'use strict';
/**
 * AGENDADOR persistente e idempotente.
 *
 * Varre os episodios publicados, descobre qual marco venceu (24h, 72h, 7d, 28d)
 * e roda o ciclo de aprendizagem — uma vez por marco, nunca duas. Tambem dispara
 * a revisao de 48h. Falha, retentativa e horario real de cada passagem ficam
 * gravados; silencio nao conta como sucesso.
 *
 * Nao e um daemon obrigatorio: roda como "tick" avulso (cron, systemd timer) ou
 * em laco. Os dois caminhos usam o mesmo estado em disco, entao reiniciar nao
 * duplica nada.
 */
const fs = require('fs');
const path = require('path');
const { EvolutionEngine } = require('./evolution/engine');
const { MILESTONES } = require('./evolution/states');
const cycle = require('./evolution/cycle');
const { Logger } = require('./log');

const log = new Logger('scheduler');
const ROOT = path.join(__dirname, '..');
const STATE_DIR = process.env.SCHEDULER_STATE_DIR || path.join(ROOT, 'var', 'scheduler');
const MAX_ATTEMPTS = Number(process.env.SCHEDULER_MAX_ATTEMPTS || 5);
const BACKOFF_MIN = [5, 15, 60, 240, 720]; // minutos entre tentativas

function statePath(channelId) { fs.mkdirSync(STATE_DIR, { recursive: true }); return path.join(STATE_DIR, `${channelId}.json`); }
function loadState(channelId) {
  const p = statePath(channelId);
  if (!fs.existsSync(p)) return { channel_id: channelId, tasks: {}, runs: [], created: new Date().toISOString() };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { log.warn(`estado do agendador ilegivel, recomecando: ${e.message}`); return { channel_id: channelId, tasks: {}, runs: [], created: new Date().toISOString() }; }
}
function saveState(channelId, st) {
  const p = statePath(channelId);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, p);
}
const taskKey = (epId, kind, milestone) => `${epId}::${kind}${milestone ? '::' + milestone : ''}`;

/** O que esta vencido agora, sem olhar o que ja foi feito. */
function dueTasks(engine, now) {
  const out = [];
  for (const x of engine.experiments()) {
    if (!x.publication || !x.publication.published_at) continue;
    const hours = (now - new Date(x.publication.published_at).getTime()) / 3600000;
    for (const m of MILESTONES) if (hours >= m.hours) out.push({ epId: x.episode_id, kind: 'milestone', milestone: m.id, due_after_hours: m.hours, hours });
    if (hours >= 48) out.push({ epId: x.episode_id, kind: 'review48h', milestone: null, due_after_hours: 48, hours });
  }
  return out;
}

/**
 * Uma passagem. Idempotente por construcao:
 *  - tarefa com status 'done' nunca roda de novo;
 *  - o ciclo tambem checa, no registro imutavel, se o marco ja foi medido;
 *  - tarefa que falhou so volta depois do backoff, ate MAX_ATTEMPTS.
 */
