'use strict';
const S = { ep: 'ep_001', data: null, view: 'gabinete', job: null };
const $ = (s, r) => (r || document).querySelector(s);
const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const api = async (p, o) => (await fetch(p, o)).json();
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pill = (txt, cls) => `<span class="pill ${cls}">${h(txt)}</span>`;
const stageIcon = { done: ['ok', 'concluído'], failed: ['bad', 'falhou'], running: ['warn', 'rodando'], stale: ['warn', 'desatualizado'], pending: ['idle', 'pendente'] };

async function load() {
  const list = await api('/api/episodes').catch(() => ({ episodes: [] }));
  S.list = list.episodes || [];
  if (!S.list.find(e => e.id === S.ep) && S.list.length) S.ep = S.list[0].id;
  const [d, ch] = await Promise.all([api(`/api/episodes/${S.ep}`).catch(() => null), api('/api/channel')]);
  S.data = d; S.channel = ch;
  $('#chName').textContent = ch.working_name + ' · identidade provisória';
  renderEpPicker();
  render();
}
function renderEpPicker() {
  let el = $('#epPicker');
  if (!el) {
    const nav = $('#nav');
    nav.insertAdjacentHTML('afterbegin', '<div class="sec">Episódio</div><div id="epPicker" style="padding:0 16px 8px"></div>');
    el = $('#epPicker');
  }
  el.innerHTML = `<select id="epSel">${S.list.map(e => `<option value="${h(e.id)}" ${e.id === S.ep ? 'selected' : ''}>${h(e.id)} — ${h((e.title || '').slice(0, 26))}</option>`).join('')}</select>`;
  $('#epSel').onchange = (ev) => { S.ep = ev.target.value; load(); };
}
function setView(v) { S.view = v; document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === v)); render(); }
document.addEventListener('click', e => { const a = e.target.closest('#nav a'); if (a) { e.preventDefault(); setView(a.dataset.v); } });

function render() {
  const m = $('#main');
  if (!S.data || !S.data.episode) { m.innerHTML = `<h2>Nenhum episódio</h2><p class="sub">Abra uma missão com o CEO Virtual.</p>`; return; }
  m.innerHTML = (VIEWS[S.view] || VIEWS.gabinete)();
  wire();
}

const V = {}; const VIEWS = V;

V.gabinete = () => {
  const d = S.data, ep = d.episode, q = d.quality, st = d.pipeline;
  const done = st.filter(s => s.status === 'done').length;
  const gates = q ? q.gates : null;
  const total = st.reduce((a, s) => a + (s.durationMs || 0), 0);
  return `<h2>Gabinete do Presidente</h2><p class="sub">Estado real da empresa. Nada aqui é estimativa.</p>
  <div class="grid g4" style="margin-bottom:16px">
    ${kpi('Pipeline', `${done}/${st.length}`, 'estágios concluídos')}
    ${kpi('Despesa externa', `US$ ${(ep.cost_usd || 0).toFixed(2)}`, 'limite US$ 0,00')}
    ${kpi('Máquina', `${(total / 60000).toFixed(1)} min`, 'tempo somado de execução')}
    ${kpi('Gates', d.gates_stale ? 'desatual.' : (gates ? (gates.can_be_approved ? 'verdes' : 'bloqueado') : '—'),
      d.gates_stale ? 'auditoria invalidada — rodar de novo' : (q ? `${q.passed}/${q.total} testes` : 'não avaliados'))}
  </div>
  <div class="grid g2">
    <div class="card"><h3>Meta em curso</h3>
      <p class="small muted">Entregar o episódio piloto do canal de filosofia prática, completo e utilizável, com despesa externa zero.</p>
      <div style="margin-top:12px">${st.map(s => `<div class="between" style="padding:4px 0;font-size:12.5px"><span class="muted">${h(s.title)}</span>${pill(stageIcon[s.status][1], stageIcon[s.status][0])}</div>`).join('')}</div>
    </div>
    <div class="card"><h3>Bloqueios que dependem de você</h3>
      <div class="block"><b>1. OAuth do YouTube</b><br>Publicação e analytics estão BLOQUEADOS. É login seu, no navegador — este sistema nunca pede senha.</div>
      <div class="block" style="margin-top:10px"><b>2. Aprovação do vídeo</b><br>Status: ${h(ep.approval.status)}. Sem ela, nada entra na fila.</div>
      <div class="block" style="margin-top:10px"><b>3. Nome do canal</b><br>Três propostas aguardam escolha. Nenhum nome foi registrado.</div>
    </div>
  </div>
  <div class="card"><h3>Últimas produções</h3>
    <table><tr><th>Episódio</th><th>Título</th><th>Duração</th><th>Custo</th><th>Gates</th><th>Aprovação</th></tr>
    <tr><td class="mono">${h(ep.id)}</td><td>${h((d.metadata && d.metadata.title) || ep.title || '—')}</td>
    <td>${d.metadata ? mmss(d.metadata.duration_s) : '—'}</td><td>US$ ${(ep.cost_usd || 0).toFixed(2)}</td>
    <td>${gates ? pill(gates.can_be_approved ? 'verdes' : 'bloqueado', gates.can_be_approved ? 'ok' : 'bad') : '—'}</td>
    <td>${pill(ep.approval.status, ep.approval.status === 'approved' ? 'ok' : 'idle')}</td></tr></table></div>`;
};
const kpi = (l, v, n) => `<div class="kpi"><div class="l">${h(l)}</div><div class="v">${h(v)}</div><div class="n">${h(n)}</div></div>`;

