'use strict';
/**
 * Fila de publicacao. Tres chaves independentes, todas obrigatorias:
 *   1) gates verdes e auditoria NAO desatualizada
 *   2) aprovacao do proprietario para AQUELE video, com autorizacao de envio
 *   3) OAuth autorizado e verificado contra a API
 * E mais: o primeiro envio e sempre privado. Publicar em publico e outra decisao.
 */
const oauth = require('./oauth');
const upload = require('./upload');

function assertPublishable(store, epId) {
  const ep = store.episode(epId);
  if (!ep) throw new Error('episodio inexistente');
  if (!ep.gates || !ep.gates.can_be_approved) throw new Error('gates nao aprovados: publicacao bloqueada');
  if (!ep.stages.qa || ep.stages.qa.status !== 'done') throw new Error('auditoria desatualizada: rode a auditoria de novo antes de publicar');
  if (ep.approval.status !== 'approved') throw new Error('sem aprovacao do proprietario para este video');
  if (!ep.approval.scheduled_upload_authorized) throw new Error('a aprovacao nao autorizou envio programado deste video');
  return ep;
}

async function enqueue(store, epId, { privacy = 'private', publishAt = null, approvedBy }) {
  assertPublishable(store, epId);
  if (privacy !== 'private' && privacy !== 'unlisted') throw new Error('o padrao operacional exige privado ou nao listado no primeiro envio');
  const st = await oauth.state(store.channelId);
  const rec = { epId, privacy, publishAt, approvedBy, queued_at: new Date().toISOString(),
    status: st.status === 'AUTORIZADO' ? 'READY_TO_UPLOAD' : 'BLOCKED_NO_OAUTH',
    oauth_state: st.status, video_id: null, url: null };
  store.append('publication.recorded', rec);
  return rec;
}

/** Envio real. So roda com as tres chaves. Retorna o estado REAL conferido na API. */
async function publishPrivate(store, epId, { filePath, metadata, by, force = false, onProgress = null }) {
  assertPublishable(store, epId);
  // trava de canal depois das checagens locais: exige canal vinculado por ID
  await require('./channel-guard').assertWritable(store.channelId, 'envio privado');
  const st = await oauth.state(store.channelId);
  if (st.status !== 'AUTORIZADO') throw new Error(`OAuth em estado ${st.status}: ${st.reason || 'sem autorizacao'}`);
  const existing = upload.readRec(store.channelId, epId);
  if (existing && existing.video_id && !force)
    throw new Error(`este episodio ja tem video_id=${existing.video_id}; envio duplicado impedido`);

  const res = await upload.uploadVideo({ channelId: store.channelId, epId, filePath,
    metadata: { ...metadata, privacy_status: 'private' }, onProgress, force });
  let verified = null;
  try { verified = await upload.verifyUploaded(store.channelId, res.video_id); } catch (_) {}
  const rec = { epId, privacy: (verified && verified.privacy) || res.privacy || 'private',
    publishAt: metadata.publish_at || null, approvedBy: by || 'presidente',
    queued_at: new Date().toISOString(), status: 'UPLOADED_PRIVATE',
    video_id: res.video_id, url: res.url, bytes: res.bytes,
    verified_on_youtube: verified, resumed: !!res.resumed };
  store.append('publication.recorded', rec);
  store.append('memory.recorded', { kind: 'publicacao_privada', epId, video_id: res.video_id, by: rec.approvedBy });
  return rec;
}
module.exports = { enqueue, publishPrivate, assertPublishable };
