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
episodios no disco: ${listEpisodeDirs(CHANNEL).join(', ') || '(nenhum)'}
  node src/cli.js doctor
estagios: ${STAGES.map((s) => s.id).join(', ')}`);
  }
}
main().catch((e) => { log.error(e.stack || e.message); process.exit(1); });