V.ceo = () => `<h2>CEO Virtual</h2><p class="sub">Responde a partir do estado real do pipeline. Não publica, não gasta, não conecta conta.</p>
  <div class="card"><div class="chat" id="chat"><div class="msg ceo"><b>CEO</b>Pronto. Pergunte "status", "custo", "bloqueios", "reunião executiva", ou peça "novo episódio: <tema>".</div></div>
  <div class="flex"><input id="ceoIn" placeholder="falar com o CEO…" style="flex:1"><button class="p" id="ceoSend">Enviar</button></div>
  <div class="flex" style="margin-top:9px">${['status', 'custo', 'bloqueios', 'reunião executiva', 'calendário'].map(q => `<button class="qq" data-q="${h(q)}">${h(q)}</button>`).join('')}</div>
  </div>
  <div class="notice">Reunião por voz ainda não existe aqui: não há integração de áudio bidirecional instalada. Enquanto não houver, a reunião é por texto e vira tarefa no store — não simulo uma chamada que não acontece.</div>`;

V.canais = () => { const c = S.channel; return `<h2>Canais</h2><p class="sub">Perfis lógicos. Nenhuma conta Google é criada automaticamente.</p>
  <div class="card"><div class="between"><h3 style="margin:0">${h(c.working_name)} <span class="muted small">(${h(c.id)})</span></h3>${pill('identidade provisória', 'warn')}</div>
  <p class="small muted" style="margin-top:10px">${h(c.editorial_thesis.statement)}</p>
  <div class="grid g2" style="margin-top:14px">
    <div><div class="l muted small"><b>NÃO é isto</b></div><ul class="small muted" style="padding-left:17px;margin-top:6px">${c.editorial_thesis.not_this.map(x => `<li>${h(x)}</li>`).join('')}</ul></div>
    <div><div class="l muted small"><b>É isto</b></div><ul class="small muted" style="padding-left:17px;margin-top:6px">${c.editorial_thesis.this_instead.map(x => `<li>${h(x)}</li>`).join('')}</ul></div>
  </div></div>
  <div class="card"><h3>Nomes propostos — nenhum registrado</h3>
  <table><tr><th>Nome</th><th>Por que</th><th>Risco</th></tr>
  ${c.name_proposals.map(n => `<tr><td><b>${h(n.name)}</b></td><td class="muted">${h(n.why)}</td><td class="muted">${h(n.risk)}</td></tr>`).join('')}</table>
  <div class="block" style="margin-top:12px">${h(c.registration)}</div></div>
  <div class="card"><h3>Isolamento</h3><table>${Object.entries(c.isolation).map(([k, v]) => `<tr><td class="mono">${h(k)}</td><td class="muted">${h(v)}</td></tr>`).join('')}</table></div>`;
};

