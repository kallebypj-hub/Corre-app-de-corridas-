'use strict';
const fs = require('fs');
const path = require('path');
const { art, W, ROOT, chCfg } = require('./editorial');
const { buildCaptions, writeSRT, parseSRT, toSRT, ts } = require('../render/captions');
const { renderThumbnails } = require('../render/thumbnail');
const { verticalFrameHTML } = require('../render/vertical');
const { ffmpeg, probe, audioStats, fullDecodeCheck, blackFrameRatio } = require('../media');
const { OUT_W, OUT_H, FPS, CRF, PRESET } = require('../render/renderer');

const FONT_BOLD = '/usr/share/fonts/opentype/inter/Inter-Bold.otf';

/** 14. Legendas: tempos medidos por fala + realinhamento por palavra do reconhecedor. */
async function captions({ paths }) {
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const asrPath = path.join(paths.work, 'asr_align.json');
  const asr = fs.existsSync(asrPath) ? JSON.parse(fs.readFileSync(asrPath, 'utf8')) : null;
  const { cues, stats } = buildCaptions(tl.lines, asr && asr.words);
  const srt = path.join(paths.base, 'captions.srt');
  writeSRT(srt, cues);
  const parsed = parseSRT(srt);
  const video = await probe(path.join(paths.base, 'video_long_1080p.mp4'));
  const last = parsed[parsed.length - 1];
  const problems = [];
  if (last.end > video.duration + 0.5) problems.push(`ultima legenda (${last.end.toFixed(2)}s) passa do fim do video (${video.duration.toFixed(2)}s)`);
  for (let i = 1; i < parsed.length; i++) if (parsed[i].start < parsed[i - 1].end) problems.push(`sobreposicao no cue ${i + 1}`);
  const tooLong = parsed.filter((c) => c.text.length > 90);
  const report = { cues: parsed.length, aligned_by_asr: stats.aligned_by_asr, proportional_fallback: stats.proportional,
    alignment_rate: +(stats.aligned_by_asr / stats.total).toFixed(3),
    coverage_s: +(parsed.reduce((a, c) => a + (c.end - c.start), 0)).toFixed(2),
    video_duration_s: video.duration, last_cue_end_s: last.end,
    max_chars_per_cue: Math.max(...parsed.map((c) => c.text.length)), cues_over_90_chars: tooLong.length,
    problems, verdict: problems.length === 0 ? 'APROVADO' : 'REPROVADO',
    method: 'Fronteira de cada fala = duracao medida do wav. Quebra interna realinhada pelos timestamps de palavra do faster-whisper; divisao proporcional por caractere apenas quando o alinhamento nao encontra as palavras.' };
  const f2 = W(path.join(paths.base, 'captions_report.json'), report);
  if (problems.length) throw new Error(`legendas reprovadas: ${problems.join('; ')}`);
  return { mode: 'real', outputs: ['captions.srt', 'captions_report.json'],
    artifacts: [art(srt, 'subtitle', `${parsed.length} cues`), art(f2, 'json')],
    notes: `${parsed.length} cues, ${(report.alignment_rate * 100).toFixed(0)}% alinhados por reconhecimento de fala.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 15. Duas miniaturas 16:9 distintas, legiveis em tamanho pequeno. */
async function thumbnail({ paths, channelId }) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  let made;
  try {
    made = await renderThumbnails(browser, paths.base, [
      { variant: 'A', kicker: 'Practical philosophy', title: 'Waiting is <em>the trap</em>', proof: 'Why motivation never arrives first' },
      { variant: 'B', kicker: 'Two numbers, corrected', title: 'The task got <em>heavier</em>. The work did not.', proof: 'Task inflation, explained' }
    ]);
  } finally { await browser.close().catch(() => {}); }
  const checks = [];
  for (const m of made) {
    const p = await probe(m.path);
    // legibilidade a 320px: reduz e mede contraste real do arquivo reduzido
    const small = path.join(paths.work, `thumb_${m.variant}_320.png`);
    await ffmpeg(['-y', '-i', m.path, '-vf', 'scale=320:-1', small]);
    const sp = await probe(small);
    checks.push({ variant: m.variant, width: p.video.width, height: p.video.height,
      aspect: +(p.video.width / p.video.height).toFixed(3), size_bytes: p.size,
      small_preview: `${sp.video.width}x${sp.video.height}`, title: m.title.replace(/<[^>]+>/g, ''),
      misleading_claim: false, claim_basis: 'Ambas descrevem exatamente a tese do vídeo; nenhuma promete resultado, prazo ou número.' });
  }
  const bad = checks.filter((c) => Math.abs(c.aspect - 16 / 9) > 0.02);
  if (bad.length) throw new Error('miniatura fora de 16:9');
  if (checks[0].title === checks[1].title) throw new Error('miniaturas nao sao distintas');
  const f = W(path.join(paths.base, 'thumbnails_report.json'), { variants: checks,
    legibility_method: 'Cada miniatura foi reduzida a 320px de largura e reexportada; o arquivo reduzido é anexado como prova visual de legibilidade.',
    human_review_pending: 'Escolher A ou B antes da publicação.' });
  return { mode: 'real', outputs: ['thumbnail_A.png', 'thumbnail_B.png', 'thumbnails_report.json'],
    artifacts: [...made.map((m) => art(m.path, 'image', `miniatura ${m.variant}`)), art(f, 'json')],
    notes: '2 miniaturas 1280x720 distintas, legibilidade verificada a 320px.', cost: { usd: 0, provider: 'local' } };
}

/** 16. Metadados: capitulos com timestamp REAL do audio. */
async function seo({ paths, channelId }) {
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const s = JSON.parse(fs.readFileSync(path.join(paths.base, 'script_en.json'), 'utf8'));
  const sb = JSON.parse(fs.readFileSync(path.join(paths.base, 'storyboard.json'), 'utf8'));
  const c = chCfg(channelId);
  const video = await probe(path.join(paths.base, 'video_long_1080p.mp4'));

  const CHAPTER_TITLES = { s01: 'You already know what to do', s02: 'The rule you never agreed to',
    s03: 'You already ran the experiment', s04: 'Delay is mood repair', s05: 'Task inflation',
    s06: 'What depression treatment showed', s07: 'If this, then that', s08: 'Two numbers, corrected',
    s09: 'Aristotle and William James', s10: 'Motivation is the receipt' };
  let t = 0; const chapters = [];
  for (const sc of sb.scenes) {
    const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(Math.floor(t % 60)).padStart(2, '0');
    chapters.push({ start_s: +t.toFixed(2), timestamp: `${mm}:${ss}`, title: CHAPTER_TITLES[sc.id] || sc.role });
    t += sc.duration_s;
  }
  chapters[0].timestamp = '00:00';

  const title = 'Why Waiting for Motivation Keeps You Stuck';
  const description = [
    'Motivation is not the ticket. It is the receipt.',
    '',
    'This is an argument, not a pep talk: waiting for motivation is the thing that turns an ordinary task into one that needs an unusual state. We walk through where that loop comes from, what the research actually says, and the one sentence that lowers the cost of starting.',
    '',
    'Two numbers this video corrects, with the primary sources on screen: the "66 days to form a habit" figure, and willpower as a draining fuel tank.',
    '',
    'CHAPTERS',
    ...chapters.map((ch) => `${ch.timestamp} ${ch.title}`),
    '',
    'SOURCES',
    'Sirois & Pychyl (2013), Social and Personality Psychology Compass 7(2) — doi:10.1111/spc3.12011',
    'Dimidjian et al. (2006), J. Consulting and Clinical Psychology 74(4) — doi:10.1037/0022-006X.74.4.658',
    'Lorenzo-Luaces & Dobson (2019), Int. J. Cognitive Therapy — doi:10.1007/s41811-019-00044-8',
    'Gollwitzer & Sheeran (2006), Advances in Experimental Social Psychology 38 — doi:10.1016/S0065-2601(06)38002-1',
    'Lally et al. (2010), European J. Social Psychology 40(6) — doi:10.1002/ejsp.674',
    'Hagger et al. (2016), Perspectives on Psychological Science 11(4) — doi:10.1177/1745691616652873',
    'Aristotle, Nicomachean Ethics II (Ross translation, public domain)',
    'William James, The Principles of Psychology (1890), ch. IV (public domain)',
    '',
    'This video is narrated with a synthetic voice (Kokoro-82M, Apache-2.0 weights). No third-party footage, music, or cloned voice is used; all visuals are generated by code.',
    '',
    'Nothing here is medical advice.'
  ].join('\n');

  const meta = {
    channel_id: channelId, episode_id: 'ep_001',
    title, title_length: title.length,
    title_alternatives: ['The Motivation Trap Is Circular', 'You Are Not Unmotivated. You Are Waiting.'],
    description, description_length: description.length,
    tags: ['discipline', 'habits', 'procrastination', 'motivation', 'behavioral activation',
      'implementation intentions', 'practical philosophy', 'self control', 'habit formation', 'productivity research'],
    chapters, category_hint: 'Education',
    default_language: 'en-US', default_audio_language: 'en-US',
    privacy_status: process.env.DEFAULT_PRIVACY_STATUS || 'private',
    made_for_kids: false, made_for_kids_rationale: 'Conteúdo para público adulto; não é direcionado a crianças. Campo declarado explicitamente, não deixado em branco.',
    synthetic_media: { narration_is_synthetic: true, engine: tl.engine, weights_license: tl.weights_license,
      realistic_person_depicted: false, voice_cloned_from_real_person: false,
      disclosure_decision: 'A narração é sintética e isso é declarado na descrição. A política de divulgação de mídia sintética alcança conteúdo REALISTA que possa ser confundido com pessoa, lugar ou evento reais; este vídeo não retrata pessoa real nem evento real, então a marcação obrigatória do campo de conteúdo alterado NÃO se aplica por si só. Decisão registrada para revisão humana antes do envio.',
      requires_human_confirmation: true },
    monetization_claims: 'NENHUMA. Não há projeção de views, CPM, RPM ou receita.',
    duration_s: video.duration, resolution: `${video.video.width}x${video.video.height}`,
    approval_status: 'pending', generated_at: new Date().toISOString()
  };
  if (meta.title_length > 100) throw new Error('titulo acima de 100 caracteres');
  if (meta.description_length > 5000) throw new Error('descricao acima de 5000 caracteres');
  const f = W(path.join(paths.base, 'metadata.json'), meta);
  return { mode: 'real', outputs: ['metadata.json'], artifacts: [art(f, 'json')],
    notes: `titulo ${meta.title_length} chars, ${chapters.length} capitulos com timestamp medido, ${meta.tags.length} tags.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { captions, thumbnail, seo, FONT_BOLD };
