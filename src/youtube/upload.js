'use strict';
/**
 * Upload real para o YouTube: videos.insert com sessao RETOMAVEL.
 *
 * Garantias:
 *  - privacyStatus FORCADO para private. Qualquer outro valor e recusado aqui,
 *    nao so no painel. Publicar em publico e outra decisao, do dono, depois.
 *  - prevencao de duplicidade: um registro por episodio guarda o sha256 do arquivo.
 *    Se ja existe video_id para aquele arquivo, o upload e recusado.
 *  - retomada: a URI de sessao e gravada em disco. Se a conexao cair, o envio
 *    continua do byte que o Google diz ter recebido, nao do zero.
 *  - nenhum token aparece em log ou em erro.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { request, apiError, ENDPOINTS, scrub } = require('./http');
const oauth = require('./oauth');
const { Logger } = require('../log');

const log = new Logger('youtube.upload');
const CHUNK = Number(process.env.YT_UPLOAD_CHUNK_BYTES || 8 * 1024 * 1024); // multiplo de 256 KiB
// Configuravel para que a suite de testes NUNCA escreva nem apague em var/uploads.
const STATE_DIR = process.env.YT_UPLOAD_STATE_DIR || path.join(__dirname, '..', '..', 'var', 'uploads');

function recFile(channelId, epId) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  return path.join(STATE_DIR, `${channelId}__${epId}.json`);
}
function readRec(channelId, epId) {
  const p = recFile(channelId, epId);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}
function writeRec(channelId, epId, rec) {
  fs.writeFileSync(recFile(channelId, epId), JSON.stringify(rec, null, 2), { mode: 0o600 });
  return rec;
}
function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

function buildBody(metadata) {
  const privacy = metadata.privacy_status || 'private';
  if (privacy !== 'private') throw new Error(`privacyStatus recusado: "${privacy}". O primeiro envio e sempre private.`);
  const snippet = {
    title: String(metadata.title || '').slice(0, 100),
    description: String(metadata.description || '').slice(0, 5000),
    tags: (metadata.tags || []).slice(0, 60),
    categoryId: String(metadata.category_id || '27'), // 27 = Education
    defaultLanguage: metadata.default_language || 'en-US',
    defaultAudioLanguage: metadata.default_audio_language || 'en-US'
  };
  if (!snippet.title) throw new Error('metadata sem titulo');
  const status = { privacyStatus: 'private',
    selfDeclaredMadeForKids: metadata.made_for_kids === true,
    embeddable: true, license: 'youtube' };
  if (metadata.publish_at) status.publishAt = metadata.publish_at; // agendamento so vale com privacyStatus private
  return JSON.stringify({ snippet, status });
}

/** Pergunta ao Google quantos bytes ele ja tem desta sessao. */
async function probeSession(sessionUri, total) {
  const res = await request(sessionUri, { method: 'PUT',
    headers: { 'Content-Length': 0, 'Content-Range': `bytes */${total}` } });
  if (res.status === 200 || res.status === 201) return { done: true, body: res.json };
  if (res.status === 308) {
    const range = res.headers.range || res.headers.Range;
    const received = range ? Number(String(range).split('-')[1]) + 1 : 0;
    return { done: false, received };
  }
  if (res.status === 404) return { expired: true };
  throw apiError('consulta de sessao de upload falhou', res);
}

/**
 * @param opts.onProgress (sent, total)
 * @param opts.force  pula a trava de duplicidade (exige confirmacao explicita do dono)
 */
