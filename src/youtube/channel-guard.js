'use strict';
/**
 * TRAVA DE CANAL.
 *
 * A conta Google do dono tem quatro canais, e um deles e PESSOAL. O OAuth
 * autoriza o canal que o dono escolher na tela de consentimento — e nada impede
 * que ele escolha o errado por engano. Por isso toda escrita passa por aqui.
 *
 * Regras, em ordem, sem excecao:
 *
 *  1. LISTA DE PROIBIDOS vem primeiro e nao tem contorno. Confere id, titulo e
 *     handle. Nem `force`, nem `bind`, nem variavel de ambiente passam por cima.
 *  2. ESCRITA EXIGE VINCULO. Enquanto `bound` nao for true e o ID oficial nao
 *     estiver preenchido, nenhuma escrita acontece — nem envio, nem agendamento,
 *     nem publicacao, nem qualquer outra.
 *  3. VINCULADO EXIGE ID IDENTICO. A comparacao e por ID do YouTube, string
 *     exata. Titulo e handle servem para VINCULAR e para auditar, nunca para
 *     autorizar uma escrita: titulo se renomeia, ID nao.
 */
const fs = require('fs');
const path = require('path');
const oauth = require('./oauth');
const { Logger } = require('../log');

const log = new Logger('youtube.guard');
const ROOT = path.join(__dirname, '..', '..');
const CFG = process.env.YT_CHANNELS_CONFIG || path.join(ROOT, 'config', 'youtube-channels.json');

function config() { return JSON.parse(fs.readFileSync(CFG, 'utf8')); }
function save(c) { const tmp = CFG + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, CFG); }
const norm = (s) => String(s || '').trim().toLowerCase().replace(/^@/, '');

/** Casa o canal vivo contra uma entrada da lista de proibidos: id, titulo ou handle. */
function forbiddenMatch(c, live) {
  for (const f of c.forbidden || []) {
    const byId = f.youtube_channel_id && live.id && f.youtube_channel_id === live.id;
    const byTitle = f.title && live.title && norm(f.title) === norm(live.title);
    const byHandle = f.handle && live.handle && norm(f.handle) === norm(live.handle);
    if (byId || byTitle || byHandle) return { entry: f, matched_by: byId ? 'id' : (byTitle ? 'titulo' : 'handle') };
  }
  return null;
}

/**
 * Confere o canal autorizado contra o oficial.
 *
 * @param purpose 'write' (padrao) exige vinculo e ID identico;
 *                'bind'  permite ainda nao vinculado, conferindo titulo/handle;
 *                'read'  so recusa canal proibido.
 * @returns {ok, writable, code, reason, channel}
 */
async function check(internalKey, { purpose = 'write' } = {}) {
  const c = config();
  const off = c.official;
  if (off.internal_key !== internalKey)
    return { ok: false, writable: false, code: 'CANAL_INTERNO_DESCONHECIDO', reason: `o canal interno "${internalKey}" nao e o oficial configurado ("${off.internal_key}")` };

  const st = await oauth.state(internalKey);
  if (st.status !== 'AUTORIZADO')
    return { ok: false, writable: false, code: 'SEM_OAUTH', reason: `OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`, state: st.status };

  const live = { id: st.youtube_channel_id, title: st.channel_title, handle: st.channel_handle || null };

  // ---- 1) lista de proibidos: barreira absoluta, antes de tudo ----
  const bad = forbiddenMatch(c, live);
  if (bad) {
    log.error(`RECUSADO: o token autoriza o canal proibido "${live.title}" (${live.id}), casado por ${bad.matched_by}`);
    return { ok: false, writable: false, code: 'CANAL_PROIBIDO', hard: true,
      reason: `o token autoriza "${live.title}" (${live.id}), que esta na lista de proibidos (casou por ${bad.matched_by}): ${bad.entry.reason}`,
      channel: live, forbidden_match: bad.entry.title, matched_by: bad.matched_by,
      note: 'esta recusa nao tem contorno: force, bind e configuracao nao passam por cima dela' };
  }

  if (purpose === 'read') return { ok: true, writable: false, channel: live, bound: !!off.bound, reason: 'leitura permitida: o canal nao esta na lista de proibidos' };

  // ---- 2) escrita exige vinculo por ID ----
  if (purpose === 'write') {
    if (!off.bound || !off.youtube_channel_id)
      return { ok: false, writable: false, code: 'CANAL_NAO_VINCULADO',
        reason: `o canal oficial ainda nao foi vinculado por ID. Nenhuma escrita e permitida antes disso. O token alcanca "${live.title}" (${live.id}); se for o Quiet Resolve, rode "node src/cli.js channel bind" para vincular.`,
        channel: live, bound: false,
        expected: { title: off.expected_title, handle: off.expected_handle } };
    if (live.id !== off.youtube_channel_id)
      return { ok: false, writable: false, code: 'CANAL_DIFERENTE_DO_VINCULADO',
        reason: `o token autoriza ${live.id} ("${live.title}") mas a empresa esta vinculada a ${off.youtube_channel_id}. Reautorize escolhendo o canal certo.`,
        channel: live, bound_to: off.youtube_channel_id };
    return { ok: true, writable: true, channel: live, bound: true,
      reason: `ID confere exatamente com o vinculado (${off.youtube_channel_id})`, matched_by: 'id' };
  }

  // ---- 3) purpose 'bind': ainda nao vinculado, confere titulo/handle ----
  if (off.bound && off.youtube_channel_id && live.id !== off.youtube_channel_id)
    return { ok: false, writable: false, code: 'CANAL_DIFERENTE_DO_VINCULADO',
      reason: `ja vinculado a ${off.youtube_channel_id}, mas o token alcanca ${live.id} ("${live.title}")`,
      channel: live, bound_to: off.youtube_channel_id };
  const titleOk = off.expected_title ? norm(live.title) === norm(off.expected_title) : true;
  const handleOk = off.expected_handle && live.handle ? norm(live.handle) === norm(off.expected_handle) : null;
  if (!titleOk && handleOk !== true)
    return { ok: false, writable: false, code: 'CANAL_NAO_E_O_ESPERADO',
      reason: `o token autoriza "${live.title}"${live.handle ? ` (${live.handle})` : ''}, mas o canal oficial da empresa e "${off.expected_title}" (${off.expected_handle}). Reautorize escolhendo o canal certo na tela do Google.`,
      channel: live, expected: { title: off.expected_title, handle: off.expected_handle } };
  return { ok: true, writable: false, channel: live, bound: !!off.bound,
    reason: `canal confere com o esperado por ${handleOk === true ? 'handle' : 'titulo'}; pode ser vinculado`,
    matched_by: handleOk === true ? 'handle' : 'titulo' };
}

