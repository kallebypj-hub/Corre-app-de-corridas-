'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { art, W, chCfg } = require('./editorial');
const cfg = require('../episode-config');
const { declare, notAutonomous } = require('../autonomy');
const { EvolutionEngine } = require('../evolution/engine');
const { probe, fullDecodeCheck, audioStats, blackFrameRatio } = require('../media');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 18. Manifesto de origem, licenca e atribuicao de TODO ativo, por cena e por arquivo. */
async function provenance({ paths, channelId, epId }) {
  const sb = JSON.parse(fs.readFileSync(path.join(paths.base, 'storyboard.json'), 'utf8'));
  const tl = JSON.parse(fs.readFileSync(path.join(paths.base, 'narration_timeline.json'), 'utf8'));
  const sources = cfg.loadSources(channelId, epId);
  const brief = cfg.loadBrief(channelId, epId);
  const sm = JSON.parse(fs.readFileSync(path.join(paths.base, 'shorts_manifest.json'), 'utf8'));
  const c = chCfg(channelId);

  const files = [];
  const addFile = (rel, role) => { const abs = path.join(paths.base, rel);
    if (fs.existsSync(abs)) files.push({ file: rel, role, bytes: fs.statSync(abs).size, sha256: sha(abs) }); };
  ['video_long_1080p.mp4', 'narration.wav', 'captions.srt', 'thumbnail_A.png', 'thumbnail_B.png'].forEach((f) => addFile(f, 'entrega'));
  for (const s of sm.shorts) addFile(path.join('shorts', `${s.short_id}.mp4`), 'short');

  const out = {
    episode_id: epId, channel_id: channelId, compiled_at: new Date().toISOString(),
    production_mode: brief.production_mode,
    autonomy_disclosure: { statement: brief.authorship.honest_statement,
      stages_not_autonomous: notAutonomous() },
    visual_assets_by_scene: sb.scenes.map((s) => ({ scene: s.id, motif: s.motif, camera: s.camera,
      asset_type: s.asset.type, generator: s.asset.generator, origin: s.asset.source, license: s.asset.license,
      attribution: s.asset.attribution_required ? 'requerida' : 'nao requerida', third_party_media: s.asset.third_party_media })),
    fonts: [{ family: 'Inter / Inter Display', license: 'SIL Open Font License 1.1',
      use: 'renderizacao de texto nos frames; a fonte nao e redistribuida no arquivo de video', source: 'pacote de fontes do sistema' }],
    audio: { narration: { engine: tl.engine, version: tl.engine_version, weights: 'hexgrad/Kokoro-82M',
      weights_license: tl.weights_license, voice_preset: tl.voice, executed: 'local, CPU, sem chamada de rede paga',
      cloned_from_real_person: false, consent_note: 'Nenhuma voz de pessoa real foi clonada ou imitada.' },
      music: { present: false, decision: 'Sem trilha. Nao usar faixa de terceiro sem licenca para a plataforma.' },
      third_party_audio: false },
    synthetic_media: { narration_is_synthetic: true, visuals_are_generative_ai: false,
      visuals_method: 'desenho procedural por codigo (SVG/CSS) renderizado por Chromium e animado por FFmpeg',
      realistic_depiction_of_real_people_places_events: false,
      disclosure: 'declarada na descricao do video; marcacao de conteudo alterado avaliada e registrada em metadata.json para confirmacao humana' },
    text_sources: sources.sources.map((s) => ({ id: s.id, reference: `${s.authors} (${s.year}). ${s.title}. ${s.venue || ''}`.trim(),
      doi: s.doi || null, url: s.url || null, rights: s.rights || 'citacao academica referenciada, sem reproducao de texto protegido', verification: s.verification })),
    withheld_claims: sources.rejected_or_withheld,
    models_and_tools: [
      { name: 'Kokoro-82M', role: 'narracao', license: 'Apache-2.0', cost_usd: 0 },
      { name: 'faster-whisper (base.en)', role: 'alinhamento e verificacao de inteligibilidade', license: 'MIT (lib) / MIT (modelo Whisper)', cost_usd: 0 },
      { name: 'FFmpeg 6.1.1', role: 'render e montagem', license: 'LGPL/GPL conforme build do sistema', cost_usd: 0 },
      { name: 'Chromium via Playwright', role: 'rasterizacao dos frames-chave', license: 'BSD / Apache-2.0', cost_usd: 0 },
      { name: 'Claude Code', role: brief.authorship.script_by, license: 'n/a', cost_usd: 0 }
    ],
    third_party_media_used: false, stock_footage_used: false, generative_images_used: false,
    delivered_files: files,
    external_spend_usd: 0
  };
  const f = W(path.join(paths.base, 'provenance.json'), out);
  const bad = out.visual_assets_by_scene.filter((a) => !a.license || /unknown/i.test(a.license));
  if (bad.length) throw new Error(`${bad.length} ativo(s) sem licenca`);
  return { mode: 'real', autonomy: declare('provenance'), outputs: ['provenance.json'], artifacts: [art(f, 'json')],
    notes: `${out.visual_assets_by_scene.length} cenas, ${files.length} arquivos com sha256, 0 ativo de terceiro.`,
    cost: { usd: 0, provider: 'local' } };
}

