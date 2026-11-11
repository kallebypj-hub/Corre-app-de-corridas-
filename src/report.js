'use strict';
/** Gera o relatorio de entrega a partir dos dados REAIS do store e do disco. */
require('./env');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Store } = require('./store');
const { STAGES } = require('./pipeline');
const { probe } = require('./media');

const CH = process.env.CHANNEL_ID || 'ch_practical_discipline';
const { listEpisodeDirs } = require('./episode-config');
const EP = process.argv[2] || listEpisodeDirs(process.env.CHANNEL_ID || 'ch_practical_discipline')[0];
if (!EP) { console.error('nenhum episodio no disco'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'content', 'channels', CH, 'episodes', EP);
const J = (f) => JSON.parse(fs.readFileSync(path.join(BASE, f), 'utf8'));
const fmt = (n) => (n / 1048576).toFixed(2) + ' MB';

(async () => {
  const store = new Store(CH);
  const ep = store.episode(EP);
  const company = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'company.json'), 'utf8'));
  const q = J('quality_report.json'); const md = J('metadata.json'); const pv = J('provenance.json');
  const tl = J('narration_timeline.json'); const ir = J('intelligibility_report.json');
  const cr = J('captions_report.json'); const cl = J('claims_review.json'); const sm = J('shorts_manifest.json'); const sb = J('storyboard.json');
  const vp = await probe(path.join(BASE, 'video_long_1080p.mp4'));
  const ytState = await require('./youtube/oauth').state(CH).catch((e) => ({ status: 'ERRO', reason: e.message, upload_possible: false, analytics_possible: false }));
  const pubs = (store.state.publications || []).filter((x) => x.video_id);

  const agentsRan = [...new Set(Object.values(ep.stages).filter((s) => s.status === 'done').map((s) => s.agent))];
  const totalMs = Object.values(ep.stages).reduce((a, s) => a + (s.durationMs || 0), 0);
  const L = [];
  L.push('# Entrega do piloto — youtube-media-company', '', `Gerado automaticamente a partir do store e do disco em ${new Date().toISOString()}.`, '',
    '## Máquina', '', '| Item | Valor |', '|---|---|',
    `| Sistema | ${os.platform()} ${os.release()} |`, `| CPU | ${(os.cpus()[0] || {}).model} · ${os.cpus().length} vCPU |`,
    `| Memória | ${(os.totalmem() / 1073741824).toFixed(1)} GB |`, `| Node | ${process.version} |`, '',
    '## Pipeline executado', '', '| Estágio | Agente | Autonomia | Tempo | Artefatos | Custo |', '|---|---|---|---|---|---|');
  for (const s of STAGES) {
    const st = ep.stages[s.id] || {};
    const au = st.autonomy ? st.autonomy.label : (st.mode || '—');
    L.push(`| ${s.title} \`${s.id}\` | ${s.agent} | ${au} | ${st.durationMs ? (st.durationMs / 1000).toFixed(1) + 's' : '—'} | ${(st.artifacts || []).length} | US$ ${(((st.cost || {}).usd) || 0).toFixed(2)} |`);
  }
  const na = require('./autonomy').notAutonomous();
  L.push('', '### O que NÃO é autônomo hoje', '',
    'Isto fica escrito de propósito. O pipeline produz, valida e bloqueia sozinho; a parte intelectual não.', '',
    '| Estágio | Nível | O que falta para rodar sozinho |', '|---|---|---|');
  for (const x of na) L.push(`| \`${x.stage}\` | ${x.label} | ${x.gap || '—'} |`);
  L.push('', `**Tempo somado de execução:** ${(totalMs / 60000).toFixed(1)} min · **Despesa externa total: US$ ${(ep.cost_usd || 0).toFixed(2)}**`, '',
    '## Vídeo longo', '', '| Medida | Valor (medido por ffprobe) |', '|---|---|',
    `| Arquivo | \`content/channels/${CH}/episodes/${EP}/video_long_1080p.mp4\` |`,
    `| Duração | ${Math.floor(vp.duration / 60)}min ${String(Math.round(vp.duration % 60)).padStart(2, '0')}s (${vp.duration.toFixed(2)}s) |`,
    `| Resolução | ${vp.video.width}x${vp.video.height} @ ${vp.video.fps} fps |`,
    `| Vídeo | ${vp.video.codec} ${vp.video.profile}, ${vp.video.pix_fmt}, ${vp.video.nb_frames} frames |`,
    `| Áudio | ${vp.audio.codec}, ${vp.audio.sample_rate} Hz, ${vp.audio.channels} canais |`,
    `| Tamanho | ${fmt(vp.size)} |`,
    `| Decodificação completa | ${q.measurements.decode_check.ok ? 'OK' : 'FALHOU'} em ${(q.measurements.decode_check.elapsed_ms / 1000).toFixed(1)}s |`,
    `| Volume médio / pico | ${q.measurements.audio_stats.mean_volume_db} dBFS / ${q.measurements.audio_stats.max_volume_db} dBFS |`,
    `| Tela preta | ${q.measurements.black_frames.black_seconds}s (${((q.measurements.black_frames.black_ratio || 0) * 100).toFixed(2)}%) |`, '',
    '## Narração e legendas', '', '| Medida | Valor |', '|---|---|',
    `| Motor | ${tl.engine} ${tl.engine_version} — ${tl.weights_license} |`,
    `| Voz | \`${tl.voice}\` · ${tl.sample_rate} Hz |`,
    `| Falas sintetizadas | ${tl.lines.length}, todas com duração medida em amostras |`,
    `| Afirmações factuais | ${cl.summary.factual_lines_detected} detectadas · ${cl.summary.verified} verificadas na matriz · ${cl.summary.exempt_illustrative || 0} isentas por uso ilustrativo · ${cl.summary.orphan_assertions} órfãs |`,
    `| Velocidade de síntese | ${tl.realtime_factor ? tl.realtime_factor + 'x tempo real' : 'reaproveitada do cache'} |`,
    `| Inteligibilidade (WER por reconhecimento de fala) | **${(ir.word_error_rate * 100).toFixed(2)}%** (limite 15%) · modelo ${ir.model} |`,
    `| Legendas | ${cr.cues} cues · ${(cr.alignment_rate * 100).toFixed(0)}% alinhados por timestamp de palavra · última em ${cr.last_cue_end_s.toFixed(1)}s |`, '',
    '## Shorts', '', '| Arquivo | Duração | Resolução | Janela no vídeo longo | Autossuficiência |', '|---|---|---|---|---|');
  for (const s of sm.shorts) L.push(`| \`shorts/${s.short_id}.mp4\` | ${s.duration_s}s | ${s.resolution} | ${s.source_window_s.start}s–${s.source_window_s.end}s | ${s.standalone_rationale} |`);
  L.push('', '## Gates', '', `**${q.gates.verdict}** — ${q.passed}/${q.total} testes.`, '', '| Teste | Resultado | Evidência |', '|---|---|---|');
  for (const t of q.tests) L.push(`| \`${t.id}\` | ${t.pass ? 'OK' : 'FALHOU'} | ${String(t.detail).replace(/\|/g, '/')} |`);
  L.push('', '## Direitos e originalidade', '',
    `- Cenas com licença declarada: **${pv.visual_assets_by_scene.length}/${sb.scenes.length}**, nenhuma com licença desconhecida.`,
    `- Mídia de terceiro: **${pv.third_party_media_used ? 'SIM' : 'nenhuma'}** · banco de imagens: **${pv.stock_footage_used ? 'SIM' : 'nenhum'}** · imagem generativa: **${pv.generative_images_used ? 'SIM' : 'nenhuma'}**.`,
    `- Voz clonada de pessoa real: **${pv.audio.narration.cloned_from_real_person ? 'SIM' : 'não'}**. Trilha musical: **${pv.audio.music.present ? 'sim' : 'ausente por decisão'}**.`,
    `- Fontes verificadas: **${pv.text_sources.length}** · afirmações retiradas por não confirmação: **${pv.withheld_claims.length}**.`,
    `- Arquivos entregues com sha256 no manifesto: **${pv.delivered_files.length}**.`, '',
    '## Agentes que realmente executaram', '', '| Função | Estágios |', '|---|---|');
  for (const a of agentsRan) {
    const ags = company.agents.find((x) => x.id === a);
    L.push(`| ${ags ? ags.name : a} | ${Object.values(ep.stages).filter((s) => s.agent === a && s.status === 'done').map((s) => '`' + s.id + '`').join(', ')} |`);
  }
  const notRan = company.agents.filter((a) => !agentsRan.includes(a.id));
  L.push('', `Funções configuradas mas **sem execução neste piloto**: ${notRan.map((a) => `${a.name} (${a.id})`).join(', ') || 'nenhuma'} — o CEO virtual opera por chat/API e o editor de publicação está bloqueado por falta de OAuth.`, '',
    '## YouTube', '', `- Estado real: **${ytState.status}**${ytState.reason ? ` — ${ytState.reason}` : ''}`,
    `- Upload possível: **${ytState.upload_possible ? 'sim' : 'não'}** · Analytics possível: **${ytState.analytics_possible ? 'sim' : 'não'}**`,
    `- Vídeos enviados por este sistema: **${pubs.length}**${pubs.length ? ' (' + pubs.map((x) => x.video_id).join(', ') + ')' : ''}`,
    '- Token guardado não é prova: o estado `AUTORIZADO` só é declarado depois de uma chamada real à API que confirme o canal.',
    `- Privacidade padrão configurada: \`${md.privacy_status}\`. Público infantil declarado: \`${md.made_for_kids}\`.`, '',
    '## Aprovação', '', `- Estado: **${ep.approval.status}**`,
    '- Aprovar no painel vale **somente para este vídeo** e não autoriza envios futuros.');

  // ---- Evolution Engine ----
  const { EvolutionEngine } = require('./evolution/engine');
  const engine = new EvolutionEngine(CH);
  const xp = engine.store.experiment(`exp_${EP}`);
  const est = engine.stats();
  L.push('', '## Experimento', '');
  if (!xp) L.push('Nenhum experimento registrado para este episódio.');
  else {
    L.push('| Campo | Valor |', '|---|---|',
      `| Experimento | \`${xp.experiment_id}\` |`,
      `| Hipótese | ${xp.hypothesis} |`,
      `| Variável principal | \`${xp.primary_variable}\` |`,
      `| Registrado antes da produção | ${xp.registered_before_production ? 'sim' : 'NÃO'} |`,
      `| Assinatura de variáveis | ${xp.production ? xp.production.variable_fingerprint : '—'} |`,
      `| Veredicto atual | **${xp.current_verdict.verdict}** — ${xp.current_verdict.reason || 'sem medida ainda'} |`,
      `| Medições coletadas | ${xp.measurements.length} |`,
      `| Edições registradas | ${xp.edits.length} |`,
      `| Questionamentos do auditor | ${xp.challenges.length} |`, '');
    if ((xp.applies_learning || []).length) {
      L.push('**Aprendizado anterior aplicado:**', '');
      for (const a of xp.applies_learning) L.push(`- ${a}`);
      L.push('');
    }
    if (xp.production && (xp.production.thumbnails || []).length) {
      L.push('**Miniaturas, medidas no pixel:**', '', '| Variante | Contraste | Massa de texto | Lado | Cores dominantes | Alertas |', '|---|---|---|---|---|---|');
      for (const t2 of xp.production.thumbnails)
        L.push(`| ${t2.variant} | ${t2.measured.contrast_ratio_p5_p95}:1 | ${t2.measured.bright_pixels_pct}% | ${t2.measured.text_side} | ${t2.measured.dominant_colors.slice(0, 3).map((c) => c.hex).join(' ')} | ${t2.legibility_flags.length ? t2.legibility_flags.join('; ') : '—'} |`);
      L.push('');
    }
    L.push(`**Funil de diagnóstico:** ${xp.current_funnel ? JSON.stringify(xp.current_funnel.summary) : 'não avaliado — sem publicação, não há audiência a medir. Isso é ausência, não zero.'}`, '');
  }
  L.push(`**Registro imutável:** ${est.events} evento(s), corrente ${est.chain.ok ? '**íntegra**' : '**QUEBRADA: ' + est.chain.reason + '**'}.`, '');

  const bsum = require('./budget').summary(CH);
  L.push('## Orçamento', '', '| Item | Valor |', '|---|---|',
    `| Teto global | US$ ${bsum.global_limit_usd.toFixed(2)} (${bsum.hard_cap ? 'rígido' : 'flexível'}) |`,
    `| Gasto real (faturável) | US$ ${bsum.total_spent_usd.toFixed(2)} |`,
    `| Chamadas pagas recusadas pelo teto | ${bsum.denied_attempts} |`,
    `| Teto por experimento | US$ ${bsum.per_experiment_limit_usd.toFixed(2)} |`, '',
    `Custos reais sem fatura: ${bsum.real_costs_not_invoiced.tracked.join(', ')}.`, '');
  const out = path.join(ROOT, 'reports', `entrega-${EP}.md`);
  fs.writeFileSync(out, L.join('\n'), 'utf8');
  console.log(out);
  console.log(`gates ${q.passed}/${q.total} · custo US$ ${(ep.cost_usd || 0).toFixed(2)} · video ${vp.duration.toFixed(1)}s ${fmt(vp.size)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
