'use strict';
/**
 * CEO VIRTUAL — nao e chat decorativo.
 * Cada resposta sai de leitura do store/disco. Ele pode abrir missao, mandar
 * refazer estagio e cobrar evidencia. Ele NAO pode publicar, gastar nem aprovar
 * no lugar do presidente: essas tres acoes exigem o humano.
 */
const fs = require('fs');
const path = require('path');
const { STAGES, downstreamOf } = require('./pipeline');

const DENY = {
  publish: 'Publicar não está na minha alçada. Publicação exige três coisas: gates verdes, sua aprovação específica deste vídeo e OAuth do YouTube autorizado por você no navegador. Posso deixar tudo pronto na fila.',
  spend: 'Não autorizo despesa. O limite de gasto externo está em US$ 0,00 e só você muda isso. Se um provedor pago resolver algo, eu te mostro o quê, quanto e o que ganha — a decisão é sua.',
  account: 'Não conecto conta nem crio canal no Google. Esse passo é seu, no navegador, com seu login. Eu preparo a tela de autorização.'
};

function fmtDur(ms) { return ms ? `${(ms / 1000).toFixed(1)}s` : '—'; }

function brief(store, epId) {
  const ep = store.episode(epId);
  if (!ep) return null;
  const done = Object.values(ep.stages).filter((s) => s.status === 'done');
  const failed = Object.values(ep.stages).filter((s) => s.status === 'failed');
  const stale = Object.values(ep.stages).filter((s) => s.status === 'stale');
  // Se a auditoria foi invalidada, o veredicto anterior NAO vale mais.
  // Mostrar "verdes" de uma avaliacao desatualizada seria estado falso.
  const qaStale = !ep.stages.qa || ep.stages.qa.status !== 'done';
  return { ep, done: done.length, total: STAGES.length, failed, stale,
    cost: ep.cost_usd || 0, gates: ep.gates, gatesStale: qaStale && !!ep.gates, approval: ep.approval,
    totalMs: done.reduce((a, s) => a + (s.durationMs || 0), 0) };
}

