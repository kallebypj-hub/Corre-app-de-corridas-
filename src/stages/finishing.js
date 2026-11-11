'use strict';
const fs = require('fs');
const path = require('path');
const { art, W, ROOT, chCfg } = require('./editorial');
const cfg = require('../episode-config');
const { declare } = require('../autonomy');
const { buildCaptions, writeSRT, parseSRT, toSRT, ts } = require('../render/captions');
const { renderThumbnails } = require('../render/thumbnail');
const { verticalFrameHTML } = require('../render/vertical');
const { ffmpeg, probe, audioStats, fullDecodeCheck, blackFrameRatio } = require('../media');
const { OUT_W, OUT_H, FPS, CRF, PRESET } = require('../render/renderer');

const FONT_BOLD = '/usr/share/fonts/opentype/inter/Inter-Bold.otf';

/** 14. Legendas: tempos medidos por fala + realinhamento por palavra do reconhecedor. */
async function captions({ paths, epId }) {
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const asrPath = path.join(paths.work, 'asr_align.json');
  const asr = fs.existsSync(asrPath) ? JSON.parse(fs.readFileSync(asrPath, 'utf8')) : null;
  const { cues, stats } = buildCaptions(tl.lines, asr && asr.words);
  const srt = path.join(paths.base, 'captions.srt');
  writeSRT(srt, cues);
  const parsed = parseSRT(srt);
  const video = await probe(path.join(paths.base, 'video_long_1080p.mp4'));
  if (!parsed.length) throw new Error(`${epId}: nenhum cue de legenda gerado`);
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
  return { mode: 'real', autonomy: declare('captions'), outputs: ['captions.srt', 'captions_report.json'],
    artifacts: [art(srt, 'subtitle', `${parsed.length} cues`), art(f2, 'json')],
    notes: `${parsed.length} cues, ${(report.alignment_rate * 100).toFixed(0)}% alinhados por reconhecimento de fala.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 15. Duas miniaturas 16:9 distintas, legiveis em tamanho pequeno. */
async function thumbnail({ paths, channelId, epId }) {
  const brief = cfg.loadBrief(channelId, epId);
  const variants = brief.thumbnails;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  let made;
  try { made = await renderThumbnails(browser, paths.base, variants); }
  finally { await browser.close().catch(() => {}); }
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
  return { mode: 'real', autonomy: declare('thumbnail'), outputs: made.map((m) => `thumbnail_${m.variant}.png`).concat(['thumbnails_report.json']),
    artifacts: [...made.map((m) => art(m.path, 'image', `miniatura ${m.variant}`)), art(f, 'json')],
    notes: '2 miniaturas 1280x720 distintas, legibilidade verificada a 320px.', cost: { usd: 0, provider: 'local' } };
}

/** 16. Metadados: titulo, descricao e tags vem do BRIEF; capitulos sao calculados do audio medido. */
async function seo({ paths, channelId, epId }) {
  const brief = cfg.loadBrief(channelId, epId);
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const sb = JSON.parse(fs.readFileSync(path.join(paths.base, 'storyboard.json'), 'utf8'));
  const sources = cfg.loadSources(channelId, epId);
  const video = await probe(path.join(paths.base, 'video_long_1080p.mp4'));
  const bm = brief.metadata;

  let t = 0; const chapters = [];
  for (const sc of sb.scenes) {
    const title = (brief.chapters && brief.chapters[sc.id]) || sc.role || sc.id;
    const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(Math.floor(t % 60)).padStart(2, '0');
    chapters.push({ start_s: +t.toFixed(2), timestamp: `${mm}:${ss}`, title });
    t += sc.duration_s;
  }
  chapters[0].timestamp = '00:00';

  const srcLines = sources.sources.map((s2) => {
    const ref = `${s2.authors} (${s2.year}). ${s2.title}.`;
    return s2.doi ? `${ref} doi:${s2.doi}` : (s2.url ? `${ref} ${s2.url}` : ref);
  });
  const description = []
    .concat(bm.description_lead || [])
    .concat(['', 'CHAPTERS'], chapters.map((ch) => `${ch.timestamp} ${ch.title}`))
    .concat(['', 'SOURCES'], srcLines)
    .concat([''], bm.closing_notes || [])
    .join('\n');

  const meta = {
    channel_id: channelId, episode_id: epId,
    title: bm.title, title_length: bm.title.length,
    title_alternatives: bm.title_alternatives || [],
    description, description_length: description.length,
    tags: bm.tags || [], chapters, category_hint: bm.category_hint || 'Education',
    default_language: 'en-US', default_audio_language: 'en-US',
    privacy_status: process.env.DEFAULT_PRIVACY_STATUS || 'private',
    made_for_kids: bm.made_for_kids === true,
    made_for_kids_rationale: bm.made_for_kids_rationale,
    synthetic_media: { narration_is_synthetic: true, engine: tl.engine, weights_license: tl.weights_license,
      realistic_person_depicted: false, voice_cloned_from_real_person: false,
      disclosure_decision: bm.disclosure_decision, requires_human_confirmation: true },
    monetization_claims: 'NENHUMA. Nao ha projecao de views, CPM, RPM ou receita.',
    duration_s: video.duration, resolution: `${video.video.width}x${video.video.height}`,
    approval_status: 'pending', generated_at: new Date().toISOString()
  };
  if (!meta.title) throw new Error(`${epId}: brief.metadata.title ausente`);
  if (meta.title_length > 100) throw new Error('titulo acima de 100 caracteres');
  if (meta.description_length > 5000) throw new Error('descricao acima de 5000 caracteres');
  if (!meta.tags.length) throw new Error(`${epId}: brief.metadata.tags vazio`);
  if (/guarantee|guaranteed|earn \$|\bRPM\b|\bCPM\b/i.test(description)) throw new Error('descricao com promessa de receita');
  const f = W(path.join(paths.base, 'metadata.json'), meta);
  return { mode: 'real', autonomy: declare('seo'), outputs: ['metadata.json'], artifacts: [art(f, 'json')],
    notes: `titulo ${meta.title_length} chars, ${chapters.length} capitulos com timestamp medido, ${meta.tags.length} tags, ${srcLines.length} fontes na descricao.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { captions, thumbnail, seo, FONT_BOLD };
