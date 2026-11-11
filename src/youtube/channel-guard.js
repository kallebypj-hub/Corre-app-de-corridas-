'use strict';
/**
 * TRAVA DE CANAL.
 *
 * A conta Google do dono tem quatro canais, e um deles e PESSOAL. O OAuth
 * autoriza o canal que o dono escolher na tela de consentimento — e nada impede
 * que ele escolha o errado por engano. Por isso toda escrita passa por aqui:
 * o sistema pergunta a API qual canal o token alcanca e compara com o oficial.
 *
 * Nao bate: recusa. Bate com a lista de proibidos: recusa e registra.
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

/**
 * Confere o canal autorizado contra o oficial.
 * @returns {ok, reason, channel}
 */
async function check(internalKey) {
  const c = config();
  const off = c.official;
  if (off.internal_key !== internalKey)
    return { ok: false, code: 'CANAL_INTERNO_DESCONHECIDO', reason: `o canal interno "${internalKey}" nao e o oficial configurado ("${off.internal_key}")` };

  const st = await oauth.state(internalKey);
  if (st.status !== 'AUTORIZADO')
    return { ok: false, code: 'SEM_OAUTH', reason: `OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`, state: st.status };

  const live = { id: st.youtube_channel_id, title: st.channel_title };

  // 1) lista de proibidos, por titulo ou por id
  for (const f of c.forbidden || []) {
    const sameId = f.youtube_channel_id && live.id && f.youtube_channel_id === live.id;
    const sameTitle = f.title && norm(f.title) === norm(live.title);
    if (sameId || sameTitle) {
      log.error(`RECUSADO: o token autoriza o canal proibido "${live.title}" (${live.id})`);
      return { ok: false, code: 'CANAL_PROIBIDO',
        reason: `o token autoriza "${live.title}" (${live.id}), que esta na lista de proibidos: ${f.reason}`,
        channel: live, forbidden_match: f.title };
    }
  }

  // 2) ja vinculado: exige o MESMO id, sempre
  if (off.bound && off.youtube_channel_id) {
    if (live.id !== off.youtube_channel_id)
      return { ok: false, code: 'CANAL_DIFERENTE_DO_VINCULADO',
        reason: `o token autoriza ${live.id} ("${live.title}") mas a empresa esta vinculada a ${off.youtube_channel_id}. Reautorize escolhendo o canal certo, ou desvincule de propósito.`,
        channel: live, bound_to: off.youtube_channel_id };
    return { ok: true, channel: live, bound: true, reason: 'canal autorizado confere com o vinculado' };
  }

  // 3) ainda nao vinculado: confere titulo/handle contra o esperado
  const titleOk = off.expected_title ? norm(live.title) === norm(off.expected_title) : true;
  if (!titleOk)
    return { ok: false, code: 'CANAL_NAO_E_O_ESPERADO',
      reason: `o token autoriza "${live.title}", mas o canal oficial da empresa e "${off.expected_title}" (${off.expected_handle}). Reautorize escolhendo o canal certo na tela do Google.`,
      channel: live, expected: { title: off.expected_title, handle: off.expected_handle } };
  return { ok: true, channel: live, bound: false, reason: 'canal confere com o esperado, mas ainda nao foi vinculado' };
}

/** Porteiro: lanca excecao se a escrita nao for permitida. */
async function assertWritable(internalKey, operation = 'operacao') {
  const r = await check(internalKey);
  if (!r.ok) throw new Error(`${operation} recusada — ${r.reason}`);
  return r;
}

/**
 * Vincula o canal oficial ao ID real, uma vez.
 * Idempotente: vincular de novo ao mesmo ID e no-op; a outro ID e recusado.
 */
async function bind(internalKey, { force = false, handle = null } = {}) {
  const r = await check(internalKey);
  if (!r.ok && r.code !== 'CANAL_NAO_E_O_ESPERADO') return { bound: false, ...r };
  if (!r.channel || !r.channel.id) return { bound: false, code: 'SEM_CANAL', reason: 'nao consegui ler o canal do token' };
  const c = config();
  if (c.official.bound && c.official.youtube_channel_id && c.official.youtube_channel_id !== r.channel.id && !force)
    return { bound: false, code: 'JA_VINCULADO', reason: `ja vinculado a ${c.official.youtube_channel_id}; vincular a outro exige decisao explicita` };
  if (!r.ok && !force) return { bound: false, ...r };
  c.official.youtube_channel_id = r.channel.id;
  c.official.bound = true;
  c.official.bound_at = new Date().toISOString();
  if (handle) c.official.observed_handle = handle;
  c.official.observed_title = r.channel.title;
  save(c);
  log.info(`canal oficial vinculado: ${r.channel.title} (${r.channel.id})`);
  return { bound: true, channel: r.channel, forced: !!force };
}
function status() {
  const c = config();
  return { official: c.official, forbidden: (c.forbidden || []).map((f) => ({ title: f.title, reason: f.reason })),
    authorized_not_in_use: c.authorized_not_in_use || [], policy: c.policy };
}
module.exports = { check, assertWritable, bind, status, config, CFG };
