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
 *
 * Cada uma le uma marca DIFERENTE da aprovacao, e nenhuma le a do outro:
 *   1 -> approval.scheduled_upload_authorized
 *   2 -> approval.publication_schedule_authorized
 *   3 -> approval.public_release_authorized  + frase de confirmacao exata
 *   4 -> approval.audience_collection_authorized
 *
 * DUAS DATAS: o envio privado grava `uploaded_privately_at`; a publicacao
 * publica grava `published_publicly_at`. Marco de audiencia conta da SEGUNDA, e
 * so depois de a API confirmar que a privacidade virou "public".
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
    requires: ['video ja enviado como privado', 'data futura', 'approval.publication_schedule_authorized marcado para ESTE episodio'],
    grants: ['o YouTube publica sozinho na data marcada'],
    does_not_grant: ['tornar publico agora', 'iniciar coleta de audiencia'],
    note: 'autorizar o envio privado NAO autoriza agendar: sao marcas separadas na aprovacao'
  },
  publicar: {
    label: 'tornar publico',
    requires: ['video ja enviado', 'APROVACAO ESPECIFICA DO DONO para ESTE video', 'frase de confirmacao exata'],
    grants: ['o video fica visivel para qualquer pessoa'],
    does_not_grant: ['autorizacao para o proximo video']
  },
  iniciar_coleta: {
    label: 'iniciar coleta de audiencia',
    requires: ['video PUBLICO confirmado na API', 'approval.audience_collection_authorized marcado para ESTE episodio', 'OAuth verificado'],
    grants: ['o agendador passa a medir este video nos marcos de 24h, 72h, 7 e 28 dias'],
    does_not_grant: ['mudar privacidade', 'publicar o proximo video'],
    note: 'video privado nao entra em coleta: sem audiencia nao ha o que medir'
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
  const uploadedAt = new Date().toISOString();
  const rec = { epId, state: STATES.UPLOAD_PRIVADO, privacy: (verified && verified.privacy) || 'private',
    approvedBy: by || 'presidente', video_id: res.video_id, url: res.url, bytes: res.bytes,
    verified_on_youtube: verified, uploaded_privately_at: uploadedAt, queued_at: uploadedAt, status: 'UPLOADED_PRIVATE',
    published_publicly_at: null, audience_clock_started: false,
    grants: TRANSITIONS.upload_privado.grants, does_not_grant: TRANSITIONS.upload_privado.does_not_grant,
    note: 'arquivo privado no YouTube. Nenhum marco de audiencia comeca a contar: ninguem viu o video ainda.' };
  store.append('publication.recorded', rec);
  // o Evolution Engine so sabe da publicacao por aqui — como ENVIO PRIVADO
  try { new EvolutionEngine(store.channelId).recordPublication(epId, { kind: 'upload_privado',
    video_id: res.video_id, url: res.url, privacy: rec.privacy,
    uploaded_privately_at: uploadedAt, author: by || 'presidente' }); } catch (e) { log.warn(e.message); }
  return rec;
}

/** 2. AGENDAMENTO — continua privado ate a data */
async function schedule(store, epId, { publishAt, by }) {
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  if (!ep.approval || ep.approval.status !== 'approved') throw new Error('o episodio nao esta aprovado');
  if (!ep.approval.publication_schedule_authorized)
    throw new Error('a aprovacao deste episodio nao marcou autorizacao de AGENDAMENTO; isso e uma decisao separada do envio privado e da publicacao publica');
  // trava de canal depois das checagens locais: exige canal vinculado por ID
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
    uploaded_privately_at: rec.uploaded_privately_at || rec.queued_at || null,
    published_publicly_at: null, audience_clock_started: false,
    grants: TRANSITIONS.agendar.grants, does_not_grant: TRANSITIONS.agendar.does_not_grant,
    note: 'o video segue privado ate a data; agendar nao e publicar agora, e o relogio da audiencia nao comecou' };
  store.append('publication.recorded', out);
  try { new EvolutionEngine(store.channelId).recordPublication(epId, { kind: 'agendamento',
    video_id: rec.video_id, url: rec.url || null, privacy: 'private',
    uploaded_privately_at: rec.uploaded_privately_at || rec.queued_at || null, author: by }); } catch (e) { log.warn(e.message); }
  return out;
}

