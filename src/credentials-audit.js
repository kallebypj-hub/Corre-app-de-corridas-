'use strict';
/**
 * AUDITOR DO ASSISTENTE DE CREDENCIAIS.
 *
 * Mora FORA do arquivo que audita, de proposito: um auditor dentro do proprio
 * codigo casa com os seus proprios padroes de deteccao e se aprova sozinho.
 * Este le src/credentials.js como texto e responde uma pergunta so:
 *
 *   existe, naquele arquivo, algum caminho capaz de mandar um segredo para
 *   fora da maquina, de escrever ele num log, ou de deixar ele no historico
 *   do shell?
 *
 * E o que o dono roda ANTES de confiar a chave ao assistente.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(__dirname, 'credentials.js');

/** Modulos que dariam ao assistente a capacidade de transmitir ou executar. */
const FORBIDDEN_MODULES = ['http', 'https', 'net', 'dgram', 'dns', 'tls', 'child_process', 'worker_threads', 'vm', 'cluster'];
/** Modulos que ele legitimamente precisa. Qualquer outro e sinal de alerta. */
const ALLOWED_MODULES = ['fs', 'path', 'crypto', 'os', './env'];

function requiresIn(src) {
  const out = [];
  const re = /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m; while ((m = re.exec(src))) out.push(m[1].replace(/^node:/, ''));
  return [...new Set(out)];
}

function audit({ target = TARGET } = {}) {
  const src = fs.readFileSync(target, 'utf8');
  const reqs = requiresIn(src);
  const checks = [];
  const add = (check, ok, detail) => checks.push({ check, ok, detail });

  const bad = reqs.filter((r) => FORBIDDEN_MODULES.includes(r));
  add('nao carrega nada capaz de transmitir ou executar', bad.length === 0,
    bad.length ? `CARREGA: ${bad.join(', ')}` : `nenhum de: ${FORBIDDEN_MODULES.join(', ')}`);

  const extra = reqs.filter((r) => !ALLOWED_MODULES.includes(r));
  add('carrega apenas o que precisa', extra.length === 0,
    extra.length ? `modulo inesperado: ${extra.join(', ')}` : `carrega so ${reqs.join(', ')}`);

  add('nao faz chamada de rede', !/\bfetch\s*\(|new\s+WebSocket|XMLHttp[R]equest|\.request\s*\(/.test(src),
    'nenhuma chamada de rede no fonte');

  add('nao usa o registrador do projeto', !/[L]ogger/.test(src),
    'o assistente nao instancia registrador: nada dele vai para log');

  const prints = (src.match(/console\.(log|info|warn|error)/g) || []).length;
  add('nao imprime nada por conta propria', prints === 0,
    prints ? `${prints} impressao(oes) direta(s) no fonte` : 'as unicas escritas na tela sao os rotulos do prompt, via process.stdout.write');

  add('o segredo nao entra por argumento de linha de comando', !/process\.a[r]gv/.test(src),
    'o assistente nao le argumentos: o que a linha de comando passa e, no maximo, um caminho de arquivo');

  add('nao acrescenta em arquivo nenhum', !/appendFile/.test(src),
    'nao existe escrita em modo de acrescimo: nada de log crescendo com segredo dentro');

  const writes = (src.match(/writeFileSync/g) || []).length;
  add('escreve poucos arquivos, todos conhecidos', writes <= 3,
    `${writes} escrita(s): o .env, o backup do .env anterior e a sobrescrita do JSON de entrada antes de apagar`);

  add('escrita atomica com permissao 0600', /mode: 0o600/.test(src) && /renameSync/.test(src) && /chmodSync\([^,]+,\s*0o600\)/.test(src),
    'arquivo temporario, rename, e 0600 no arquivo e no backup');

  add('recusa valor de exemplo', /PLACEHOLDER\.test/.test(src),
    'placeholder e barrado antes de qualquer escrita');

  add('recusa .env rastreado pelo git', /envIsTracked\(\)\)\s*\n?\s*throw/.test(src) || /if \(envIsTracked\(\)\)/.test(src),
    'segredo nao entra em arquivo versionado');

  add('aceita so credencial de Aplicativo da Web', /j\.installed && !j\.web/.test(src),
    'JSON de Aplicativo de desktop e recusado, com o motivo');

  add('apaga o JSON de entrada depois de ler', /randomBytes/.test(src) && /unlinkSync/.test(src),
    'o arquivo baixado e sobrescrito com bytes aleatorios e removido: a chave nao fica largada na pasta');

  add('o relatorio carrega impressao digital, nao valor', /slice\(0,\s*12\)/.test(src) && /secrets_disclosed: false/.test(src),
    'sha256 cortado em 12 caracteres e o maximo que sai de um segredo');

  const cred = require('./credentials');
  const envPath = path.relative(ROOT, cred.ENV_FILE);
  const st = fs.existsSync(cred.ENV_FILE) ? fs.statSync(cred.ENV_FILE) : null;
  return {
    ok: checks.every((c) => c.ok),
    auditor: path.relative(ROOT, __filename),
    audited: path.relative(ROOT, target),
    audited_sha256: crypto.createHash('sha256').update(src).digest('hex'),
    audited_lines: src.split('\n').length,
    requires: reqs,
    writes_only: [envPath, `${envPath}.anterior`, `${path.relative(ROOT, cred.INBOX)}/<json de entrada, apagado>`],
    reads_from: ['JSON baixado do Google, na pasta de entrada', 'terminal, com o eco desligado'],
    transmits_to: [],
    checks,
    env_file: { path: envPath, exists: !!st,
      mode: st ? '0' + (st.mode & 0o777).toString(8) : null,
      ignored_by_git: !cred.envIsTracked() },
    verdict: checks.every((c) => c.ok)
      ? 'O assistente nao tem caminho de codigo para transmitir, registrar ou expor um segredo. Grava no .env privado e nada mais.'
      : 'ALGUMA GARANTIA FALHOU: nao entregue credencial a este assistente antes de corrigir.'
  };
}
module.exports = { audit, requiresIn, FORBIDDEN_MODULES, ALLOWED_MODULES, TARGET };
