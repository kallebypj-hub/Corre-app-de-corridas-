'use strict';
require('./env');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { Pipeline, STAGES } = require('./pipeline');
const impls = require('./stages');
const { Logger } = require('./log');
const { listEpisodeDirs, loadBrief } = require('./episode-config');

const CHANNEL = process.env.CHANNEL_ID || 'ch_practical_discipline';
const log = new Logger('cli');

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const store = new Store(CHANNEL);
  const pipe = new Pipeline({ channelId: CHANNEL, store, impls });
  // Nenhum episodio e padrao no codigo: a lista vem do disco.
  const dirs = listEpisodeDirs(CHANNEL);
  const epId = rest.find((r) => r.startsWith('ep_')) || dirs[0];
  if (!epId) throw new Error(`nenhum episodio em content/channels/${CHANNEL}/episodes/. Crie a pasta com brief.json, script_en.json, sources.json e claims.json.`);

  if (cmd === 'produce' || cmd === 'resume') {
    store.ensureEpisode(epId, { title: loadBrief(CHANNEL, epId).working_title });
    const from = (rest.find((r) => r.startsWith('--from=')) || '').split('=')[1] || null;
    const force = rest.includes('--force');
    const t0 = Date.now();
    const ran = await pipe.run(epId, { from, force });
    log.info(`CONCLUIDO em ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min. Estagios executados: ${ran.join(', ') || '(nenhum — tudo em checkpoint)'}`);
  } else if (cmd === 'stage') {
    const id = rest[0];
    store.ensureEpisode(epId, { title: loadBrief(CHANNEL, epId).working_title });
    await pipe.runStage(epId, id);
  } else if (cmd === 'status') {
    const rows = pipe.status(epId);
    console.log(`\nEpisodio ${epId} — canal ${CHANNEL}\n`);
    for (const r of rows) {
      const icon = { done: '[OK]  ', failed: '[FALHA]', running: '[...]  ', stale: '[STALE]', pending: '[  ]  ' }[r.status] || '[?]';
      console.log(`${icon} ${r.id.padEnd(18)} ${String(r.mode || '-').padEnd(10)} ${r.durationMs ? (r.durationMs / 1000).toFixed(1) + 's' : ''} ${r.error ? '-> ' + r.error : ''}`);
    }
    const ep = store.episode(epId);
    console.log(`\nCusto externo acumulado: US$ ${(ep.cost_usd || 0).toFixed(2)}`);
    console.log(`Gates: ${ep.gates ? ep.gates.verdict : 'nao avaliados'} | Aprovacao: ${ep.approval.status}\n`);
  } else if (cmd === 'episodes') {
    for (const d of listEpisodeDirs(CHANNEL)) {
      let b = null; try { b = loadBrief(CHANNEL, d); } catch (e) { console.log(`${d}  [brief invalido] ${e.message}`); continue; }
      const ep = store.episode(d);
      console.log(`${d}  ${b.working_title}  | pauta ${b.idea_id || '-'} | estagios concluidos: ${ep ? Object.values(ep.stages).filter(s2 => s2.status === 'done').length : 0}`);
    }
  } else if (cmd === 'youtube') {
    const yt = require('./youtube/oauth');
    const sub = rest[0];
    if (sub === 'authorize') {
      const url = yt.authUrl(CHANNEL);
      if (!url) { console.log('OAuth nao configurado: defina YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET no .env.'); return; }
      console.log('\nAbra este endereco no SEU navegador, logado na conta do canal:\n');
      console.log(url);
      console.log('\nO servidor precisa estar no ar para receber o retorno em ' + yt.redirectUri() + '\n');
    } else if (sub === 'revoke') {
      console.log(JSON.stringify(await yt.revoke(CHANNEL), null, 2));
    } else if (sub === 'verify') {
      console.log(JSON.stringify(await yt.verify(CHANNEL), null, 2));
    } else {
      const st = await yt.state(CHANNEL);
      console.log(JSON.stringify(st, null, 2));
    }
  } else if (cmd === 'upload') {
    const ytQueue = require('./youtube/queue');
    const fs2 = require('fs');
    const base = path.join(__dirname, '..', 'content', 'channels', CHANNEL, 'episodes', epId);
    const file = path.join(base, 'video_long_1080p.mp4');
    const metadata = JSON.parse(fs2.readFileSync(path.join(base, 'metadata.json'), 'utf8'));
    let last = 0;
    const r = await ytQueue.publishPrivate(store, epId, { filePath: file, metadata,
      by: 'presidente (linha de comando)', force: rest.includes('--force'),
      onProgress: (sent, total) => { const pct = Math.floor(sent / total * 100);
        if (pct >= last + 10) { last = pct; log.info(`envio ${pct}%`); } } });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'evolution') {
    const { EvolutionEngine } = require('./evolution/engine');
    const e = new EvolutionEngine(CHANNEL);
    const sub = rest[0];
    if (sub === 'review') { console.log(JSON.stringify(e.review48h(epId), null, 2)); return; }
    if (sub === 'knowledge') { console.log(JSON.stringify(e.briefing([]), null, 2)); return; }
    if (sub === 'timeline') {
      for (const ev of e.store.reload().events) console.log(`${String(ev.seq).padStart(3)} ${ev.ts.slice(0, 19)} ${ev.author.padEnd(22)} ${ev.type}`);
      console.log(JSON.stringify(e.stats().chain)); return;
    }
    const st = e.stats();
    console.log(`registro: ${st.events} evento(s), corrente ${st.chain.ok ? 'integra' : 'QUEBRADA'}`);
    for (const x of e.experiments()) {
      console.log(`\n${x.experiment_id}  (${x.episode_id})`);
      console.log(`  variavel: ${x.primary_variable}`);
      console.log(`  hipotese: ${String(x.hypothesis).slice(0, 110)}`);
      console.log(`  veredicto: ${x.current_verdict.verdict}  | medicoes: ${x.measurements.length} | edicoes: ${x.edits.length}`);
      if (!x.publication) console.log('  publicacao: nenhuma — sem dado de audiencia, o funil nao e avaliado');
    }
  } else if (cmd === 'channel') {
    const guard = require('./youtube/channel-guard');
    const sub = rest[0];
    if (sub === 'bind') { console.log(JSON.stringify(await guard.bind(CHANNEL, { force: rest.includes('--force') }), null, 2)); return; }
    if (sub === 'audit') {
      const audit = require('./youtube/channel-audit');
      const proposal = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'config', 'channel-optimization.json'), 'utf8'));
      const r = await audit.audit(CHANNEL, { proposal: { channel_name: proposal.channel } });
      const out = path.join(__dirname, '..', 'reports', `auditoria-canal-${new Date().toISOString().slice(0, 10)}.json`);
      require('fs').writeFileSync(out, JSON.stringify(r, null, 2));
      console.log(JSON.stringify(r.available ? { channel: r.channel.title, id: r.channel.youtube_channel_id,
        videos: r.inventory_summary, recomendacoes: r.recommendations.length, relatorio: out } : r, null, 2));
      return;
    }
    console.log(JSON.stringify(await guard.check(CHANNEL), null, 2));
    console.log(JSON.stringify(guard.status(), null, 2));
  } else if (cmd === 'cycle') {
    const cycle = require('./evolution/cycle');
    const analytics = require('./youtube/analytics');
    const r = await cycle.runFor(CHANNEL, epId, { collector: (ch, o) => analytics.collectForVideo(ch, o) });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'scheduler') {
    const sched = require('./scheduler');
    const analytics = require('./youtube/analytics');
    const collector = (ch, o) => analytics.collectForVideo(ch, o);
    const sub = rest[0];
    if (sub === 'status') { console.log(JSON.stringify(sched.status(CHANNEL), null, 2)); return; }
    if (sub === 'loop') { await sched.loop(CHANNEL, { collector }); return; }
    const r = await sched.tick(CHANNEL, { collector, dryRun: rest.includes('--dry-run') });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'publish') {
    const pubmod = require('./youtube/publication');
    const sub = rest[0];
    const fs2 = require('fs');
    const base = path.join(__dirname, '..', 'content', 'channels', CHANNEL, 'episodes', epId);
    if (sub === 'state') { console.log(JSON.stringify(await pubmod.stateOf(store, epId), null, 2)); return; }
    if (sub === 'private') {
      const metadata = JSON.parse(fs2.readFileSync(path.join(base, 'metadata.json'), 'utf8'));
      let last = 0;
      const r = await pubmod.uploadPrivate(store, epId, { filePath: path.join(base, 'video_long_1080p.mp4'), metadata,
        by: 'presidente (linha de comando)', force: rest.includes('--force'),
        onProgress: (sent, total) => { const p2 = Math.floor(sent / total * 100); if (p2 >= last + 10) { last = p2; log.info(`envio ${p2}%`); } } });
      console.log(JSON.stringify(r, null, 2)); return;
    }
    if (sub === 'schedule') {
      const at = rest.find((x) => /^\d{4}-\d{2}-\d{2}/.test(x));
      if (!at) throw new Error('informe a data: node src/cli.js publish schedule <ep> 2026-12-01T13:00:00Z');
      console.log(JSON.stringify(await pubmod.schedule(store, epId, { publishAt: at, by: 'presidente' }), null, 2)); return;
    }
    if (sub === 'public') {
      const phrase = process.argv.slice(2).join(' ').includes(pubmod.CONFIRM_PHRASE(epId)) ? pubmod.CONFIRM_PHRASE(epId) : null;
      console.log(JSON.stringify(await pubmod.makePublic(store, epId, { by: 'presidente', confirmation: phrase }), null, 2)); return;
    }
    if (sub === 'collect') { console.log(JSON.stringify(pubmod.startCollection(store, epId, { by: 'presidente' }), null, 2)); return; }
    console.log(JSON.stringify(pubmod.TRANSITIONS, null, 2));
  } else if (cmd === 'import-studio') {
    const si = require('./youtube/studio-import');
    const file = rest.find((x) => x.endsWith('.csv'));
    if (!file) { console.log(`coloque o CSV exportado do Studio em ${si.INBOX} e rode: node src/cli.js import-studio <ep> <arquivo.csv>`); return; }
    const { EvolutionEngine } = require('./evolution/engine');
    const e = new EvolutionEngine(CHANNEL);
    const x = e.store.experiment(`exp_${epId}`);
    const r = si.importFile(file, { videoId: x && x.publication ? x.publication.video_id : null });
    e.recordMeasurement(epId, { milestone: rest.find((m) => ['h24', 'h72', 'd7', 'd28'].includes(m)) || 'd7',
      metrics: r.metrics, source: r.source, window: r.period, author: 'presidente (importacao manual)' });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'editorial') {
    console.log(JSON.stringify(require('./editorial/generator').status(), null, 2));
  } else if (cmd === 'budget') {
    console.log(JSON.stringify(require('./budget').summary(CHANNEL), null, 2));
  } else if (cmd === 'doctor') {
    const { checkEnv } = require('./doctor');
    console.log(JSON.stringify(await checkEnv(), null, 2));
  } else if (cmd === 'verify') {
    const { verifyEpisode } = require('./verify');
    console.log(JSON.stringify(await verifyEpisode(CHANNEL, epId), null, 2));
  } else {
    console.log(`uso:
  node src/cli.js produce [<ep>] [--from=<estagio>] [--force]
  node src/cli.js stage <estagio> [<ep>]
  node src/cli.js status [<ep>]
  node src/cli.js verify [<ep>]
  node src/cli.js episodes
  node src/cli.js youtube [state|authorize|verify|revoke]
  node src/cli.js upload <ep> [--force]      # envio PRIVADO real; exige gates, aprovacao e OAuth
  node src/cli.js evolution [review|knowledge|timeline] [<ep>]
  node src/cli.js budget
  node src/cli.js channel [status|bind|audit]   # trava de canal e auditoria do Quiet Resolve
  node src/cli.js cycle <ep>                    # ciclo de aprendizagem completo
  node src/cli.js scheduler [tick|status|loop] [--dry-run]
  node src/cli.js publish [state|private|schedule|public|collect] <ep>
  node src/cli.js import-studio <ep> <arquivo.csv> [h24|h72|d7|d28]
  node src/cli.js editorial                     # provedor de geracao editorial e autonomia real
episodios no disco: ${listEpisodeDirs(CHANNEL).join(', ') || '(nenhum)'}
  node src/cli.js doctor
estagios: ${STAGES.map((s) => s.id).join(', ')}`);
  }
}
main().catch((e) => { log.error(e.stack || e.message); process.exit(1); });
