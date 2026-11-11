'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { art, W, ROOT, chCfg } = require('./editorial');
const cfg = require('../episode-config');
const { declare } = require('../autonomy');
const { LocalTTS, TTS_PYTHON } = require('../tts/local-tts');
const { SceneRenderer, OUT_W, OUT_H, FPS, CRF, PRESET, motionFor } = require('../render/renderer');
const { ffmpeg, probe, audioStats } = require('../media');

const PAUSE = { beat: 0.38, scene: 1.10, lead: 0.60, outro: 1.80 };
const SR = 24000;

/** 8. Storyboard: cena, texto na tela, ativo, licenca, narracao e proposito visual. */
async function storyboard({ paths, channelId, epId }) {
  const s = cfg.loadScript(channelId, epId);
  const c = chCfg(channelId);
  const scenes = s.scenes.map((sc, i) => ({
    id: sc.id, index: i, role: sc.role, motif: sc.motif, accent: sc.accent,
    visual_purpose: sc.purpose,
    camera: motionFor(i).name,
    on_screen: sc.on_screen,
    narration: sc.beats.map((b) => b.text),
    beats: sc.beats.map((b, k) => ({ index: k, text: b.text, screen: b.screen, duration_s: null })),
    duration_s: null,
    asset: { type: 'motion_graphics_generated_by_code', generator: 'src/render/compose.js',
      source: 'obra original do canal', license: 'proprietario do canal (gerado por codigo nesta producao)',
      attribution_required: false, third_party_media: false,
      fonts: [{ family: c.visual_identity.type.display, license: c.visual_identity.type.license },
              { family: c.visual_identity.type.body, license: c.visual_identity.type.license }] }
  }));
  const out = { episode_id: epId, channel_id: channelId, visual_identity: c.visual_identity,
    note: 'Duracoes ficam null ate o estagio de voz medir o audio real. Nenhuma duracao estimada entra no storyboard final.',
    scenes };
  const f = W(path.join(paths.base, 'storyboard.json'), out);
  return { mode: 'real', autonomy: declare('storyboard'), outputs: ['storyboard.json'], artifacts: [art(f, 'json')],
    notes: `${scenes.length} cenas, ${scenes.length} motivos visuais distintos, cameras: ${[...new Set(scenes.map(x => x.camera))].length}.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 9. Direitos: toda cena declara origem, licenca e se ha midia de terceiro. */
async function media_rights({ paths }) {
  const sb = JSON.parse(fs.readFileSync(path.join(paths.base, 'storyboard.json'), 'utf8'));
  const assets = sb.scenes.map((sc) => ({ scene: sc.id, asset_type: sc.asset.type, source: sc.asset.source,
    license: sc.asset.license, attribution: sc.asset.attribution_required ? 'requerida' : 'nao requerida',
    third_party_media: sc.asset.third_party_media, limitations: 'nenhuma — obra propria gerada por codigo nesta sessao' }));
  const unknown = assets.filter((a) => !a.license || /unknown|desconhec/i.test(a.license));
  const thirdParty = assets.filter((a) => a.third_party_media);
  const out = { verdict: unknown.length === 0 ? 'APROVADO' : 'BLOQUEIA_APROVACAO',
    assets, assets_with_unknown_license: unknown.length, third_party_assets: thirdParty.length,
    policy: ['Nenhuma foto, video, musica, cena de filme, podcast ou fala de terceiro foi usada.',
      'Nenhuma imagem generativa foi usada: todo visual e desenhado por codigo neste repositorio.',
      'Tipografia Inter sob SIL Open Font License 1.1, instalada no sistema; nao redistribuida no video.',
      'Trilha musical: ausente por decisao. O video funciona sem musica.'],
    checked_by: 'media_rights_curator', checked_at: new Date().toISOString() };
  const f = W(path.join(paths.base, 'media_rights.json'), out);
  if (unknown.length) throw new Error(`${unknown.length} ativo(s) com licenca indefinida`);
  return { mode: 'real', autonomy: declare('storyboard'), outputs: ['storyboard.json'], artifacts: [art(f, 'json')],
    notes: `${assets.length} ativos, 0 com licenca desconhecida, 0 de terceiros.`, cost: { usd: 0, provider: 'local' } };
}

async function makeSilence(file, seconds) {
  if (fs.existsSync(file)) return file;
  await ffmpeg(['-y', '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=mono`, '-t', seconds.toFixed(3), '-c:a', 'pcm_s16le', file]);
  return file;
}
async function concatWav(list, outFile, workDir) {
  const lf = path.join(workDir, `concat_${path.basename(outFile)}.txt`);
  fs.writeFileSync(lf, list.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', lf, '-c', 'copy', outFile]);
  fs.unlinkSync(lf);
  return outFile;
}

/** 10. Narracao real com TTS local. Duracao MEDIDA por fala; nada de estimativa. */
async function voice({ paths, channelId, epId, log }) {
  const s = cfg.loadScript(channelId, epId);
  const tts = new LocalTTS();
  const info = await tts.start();
  const sil = {};
  for (const [k, v] of Object.entries(PAUSE)) sil[k] = await makeSilence(path.join(paths.audio, `_sil_${k}.wav`), v);

  const timeline = []; const sceneAudio = []; const sceneDur = {}; const beatDur = {};
  let t = PAUSE.lead; let synthMs = 0;
  try {
    for (let si = 0; si < s.scenes.length; si++) {
      const sc = s.scenes[si];
      const parts = []; const bd = [];
      // O silencio de abertura entra no AUDIO e tambem na duracao do primeiro beat:
      // sem isso o video da cena 1 fica mais curto que o audio dela.
      const leadIn = si === 0 ? PAUSE.lead : 0;
      if (leadIn) parts.push(sil.lead);
      for (let bi = 0; bi < sc.beats.length; bi++) {
        const b = sc.beats[bi];
        const wav = path.join(paths.audio, `${sc.id}_b${String(bi).padStart(2, '0')}.wav`);
        const stamp = wav + '.txt';
        const t0 = Date.now();
        let r;
        if (fs.existsSync(wav) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === b.text) {
          const pw = await probe(wav);
          r = { seconds: pw.duration, cached: true };
        } else {
          r = await tts.say(b.text, wav);
          fs.writeFileSync(stamp, b.text, 'utf8');
          synthMs += Date.now() - t0;
        }
        const isLastBeat = bi === sc.beats.length - 1;
        const isLastScene = si === s.scenes.length - 1;
        const tail = isLastBeat ? (isLastScene ? PAUSE.outro : PAUSE.scene) : PAUSE.beat;
        timeline.push({ lineId: `${sc.id}_b${bi}`, scene: sc.id, beat: bi, text: b.text,
          start: +t.toFixed(4), end: +(t + r.seconds).toFixed(4), duration: r.seconds, measured: true });
        t += r.seconds + tail;
        parts.push(wav, isLastBeat ? (isLastScene ? sil.outro : sil.scene) : sil.beat);
        bd.push(+((bi === 0 ? leadIn : 0) + r.seconds + tail).toFixed(4));
      }
      const sa = path.join(paths.audio, `scene_${sc.id}.wav`);
      await concatWav(parts, sa, paths.work);
      const p = await probe(sa);
      sceneAudio.push(sa); sceneDur[sc.id] = p.duration; beatDur[sc.id] = bd;
      log.info(`  voz ${sc.id}: ${sc.beats.length} falas, ${p.duration.toFixed(2)}s`);
    }
  } finally { tts.stop(); }

  const narration = path.join(paths.base, 'narration.wav');
  await concatWav(sceneAudio, narration, paths.work);
  const np = await probe(narration);
  const st = await audioStats(narration);
  if (!np.audio) throw new Error('narration.wav sem faixa de audio');
  if (st.max_volume_db !== null && st.max_volume_db >= -0.1) throw new Error(`clipping detectado: pico ${st.max_volume_db} dBFS`);
  if (st.mean_volume_db !== null && st.mean_volume_db < -45) throw new Error(`faixa praticamente muda: media ${st.mean_volume_db} dBFS`);

  const tl = { engine: info.engine, engine_version: info.version, weights_license: info.license,
    voice: process.env.TTS_VOICE || 'am_michael', sample_rate: SR, pauses: PAUSE,
    total_duration_s: np.duration, synthesis_cpu_ms: synthMs,
    realtime_factor: synthMs > 0 ? +(np.duration / (synthMs / 1000)).toFixed(2) : null,
    audio_stats: st, scene_durations: sceneDur, beat_durations: beatDur, lines: timeline };
  const f1 = W(path.join(paths.base, 'narration_timeline.json'), tl);

  // escreve as duracoes MEDIDAS de volta no storyboard
  const sbPath = path.join(paths.base, 'storyboard.json');
  const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
  for (const sc of sb.scenes) {
    sc.duration_s = +sceneDur[sc.id].toFixed(3);
    sc.beats.forEach((b, i) => { b.duration_s = beatDur[sc.id][i]; });
  }
  sb.note = 'Duracoes medidas do audio sintetizado (amostras do wav), nao estimadas.';
  sb.total_duration_s = +np.duration.toFixed(3);
  W(sbPath, sb);

  return { mode: 'real', autonomy: declare('voice'), model: `${info.engine} ${info.version} (${info.license})`,
    outputs: ['narration.wav', 'narration_timeline.json'],
    artifacts: [art(narration, 'audio', `${np.duration.toFixed(2)}s, ${np.audio.codec} ${np.audio.sample_rate}Hz`), art(f1, 'json')],
    notes: `${timeline.length} falas sintetizadas localmente, ${np.duration.toFixed(1)}s, pico ${st.max_volume_db} dBFS, ${tl.realtime_factor}x tempo real.`,
    cost: { usd: 0, provider: 'local_kokoro' } };
}

/** 11. Alinhamento: reconhecedor local da os tempos reais por palavra e prova inteligibilidade. */
async function align({ paths, log }) {
  const narration = path.join(paths.base, 'narration.wav');
  const out = path.join(paths.work, 'asr_align.json');
  const script = path.join(ROOT, 'src', 'tts', 'asr_align.py');
  // O reconhecedor recebe o vetor ja decodificado em 16 kHz mono: evita o
  // decodificador interno (PyAV), cuja versao instalada diverge da esperada.
  const wav16 = path.join(paths.work, 'narration_16k.wav');
  await ffmpeg(['-y', '-i', narration, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav16]);
  const t0 = Date.now();
  const { stdout } = await execFileAsync(TTS_PYTHON, ['-I', script, wav16, out, process.env.ASR_MODEL || 'base.en'],
    { maxBuffer: 32 * 1024 * 1024, timeout: 1000 * 60 * 60 });
  const meta = JSON.parse(String(stdout).trim().split('\n').pop());
  const asr = JSON.parse(fs.readFileSync(out, 'utf8'));

  // WER entre o roteiro e o que o reconhecedor ouviu = prova objetiva de inteligibilidade
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ref = norm(tl.lines.map((l) => l.text).join(' ')).split(' ');
  const hyp = norm(asr.words.map((w) => w.w).join(' ')).split(' ');
  const wer = levenshteinWords(ref, hyp) / ref.length;
  const lowConf = asr.words.filter((w) => w.p < 0.5).length;
  const report = { model: meta.model, asr_duration_s: meta.duration, words_recognized: meta.words,
    reference_words: ref.length, word_error_rate: +wer.toFixed(4),
    intelligibility_verdict: wer <= 0.15 ? 'APROVADO' : 'REVISAR',
    low_confidence_words: lowConf, elapsed_ms: Date.now() - t0,
    method: 'faster-whisper local (CPU, int8). WER calculado entre o texto do roteiro e a transcricao do audio sintetizado.' };
  const f = W(path.join(paths.base, 'intelligibility_report.json'), report);
  log.info(`  WER ${(wer * 100).toFixed(2)}% (${meta.words} palavras reconhecidas)`);
  if (wer > 0.30) throw new Error(`narracao ininteligivel: WER ${(wer * 100).toFixed(1)}%`);
  return { mode: 'real', autonomy: declare('align'), model: meta.model, outputs: ['intelligibility_report.json', 'work/asr_align.json'],
    artifacts: [art(f, 'json'), art(out, 'json')],
    notes: `WER ${(wer * 100).toFixed(2)}%, ${meta.words} palavras com timestamp.`, cost: { usd: 0, provider: 'local' } };
}
function levenshteinWords(a, b) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1); let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 12. Render de cenas: cada cena vira um MP4 independente -> remontagem isolada. */
async function scenes({ paths, channelId, epId, log, onlyScene = null }) {
  const s = cfg.loadScript(channelId, epId);
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const r = new SceneRenderer();
  const made = []; const artifacts = [];
  // Impressao digital das entradas de UMA cena. Se nada que a afeta mudou e o
  // MP4 dela esta no disco, a cena e reaproveitada: corrigir uma cena nao obriga
  // a refazer as outras nove.
  // A assinatura inclui o CODIGO DE COMPOSICAO: mudar a arte de um motivo passa
  // a invalidar as cenas que o usam, em vez de deixar frame velho no arquivo final.
  const composeSrc = fs.readFileSync(path.join(__dirname, '..', 'render', 'compose.js'), 'utf8');
  const composeHash = crypto.createHash('sha256').update(composeSrc).digest('hex');
  const fingerprint = (sc, i) => crypto.createHash('sha256').update(JSON.stringify({
    scene: sc, index: i, beats: tl.beat_durations[sc.id], duration: tl.scene_durations[sc.id],
    compose: composeHash,
    renderer: { w: OUT_W, h: OUT_H, fps: FPS, crf: CRF, preset: PRESET }
  })).digest('hex');
  try {
    for (let i = 0; i < s.scenes.length; i++) {
      const sc = s.scenes[i];
      const out0 = path.join(paths.scenes, `${sc.id}.mp4`);
      const fpFile = path.join(paths.scenes, `${sc.id}.fingerprint`);
      const fp = fingerprint(sc, i);
      const unchanged = fs.existsSync(out0) && fs.existsSync(fpFile) && fs.readFileSync(fpFile, 'utf8') === fp;
      if ((onlyScene && sc.id !== onlyScene && fs.existsSync(out0)) || (!onlyScene && unchanged)) {
        const pr = await probe(out0);
        log.info(`  cena ${sc.id}: reaproveitada do checkpoint (entradas inalteradas)`);
        made.push({ id: sc.id, path: out0, duration: pr.duration, sync_delta_s: +Math.abs(pr.duration - tl.scene_durations[sc.id]).toFixed(3), reused: true });
        artifacts.push(art(out0, 'video', `${sc.id} reaproveitada`));
        continue;
      }
      const t0 = Date.now();
      const stills = await r.captureStills(sc, path.join(paths.stills, sc.id));
      const out = path.join(paths.scenes, `${sc.id}.mp4`);
      const res = await r.renderScene({ scene: sc, sceneIndex: i, stills,
        beatNatural: tl.beat_durations[sc.id], sceneDuration: tl.scene_durations[sc.id],
        outPath: out, workDir: paths.work });
      const delta = Math.abs(res.probe.duration - tl.scene_durations[sc.id]);
      if (delta > 0.25) throw new Error(`cena ${sc.id} dessincronizada: video ${res.probe.duration.toFixed(3)}s vs audio ${tl.scene_durations[sc.id].toFixed(3)}s`);
      fs.writeFileSync(fpFile, fp, 'utf8');
      log.info(`  cena ${sc.id}: ${res.beats} beats, camera ${res.motion}, ${res.probe.duration.toFixed(2)}s, ${((Date.now() - t0) / 1000).toFixed(1)}s de render`);
      made.push({ id: sc.id, path: out, motion: res.motion, duration: res.probe.duration, sync_delta_s: +delta.toFixed(3), reused: false });
      artifacts.push(art(out, 'video', `${res.probe.video.width}x${res.probe.video.height} ${res.motion}`));
    }
  } finally { await r.close(); }
  const f = W(path.join(paths.base, 'scenes_manifest.json'), { scenes: made, renderer: 'playwright+ffmpeg zoompan/xfade', width: OUT_W, height: OUT_H, fps: FPS });
  artifacts.push(art(f, 'json'));
  return { mode: 'real', autonomy: declare('scenes'), outputs: made.map((m) => `scenes/${m.id}.mp4`), artifacts,
    notes: `${made.filter(m => !m.reused).length} cena(s) renderizada(s), ${made.filter(m => m.reused).length} reaproveitada(s). Sincronia maxima fora: ${Math.max(...made.map(m => m.sync_delta_s || 0)).toFixed(3)}s.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 13. Montagem final: concatena cenas, casa com a narracao, exporta H.264 + AAC. */
async function edit({ paths, log }) {
  const man = JSON.parse(fs.readFileSync(path.join(paths.base, 'scenes_manifest.json'), 'utf8'));
  const narration = path.join(paths.base, 'narration.wav');
  const silentPath = path.join(paths.work, 'video_silent.mp4');
  const lf = path.join(paths.work, 'scenes_concat.txt');
  fs.writeFileSync(lf, man.scenes.map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`).join('\n'));
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', lf, '-c', 'copy', silentPath]);

  const out = path.join(paths.base, 'video_long_1080p.mp4');
  const t0 = Date.now();
  await ffmpeg(['-y', '-i', silentPath, '-i', narration,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-shortest', out]);
  const p = await probe(out);
  const np = await probe(narration);
  const drift = Math.abs(p.duration - np.duration);
  log.info(`  video final ${p.duration.toFixed(2)}s | audio ${np.duration.toFixed(2)}s | deriva ${drift.toFixed(3)}s | ${(p.size / 1048576).toFixed(1)} MB | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!p.video || !p.audio) throw new Error('MP4 final sem faixa de video ou audio');
  if (p.video.width !== OUT_W || p.video.height !== OUT_H) throw new Error(`resolucao errada: ${p.video.width}x${p.video.height}`);
  if (drift > 0.5) throw new Error(`deriva audio/video de ${drift.toFixed(2)}s`);
  return { mode: 'real', autonomy: declare('edit'), outputs: ['video_long_1080p.mp4'],
    artifacts: [art(out, 'video', `${p.video.width}x${p.video.height} ${p.video.codec}/${p.audio.codec} ${p.duration.toFixed(1)}s`)],
    notes: `${p.duration.toFixed(1)}s, ${(p.size / 1048576).toFixed(1)} MB, deriva A/V ${drift.toFixed(3)}s.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { storyboard, media_rights, voice, align, scenes, edit, PAUSE, concatWav, makeSilence, levenshteinWords };
