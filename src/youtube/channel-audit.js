'use strict';
/**
 * AUDITORIA DO CANAL EXISTENTE — somente leitura.
 *
 * O dono ja tem um canal. Este modulo le o que esta la (identidade, SEO,
 * organizacao, inventario de videos) e produz um diagnostico com recomendacoes.
 *
 * REGRA DURA: nada aqui escreve. Nao renomeia, nao troca foto nem banner, nao
 * mexe em privacidade de video, nao cria playlist, nao apaga nada. Cada
 * recomendacao sai marcada com o escopo que ela exigiria e com
 * requires_human_approval: true.
 */
const fs = require('fs');
const path = require('path');
const { request, apiError, ENDPOINTS, scrub } = require('./http');
const oauth = require('./oauth');

const ROOT = path.join(__dirname, '..', '..');
/** Escopos de ESCRITA que este projeto deliberadamente NAO pede hoje. */
const WRITE_SCOPES = {
  channel_branding: 'https://www.googleapis.com/auth/youtube',
  playlists: 'https://www.googleapis.com/auth/youtube',
  sections: 'https://www.googleapis.com/auth/youtube',
  video_metadata: 'https://www.googleapis.com/auth/youtube.force-ssl'
};
/** O que simplesmente nao existe na Data API e so se faz no Studio. */
const STUDIO_ONLY = [
  'campo "Related video" do Short, que liga oficialmente um Short ao video longo',
  'teste nativo A/B de miniaturas',
  'alguns campos de palavras-chave e de branding avancado',
  'secoes de pagina inicial com layout personalizado alem do que channelSections expoe'
];

async function get(channelId, url) {
  const token = await oauth.accessToken(channelId);
  const res = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200 || !res.json) throw apiError(`consulta falhou: ${url.split('?')[0]}`, res);
  return res.json;
}

/** Le tudo que da para ler do canal autorizado. */
async function readChannel(channelId) {
  const j = await get(channelId, `${ENDPOINTS.api}/youtube/v3/channels?part=snippet,brandingSettings,statistics,contentDetails,status,topicDetails&mine=true`);
  const it = (j.items || [])[0];
  if (!it) throw new Error('o token e valido mas nao alcanca nenhum canal');
  const bs = it.brandingSettings || {};
  return {
    youtube_channel_id: it.id,
    title: (it.snippet || {}).title || null,
    handle: (it.snippet || {}).customUrl || null,
    description: (it.snippet || {}).description || '',
    country: (it.snippet || {}).country || null,
    default_language: (it.snippet || {}).defaultLanguage || null,
    published_at: (it.snippet || {}).publishedAt || null,
    avatar: ((it.snippet || {}).thumbnails || {}).high ? it.snippet.thumbnails.high.url : null,
    banner: (bs.image || {}).bannerExternalUrl || null,
    keywords: (bs.channel || {}).keywords || '',
    unsubscribed_trailer: (bs.channel || {}).unsubscribedTrailer || null,
    statistics: it.statistics || {},
    uploads_playlist: ((it.contentDetails || {}).relatedPlaylists || {}).uploads || null,
    privacy_status: (it.status || {}).privacyStatus || null,
    made_for_kids: (it.status || {}).madeForKids ?? null,
    topics: ((it.topicDetails || {}).topicCategories || [])
  };
}
async function readInventory(channelId, uploadsPlaylist, { max = 200 } = {}) {
  if (!uploadsPlaylist) return { videos: [], note: 'canal sem playlist de uploads' };
  const ids = []; let pageToken = '';
  while (ids.length < max) {
    const j = await get(channelId, `${ENDPOINTS.api}/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploadsPlaylist)}${pageToken ? '&pageToken=' + pageToken : ''}`);
    for (const i of j.items || []) ids.push(i.contentDetails.videoId);
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const j = await get(channelId, `${ENDPOINTS.api}/youtube/v3/videos?part=snippet,status,contentDetails,statistics&id=${batch}`);
    for (const v of j.items || []) videos.push({
      id: v.id, title: (v.snippet || {}).title, published_at: (v.snippet || {}).publishedAt,
      privacy: (v.status || {}).privacyStatus, made_for_kids: (v.status || {}).madeForKids ?? null,
      duration: (v.contentDetails || {}).duration, is_short_duration: /PT([0-5]?\dS|1M([0-5]?\dS)?)$/.test((v.contentDetails || {}).duration || ''),
      views: Number((v.statistics || {}).viewCount || 0),
      description_length: ((v.snippet || {}).description || '').length,
      tags: ((v.snippet || {}).tags || []).length,
      default_language: (v.snippet || {}).defaultLanguage || null
    });
  }
  return { videos, counted: videos.length };
}
async function readPlaylists(channelId) {
  const j = await get(channelId, `${ENDPOINTS.api}/youtube/v3/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50`);
  return (j.items || []).map((p) => ({ id: p.id, title: (p.snippet || {}).title,
    description_length: ((p.snippet || {}).description || '').length,
    items: (p.contentDetails || {}).itemCount || 0, privacy: (p.status || {}).privacyStatus }));
}
async function readSections(channelId) {
  try {
    const j = await get(channelId, `${ENDPOINTS.api}/youtube/v3/channelSections?part=snippet,contentDetails&mine=true`);
    return (j.items || []).map((s) => ({ id: s.id, type: (s.snippet || {}).type, title: (s.snippet || {}).title || null, position: (s.snippet || {}).position }));
  } catch (e) { return { error: scrub(e.message) }; }
}

