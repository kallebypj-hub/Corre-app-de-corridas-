'use strict';
require('./env');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { Pipeline, STAGES } = require('./pipeline');
const impls = require('./stages');
const { Logger } = require('./log');

const CHANNEL = process.env.CHANNEL_ID || 'ch_practical_discipline';
const log = new Logger('cli');

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const store = new Store(CHANNEL);
  const pipe = new Pipeline({ channelId: CHANNEL, store, impls });
  const epId = rest.find((r) => r.startsWith('ep_')) || 'ep_001';

  if (cmd === 'produce' || cmd === 'resume') {
    store.ensureEpisode(epId, { title: 'Why Waiting for Motivation Keeps You Stuck' });
    const from = (rest.find((r) => r.startsWith('--from=')) || '').split('=')[1] || null;
    const force = rest.includes('--force');
    const t0 = Date.now();
    const ran = await pipe.run(epId, { from, force });
    log.info(`CONCLUIDO em ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min. Estagios executados: ${ran.join(', ') || '(nenhum — tudo em checkpoint)'}`);
  } else if (cmd === 'stage') {
    const id = rest[0];
    store.ensureEpisode(epId, { title: 'Why Waiting for Motivation Keeps You Stuck' });
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
  } else if (cmd === 'doctor') {
    const { checkEnv } = require('./doctor');
    console.log(JSON.stringify(await checkEnv(), null, 2));
  } else if (cmd === 'verify') {
    const { verifyEpisode } = require('./verify');
    console.log(JSON.stringify(await verifyEpisode(CHANNEL, epId), null, 2));
  } else {
    console.log(`uso:
  node src/cli.js produce [ep_001] [--from=<estagio>] [--force]
  node src/cli.js stage <estagio> [ep_001]
  node src/cli.js status [ep_001]
  node src/cli.js verify [ep_001]
  node src/cli.js doctor
estagios: ${STAGES.map((s) => s.id).join(', ')}`);
  }
}
main().catch((e) => { log.error(e.stack || e.message); process.exit(1); });