/** Porteiro: lanca excecao se a ESCRITA nao for permitida. Exige vinculo e ID identico. */
async function assertWritable(internalKey, operation = 'operacao') {
  const r = await check(internalKey, { purpose: 'write' });
  if (!r.writable) throw new Error(`${operation} recusada — ${r.reason}`);
  return r;
}

/**
 * Vincula o canal oficial ao ID real, uma vez.
 *
 * `force` existe para UM caso: o dono renomeou o canal e o titulo nao casa mais.
 * Ele NUNCA passa por cima da lista de proibidos nem da falta de OAuth.
 */
async function bind(internalKey, { force = false, handle = null } = {}) {
  const r = await check(internalKey, { purpose: 'bind' });
  if (r.code === 'CANAL_PROIBIDO')
    return { bound: false, force_ignored: !!force, ...r };
  if (r.code === 'SEM_OAUTH' || r.code === 'CANAL_INTERNO_DESCONHECIDO')
    return { bound: false, force_ignored: !!force, ...r };
  if (!r.channel || !r.channel.id) return { bound: false, code: 'SEM_CANAL', reason: 'nao consegui ler o canal do token' };
  const c = config();
  if (c.official.bound && c.official.youtube_channel_id && c.official.youtube_channel_id !== r.channel.id && !force)
    return { bound: false, code: 'JA_VINCULADO', reason: `ja vinculado a ${c.official.youtube_channel_id}; vincular a outro exige decisao explicita` };
  if (!r.ok && !force) return { bound: false, ...r };
  c.official.youtube_channel_id = r.channel.id;
  c.official.bound = true;
  c.official.bound_at = new Date().toISOString();
  c.official.observed_handle = handle || r.channel.handle || c.official.observed_handle || null;
  c.official.observed_title = r.channel.title;
  save(c);
  log.info(`canal oficial vinculado: ${r.channel.title} (${r.channel.id})`);
  return { bound: true, channel: r.channel, forced: !!force, matched_by: r.matched_by || null };
}
function status() {
  const c = config();
  return { official: c.official,
    writes_allowed: !!(c.official.bound && c.official.youtube_channel_id),
    writes_note: c.official.bound && c.official.youtube_channel_id
      ? `escritas liberadas apenas para o ID ${c.official.youtube_channel_id}, conferido na API a cada operacao`
      : 'nenhuma escrita e permitida: o canal oficial ainda nao foi vinculado por ID',
    forbidden: (c.forbidden || []).map((f) => ({ title: f.title, handle: f.handle || null, reason: f.reason })),
    authorized_not_in_use: c.authorized_not_in_use || [], policy: c.policy };
}
module.exports = { check, assertWritable, bind, status, config, forbiddenMatch, CFG };