async function uploadVideo({ channelId, epId, filePath, metadata, onProgress = null, force = false }) {
  if (!fs.existsSync(filePath)) throw new Error(`arquivo inexistente: ${filePath}`);
  const st = await oauth.state(channelId);
  if (st.status !== 'AUTORIZADO') throw new Error(`upload bloqueado: OAuth em estado ${st.status}. ${st.reason || ''}`.trim());
  // Segunda trava, no nivel mais baixo: nem um chamador descuidado envia para o canal errado.
  await require('./channel-guard').assertWritable(channelId, 'upload');

  const total = fs.statSync(filePath).size;
  const digest = sha256File(filePath);
  let rec = readRec(channelId, epId);

  // --- trava de duplicidade ---
  if (rec && rec.video_id && rec.file_sha256 === digest && !force) {
    throw new Error(`duplicidade impedida: este arquivo ja foi enviado como video_id=${rec.video_id} em ${rec.completed_at}. Para enviar outra vez, e preciso forcar explicitamente.`);
  }
  if (rec && rec.video_id && rec.file_sha256 !== digest) {
    log.warn(`o arquivo de ${epId} mudou desde o envio anterior (${rec.video_id}); iniciando sessao nova`);
    rec = null;
  }

  const body = buildBody(metadata);
  let sessionUri = null, sent = 0;

  // --- retomada de sessao ---
  if (rec && rec.session_uri && rec.file_sha256 === digest && !rec.video_id) {
    try {
      const p = await probeSession(rec.session_uri, total);
      if (p.done) {
        const vid = p.body && p.body.id;
        writeRec(channelId, epId, { ...rec, video_id: vid, completed_at: new Date().toISOString(), resumed: true });
        return { video_id: vid, url: `https://www.youtube.com/watch?v=${vid}`, privacy: 'private', resumed: true, bytes: total };
      }
      if (!p.expired) { sessionUri = rec.session_uri; sent = p.received || 0; log.info(`retomando upload de ${epId} a partir de ${sent}/${total} bytes`); }
    } catch (e) { log.warn(`sessao anterior inutilizavel (${scrub(e.message)}); abrindo outra`); }
  }

  // --- abre sessao ---
  if (!sessionUri) {
    const token = await oauth.accessToken(channelId);
    const res = await request(`${ENDPOINTS.upload}/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
      method: 'POST', body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body), 'X-Upload-Content-Length': total, 'X-Upload-Content-Type': 'video/mp4' }
    });
    if (res.status !== 200 && res.status !== 201) throw apiError('abertura da sessao de upload falhou', res);
    sessionUri = res.headers.location || res.headers.Location;
    if (!sessionUri) throw new Error('o Google nao devolveu a URI de sessao (cabecalho Location ausente)');
    sent = 0;
    rec = writeRec(channelId, epId, { channelId, epId, file: filePath, file_sha256: digest, bytes: total,
      session_uri: sessionUri, started_at: new Date().toISOString(), video_id: null, privacy: 'private' });
  }

  // --- envia em pedacos, com retomada por 308 ---
  const fd = fs.openSync(filePath, 'r');
  try {
    let attempts = 0;
    while (sent < total) {
      const size = Math.min(CHUNK, total - sent);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, sent);
      let res;
      try {
        res = await request(sessionUri, { method: 'PUT', body: buf, timeout: 15 * 60 * 1000,
          headers: { 'Content-Length': size, 'Content-Range': `bytes ${sent}-${sent + size - 1}/${total}` } });
      } catch (e) {
        if (++attempts > 5) throw new Error(`upload interrompido apos 5 tentativas: ${scrub(e.message)}`);
        const wait = Math.min(32000, 1000 * 2 ** attempts);
        log.warn(`falha de rede no pedaco em ${sent} bytes; nova tentativa em ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        const p = await probeSession(sessionUri, total);
        if (p.done) { const vid = p.body && p.body.id; writeRec(channelId, epId, { ...rec, video_id: vid, completed_at: new Date().toISOString() });
          return { video_id: vid, url: `https://www.youtube.com/watch?v=${vid}`, privacy: 'private', bytes: total, retries: attempts }; }
        sent = p.received || sent;
        continue;
      }
      if (res.status === 308) {
        const range = res.headers.range || res.headers.Range;
        sent = range ? Number(String(range).split('-')[1]) + 1 : sent + size;
        attempts = 0;
        if (onProgress) onProgress(sent, total);
        continue;
      }
      if (res.status === 200 || res.status === 201) {
        const vid = res.json && res.json.id;
        if (!vid) throw new Error('upload terminou sem id de video na resposta');
        const privacy = ((res.json.status || {}).privacyStatus) || null;
        if (privacy && privacy !== 'private') log.error(`ATENCAO: o YouTube devolveu privacyStatus=${privacy}, nao private`);
        const done = writeRec(channelId, epId, { ...rec, video_id: vid, completed_at: new Date().toISOString(),
          reported_privacy: privacy, bytes_sent: total });
        if (onProgress) onProgress(total, total);
        log.info(`upload concluido: ${vid} (privacidade reportada: ${privacy})`);
        return { video_id: vid, url: `https://www.youtube.com/watch?v=${vid}`, privacy, bytes: total,
          reported_status: res.json.status || null, record: done };
      }
      if (res.status === 404) throw new Error('a sessao de upload expirou; rode de novo para abrir outra');
      if (res.status >= 500) {
        if (++attempts > 5) throw apiError('upload falhou apos 5 tentativas', res);
        const wait = Math.min(32000, 1000 * 2 ** attempts);
        log.warn(`HTTP ${res.status} do servidor; nova tentativa em ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        const p = await probeSession(sessionUri, total);
        sent = p.received || sent;
        continue;
      }
      throw apiError('upload recusado', res);
    }
  } finally { fs.closeSync(fd); }
  throw new Error('upload terminou sem confirmacao do YouTube');
}

/** Confere no YouTube o estado REAL do video enviado. Arquivo local nao e prova. */
async function verifyUploaded(channelId, videoId) {
  const token = await oauth.accessToken(channelId);
  const res = await request(`${ENDPOINTS.api}/youtube/v3/videos?part=status,snippet,processingDetails&id=${encodeURIComponent(videoId)}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200 || !res.json) throw apiError('consulta do video falhou', res);
  const item = (res.json.items || [])[0];
  if (!item) return { found: false, video_id: videoId };
  return { found: true, video_id: videoId, privacy: (item.status || {}).privacyStatus || null,
    upload_status: (item.status || {}).uploadStatus || null,
    processing: (item.processingDetails || {}).processingStatus || null,
    title: (item.snippet || {}).title || null, published_at: (item.snippet || {}).publishedAt || null,
    url: `https://www.youtube.com/watch?v=${videoId}` };
}
module.exports = { uploadVideo, verifyUploaded, readRec, writeRec, recFile, sha256File, buildBody, probeSession, CHUNK, STATE_DIR };