async function tick(channelId, { collector, now = Date.now(), dryRun = false } = {}) {
  const engine = new EvolutionEngine(channelId);
  const st = loadState(channelId);
  const started = new Date(now).toISOString();
  const due = dueTasks(engine, now);
  const actions = [];

  for (const d of due) {
    const key = taskKey(d.epId, d.kind, d.milestone);
    const task = st.tasks[key] || { key, ...d, status: 'pending', attempts: 0, history: [] };
    if (task.status === 'done') { actions.push({ key, action: 'pulado', reason: `ja concluido em ${task.completed_at}` }); st.tasks[key] = task; continue; }
    if (task.status === 'failed' && task.attempts >= MAX_ATTEMPTS) { actions.push({ key, action: 'desistido', reason: `${task.attempts} tentativas sem sucesso; precisa de olhar humano` }); st.tasks[key] = task; continue; }
    if (task.next_attempt_at && now < new Date(task.next_attempt_at).getTime()) {
      actions.push({ key, action: 'aguardando backoff', reason: `proxima tentativa em ${task.next_attempt_at}` }); st.tasks[key] = task; continue;
    }
    if (dryRun) { actions.push({ key, action: 'rodaria', reason: `${d.kind}${d.milestone ? ' ' + d.milestone : ''} vencido ha ${(d.hours - d.due_after_hours).toFixed(1)}h` }); st.tasks[key] = task; continue; }

    task.attempts += 1;
    task.last_attempt_at = new Date(now).toISOString();
    try {
      let result;
      if (d.kind === 'milestone') result = await cycle.runFor(channelId, d.epId, { collector, now });
      else result = engine.review48h(d.epId, { now });
      const ok = d.kind === 'milestone' ? (result.ran || result.steps.some((s) => s.status === 'ja medido')) : true;
      task.status = ok ? 'done' : 'pending';
      if (ok) task.completed_at = new Date().toISOString();
      task.result = d.kind === 'milestone'
        ? { ran: result.ran, milestone: result.milestone || null, verdict: result.verdict || null, steps: (result.steps || []).map((s) => `${s.step}:${s.status}`) }
        : { actionable: result.actionable, blockers: result.blockers };
      task.history.push({ at: task.last_attempt_at, outcome: task.status, note: d.kind });
      actions.push({ key, action: task.status === 'done' ? 'concluido' : 'repetir', result: task.result });
    } catch (e) {
      task.status = 'failed';
      task.last_error = String(e.message).slice(0, 400);
      const wait = BACKOFF_MIN[Math.min(task.attempts - 1, BACKOFF_MIN.length - 1)];
      task.next_attempt_at = new Date(now + wait * 60000).toISOString();
      task.history.push({ at: task.last_attempt_at, outcome: 'erro', error: task.last_error, retry_in_minutes: wait });
      actions.push({ key, action: 'falhou', error: task.last_error, retry_at: task.next_attempt_at, attempt: task.attempts });
      log.error(`tarefa ${key} falhou (tentativa ${task.attempts}): ${task.last_error}`);
    }
    st.tasks[key] = task;
  }

  const run = { started_at: started, finished_at: new Date().toISOString(),
    due_found: due.length, actions, dry_run: !!dryRun };
  st.runs.unshift(run);
  st.runs = st.runs.slice(0, 200);
  st.last_tick_at = run.finished_at;
  saveState(channelId, st);
  return run;
}

function status(channelId) {
  const st = loadState(channelId);
  const tasks = Object.values(st.tasks);
  return { channel_id: channelId, last_tick_at: st.last_tick_at || null,
    tasks_total: tasks.length,
    by_status: tasks.reduce((a, t) => { a[t.status] = (a[t.status] || 0) + 1; return a; }, {}),
    failing: tasks.filter((t) => t.status === 'failed').map((t) => ({ key: t.key, attempts: t.attempts, error: t.last_error, retry_at: t.next_attempt_at })),
    exhausted: tasks.filter((t) => t.status === 'failed' && t.attempts >= MAX_ATTEMPTS).map((t) => t.key),
    recent_runs: st.runs.slice(0, 10),
    note: 'tarefa concluida nunca roda de novo; falha volta com espera crescente ate 5 tentativas e depois espera decisao humana.' };
}

/** Laco opcional, para quem preferir processo longo em vez de cron. */
async function loop(channelId, { collector, intervalMs = 15 * 60 * 1000, signal } = {}) {
  log.info(`agendador em laco, intervalo de ${(intervalMs / 60000).toFixed(0)} min`);
  while (!(signal && signal.aborted)) {
    try { const r = await tick(channelId, { collector }); log.info(`tick: ${r.due_found} vencida(s), ${r.actions.length} acao(oes)`); }
    catch (e) { log.error(`tick falhou inteiro: ${e.message}`); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
module.exports = { tick, status, loop, dueTasks, loadState, STATE_DIR, MAX_ATTEMPTS, BACKOFF_MIN };