async function handle(input, ctx) {
  const { store, pipeline, channelId } = ctx;
  const text = String(input || '').trim();
  const low = text.toLowerCase();
  const eps = store.episodes();
  // Episodio padrao: o mais recente COM trabalho feito. Um episodio recem-aberto
  // (ou de laboratorio) nao sequestra o "status" de quem ja produziu.
  const withWork = eps.filter((e) => Object.values(e.stages || {}).some((s) => s.status === 'done'));
  const epId = (text.match(/ep_\d+/) || [])[0] || (withWork[0] && withWork[0].id) || (eps[0] && eps[0].id) || null;
  const reply = (message, actions = [], data = null) => ({ message, actions, data, at: new Date().toISOString() });

  if (/publicar|publish|subir|enviar pro youtube|upload/.test(low)) return reply(DENY.publish, ['abrir_fila_de_publicacao']);
  if (/gastar|comprar|pagar|assinar|contratar api/.test(low)) return reply(DENY.spend, ['ver_custos']);
  if (/conectar conta|criar canal|login do google|oauth/.test(low)) return reply(DENY.account, ['abrir_oauth']);

  if (/^status|como est|situa[cç][aã]o|resumo/.test(low)) {
    const b = brief(store, epId);
    if (!b) return reply('Não há episódio aberto ainda. Me peça "novo episódio" e eu abro a missão.');
    const lines = [
      `Episódio ${epId} — ${b.ep.title || 's/ título'}`,
      `Pipeline: ${b.done}/${b.total} estágios concluídos${b.failed.length ? `, ${b.failed.length} com falha` : ''}${b.stale.length ? `, ${b.stale.length} desatualizados` : ''}.`,
      `Tempo de execução somado: ${(b.totalMs / 1000 / 60).toFixed(1)} min. Despesa externa: US$ ${b.cost.toFixed(2)}.`,
      b.gatesStale ? `Gates: DESATUALIZADOS — a última avaliação (${b.gates.verdict}) foi invalidada porque um estágio anterior foi refeito. Precisa rodar a auditoria de novo.`
        : (b.gates ? `Gates: ${b.gates.verdict}${b.gates.blocking_failures.length ? ` (travando: ${b.gates.blocking_failures.join(', ')})` : ''}.` : 'Gates: ainda não avaliados.'),
      `Aprovação do presidente: ${b.approval.status}.`,
      b.failed.length ? `Falhou: ${b.failed.map((f) => `${f.id} (${f.error})`).join(' · ')}` : null
    ].filter(Boolean);
    return reply(lines.join('\n'), ['abrir_producao', 'abrir_estudio'], b);
  }

  if (/^custo|or[cç]amento|quanto (gastou|custou)/.test(low)) {
    const b = brief(store, epId);
    const perStage = b ? Object.values(b.ep.stages).map((s) => `${s.id}: US$ ${(((s.cost || {}).usd) || 0).toFixed(2)} (${s.mode || '-'})`) : [];
    return reply([`Despesa externa do episódio ${epId}: US$ ${(b ? b.cost : 0).toFixed(2)}.`,
      'Limite configurado: US$ 0,00. Nenhuma chamada paga foi feita.',
      'Custo real existente: energia, CPU e disco desta máquina — software grátis não é produção grátis.',
      '', ...perStage].join('\n'), ['ver_integracoes']);
  }

  if (/bloqueio|travad|o que falta|pend[eê]ncia/.test(low)) {
    const b = brief(store, epId);
    const blocks = [];
    const yt = require('./youtube/oauth');
    const st = await yt.state(channelId).catch(() => ({ status: 'ERRO' }));
    if (st.status !== 'AUTORIZADO') blocks.push(`YouTube: ${st.status}${st.reason ? ' — ' + st.reason : ''}. Publicação e analytics BLOQUEADOS. O passo é seu, no navegador: docs/youtube-oauth.md.`);
    if (b && b.gates && !b.gates.can_be_approved) blocks.push(`Gates reprovados: ${b.gates.blocking_failures.join(', ')}.`);
    if (b && b.approval.status === 'pending') blocks.push('Falta sua aprovação do vídeo no Estúdio de Revisão.');
    if (b && b.failed.length) blocks.push(`Estágios com falha: ${b.failed.map((f) => f.id).join(', ')}.`);
    const ch = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'channels', `${channelId}.json`), 'utf8'));
    if (ch.status === 'pilot_provisional_identity') blocks.push('Nome do canal ainda provisório — três propostas aguardam sua escolha; nenhum nome foi registrado.');
    return reply(blocks.length ? blocks.map((b2, i) => `${i + 1}. ${b2}`).join('\n') : 'Nenhum bloqueio aberto.', ['abrir_gabinete']);
  }

  if (!epId && !/nov[oa] /.test(low)) return reply('Nenhum episódio aberto ainda. Peça "novo episódio: <tema>" e eu abro a missão.');
  const novo = low.match(/nov[oa] (epis[oó]dio|v[ií]deo|pauta)\s*:?\s*(.*)/);
  if (novo) {
    const tema = (novo[2] || '').trim();
    const n = eps.length + 1;
    const newId = `ep_${String(n).padStart(3, '0')}`;
    const mission = { id: `m_${Date.now()}`, type: 'novo_episodio', episode: newId, topic: tema || '(a definir pelo diretor editorial)',
      requested_by: 'ceo', status: 'aberta',
      acceptance: ['roteiro original com dossiê de fontes verificadas', 'MP4 1080p com narração real', '3 Shorts autossuficientes', 'gates verdes'],
      budget_usd: 0 };
    store.append('mission.created', mission);
    return reply([`Missão aberta: ${mission.id} → ${newId}.`,
      tema ? `Tema recebido: "${tema}".` : 'Sem tema definido: o diretor editorial vai escolher entre as 12 pautas com tese já levantadas.',
      'Critério de aceite: roteiro original com fontes verificadas, MP4 1080p com narração real, 3 Shorts autossuficientes e gates verdes.',
      'Orçamento: US$ 0,00. Para rodar a produção, use "produzir ' + newId + '" ou o botão de produção no painel.'].join('\n'),
      ['abrir_producao'], mission);
  }

  const refazer = low.match(/refaz(er)?\s+(?:o\s+)?(?:est[aá]gio\s+)?([a-z_]+)/);
  if (refazer) {
    const id = refazer[2];
    if (!STAGES.find((s) => s.id === id)) return reply(`Não conheço o estágio "${id}". Os estágios são: ${STAGES.map((s) => s.id).join(', ')}.`);
    const down = downstreamOf(id);
    return reply([`Posso refazer "${id}" do episódio ${epId}.`,
      `Isso invalida e exige refazer depois: ${down.join(', ') || '(nada)'}.`,
      'Confirme no painel, em Produção → Reiniciar estágio. Não disparo render pesado por conversa.'].join('\n'),
      [`run_stage:${id}`]);
  }

  if (/aprovar|aprovo/.test(low)) {
    return reply(['Aprovação é sua, não minha — e ela é por vídeo, não em geral.',
      'No Estúdio de Revisão tem o botão. Aprovar lá libera, no máximo, o envio programado DESTE vídeo, sempre como privado primeiro.'].join('\n'), ['abrir_estudio']);
  }

  if (/agenda|calend[aá]rio|cronograma|90 dias/.test(low)) {
    const f = path.join(__dirname, '..', 'content', 'channels', channelId, 'calendar_90d.json');
    if (fs.existsSync(f)) { const cal = JSON.parse(fs.readFileSync(f, 'utf8'));
      return reply([`Calendário de 90 dias: ${cal.slots.length} slots, ${cal.cadence}.`,
        `Próximos: ${cal.slots.slice(0, 4).map((s) => `${s.date} ${s.title}`).join(' · ')}`,
        'Nada é publicado automaticamente: cada slot só anda com aprovação do vídeo.'].join('\n'), ['abrir_calendario'], cal); }
    return reply('O calendário ainda não foi gerado.');
  }

  if (/reuni[aã]o|executiv/.test(low)) {
    const b = brief(store, epId);
    return reply([`Reunião executiva — ${new Date().toLocaleDateString('pt-BR')}`,
      `1. Produção: ${b ? `${b.done}/${b.total} estágios, ${(b.totalMs / 60000).toFixed(1)} min de máquina` : 'sem episódio'}.`,
      `2. Custo: US$ ${(b ? b.cost : 0).toFixed(2)} externo. Dentro do limite.`,
      `3. Risco: publicação e analytics bloqueados por falta de OAuth — é a decisão que mais trava a empresa agora.`,
      `4. Qualidade: ${b && b.gatesStale ? 'gates DESATUALIZADOS, auditoria precisa rodar de novo' : (b && b.gates ? b.gates.verdict : 'gates pendentes')}.`,
      `5. Recomendação: autorizar o OAuth e escolher o nome do canal. Sem isso o motor produz mas não distribui.`,
      '', 'Quer que eu abra isso como missão?'].join('\n'), ['abrir_gabinete']);
  }

  if (/epis[oó]dios|lista/.test(low)) {
    const rows = eps.map((e) => {
      const done = Object.values(e.stages || {}).filter((x) => x.status === 'done').length;
      return `${e.id} — ${e.title || 's/ título'} · ${done}/19 estágios · gates ${e.gates ? e.gates.verdict : 'não avaliados'} · aprovação ${e.approval.status}`;
    });
    return reply(rows.length ? rows.join('\n') : 'Nenhum episódio aberto.', ['abrir_producao']);
  }
  if (/autonom|sozinho|automa/.test(low)) {
    const na = require('./autonomy').notAutonomous();
    return reply(['Sendo honesto sobre o que esta empresa faz sozinha:', '',
      'Roda sozinho: validação, narração, render, legenda, corte dos Shorts, auditoria e bloqueio.',
      '', 'NÃO roda sozinho hoje:',
      ...na.map((x) => `- ${x.stage} (${x.label}): ${x.gap}`),
      '', 'Ou seja: o episódio 3 vai precisar do mesmo trabalho intelectual — seu, meu numa sessão, ou de uma LLM configurada com autorização de gasto.'].join('\n'));
  }
  return reply(['Sou o CEO virtual desta empresa. Falo com base no estado real do pipeline, não de cabeça.',
    'Posso: "status", "custo", "bloqueios", "episódios", "autonomia", "reunião executiva", "novo episódio: <tema>", "refazer <estágio>", "calendário".',
    'Não posso: publicar, gastar ou conectar conta. Essas três são suas.'].join('\n'));
}
module.exports = { handle, DENY };
