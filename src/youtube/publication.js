'use strict';
/**
 * MAQUINA DE ESTADOS DA PUBLICACAO.
 *
 * Quatro decisoes DIFERENTES, cada uma com sua propria autorizacao:
 *
 *   1. UPLOAD_PRIVADO       — o arquivo sobe como private
 *   2. AGENDAMENTO          — define publishAt; o video segue private ate la
 *   3. PUBLICACAO_PUBLICA   — privacyStatus vira public  <-- exige aprovacao especifica do dono
 *   4. COLETA_DE_AUDIENCIA  — o agendador passa a medir aquele video
 *
 * Autorizar 1 NAO autoriza 2, 3 nem 4. Autorizar 3 vale para UM video, uma vez.
 * O estado real de cada etapa e sempre conferido na API, nunca deduzido.
 */
const fs = require('fs');
const path = require('path');
const oauth = require('./oauth');
const upload = require('./upload');
const { request, apiError, ENDPOINTS, scrub } = require('./http');
const { EvolutionEngine } = require('../evolution/engine');
const guard = require('./channel-guard');
const { Logger } = require('../log');

const log = new Logger('youtube.publication');

const STATES = {
  NAO_PRODUZIDO: 'nao produzido',
  PRONTO_NAO_ENVIADO: 'pronto, nao enviado',
  UPLOAD_PRIVADO: 'enviado como privado',
  AGENDADO: 'agendado para publicar',
  PUBLICO: 'publico',
  COLETANDO: 'coletando audiencia'
};
/** Cada transicao declara o que exige. Nada aqui e implicito. */
const TRANSITIONS = {
  upload_privado: {
    label: 'enviar como privado',
    requires: ['gates verdes', 'auditoria nao desatualizada', 'aprovacao do episodio', 'autorizacao de envio marcada na aprovacao', 'OAuth verificado'],
    grants: ['o arquivo existe no YouTube como private'],
    does_not_grant: ['agendamento', 'publicacao publica', 'coleta de audiencia']
  },
  agendar: {
    label: 'agendar publicacao',
    requires: ['video ja enviado como privado', 'data futura', 'autorizacao explicita de agendamento'],
    grants: ['o YouTube publica sozinho na data marcada'],
    does_not_grant: ['tornar publico agora']
  },
  publicar: {
    label: 'tornar publico',
    requires: ['video ja enviado', 'APROVACAO ESPECIFICA DO DONO para ESTE video', 'frase de confirmacao exata'],
    grants: ['o video fica visivel para qualquer pessoa'],
    does_not_grant: ['autorizacao para o proximo video']
  },
  iniciar_coleta: {
    label: 'iniciar coleta de audiencia',
    requires: ['video enviado', 'OAuth verificado'],
    grants: ['o agendador passa a medir este video nos marcos'],
    does_not_grant: ['mudar privacidade']
  }
};

function assertReadyForUpload(store, epId) {
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  if (!ep.gates || !ep.gates.can_be_approved) throw new Error('gates nao aprovados: envio bloqueado');
  if (!ep.stages.qa || ep.stages.qa.status !== 'done') throw new Error('auditoria desatualizada: rode a auditoria antes de enviar');
  if (ep.approval.status !== 'approved') throw new Error('sem aprovacao do proprietario para este video');
  if (!ep.approval.scheduled_upload_authorized) throw new Error('a aprovacao nao autorizou o envio deste video');
  return ep;
}

/** 1. UPLOAD PRIVADO */
async function uploadPrivate(store, epId, { filePath, metadata, by, force = false, onProgress = null }) {
  assertReadyForUpload(store, epId);
  await guard.assertWritable(store.channelId, 'envio privado');
  const st = await oauth.state(store.channelId);
  if (st.status !== 'AUTORIZADO') throw new Error(`OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`);
  const existing = upload.readRec(store.channelId, epId);
  if (existing && existing.video_id && !force) throw new Error(`este episodio ja tem video_id=${existing.video_id}; envio duplicado impedido`);

  const res = await upload.uploadVideo({ channelId: store.channelId, epId, filePath,
    metadata: { ...metadata, privacy_status: 'private', publish_at: undefined }, onProgress, force });
  let verified = null;
  try { verified = await upload.verifyUploaded(store.channelId, res.video_id); } catch (_) {}
  const rec = { epId, state: STATES.UPLOAD_PRIVADO, privacy: (verified && verified.privacy) || 'private',
    approvedBy: by || 'presidente', video_id: res.video_id, url: res.url, bytes: res.bytes,
    verified_on_youtube: verified, queued_at: new Date().toISOString(), status: 'UPLOADED_PRIVATE',
    grants: TRANSITIONS.upload_privado.grants, does_not_grant: TRANSITIONS.upload_privado.does_not_grant };
  store.append('publication.recorded', rec);
  // o Evolution Engine so sabe da publicacao por aqui
  try { new EvolutionEngine(store.channelId).recordPublication(epId, { video_id: res.video_id, url: res.url,
    privacy: rec.privacy, published_at: new Date().toISOString(), author: by || 'presidente' }); } catch (e) { log.warn(e.message); }
  return rec;
}

