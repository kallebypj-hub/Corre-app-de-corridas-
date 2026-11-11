'use strict';
/**
 * AGENDADOR persistente e idempotente.
 *
 * Varre os episodios PUBLICOS, descobre qual marco venceu (24h, 72h, 7d, 28d) e
 * roda o ciclo de aprendizagem — uma vez por marco, nunca duas. Tambem dispara a
 * revisao de 48h. Falha, retentativa e horario real de cada passagem ficam
 * gravados; silencio nao conta como sucesso.
 *
 * O relogio e a PUBLICACAO PUBLICA confirmada na API. Video privado ou agendado
 * nao entra na varredura: nao ha audiencia para medir.
 *
 * TRES SITUACOES DIFERENTES, e so uma encerra a tarefa:
 *  - `done`: a medida veio completa. Nunca roda de novo.
 *  - `provisoria`: a medida veio, mas falta dado que AINDA PODE CHEGAR (o
 *    relatorio de impressoes leva ate 48h). A tarefa continua aberta e volta na
 *    cadencia de remedicao. Isso NAO gasta tentativa de erro.
 *  - `failed`: deu erro. Volta com espera crescente, ate o limite, e depois
 *    espera decisao humana.
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
const BACKOFF_MIN = [5, 15, 60, 240, 720]; // minutos entre tentativas apos ERRO
// remedicao de marco aberto: a cada 3h, por ate 48h, que e o atraso maximo
// documentado do relatorio em lote de impressoes.
const RECHECK_MIN = Number(process.env.SCHEDULER_RECHECK_MINUTES || 180);
const MAX_RECHECKS = Number(process.env.SCHEDULER_MAX_RECHECKS || 16);

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

/**
 * O que esta vencido agora, sem olhar o que ja foi feito.
 * So entra episodio com PUBLICACAO PUBLICA confirmada.
 */