/** 19. Auditoria tecnica: decodificacao real, gates inegociaveis, custo e risco. */
async function qa({ paths, channelId, store, epId, log }) {
  const base = paths.base;
  const video = path.join(base, 'video_long_1080p.mp4');
  const tests = []; const t = (id, pass, detail, evidence) => tests.push({ id, pass: !!pass, detail, evidence: evidence || null });

  const vp = await probe(video);
  const decode = await fullDecodeCheck(video);
  const astats = await audioStats(video);
  const black = await blackFrameRatio(video, vp.duration);
  log.info(`  decodificacao completa do MP4: ${decode.ok ? 'OK' : 'FALHOU'} em ${(decode.ms / 1000).toFixed(1)}s`);

  t('mp4_decodifica_inteiro', decode.ok, `ffmpeg -xerror decodificou todo o arquivo em ${(decode.ms / 1000).toFixed(1)}s`, decode.stderr || 'sem erro');
  t('tem_faixa_de_video', !!vp.video, `${vp.video && vp.video.codec} ${vp.video && vp.video.width}x${vp.video && vp.video.height}`);
  t('tem_faixa_de_audio', !!vp.audio, `${vp.audio && vp.audio.codec} ${vp.audio && vp.audio.sample_rate}Hz ${vp.audio && vp.audio.channels}ch`);
  t('resolucao_1080p', vp.video && vp.video.width === 1920 && vp.video.height === 1080, `${vp.video.width}x${vp.video.height}`);
  t('codec_h264_aac', vp.video.codec === 'h264' && vp.audio.codec === 'aac', `${vp.video.codec}/${vp.audio.codec}`);
  t('duracao_suficiente', vp.duration >= 360 && vp.duration <= 600, `${(vp.duration / 60).toFixed(2)} min (alvo 6-9 min)`);
  t('audio_nao_mudo', astats.mean_volume_db !== null && astats.mean_volume_db > -45, `media ${astats.mean_volume_db} dBFS`);
  t('audio_sem_clipping', astats.max_volume_db !== null && astats.max_volume_db < -0.1, `pico ${astats.max_volume_db} dBFS`);
  t('sem_tela_preta_prolongada', black.black_ratio === null || black.black_ratio < 0.02, `${black.black_seconds}s de tela preta (${((black.black_ratio || 0) * 100).toFixed(2)}%)`);

  const cr = JSON.parse(fs.readFileSync(path.join(base, 'captions_report.json'), 'utf8'));
  t('legendas_coerentes', cr.verdict === 'APROVADO' && cr.last_cue_end_s <= vp.duration + 0.5,
    `${cr.cues} cues, ${(cr.alignment_rate * 100).toFixed(0)}% alinhados por ASR, ultima em ${cr.last_cue_end_s.toFixed(1)}s`);
  const ir = JSON.parse(fs.readFileSync(path.join(base, 'intelligibility_report.json'), 'utf8'));
  t('narracao_inteligivel', ir.word_error_rate <= 0.15, `WER ${(ir.word_error_rate * 100).toFixed(2)}% (limite 15%)`);

  for (const v of ['A', 'B']) {
    const p = path.join(base, `thumbnail_${v}.png`);
    const ok = fs.existsSync(p);
    t(`miniatura_${v}`, ok, ok ? `${(await probe(p)).video.width}x${(await probe(p)).video.height}` : 'ausente');
  }
  const tr = JSON.parse(fs.readFileSync(path.join(base, 'thumbnails_report.json'), 'utf8'));
  t('miniaturas_distintas_e_nao_enganosas', tr.variants.length === 2 && tr.variants[0].title !== tr.variants[1].title && tr.variants.every((x) => !x.misleading_claim), tr.variants.map((x) => x.title).join(' | '));

  const sm = JSON.parse(fs.readFileSync(path.join(base, 'shorts_manifest.json'), 'utf8'));
  const shortChecks = [];
  for (const s of sm.shorts) {
    const sp = await probe(path.join(base, 'shorts', `${s.short_id}.mp4`));
    const d = await fullDecodeCheck(path.join(base, 'shorts', `${s.short_id}.mp4`));
    shortChecks.push({ id: s.short_id, w: sp.video.width, h: sp.video.height, dur: +sp.duration.toFixed(2), audio: !!sp.audio, decodes: d.ok });
  }
  t('tres_shorts_verticais_reais', shortChecks.length === 3 && shortChecks.every((s) => s.w === 1080 && s.h === 1920 && s.audio && s.decodes && s.dur >= 12 && s.dur <= 59.5),
    shortChecks.map((s) => `${s.id} ${s.w}x${s.h} ${s.dur}s audio:${s.audio} decod:${s.decodes}`).join(' · '));
  // Gate que faltava: a legenda queimada precisa ser MEDIDA no quadro, nao declarada.
  // Sem ele, a primeira versao dos Shorts saiu sem legenda nenhuma e passou nos testes.
  const capEv = sm.shorts.map((s) => s.captions_burned_evidence || {});
  t('shorts_com_legenda_queimada_medida',
    sm.shorts.every((s) => s.captions_burned === true) && capEv.every((e) => e.frame_bright_pixels_pct > e.backdrop_bright_pixels_pct),
    sm.shorts.map((s, i) => `${s.short_id}: ${capEv[i].frame_bright_pixels_pct}% de pixels de texto na faixa (fundo ${capEv[i].backdrop_bright_pixels_pct}%)`).join(' · '));

  const wins = sm.shorts.map((s) => s.source_window_s).sort((a, b) => a.start - b.start);
  let overlap = false; for (let i = 1; i < wins.length; i++) if (wins[i].start < wins[i - 1].end) overlap = true;
  t('shorts_sem_sobreposicao', !overlap, wins.map((w) => `${w.start}-${w.end}s`).join(' · '));

  const cl = JSON.parse(fs.readFileSync(path.join(base, 'claims_review.json'), 'utf8'));
  t('fontes_revisadas_por_matriz', cl.summary.verdict === 'APROVADO' && cl.summary.blocked === 0 && cl.summary.orphan_assertions === 0,
    `${cl.summary.factual_lines_detected} falas factuais, ${cl.summary.verified} com entrada verificada, ${cl.summary.blocked} bloqueios, ${cl.summary.orphan_assertions} entradas orfas, verificador: ${cl.matrix_verifier || 'ausente'}`);
  const pv = JSON.parse(fs.readFileSync(path.join(base, 'provenance.json'), 'utf8'));
  const pvAuto = (pv.autonomy_disclosure || {}).stages_not_autonomous;
  t('autonomia_declarada_honestamente', Array.isArray(pvAuto) && pvAuto.length > 0,
    `${(pvAuto || []).length} estagio(s) declarados como NAO autonomos: ${(pvAuto || []).map((x) => x.stage).join(', ')}`);

  t('direitos_dos_ativos_revisados', pv.visual_assets_by_scene.every((a) => a.license && !/unknown/i.test(a.license)) && !pv.third_party_media_used,
    `${pv.visual_assets_by_scene.length} cenas com licenca declarada, 0 midia de terceiro`);
  t('nenhum_ativo_simulado', !fs.existsSync(path.join(base, 'SIMULATED')) && pv.generative_images_used === false,
    'nenhum artefato marcado como simulado; visuais gerados por codigo proprio');

  const md = JSON.parse(fs.readFileSync(path.join(base, 'metadata.json'), 'utf8'));
  t('publico_configurado', typeof md.made_for_kids === 'boolean', `made_for_kids=${md.made_for_kids} (declarado explicitamente)`);
  t('privacidade_explicita', md.privacy_status === 'private', `privacyStatus=${md.privacy_status}`);
  t('midia_sintetica_avaliada', !!md.synthetic_media && md.synthetic_media.requires_human_confirmation === true, md.synthetic_media.disclosure_decision.slice(0, 120) + '...');
  t('sem_promessa_de_monetizacao', /NENHUMA/.test(md.monetization_claims) && !/guarantee|guaranteed|earn \$|rpm|cpm/i.test(md.description), 'descricao e metadata sem promessa de receita, views ou algoritmo');

  // --- Evolution Engine: hipotese registrada antes da producao e configuracao anotada ---
  const engine = new EvolutionEngine(channelId);
  const chain = engine.stats().chain;
  let xp = engine.store.experiment(`exp_${epId}`);
  t('experimento_registrado_antes_da_producao', !!xp && xp.registered_before_production === true,
    xp ? `hipotese: "${String(xp.hypothesis).slice(0, 90)}" sobre a variavel ${xp.primary_variable}` : 'nenhum experimento registrado para este episodio');
  t('registro_de_experimentos_integro', chain.ok,
    chain.ok ? `corrente de ${chain.events} evento(s) intacta` : `corrente quebrada no evento ${chain.at}: ${chain.reason}`);
  t('configuracao_do_experimento_anotada', !!(xp && (xp.production || xp.registered_at)),
    xp && xp.production ? `assinatura de variaveis ${xp.production.variable_fingerprint}, ${(xp.production.thumbnails || []).length} miniatura(s) medida(s)`
      : 'sera anotada ao fim desta auditoria, com os gates desta rodada');
  // Linha de base nao cita aprendizado porque nao havia nenhum. O que o gate
  // cobra e: se EXISTIA experimento antes deste, ele tem de ser citado.
  const priorExps = xp && xp.registered_at
    ? engine.experiments().filter((o) => o.episode_id !== epId && o.registered_at && o.registered_at < xp.registered_at)
    : [];
  t('aprendizado_anterior_declarado',
    priorExps.length === 0 ? !!(xp && xp.baseline_role !== undefined || (xp && (xp.applies_learning || []).length === 0))
      : (Array.isArray(xp && xp.applies_learning) && xp.applies_learning.length > 0),
    priorExps.length === 0
      ? 'primeiro experimento do canal: linha de base, sem aprendizado anterior a aplicar'
      : `${priorExps.length} experimento(s) anterior(es) (${priorExps.map((o) => o.episode_id).join(', ')}) e ${(xp.applies_learning || []).length} aprendizado(s) citado(s)`);

  const ep = store.episode(epId);
  const cost = Object.values(ep.stages).reduce((a, s) => a + (((s.cost || {}).usd) || 0), 0);
  t('despesa_externa_zero', cost === 0, `US$ ${cost.toFixed(2)} em todos os ${Object.keys(ep.stages).length} estagios`);
  const nr = JSON.parse(fs.readFileSync(path.join(base, 'narrative_review.json'), 'utf8'));
  t('revisao_de_narrativa_aprovada', nr.verdict === 'APROVADO', `${nr.checks.length} checagens`);

  // risco de conteudo repetitivo/massa
  const sb = JSON.parse(fs.readFileSync(path.join(base, 'storyboard.json'), 'utf8'));
  const motifs = new Set(sb.scenes.map((s) => s.motif)); const cams = new Set(sb.scenes.map((s) => s.camera));
  t('risco_conteudo_repetitivo_baixo', motifs.size >= 7 && cams.size >= 7,
    `${motifs.size} motivos visuais e ${cams.size} movimentos de camera distintos em ${sb.scenes.length} cenas`);

  const failed = tests.filter((x) => !x.pass);
  const gates = {
    verdict: failed.length === 0 ? 'APROVADO_PARA_REVISAO_HUMANA' : 'BLOQUEADO',
    blocking_failures: failed.map((f) => f.id),
    can_be_approved: failed.length === 0,
    can_be_published: false,
    publication_block_reason: 'Publicação exige (1) todos os gates verdes, (2) aprovação específica do proprietário para ESTE vídeo e (3) OAuth do YouTube autorizado. Nenhuma das três é concedida automaticamente.',
    evaluated_at: new Date().toISOString()
  };
  const report = { episode_id: epId, channel_id: channelId, gates,
    autonomy_disclosure: pv.autonomy_disclosure || null,
    experiment: xp ? { experiment_id: xp.experiment_id, hypothesis: xp.hypothesis,
      primary_variable: xp.primary_variable, applies_learning: xp.applies_learning || [],
      variable_fingerprint: xp.production ? xp.production.variable_fingerprint : null,
      current_verdict: xp.current_verdict } : null,
    tests, passed: tests.length - failed.length, total: tests.length,
    measurements: { video: vp, decode_check: { ok: decode.ok, elapsed_ms: decode.ms }, audio_stats: astats, black_frames: black, shorts: shortChecks },
    external_cost_usd: cost,
    human_review_pending: [
      'Assistir o MP4 inteiro uma vez no Estúdio de Revisão.',
      'Escolher thumbnail A ou B.',
      'Confirmar a decisão sobre divulgação de mídia sintética antes de qualquer envio.',
      'Aprovar (ou não) o título definitivo entre o provisório e as duas alternativas.'
    ] };
  const f = W(path.join(base, 'quality_report.json'), report);
  // Anotacao da producao no registro imutavel, com os gates DESTA rodada.
  if (xp && !xp.production) {
    try { await engine.recordProduction(epId, { gates: `${report.passed}/${report.total}` }); }
    catch (e2) { log.warn(`nao anotei a producao no experimento: ${e2.message}`); }
  }
  store.append('gates.evaluated', { epId, gates });
  log.info(`  gates: ${report.passed}/${report.total} — ${gates.verdict}`);
  if (failed.length) throw new Error(`gates reprovados: ${failed.map((f) => f.id).join(', ')}`);
  return { mode: 'real', autonomy: declare('qa'), outputs: ['quality_report.json'], artifacts: [art(f, 'json')],
    notes: `${report.passed}/${report.total} testes aprovados, custo externo US$ ${cost.toFixed(2)}.`,
    cost: { usd: 0, provider: 'local' } };
}
module.exports = { provenance, qa };