V.pautas = () => { const ideas = (S.data.ideas || {}).ideas || []; const ds = (S.data.ideas || {}).demand_signals || [];
  return `<h2>Pautas e calendário editorial</h2><p class="sub">${ideas.length} pautas originais com tese, fonte e risco.</p>
  ${ds.map(s => `<div class="block"><b>Sinal de demanda: ${h(s.status)}</b><br>${h(s.note)}</div>`).join('')}
  <div class="card" style="margin-top:14px"><table><tr><th>#</th><th>Título / tese</th><th>Fontes</th><th>Risco de semelhança</th><th>Shorts</th><th>Status</th></tr>
  ${ideas.map((i, n) => `<tr><td class="mono">${n + 1}</td>
    <td><b>${h(i.title)}</b><div class="muted small" style="margin-top:3px">${h(i.thesis)}</div></td>
    <td class="muted small">${(i.sources_available || []).length}</td>
    <td class="muted small">${h(i.similarity_risk)}</td><td class="muted small">${h(i.shorts_potential)}</td>
    <td>${i.pending_research ? pill('pesquisa pendente', 'warn') : (i.id === 'idea_01' ? pill('produzida', 'ok') : pill('na fila', 'idle'))}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>Calendário de 90 dias</h3><div id="cal" class="muted small">carregando…</div></div>`;
};

V.producao = () => { const st = S.data.pipeline;
  return `<h2>Produção</h2><p class="sub">Cada estágio tem artefato, checksum, custo e tempo. Reiniciar um estágio invalida os que dependem dele.</p>
  <div class="flex" style="margin-bottom:14px"><button class="p" id="runAll">Rodar pipeline (retoma do checkpoint)</button><span id="jobState" class="muted small"></span></div>
  <div class="card"><table><tr><th>Estágio</th><th>Agente</th><th>Status</th><th>Autonomia</th><th>Tempo</th><th>Artef.</th><th></th></tr>
  ${st.map(s => `<tr><td><b>${h(s.title)}</b><div class="mono muted" style="font-size:11px">${h(s.id)}</div></td>
    <td class="muted small">${h(s.agent)}</td><td>${pill(stageIcon[s.status][1], stageIcon[s.status][0])}</td>
    <td class="small">${s.autonomy ? pill(s.autonomy.label, s.autonomy.level === 'automated' ? 'ok' : (s.autonomy.level === 'local_model' ? 'idle' : 'warn')) : '<span class="muted">—</span>'}
      ${s.autonomy && s.autonomy.gap ? `<div class="muted" style="font-size:11px;margin-top:4px;max-width:46ch">${h(s.autonomy.gap)}</div>` : ''}</td>
    <td class="muted small">${s.durationMs ? (s.durationMs / 1000).toFixed(1) + 's' : '—'}</td>
    <td class="muted small">${(s.artifacts || []).length}</td>
    <td><button class="rs" data-s="${h(s.id)}" ${s.runnable ? '' : 'disabled'}>Reiniciar</button></td></tr>
    ${s.stale_reason ? `<tr><td colspan="7" class="small" style="color:var(--warn)">${h(s.stale_reason)}</td></tr>` : ''}
    ${s.error ? `<tr><td colspan="7" class="block small">${h(s.error)}</td></tr>` : ''}`).join('')}</table></div>
  <div class="notice">A coluna de autonomia diz a verdade sobre cada etapa: <b>automático</b> roda sozinho; <b>modelo local</b> usa um modelo desta máquina; <b>assistido</b> foi trabalho intelectual desta sessão e vai exigir o mesmo trabalho no próximo episódio, por uma pessoa ou por um agente com LLM configurada.</div>
  <div class="card"><h3>Artefatos no disco</h3><table><tr><th>Arquivo</th><th>Tamanho</th><th></th></tr>
  ${S.data.artifacts.map(a => `<tr><td class="mono">${h(a.rel)}</td><td class="muted small">${mb(a.bytes)}</td><td><a href="${h(a.url)}" download>baixar</a></td></tr>`).join('')}</table></div>`;
};

V.estudio = () => { const d = S.data, md = d.metadata, q = d.quality, ep = d.episode;
  if (!md) return `<h2>Estúdio de Revisão</h2><div class="block">O episódio ainda não chegou ao estágio de metadados.</div>`;
  const g = q && q.gates;
  return `<h2>Estúdio de Revisão</h2><p class="sub">${h(md.title)} · ${mmss(md.duration_s)} · ${h(md.resolution)}</p>
  <div class="grid g2"><div>
    <div class="card"><video controls preload="metadata" src="/files/${S.ep}/video_long_1080p.mp4"></video>
      <div class="flex" style="margin-top:11px"><a href="/files/${S.ep}/video_long_1080p.mp4" download>baixar MP4</a>
      <a href="/files/${S.ep}/captions.srt" download>legendas .srt</a><a href="/files/${S.ep}/narration.wav" download>narração .wav</a></div></div>
    <div class="card"><h3>Miniaturas — escolha antes de publicar</h3><div class="thumbs">
      <div><img src="/files/${S.ep}/thumbnail_A.png"><div class="small muted" style="margin-top:6px">A</div></div>
      <div><img src="/files/${S.ep}/thumbnail_B.png"><div class="small muted" style="margin-top:6px">B</div></div></div></div>
    <div class="card"><h3>Shorts derivados</h3><div class="shorts">
      ${((d.shorts || {}).shorts || []).map(s => `<div><video controls preload="metadata" src="/files/${S.ep}/shorts/${h(s.short_id)}.mp4"></video>
      <div class="small" style="margin-top:6px"><b>${h(s.title)}</b></div><div class="small muted">${s.duration_s}s · ${h(s.resolution)}</div></div>`).join('')}</div></div>
  </div><div>
    <div class="card"><h3>Gates — ${q ? `${q.passed}/${q.total}` : '—'}</h3>
      ${d.gates_stale ? `<div class="block">Esta avaliação está <b>DESATUALIZADA</b>: um estágio anterior foi refeito depois dela. Rode a auditoria de novo em Produção antes de aprovar.</div>` : ''}
      ${g ? `<div class="between"><span class="muted small">Veredicto</span>${pill(d.gates_stale ? 'desatualizado' : g.verdict, d.gates_stale ? 'warn' : (g.can_be_approved ? 'ok' : 'bad'))}</div>` : ''}
      <div style="margin-top:11px">${(q ? q.tests : []).map(t => `<div class="between" style="padding:4px 0;font-size:12.5px;border-bottom:1px solid var(--line)">
        <span><span class="mono" style="font-size:11px">${h(t.id)}</span><div class="muted" style="font-size:11.5px">${h(t.detail)}</div></span>${pill(t.pass ? 'ok' : 'falhou', t.pass ? 'ok' : 'bad')}</div>`).join('')}</div></div>
    <div class="card"><h3>Fontes e direitos</h3>
      <div class="small muted">Afirmações factuais: <b>${d.claims ? d.claims.summary.factual_lines_detected : '—'}</b> · verificadas na matriz: <b>${d.claims ? d.claims.summary.verified : '—'}</b> · isentas (ilustrativas): <b>${d.claims ? (d.claims.summary.exempt_illustrative || 0) : '—'}</b> · bloqueios: <b>${d.claims ? d.claims.summary.blocked : '—'}</b></div>
      <div class="small muted">Verificador da matriz: ${d.claims && d.claims.matrix_verifier ? h(d.claims.matrix_verifier) : '—'}</div>
      <div class="small muted">Ativos de terceiros: <b>${d.provenance ? (d.provenance.third_party_media_used ? 'sim' : 'nenhum') : '—'}</b> · Imagens generativas: <b>${d.provenance ? (d.provenance.generative_images_used ? 'sim' : 'nenhuma') : '—'}</b></div>
      <div class="flex" style="margin-top:10px"><a href="/files/${S.ep}/claims_review.md">claims_review.md</a><a href="/files/${S.ep}/provenance.json">provenance.json</a><a href="/files/${S.ep}/sources.md">sources.md</a></div></div>
    <div class="card"><h3>Decisão do presidente</h3>
      <div class="between"><span class="muted small">Status atual</span>${pill(ep.approval.status, ep.approval.status === 'approved' ? 'ok' : 'idle')}</div>
      <textarea id="apNotes" rows="3" placeholder="observações da revisão" style="margin-top:10px"></textarea>
      <label class="small muted flex" style="margin-top:9px"><input type="checkbox" id="apSched" style="width:auto"> autorizar envio programado <b>deste</b> vídeo (privado)</label>
      <div class="flex" style="margin-top:11px"><button class="p" id="apOk" ${g && g.can_be_approved && !d.gates_stale ? '' : 'disabled'}>Aprovar</button><button id="apNo">Rejeitar</button></div>
      ${g && !g.can_be_approved ? `<div class="block" style="margin-top:10px">Aprovação travada pelos gates: ${h((g.blocking_failures || []).join(', '))}</div>` : ''}
      <div class="small muted" style="margin-top:9px">Aprovar aqui vale só para este vídeo. Não cria autorização para vídeos futuros.</div></div>
    <div class="card"><h3>Pendências humanas</h3><ul class="small muted" style="padding-left:17px">${(q ? q.human_review_pending : []).map(x => `<li>${h(x)}</li>`).join('')}</ul></div>
  </div></div>`;
};

V.publicacao = () => `<h2>Publicação</h2><p class="sub">Fila, privacidade e estado real do OAuth.</p><div id="pub">carregando…</div>`;
V.analytics = () => `<h2>Analytics</h2><p class="sub">Só dado real da API autenticada. Métrica inexistente aparece como indisponível, nunca como zero.</p><div id="an">carregando…</div>`;
V.memoria = () => `<h2>Memória</h2><p class="sub">Decisões aprovadas, missões e aprendizados.</p><div id="mem">carregando…</div>`;
V.integracoes = () => `<h2>Integrações e custos</h2><p class="sub">O que está ligado, o que custa e o que está desligado por padrão.</p><div id="int">carregando…</div>`;
V.agentes = () => `<h2>Organograma</h2><p class="sub">16 funções configuradas. Nem todas rodam ao mesmo tempo.</p><div id="org">carregando…</div>`;

async function wire() {
  if (S.view === 'ceo') {
    const send = async () => { const i = $('#ceoIn'); const t = i.value.trim(); if (!t) return; i.value = '';
      add('me', 'VOCÊ', t); const r = await post('/api/ceo/chat', { message: t }); add('ceo', 'CEO', r.message); };
    $('#ceoSend').onclick = send;
    $('#ceoIn').onkeydown = e => { if (e.key === 'Enter') send(); };
    document.querySelectorAll('.qq').forEach(b => b.onclick = () => { $('#ceoIn').value = b.dataset.q; send(); });
    function add(cls, who, txt) { const c = $('#chat'); c.insertAdjacentHTML('beforeend', `<div class="msg ${cls}"><b>${h(who)}</b>${h(txt)}</div>`); c.scrollTop = c.scrollHeight; }
  }
  if (S.view === 'producao') {
    $('#runAll').onclick = async () => { $('#runAll').disabled = true; await post(`/api/episodes/${S.ep}/run`); poll(); };
    document.querySelectorAll('.rs').forEach(b => b.onclick = async () => {
      const r = await post(`/api/episodes/${S.ep}/stage/${b.dataset.s}/run`);
      $('#jobState').textContent = r.accepted ? `rodando ${b.dataset.s} — invalida: ${r.invalidates.join(', ') || 'nada'}` : (r.error || '');
      poll(); });
    async function poll() { const j = await api(`/api/episodes/${S.ep}/job`);
      if (j.job && j.job.status === 'running') { $('#jobState').textContent = `rodando ${j.job.stageId}…`; setTimeout(poll, 2500); }
      else { $('#jobState').textContent = j.job ? `${j.job.stageId}: ${j.job.status}${j.job.error ? ' — ' + j.job.error : ''}` : ''; await async function ensureSession() {
  const r = await fetch('/api/episodes');
  if (r.status !== 401) return true;
  const k = prompt('Este painel está protegido. Cole a API_KEY:');
  if (!k) return false;
  const s2 = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) });
  if (!s2.ok) { alert('Chave inválida.'); return false; }
  return true;
}
ensureSession().then(ok => { if (ok) load(); }); } }
    poll();
  }
  if (S.view === 'estudio') {
    const ok = $('#apOk'), no = $('#apNo');
    if (ok) ok.onclick = async () => { const r = await post(`/api/episodes/${S.ep}/approval`, { status: 'approved', by: 'presidente',
      notes: $('#apNotes').value, scheduled_upload_authorized: $('#apSched').checked });
      alert(r.error ? `Bloqueado: ${r.error}` : 'Aprovado. Vale só para este vídeo.'); load(); };
    if (no) no.onclick = async () => { await post(`/api/episodes/${S.ep}/approval`, { status: 'rejected', by: 'presidente', notes: $('#apNotes').value }); load(); };
  }
  if (S.view === 'publicacao') {
    const d = await api('/api/publications');
    $('#pub').innerHTML = `<div class="card"><h3>YouTube OAuth</h3><div class="between"><span class="muted small">Estado</span>${pill(d.youtube.status, d.youtube.status === 'AUTORIZADO' ? 'ok' : 'bad')}</div>
      <div class="block" style="margin-top:11px"><b>Motivo:</b> ${h(d.youtube.reason || '—')}<br><br><b>Próximo passo (é seu):</b> ${h(d.youtube.next_step || 'autorizar no navegador')}</div>
      <div class="small muted" style="margin-top:10px">Escopos que serão pedidos:<div class="tags" style="margin-top:6px">${(d.youtube.scopes_requested || []).map(s => `<span class="tag mono">${h(s.split('/auth/')[1])}</span>`).join('')}</div></div>
      <div class="notice" style="margin-top:11px">Este sistema nunca pede senha nem código de autenticação por chat. O login acontece no seu navegador, na sua conta.</div>
      <div class="flex" style="margin-top:12px">
        ${d.youtube.status === 'BLOQUEADO' ? '<button disabled>Autorizar (falta credencial no .env)</button>'
          : `<a class="p" href="/api/youtube/oauth/start"><button class="p">Autorizar no Google</button></a>`}
        ${d.youtube.status === 'AUTORIZADO' ? '<button id="ytRevoke">Revogar acesso</button>' : ''}
      </div>
      ${d.youtube.status === 'AUTORIZADO' ? `<div class="small muted" style="margin-top:10px">Canal verificado na API: <b>${h(d.youtube.channel_title || d.youtube.youtube_channel_id)}</b> · conferido em ${h((d.youtube.verified_at || '').slice(0, 19).replace('T', ' '))}</div>` : ''}
      </div>
      <div class="card"><h3>Envio privado deste episódio</h3>
        <div class="small muted">O envio exige as três chaves: gates verdes, sua aprovação <b>deste</b> vídeo com autorização de envio, e OAuth verificado. O arquivo sobe como <b>private</b>; publicar em público é outra decisão, depois.</div>
        <div class="flex" style="margin-top:11px"><button class="p" id="ytUpload" ${d.youtube.upload_possible ? '' : 'disabled'}>Enviar ${h(S.ep)} como privado</button><span id="upState" class="muted small"></span></div>
      </div>
      <div class="card"><h3>Fila</h3>${d.publications.length ? `<table><tr><th>Episódio</th><th>Privacidade</th><th>Agendado</th><th>Status</th><th>ID do vídeo</th></tr>
      ${d.publications.map(p => `<tr><td class="mono">${h(p.epId)}</td><td>${h(p.privacy)}</td><td>${h(p.publishAt || '—')}</td><td>${pill(p.status, p.status === 'READY_TO_UPLOAD' ? 'ok' : 'bad')}</td><td class="mono">${h(p.video_id || '—')}</td></tr>`).join('')}</table>`
      : `<p class="muted small">Fila vazia. Um item só entra com gates verdes <b>e</b> aprovação específica do vídeo.</p>`}
      <div class="block" style="margin-top:11px">Padrão operacional: todo primeiro envio é <b>privado</b>. Autorizar upload, enviar privado, agendar e publicar em público são quatro decisões distintas.</div></div>`;
  }
  if (S.view === 'publicacao') {
    const rv = $('#ytRevoke');
    if (rv) rv.onclick = async () => { if (!confirm('Revogar o acesso ao YouTube? Será preciso autorizar de novo.')) return;
      const r = await post('/api/youtube/revoke'); alert(r.ok ? 'Acesso revogado.' : ('Falhou: ' + (r.reason || r.error))); wire(); };
    const up = $('#ytUpload');
    if (up) up.onclick = async () => {
      if (!confirm(`Enviar ${S.ep} ao YouTube como PRIVADO?`)) return;
      up.disabled = true;
      const r = await post('/api/youtube/upload', { epId: S.ep });
      if (r.error) { $('#upState').textContent = r.error; up.disabled = false; return; }
      (async function poll() {
        const j = await api(`/api/youtube/upload/${S.ep}/job`);
        if (!j.job) { $('#upState').textContent = ''; return; }
        if (j.job.status === 'running') { $('#upState').textContent = `enviando ${Math.floor((j.job.sent / j.job.total) * 100)}%`; return setTimeout(poll, 2000); }
        $('#upState').textContent = j.job.status === 'done' ? `enviado: ${j.job.video_id} (${j.job.privacy})` : `falhou: ${j.job.error}`;
      })();
    };
  }
  if (S.view === 'analytics') {
    const d = await api('/api/analytics');
    $('#an').innerHTML = d.status === 'COLETADO'
      ? `<div class="card"><div class="between"><h3 style="margin:0">Coletado</h3>${pill(d.status, 'ok')}</div>
         <div class="small muted" style="margin-top:8px">Janela: ${h(d.from)} a ${h(d.to)} (${d.window_days} dias)</div>
         ${d.videos.map(v => `<table style="margin-top:14px"><tr><th colspan="2">${h(v.video_id)}${v.episode ? ' · ' + h(v.episode) : ''}</th></tr>
         ${Object.entries(v.metrics).map(([k, val]) => `<tr><td class="mono small">${h(k)}</td><td>${val === 'indisponivel' ? pill('indisponível', 'idle') : '<b>' + h(val) + '</b>'}</td></tr>`).join('')}</table>
         ${(v.notes || []).map(n => `<div class="small muted" style="margin-top:6px">${h(n)}</div>`).join('')}`).join('')}
         <div class="small muted" style="margin-top:12px">${h(d.hypotheses_separated || '')}</div></div>`
      : `<div class="card"><div class="between"><h3 style="margin:0">Estado</h3>${pill(d.status, 'bad')}</div>
      <div class="block" style="margin-top:11px">${h(d.reason || '')}</div>
      <table style="margin-top:12px"><tr><th>Métrica</th><th>Valor</th></tr>
      ${Object.entries(d.metrics || {}).map(([k, v]) => `<tr><td class="mono">${h(k)}</td><td>${pill(String(v), 'idle')}</td></tr>`).join('')}</table>
      <div class="small muted" style="margin-top:11px">${h(d.policy || '')}</div></div>`;
  }
  if (S.view === 'memoria') {
    const d = await api('/api/memory');
    $('#mem').innerHTML = `<div class="card"><h3>Missões</h3>${d.missions.length ? `<table><tr><th>ID</th><th>Tipo</th><th>Episódio</th><th>Status</th></tr>${d.missions.map(m => `<tr><td class="mono">${h(m.id)}</td><td>${h(m.type)}</td><td class="mono">${h(m.episode || '—')}</td><td>${pill(m.status, 'idle')}</td></tr>`).join('')}</table>` : '<p class="muted small">Nenhuma missão aberta.</p>'}</div>
      <div class="card"><h3>Registro</h3>${d.memory.length ? `<table><tr><th>Quando</th><th>Tipo</th><th>Conteúdo</th></tr>${d.memory.slice(0, 40).map(m => `<tr><td class="muted small mono">${h((m.at || '').slice(0, 19).replace('T', ' '))}</td><td class="small">${h(m.kind)}</td><td class="muted small">${h((m.reply || m.notes || m.status || '').slice(0, 160))}</td></tr>`).join('')}</table>` : '<p class="muted small">Vazio.</p>'}</div>`;
  }
  if (S.view === 'integracoes') {
    const d = await api('/api/integrations');
    $('#int').innerHTML = `<div class="grid g3" style="margin-bottom:16px">${kpi('Limite de gasto', `US$ ${d.spend_limit_usd.toFixed(2)}`, 'definido no .env')}
      ${kpi('Gasto real', `US$ ${d.spent_usd.toFixed(2)}`, 'somado de todos os estágios')}${kpi('Provedores pagos ativos', '0', 'desligados por padrão')}</div>
      <div class="card"><table><tr><th>Provedor</th><th>Papel</th><th>Status</th><th>Custo</th><th>Licença</th></tr>
      ${d.providers.map(p => `<tr><td><b>${h(p.name)}</b>${p.note ? `<div class="muted small">${h(p.note)}</div>` : ''}</td><td class="muted small">${h(p.role)}</td>
      <td>${pill(p.status, /ATIVO|disponivel/i.test(p.status) ? 'ok' : (/DESLIG|BLOQ|AUSENTE/i.test(p.status) ? 'bad' : 'idle'))}</td><td class="mono small">${h(p.cost)}</td><td class="muted small">${h(p.license || '—')}</td></tr>`).join('')}</table>
      <div class="block" style="margin-top:12px">Software grátis não é produção grátis: energia, CPU e disco desta máquina são custo real, só não são fatura.</div></div>`;
  }
  if (S.view === 'agentes') {
    const c = await api('/api/company');
    $('#org').innerHTML = `<div class="grid g2">${c.agents.map(a => `<div class="agent"><h4>${h(a.name)}</h4>
      <div class="r">responde a ${h(a.reports_to)}</div><p>${h(a.objective)}</p>
      <div class="tags">${a.deliverables.map(d2 => `<span class="tag">${h(d2.name)}: ${h(d2.type)}</span>`).join('')}</div>
      <div class="small muted" style="margin-top:8px">orçamento US$ ${a.budget_usd.toFixed(2)} · escopo ${h(a.data_scope)} · publica: ${h(String(a.can_publish))}</div></div>`).join('')}</div>`;
  }
  if (S.view === 'pautas') {
    const cal = await api('/api/calendar');
    $('#cal').innerHTML = cal.error ? h(cal.error) : `<div class="small muted" style="margin-bottom:9px">${h(cal.cadence)} · ${cal.slots.length} slots · ${h(cal.rule)}</div>
      <table><tr><th>Data</th><th>Episódio</th><th>Título</th><th>Entregas</th><th>Gate</th></tr>
      ${cal.slots.map(s => `<tr><td class="mono small">${h(s.date)}</td><td class="mono small">${h(s.episode)}</td><td>${h(s.title)}</td><td class="muted small">${h(s.deliverables)}</td><td class="muted small">${h(s.gate)}</td></tr>`).join('')}</table>`;
  }
}
load();
setInterval(() => { if (S.view === 'gabinete' || S.view === 'producao') load(); }, 15000);