/** Compara o que existe com a proposta e devolve recomendacoes — sem aplicar nada. */
function diagnose(ch, inventory, playlists, sections, proposal) {
  const rec = [];
  const add = (area, finding, action, scope, severity = 'media') =>
    rec.push({ area, finding, recommended_action: action, requires_scope: scope || null,
      requires_human_approval: true, applied: false, severity });

  // 1. identidade
  if (!ch.handle) add('identidade', 'o canal nao tem @handle definido', 'definir um @handle curto e consistente com o nome', 'Studio (handle nao e exposto pela Data API)', 'alta');
  if (!ch.banner) add('identidade', 'nao ha banner', 'subir banner 2560x1440 com area segura de 1546x423', WRITE_SCOPES.channel_branding, 'alta');
  if (!ch.avatar) add('identidade', 'nao ha foto de perfil', 'subir avatar 800x800 legivel a 48px', WRITE_SCOPES.channel_branding, 'alta');
  if (ch.title && proposal && ch.title !== proposal.channel_name)
    add('identidade', `o nome atual e "${ch.title}"`, `avaliar renomear para "${proposal.channel_name}" (decisao do dono; renomear afeta busca e reconhecimento)`, WRITE_SCOPES.channel_branding, 'baixa');

  // 2. SEO
  const d = String(ch.description || '');
  if (d.length < 150) add('seo', `descricao do canal tem ${d.length} caracteres`, 'usar a descricao proposta em ingles americano, com o posicionamento do nicho nas duas primeiras linhas', WRITE_SCOPES.channel_branding, 'alta');
  if (!ch.keywords || ch.keywords.length < 20) add('seo', 'palavras-chave do canal vazias ou curtas', 'aplicar a lista de palavras-chave proposta', WRITE_SCOPES.channel_branding, 'media');
  if (!ch.default_language) add('seo', 'idioma padrao do canal nao definido', 'definir en-US, ja que o conteudo e em ingles americano', WRITE_SCOPES.channel_branding, 'media');
  if (ch.country === null) add('seo', 'pais nao definido', 'definir o pais do canal', WRITE_SCOPES.channel_branding, 'baixa');

  // 3. organizacao
  const longs = (inventory.videos || []).filter((v) => !v.is_short_duration);
  const shorts = (inventory.videos || []).filter((v) => v.is_short_duration);
  if (!playlists.length) add('organizacao', 'nenhuma playlist', 'criar as playlists tematicas propostas e separar longos de Shorts', WRITE_SCOPES.playlists, 'media');
  if (!Array.isArray(sections) || !sections.length) add('organizacao', 'pagina inicial sem secoes', 'criar secoes: video em destaque, episodios longos, Shorts, playlists tematicas', WRITE_SCOPES.sections, 'media');
  if (!ch.unsubscribed_trailer) add('organizacao', 'sem trailer para quem nao e inscrito', 'definir o episodio de melhor retencao como trailer, depois que houver dado', WRITE_SCOPES.channel_branding, 'baixa');

  // 4. estrategia nos videos existentes
  const semDesc = (inventory.videos || []).filter((v) => v.description_length < 200);
  if (semDesc.length) add('estrategia', `${semDesc.length} video(s) com descricao abaixo de 200 caracteres`, 'reescrever descricoes com capitulos e fontes, no padrao dos episodios da empresa', WRITE_SCOPES.video_metadata, 'media');
  const semTags = (inventory.videos || []).filter((v) => v.tags === 0);
  if (semTags.length) add('estrategia', `${semTags.length} video(s) sem tags`, 'aplicar tags pertinentes ao nicho', WRITE_SCOPES.video_metadata, 'baixa');

  // 5. distribuicao
  if (shorts.length) add('distribuicao', `${shorts.length} Short(s) existente(s)`,
    'ligar cada Short ao longo correspondente pelo campo "Related video" do Studio e incluir o link do longo na descricao',
    'Studio (o campo de video relacionado nao e exposto pela Data API)', 'media');

  return { recommendations: rec,
    inventory_summary: { total: (inventory.videos || []).length, longs: longs.length, shorts: shorts.length,
      by_privacy: (inventory.videos || []).reduce((a, v) => { a[v.privacy] = (a[v.privacy] || 0) + 1; return a; }, {}),
      total_views: (inventory.videos || []).reduce((a, v) => a + v.views, 0) } };
}

/** Auditoria completa. Read-only de ponta a ponta. */
async function audit(channelId, { proposal = null } = {}) {
  const st = await oauth.state(channelId);
  if (st.status !== 'AUTORIZADO')
    return { available: false, status: st.status, reason: st.reason || 'sem autorizacao',
      note: 'a auditoria do canal existente so roda depois do OAuth; nada e inventado antes disso',
      what_it_will_read: ['identidade e branding', 'descricao e palavras-chave', 'playlists', 'secoes da pagina inicial', 'inventario de videos com privacidade e metricas publicas'],
      write_scopes_not_requested: WRITE_SCOPES, studio_only: STUDIO_ONLY };
  const ch = await readChannel(channelId);
  const inv = await readInventory(channelId, ch.uploads_playlist);
  const pls = await readPlaylists(channelId);
  const secs = await readSections(channelId);
  const dg = diagnose(ch, inv, pls, secs, proposal);
  return { available: true, audited_at: new Date().toISOString(), channel: ch,
    playlists: pls, sections: secs, inventory: inv, ...dg,
    write_scopes_not_requested: WRITE_SCOPES, studio_only: STUDIO_ONLY,
    guarantee: 'esta auditoria NAO alterou nada: nao renomeou, nao trocou imagem, nao mexeu em privacidade, nao criou nem apagou playlist.' };
}
module.exports = { audit, readChannel, readInventory, readPlaylists, readSections, diagnose, WRITE_SCOPES, STUDIO_ONLY };