/**
 * 3. PUBLICACAO PUBLICA — a unica que muda visibilidade.
 * Exige aprovacao especifica DESTE video e uma frase de confirmacao exata,
 * para que nenhum automatismo consiga acionar por acidente.
 */
const CONFIRM_PHRASE = (epId) => `PUBLICAR ${epId} EM PUBLICO`;
async function makePublic(store, epId, { by, confirmation, ownerApprovalNote = null }) {
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  if (confirmation !== CONFIRM_PHRASE(epId))
    throw new Error(`publicacao publica exige a frase exata: "${CONFIRM_PHRASE(epId)}". Aprovar o envio privado NAO autoriza publicar.`);
  if (!ep.approval || ep.approval.status !== 'approved')
    throw new Error('o episodio nao esta aprovado');
  if (!ep.approval.public_release_authorized)
    throw new Error('a aprovacao deste episodio nao marcou autorizacao de publicacao publica; isso e uma decisao separada do envio');
  // trava de canal depois das checagens locais: exige canal vinculado por ID
  await guard.assertWritable(store.channelId, 'publicacao publica');
  const rec = upload.readRec(store.channelId, epId);
  if (!rec || !rec.video_id) throw new Error('nao ha video enviado para publicar');
  const token = await oauth.accessToken(store.channelId);
  const body = JSON.stringify({ id: rec.video_id, status: { privacyStatus: 'public' } });
  const res = await request(`${ENDPOINTS.api}/youtube/v3/videos?part=status`, { method: 'PUT', body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
  if (res.status !== 200) throw apiError('publicacao publica falhou', res);
  // o relogio da audiencia so liga com a API CONFIRMANDO que ficou publico
  let verified = null; let verifyError = null;
  try { verified = await upload.verifyUploaded(store.channelId, rec.video_id); }
  catch (e) { verifyError = scrub(e.message); }
  const confirmedPublic = !!(verified && verified.privacy === 'public');
  const at = new Date().toISOString();
  const out = { epId, state: confirmedPublic ? STATES.PUBLICO : STATES.UPLOAD_PRIVADO,
    video_id: rec.video_id, privacy: (verified && verified.privacy) || null, approvedBy: by,
    owner_approval_note: ownerApprovalNote,
    uploaded_privately_at: rec.uploaded_privately_at || rec.queued_at || null,
    published_publicly_at: confirmedPublic ? at : null,
    privacy_confirmed_by_api: confirmedPublic,
    audience_clock_started: confirmedPublic,
    verify_error: verifyError,
    note: confirmedPublic
      ? 'a API confirmou privacidade "public": a partir desta data os marcos de audiencia contam. Esta autorizacao valeu para ESTE video, uma vez.'
      : `a chamada de publicacao voltou 200 mas a API ainda NAO confirma privacidade "public"${verifyError ? ` (${verifyError})` : ''}. O relogio da audiencia NAO foi ligado; rode "publish state" para conferir de novo.` };
  store.append('publication.recorded', out);
  store.append('memory.recorded', { kind: 'publicacao_publica', epId, video_id: rec.video_id, by, confirmed: confirmedPublic });
  if (confirmedPublic) {
    try { new EvolutionEngine(store.channelId).recordPublication(epId, { kind: 'publicacao_publica',
      video_id: rec.video_id, url: rec.url || `https://www.youtube.com/watch?v=${rec.video_id}`,
      privacy: 'public', uploaded_privately_at: rec.uploaded_privately_at || rec.queued_at || null,
      published_publicly_at: at, privacy_confirmed_by_api: true, author: by }); } catch (e) { log.warn(e.message); }
  }
  log.warn(`video ${rec.video_id} tornado PUBLICO por ${by}${confirmedPublic ? '' : ' (ainda sem confirmacao da API)'}`);
  return out;
}

/** 4. INICIO DA COLETA — decisao propria, e so sobre video publico confirmado */
async function startCollection(store, epId, { by }) {
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  if (!ep.approval || ep.approval.status !== 'approved') throw new Error('o episodio nao esta aprovado');
  if (!ep.approval.audience_collection_authorized)
    throw new Error('a aprovacao deste episodio nao marcou autorizacao de COLETA DE AUDIENCIA; isso e uma decisao separada do envio, do agendamento e da publicacao');
  const rec = upload.readRec(store.channelId, epId);
  if (!rec || !rec.video_id) throw new Error('nao ha video enviado: nao ha o que medir');
  // privacidade conferida na API, nao deduzida do registro local
  let verified = null;
  try { verified = await upload.verifyUploaded(store.channelId, rec.video_id); }
  catch (e) { throw new Error(`nao consegui conferir a privacidade do video na API: ${scrub(e.message)}`); }
  if (!verified || verified.privacy !== 'public')
    throw new Error(`a coleta so comeca com o video PUBLICO confirmado na API; agora a privacidade e "${(verified && verified.privacy) || 'desconhecida'}". Video privado nao tem audiencia para medir.`);
  const engine = new EvolutionEngine(store.channelId);
  const clock = engine.audienceClock(epId);
  if (!clock.started)
    throw new Error(`o registro do Evolution Engine ainda nao tem publicacao publica confirmada para este episodio (${clock.reason}); rode a publicacao publica antes da coleta`);
  const out = { epId, state: STATES.COLETANDO, video_id: rec.video_id, started_by: by,
    started_at: new Date().toISOString(), privacy: verified.privacy,
    published_publicly_at: clock.at,
    grants: TRANSITIONS.iniciar_coleta.grants, does_not_grant: TRANSITIONS.iniciar_coleta.does_not_grant,
    note: `a partir daqui o agendador mede este video nos marcos de 24h, 72h, 7 e 28 dias, contados de ${clock.at}` };
  store.append('publication.recorded', out);
  return out;
}

/** Estado real de um episodio, conferido na API quando possivel. */
async function stateOf(store, epId) {
  const ep = store.episode(epId);
  const rec = upload.readRec(store.channelId, epId);
  const engine = new EvolutionEngine(store.channelId);
  const x = engine.store.experiment(`exp_${epId}`);
  const ap = (ep && ep.approval) || {};
  const base = { episode_id: epId, transitions: TRANSITIONS,
    ready_for_upload: !!(ep && ep.gates && ep.gates.can_be_approved && ep.stages.qa && ep.stages.qa.status === 'done'
      && ap.status === 'approved' && ap.scheduled_upload_authorized),
    authorizations: {
      upload_privado: !!ap.scheduled_upload_authorized,
      agendamento: !!ap.publication_schedule_authorized,
      publicacao_publica: !!ap.public_release_authorized,
      coleta_de_audiencia: !!ap.audience_collection_authorized,
      note: 'quatro marcas independentes: marcar uma nunca marca outra'
    },
    public_release_authorized: !!ap.public_release_authorized,
    audience_clock: new EvolutionEngine(store.channelId).audienceClock(epId) };
  if (!rec || !rec.video_id) return { ...base, state: ep ? STATES.PRONTO_NAO_ENVIADO : STATES.NAO_PRODUZIDO, video_id: null, verified: null };
  let verified = null;
  try { verified = await upload.verifyUploaded(store.channelId, rec.video_id); } catch (e) { verified = { error: scrub(e.message) }; }
  const privacy = verified && verified.privacy ? verified.privacy : null;
  const collecting = !!(x && x.measurements.length);
  return { ...base, video_id: rec.video_id, url: `https://www.youtube.com/watch?v=${rec.video_id}`,
    state: privacy === 'public' ? STATES.PUBLICO : (verified && verified.published_at && new Date(verified.published_at) > new Date() ? STATES.AGENDADO : STATES.UPLOAD_PRIVADO),
    privacy,
    uploaded_privately_at: (x && x.publication && x.publication.uploaded_privately_at) || rec.uploaded_privately_at || rec.queued_at || null,
    published_publicly_at: (x && x.publication && x.publication.published_publicly_at) || null,
    collecting, measurements: x ? x.measurements.length : 0,
    open_milestones: (x && x.open_milestones) || [], final_milestones: (x && x.final_milestones) || [],
    verified };
}
module.exports = { uploadPrivate, schedule, makePublic, startCollection, stateOf,
  STATES, TRANSITIONS, CONFIRM_PHRASE, assertReadyForUpload };