function dueTasks(engine, now) {
  const out = [];
  for (const x of engine.experiments()) {
    if (!x.publication) continue;
    const clock = engine.audienceClock(x.episode_id);
    if (!clock.started) continue;
    const hours = (now - new Date(clock.at).getTime()) / 3600000;
    for (const m of MILESTONES) if (hours >= m.hours) out.push({ epId: x.episode_id, kind: 'milestone', milestone: m.id, due_after_hours: m.hours, hours });
    if (hours >= 48) out.push({ epId: x.episode_id, kind: 'review48h', milestone: null, due_after_hours: 48, hours });
  }
  return out;
}
/** Episodios que ficaram de fora da varredura, e por que. */
function skipped(engine) {
  const out = [];
  for (const x of engine.experiments()) {
    const clock = engine.audienceClock(x.episode_id);
    if (!clock.started) out.push({ epId: x.episode_id, reason: clock.reason,
      uploaded_privately_at: clock.uploaded_privately_at || null });
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
    const task = st.tasks[key] || { key, ...d, status: 'pending', attempts: 0, rechecks: 0, history: [] };
    if (task.rechecks === undefined) task.rechecks = 0;
    if (task.status === 'done') { actions.push({ key, action: 'pulado', reason: `ja concluido em ${task.completed_at}` }); st.tasks[key] = task; continue; }
    if (task.status === 'failed' && task.attempts >= MAX_ATTEMPTS) { actions.push({ key, action: 'desistido', reason: `${task.attempts} tentativas sem sucesso; precisa de olhar humano` }); st.tasks[key] = task; continue; }
    if (task.status === 'aguardando_dado') { actions.push({ key, action: 'aguardando dado', reason: `${task.rechecks} remedicoes sem o dado aparecer; o marco segue ABERTO, nao medido` }); st.tasks[key] = task; continue; }
    if (task.next_attempt_at && now < new Date(task.next_attempt_at).getTime()) {
      actions.push({ key, action: task.status === 'provisoria' ? 'aguardando remedicao' : 'aguardando backoff', reason: `proxima tentativa em ${task.next_attempt_at}` }); st.tasks[key] = task; continue;
    }
    if (dryRun) { actions.push({ key, action: 'rodaria', reason: `${d.kind}${d.milestone ? ' ' + d.milestone : ''} vencido ha ${(d.hours - d.due_after_hours).toFixed(1)}h` }); st.tasks[key] = task; continue; }

    task.last_attempt_at = new Date(now).toISOString();
    try {
      let result;
      if (d.kind === 'milestone') result = await cycle.runFor(channelId, d.epId, { collector, now });
      else result = engine.review48h(d.epId, { now });

      if (d.kind === 'milestone' && result.provisional) {
        // dado ainda pode chegar: o marco NAO fecha, e isto nao gasta tentativa de erro
        task.rechecks += 1;
        task.provisional_because = result.provisional_because || [];
        if (task.rechecks >= MAX_RECHECKS) {
          task.status = 'aguardando_dado';
          task.next_attempt_at = null;
          task.note = `${task.rechecks} remedicoes em ${((task.rechecks * RECHECK_MIN) / 60).toFixed(0)}h e o dado nao apareceu. O marco fica ABERTO, declarado como dado indisponivel, nunca como medido.`;
        } else {
          task.status = 'provisoria';
          task.next_attempt_at = new Date(now + RECHECK_MIN * 60000).toISOString();
        }
        task.result = { ran: result.ran, milestone: result.milestone || null, verdict: result.verdict || null,
          provisional: true, remeasured: !!result.remeasured, steps: (result.steps || []).map((s) => `${s.step}:${s.status}`) };
        task.history.push({ at: task.last_attempt_at, outcome: task.status, recheck: task.rechecks, because: task.provisional_because });
        actions.push({ key, action: task.status === 'aguardando_dado' ? 'aguardando dado' : 'remedir',
          reason: (result.provisional_because || []).join('; '), recheck: task.rechecks, retry_at: task.next_attempt_at });
        st.tasks[key] = task;
        continue;
      }

      task.attempts += 1;
      const ok = d.kind === 'milestone' ? (result.ran || result.steps.some((s) => s.status === 'ja medido')) : true;
      task.status = ok ? 'done' : 'pending';
      if (ok) { task.completed_at = new Date().toISOString(); task.next_attempt_at = null; }
      task.result = d.kind === 'milestone'
        ? { ran: result.ran, milestone: result.milestone || null, verdict: result.verdict || null, provisional: false,
            remeasured: !!result.remeasured, rechecks_before_final: task.rechecks, steps: (result.steps || []).map((s) => `${s.step}:${s.status}`) }
        : { actionable: result.actionable, blockers: result.blockers };
      task.history.push({ at: task.last_attempt_at, outcome: task.status, note: d.kind });
      actions.push({ key, action: task.status === 'done' ? 'concluido' : 'repetir', result: task.result });
    } catch (e) {
      task.attempts += 1;
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

  const out_of_scope = skipped(engine);
  const run = { started_at: started, finished_at: new Date().toISOString(),
    due_found: due.length, actions, dry_run: !!dryRun,
    skipped_not_public: out_of_scope };
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
    open_milestones: tasks.filter((t) => t.status === 'provisoria').map((t) => ({ key: t.key, rechecks: t.rechecks, because: t.provisional_because || [], next: t.next_attempt_at })),
    awaiting_data: tasks.filter((t) => t.status === 'aguardando_dado').map((t) => ({ key: t.key, rechecks: t.rechecks, because: t.provisional_because || [], note: t.note })),
    recent_runs: st.runs.slice(0, 10),
    note: 'tarefa concluida nunca roda de novo. Marco com dado faltando fica ABERTO e volta na cadencia de remedicao, sem gastar tentativa de erro. Erro volta com espera crescente ate 5 tentativas e depois espera decisao humana.' };
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
module.exports = { tick, status, loop, dueTasks, skipped, loadState,
  STATE_DIR, MAX_ATTEMPTS, BACKOFF_MIN, RECHECK_MIN, MAX_RECHECKS };
