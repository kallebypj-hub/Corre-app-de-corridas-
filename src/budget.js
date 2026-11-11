'use strict';
/**
 * Controle de despesa externa com TETO RIGIDO.
 *
 * Toda chamada que custaria dinheiro passa por aqui antes de acontecer. Se o
 * teto do canal, da categoria ou do experimento nao cobrir, a chamada e
 * recusada — nao registrada como "tentativa", recusada mesmo.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'config', 'budget.json');
const LEDGER_DIR = path.join(ROOT, 'var', 'budget');

function config() { return JSON.parse(fs.readFileSync(CFG, 'utf8')); }
function ledgerPath(channelId) { fs.mkdirSync(LEDGER_DIR, { recursive: true }); return path.join(LEDGER_DIR, `${channelId}.jsonl`); }
function entries(channelId) {
  const p = ledgerPath(channelId);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
function spent(channelId, { category = null, experimentId = null } = {}) {
  return entries(channelId)
    .filter((e) => e.outcome === 'charged')
    .filter((e) => !category || e.category === category)
    .filter((e) => !experimentId || e.experiment_id === experimentId)
    .reduce((a, e) => a + (Number(e.amount_usd) || 0), 0);
}

/**
 * Autoriza (ou recusa) uma despesa ANTES da chamada.
 * @returns {allowed, reason, remaining}
 */
function authorize({ channelId, category, amountUsd, experimentId = null, purpose = '' }) {
  const c = config();
  const cat = c.categories[category];
  if (!cat) return deny(channelId, { category, amountUsd, experimentId, purpose }, `categoria de despesa desconhecida: ${category}`);
  const ch = c.channels[channelId] || { limit_usd: 0, per_experiment_limit_usd: 0 };
  const amount = Number(amountUsd) || 0;
  if (amount <= 0) return { allowed: true, reason: 'sem custo', remaining: null };

  const checks = [
    { scope: 'global', limit: c.global.external_spend_limit_usd, used: spent(channelId) },
    { scope: `categoria:${category}`, limit: cat.limit_usd, used: spent(channelId, { category }) },
    { scope: `canal:${channelId}`, limit: ch.limit_usd, used: spent(channelId) }
  ];
  if (experimentId) checks.push({ scope: `experimento:${experimentId}`, limit: ch.per_experiment_limit_usd, used: spent(channelId, { experimentId }) });

  for (const k of checks) {
    if (k.used + amount > k.limit) {
      return deny(channelId, { category, amountUsd: amount, experimentId, purpose },
        `teto de ${k.scope} e US$ ${k.limit.toFixed(2)}; ja gastos US$ ${k.used.toFixed(2)} e esta chamada pediria mais US$ ${amount.toFixed(2)}.`);
    }
  }
  const remaining = Math.min(...checks.map((k) => k.limit - k.used - amount));
  return { allowed: true, reason: 'dentro de todos os tetos', remaining: +remaining.toFixed(4) };
}
function deny(channelId, req, reason) {
  record(channelId, { ...req, outcome: 'denied', reason });
  return { allowed: false, reason, remaining: 0 };
}
function record(channelId, { category, amountUsd = 0, experimentId = null, purpose = '', outcome = 'charged', reason = null, provider = null }) {
  const e = { ts: new Date().toISOString(), channel_id: channelId, category,
    amount_usd: Number(amountUsd) || 0, experiment_id: experimentId, purpose, outcome, reason, provider };
  fs.appendFileSync(ledgerPath(channelId), JSON.stringify(e) + '\n');
  return e;
}
/** Visao para o painel e para o relatorio. */
function summary(channelId) {
  const c = config();
  const all = entries(channelId);
  const byCategory = {};
  for (const [k, v] of Object.entries(c.categories))
    byCategory[k] = { limit_usd: v.limit_usd, spent_usd: +spent(channelId, { category: k }).toFixed(4), note: v.note };
  return {
    channel_id: channelId,
    global_limit_usd: c.global.external_spend_limit_usd,
    hard_cap: c.global.hard_cap,
    total_spent_usd: +spent(channelId).toFixed(4),
    denied_attempts: all.filter((e) => e.outcome === 'denied').length,
    by_category: byCategory,
    channel_limit_usd: (c.channels[channelId] || {}).limit_usd ?? 0,
    per_experiment_limit_usd: (c.channels[channelId] || {}).per_experiment_limit_usd ?? 0,
    real_costs_not_invoiced: c.real_costs_not_invoiced,
    ledger_entries: all.length,
    note: 'Gasto registrado aqui e so o que sairia em fatura. Energia, CPU e disco sao custo real sem fatura e estao listados a parte.'
  };
}
module.exports = { authorize, record, spent, summary, config, entries, LEDGER_DIR };