/** 2. AGENDAMENTO — continua privado ate a data */
async function schedule(store, epId, { publishAt, by }) {
  await guard.assertWritable(store.channelId, 'agendamento');
  const rec = upload.readRec(store.channelId, epId);
  if (!rec || !rec.video_id) throw new Error('nao ha video enviado para agendar');
  const when = new Date(publishAt);
  if (!(when.getTime() > Date.now())) throw new Error('a data de publicacao precisa estar no futuro');
  const token = await oauth.accessToken(store.channelId);
  const body = JSON.stringify({ id: rec.video_id, status: { privacyStatus: 'private', publishAt: when.toISOString() } });
  const res = await request(`${ENDPOINTS.api}/youtube/v3/videos?part=status`, { method: 'PUT', body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200) throw apiError('agendamento falhou', res);
  const out = { epId, state: STATES.AGENDADO, video_id: rec.video_id, publish_at: when.toISOString(),
    privacy: 'private', approvedBy: by, scheduled_at: new Date().toISOString(),
    note: 'o video segue privado ate a data; agendar nao e publicar agora' };
  store.append('publication.recorded', out);
  return out;
}

/**
 * 3. PUBLICACAO PUBLICA — a unica que muda visibilidade.
 * Exige aprovacao especifica DESTE video e uma frase de confirmacao exata,
 * para que nenhum automatismo consiga acionar por acidente.
 */
const CONFIRM_PHRASE = (epId) => `PUBLICAR ${epId} EM PUBLICO`;
async function makePublic(store, epId, { by, confirmation, ownerApprovalNote = null }) {
  await guard.assertWritable(store.channelId, 'publicacao publica');
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  const rec = upload.readRec(store.channelId, epId);
  if (!rec || !rec.video_id) throw new Error('nao ha video enviado para publicar');
  if (confirmation !== CONFIRM_PHRASE(epId))
    throw new Error(`publicacao publica exige a frase exata: "${CONFIRM_PHRASE(epId)}". Aprovar o envio privado NAO autoriza publicar.`);
  if (!ep.approval || ep.approval.status !== 'approved')
    throw new Error('o episodio nao esta aprovado');
  if (!ep.approval.public_release_authorized)
    throw new Error('a aprovacao deste episodio nao marcou autorizacao de publicacao publica; isso e uma decisao separada do envio');
  const token = await oauth.accessToken(store.channelId);
  const body = JSON.stringify({ id: rec.video_id, status: { privacyStatus: 'public' } });
  const res = await request(`${ENDPOINTS.api}/youtube/v3/videos?part=status`, { method: 'PUT', body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200) throw apiError('publicacao publica falhou', res);
  let verified = null;
  try { verified = await upload.verifyUploaded(store.channelId, rec.video_id); } catch (_) {}
  const out = { epId, state: STATES.PUBLICO, video_id: rec.video_id,
    privacy: (verified && verified.privacy) || 'public', approvedBy: by,
    owner_approval_note: ownerApprovalNote, published_publicly_at: new Date().toISOString(),
    verified_on_youtube: verified,
    note: 'esta autorizacao valeu para ESTE video, uma vez. O proximo exige outra.' };
  store.append('publication.recorded', out);
  store.append('memory.recorded', { kind: 'publicacao_publica', epId, video_id: rec.video_id, by });
  log.warn(`video ${rec.video_id} tornado PUBLICO por ${by}`);
  return out;
}

/** 4. INICIO DA COLETA — separado de tudo acima */
function startCollection(store, epId, { by }) {
  const rec = upload.readRec(store.channelId, epId);
  if (!rec || !rec.video_id) throw new Error('nao ha video enviado: nao ha o que medir');
  const out = { epId, state: STATES.COLETANDO, video_id: rec.video_id, started_by: by,
    started_at: new Date().toISOString(),
    note: 'a partir daqui o agendador mede este video nos marcos de 24h, 72h, 7 e 28 dias' };
  store.append('publication.recorded', out);
  return out;
}

/** Estado real de um episodio, conferido na API quando possivel. */
async function stateOf(store, epId) {
  const ep = store.episode(epId);
  const rec = upload.readRec(store.channelId, epId);
  const engine = new EvolutionEngine(store.channelId);
  const x = engine.store.experiment(`exp_${epId}`);
  const base = { episode_id: epId, transitions: TRANSITIONS,
    ready_for_upload: !!(ep && ep.gates && ep.gates.can_be_approved && ep.stages.qa && ep.stages.qa.status === 'done'
      && ep.approval.status === 'approved' && ep.approval.scheduled_upload_authorized),
    public_release_authorized: !!(ep && ep.approval && ep.approval.public_release_authorized) };
  if (!rec || !rec.video_id) return { ...base, state: ep ? STATES.PRONTO_NAO_ENVIADO : STATES.NAO_PRODUZIDO, video_id: null, verified: null };
  let verified = null;
  try { verified = await upload.verifyUploaded(store.channelId, rec.video_id); } catch (e) { verified = { error: scrub(e.message) }; }
  const privacy = verified && verified.privacy ? verified.privacy : null;
  const collecting = !!(x && x.measurements.length);
  return { ...base, video_id: rec.video_id, url: `https://www.youtube.com/watch?v=${rec.video_id}`,
    state: privacy === 'public' ? STATES.PUBLICO : (verified && verified.published_at && new Date(verified.published_at) > new Date() ? STATES.AGENDADO : STATES.UPLOAD_PRIVADO),
    privacy, collecting, measurements: x ? x.measurements.length : 0, verified };
}
module.exports = { uploadPrivate, schedule, makePublic, startCollection, stateOf,
  STATES, TRANSITIONS, CONFIRM_PHRASE, assertReadyForUpload };
