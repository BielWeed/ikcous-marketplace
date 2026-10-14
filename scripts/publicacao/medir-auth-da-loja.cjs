#!/usr/bin/env node
/**
 * medir-auth-da-loja.cjs — mede, SÓ LEITURA, a configuração de e-mail (SMTP) do
 * LOGIN (Supabase Auth) de uma loja cliente (14/10/2026).
 *
 * POR QUE EXISTE: a Savy exige confirmação de cadastro por e-mail
 * (`mailer_autoconfirm=false`). Sem remetente próprio (SMTP personalizado), o
 * Supabase só entrega e-mail de autenticação para endereços da equipe do projeto
 * (https://supabase.com/docs/guides/auth/auth-smtp, lido em 14/10/2026: "default
 * SMTP ... pre-authorized addresses", 2 mensagens por hora, "not for production")
 * — e então o cadastro de uma cliente nunca confirma. Ninguém abre o painel; o
 * caminho que sobra é o token de gestão que os workflows de banco/functions já
 * usam. Este script é o que roda dentro de .github/workflows/medir-auth-da-loja.yml.
 *
 * O QUE FAZ: UMA chamada `GET https://api.supabase.com/v1/projects/{ref}/config/auth`
 * (operationId `v1-get-auth-service-config`, "Gets project's auth config",
 * permissão `auth_config_read`, escopo OAuth `auth:read`). FONTES, conferidas em
 * 14/10/2026: https://supabase.com/docs/reference/api/v1-get-auth-service-config
 * e o OpenAPI https://api.supabase.com/api/v1-json (schema
 * `AuthConfigResponse_Output`: `mailer_autoconfirm`, `external_email_enabled`,
 * `disable_signup` booleanos anuláveis; `smtp_host`, `smtp_port` (STRING), `smtp_user`,
 * `smtp_pass`, `smtp_admin_email`, `smtp_sender_name` strings anuláveis;
 * `rate_limit_email_sent` inteiro anulável). Respostas documentadas: 200, 401, 403,
 * 429, 500.
 *
 * O RISCO É O TOKEN E A SENHA DO REMETENTE (`smtp_pass`), por isso:
 *  - SÓ LEITURA: há UMA chamada de rede em todo o arquivo e ela é GET, sem corpo e
 *    sem seguir redirecionamento (a Authorization não vai para outro host). Nenhum
 *    PATCH/POST/PUT/DELETE existe aqui, e o teste falha se aparecer.
 *  - PROJETO FECHADO em "ikcous-publicada" | "savy" (`ALVOS`, `Object.hasOwn`); o ref
 *    vem de `resolverRef` (o mesmo de conferir-banco.cjs), nunca de texto livre.
 *  - CADA ALVO ENXERGA SÓ O SEU SEGREDO: ikcous-publicada lê
 *    SUPABASE_ACCESS_TOKEN_IKCOUS, savy lê SUPABASE_ACCESS_TOKEN_SAVY. Sem ele, PARA;
 *    401/403 também PARAM, sem tentar outro segredo nem outro alvo.
 *  - O CORPO CRU NUNCA VAI PARA O LOG, nem em erro (em falha só o status HTTP). A
 *    saída é montada de uma LISTA FECHADA de campos (`filtrarConfigAuth`): o código
 *    nunca percorre as chaves da resposta, então campo fora da lista é descartado
 *    por construção. A senha e o usuário SMTP entram só como sim/não. Cada valor
 *    permitido passa por validação de formato (o que não casa vira "(formato
 *    inesperado)", sem imprimir) e por limpeza de caracteres (nada de `::`, quebra de
 *    linha ou `|` que vire comando de workflow ou quebre o resumo).
 *  - `::add-mask::` defensivo na senha, ANTES de qualquer saída (mesmo escape de
 *    `core.setSecret` do @actions/core: `%`, CR, LF).
 *
 * Testado por tests/ci_medir_auth_da_loja_test.ts.
 */
const fs = require("node:fs");
const { resolverRef } = require("./conferir-banco.cjs");

const API_BASE = "https://api.supabase.com";
const TEMPO_LIMITE_MS = 30_000;

/** Os ÚNICOS dois alvos, cada um com o NOME do seu segredo e a mensagem de parada
 * (mesmo texto de conferir-banco.cjs). Nunca uma chave escolhida por quem chama
 * chega a um efeito sem passar por `Object.hasOwn` + `resolverRef`. */
const ALVOS = Object.freeze({
  "ikcous-publicada": Object.freeze({
    segredo: "SUPABASE_ACCESS_TOKEN_IKCOUS",
    semAcesso:
      "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto",
  }),
  savy: Object.freeze({
    segredo: "SUPABASE_ACCESS_TOKEN_SAVY",
    semAcesso:
      "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto",
  }),
});

const VAZIO = "(vazio)";
const INESPERADO = "(formato inesperado)";

const ehObjeto = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const preenchido = (v) => typeof v === "string" && v.trim() !== "";

/** Só letras, números, espaço e `.,_@&'()-`: sem `:`, `|`, crase, quebra de linha
 * nem `%` — nada que vire comando de workflow ou quebre uma tabela Markdown. */
function textoSeguro(valor, maximo = 80) {
  const limpo = String(valor)
    .replace(/[^\p{L}\p{N} .,_@&'()-]/gu, "?")
    .trim();
  return limpo.length > maximo ? `${limpo.slice(0, maximo)}…` : limpo;
}

const textoBooleano = (v) =>
  v === true || v === false ? String(v) : v == null ? VAZIO : INESPERADO;

const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,251}$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9][A-Za-z0-9.-]{0,251}$/;
const PORTA = /^\d{1,5}$/;

function textoDoHost(v) {
  if (!preenchido(v)) return VAZIO;
  return HOST.test(v) ? v : `preenchido ${INESPERADO}`;
}

function textoDaPorta(v) {
  // a API documenta `smtp_port` como string; aceita inteiro por tolerância
  if (v == null || v === "") return VAZIO;
  const t = typeof v === "number" && Number.isInteger(v) ? String(v) : v;
  return typeof t === "string" && PORTA.test(t) ? t : INESPERADO;
}

function textoDoEmail(v) {
  if (!preenchido(v)) return VAZIO;
  return EMAIL.test(v) ? v : `preenchido ${INESPERADO}`;
}

function textoDoInteiro(v) {
  if (v == null) return VAZIO;
  return Number.isInteger(v) ? String(v) : INESPERADO;
}

const simNao = (v) => (preenchido(v) ? "sim" : "nao");

/**
 * A LISTA FECHADA. Recebe o objeto da resposta e devolve só estes campos, nesta
 * ordem. Nenhuma chave da resposta é percorrida: o que não está aqui não existe
 * para o resto do script.
 */
function filtrarConfigAuth(config) {
  const c = ehObjeto(config) ? config : {};
  const smtp = {
    host: preenchido(c.smtp_host),
    port: c.smtp_port != null && c.smtp_port !== "",
    user: preenchido(c.smtp_user),
    pass: preenchido(c.smtp_pass),
    admin: preenchido(c.smtp_admin_email),
  };
  const faltando = Object.entries(smtp)
    .filter(([, ok]) => !ok)
    .map(([nome]) => (nome === "admin" ? "smtp_admin_email" : `smtp_${nome}`));
  const remetente =
    faltando.length === 0
      ? "SIM"
      : faltando.length === 5
        ? "NAO"
        : "INCOMPLETO";
  const confirma =
    c.mailer_autoconfirm === false
      ? "SIM"
      : c.mailer_autoconfirm === true
        ? "NAO"
        : "DESCONHECIDO";

  const campos = [
    ["mailer_autoconfirm", textoBooleano(c.mailer_autoconfirm)],
    ["external_email_enabled", textoBooleano(c.external_email_enabled)],
    ["disable_signup", textoBooleano(c.disable_signup)],
    ["smtp_host", textoDoHost(c.smtp_host)],
    ["smtp_port", textoDaPorta(c.smtp_port)],
    ["smtp_user preenchido", simNao(c.smtp_user)],
    ["smtp_pass preenchido", simNao(c.smtp_pass)],
    ["smtp_admin_email", textoDoEmail(c.smtp_admin_email)],
    [
      "smtp_sender_name",
      preenchido(c.smtp_sender_name) ? textoSeguro(c.smtp_sender_name) : VAZIO,
    ],
    ["rate_limit_email_sent", textoDoInteiro(c.rate_limit_email_sent)],
  ];

  const veredito = [
    ["Remetente próprio (SMTP)", remetente],
    ["Cadastro exige confirmação por e-mail", confirma],
  ];
  const alerta =
    confirma === "SIM" && remetente !== "SIM"
      ? `ATENCAO: o cadastro exige confirmação por e-mail e o remetente próprio está ${
          remetente === "NAO"
            ? "ausente"
            : `incompleto (falta: ${faltando.join(", ")})`
        }; o envio padrão do Supabase só entrega para a equipe do projeto, então cadastros de clientes podem nunca confirmar.`
      : null;
  return { campos, veredito, alerta };
}

/** Texto do log e do resumo do run, a partir do que `filtrarConfigAuth` devolveu. */
function montarRelatorio({ projeto, ref, filtrado }) {
  const titulo = `Auth da loja ${projeto} (ref ${ref}) — somente leitura`;
  const linhas = [
    titulo,
    ...filtrado.campos.map(([nome, valor]) => `${nome}: ${valor}`),
    ...filtrado.veredito.map(([nome, valor]) => `${nome}: ${valor}`),
  ];
  if (filtrado.alerta) linhas.push(filtrado.alerta);
  const markdown = [
    `### ${titulo}`,
    "",
    "| campo | valor |",
    "| --- | --- |",
    ...filtrado.campos.map(([nome, valor]) => `| ${nome} | ${valor} |`),
    ...filtrado.veredito.map(
      ([nome, valor]) => `| **${nome}** | **${valor}** |`,
    ),
    ...(filtrado.alerta ? ["", `> ${filtrado.alerta}`] : []),
    "",
  ].join("\n");
  return { linhas, markdown };
}

/** Escape de dado de comando de workflow (igual ao de `core.setSecret`). */
function escaparDadoDeComando(valor) {
  return String(valor)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

/** Só o nome do erro, só se for um identificador — nunca a mensagem (que pode
 * carregar URL, cabeçalho ou pedaço do corpo). */
function nomeSeguro(erro) {
  const nome = erro && typeof erro.name === "string" ? erro.name : "";
  return /^[A-Za-z]{1,40}$/.test(nome) ? nome : "Error";
}

/**
 * Faz a medição. Devolve o código de saída (0 = medido; 1 = parou), sem chamar
 * `process.exit` — o teste injeta `fetchImpl` e `saida`.
 */
async function medir({ projeto, env, fetchImpl, saida }) {
  // eslint-disable-next-line security/detect-object-injection -- `Object.hasOwn` na mesma expressão: só as duas chaves de ALVOS passam.
  const alvo = Object.hasOwn(ALVOS, projeto) ? ALVOS[projeto] : null;
  if (!alvo) {
    saida.erro(
      `FALHOU: projeto desconhecido: "${textoSeguro(projeto, 40)}" (use ikcous-publicada ou savy)`,
    );
    return 1;
  }
  // SÓ o segredo do próprio alvo; sem ele PARA (nunca tenta o do vizinho).
  const token = env[alvo.segredo];
  if (!token) {
    saida.erro(alvo.semAcesso);
    return 1;
  }
  let ref;
  try {
    ref = resolverRef(projeto);
  } catch (erro) {
    saida.erro(`FALHOU: ${textoSeguro(erro.message, 120)}`);
    return 1;
  }

  let r;
  try {
    r = await fetchImpl(`${API_BASE}/v1/projects/${ref}/config/auth`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    saida.erro(
      `FALHOU: a chamada à Management API não completou (${nomeSeguro(erro)})`,
    );
    return 1;
  }
  const status = Number.isInteger(r.status) ? r.status : 0;
  if (status === 401 || status === 403) {
    saida.erro(`FALHOU: ${alvo.semAcesso} (HTTP ${status})`);
    return 1;
  }
  if (!r.ok) {
    saida.erro(
      `FALHOU: a Management API respondeu HTTP ${status} (corpo não impresso)`,
    );
    return 1;
  }

  let config;
  try {
    config = JSON.parse(await r.text());
  } catch {
    config = null;
  }
  if (!ehObjeto(config)) {
    saida.erro(
      "FALHOU: a Management API respondeu 200, mas o corpo não é um objeto JSON (corpo não impresso)",
    );
    return 1;
  }

  // A senha, se vier, é mascarada ANTES de qualquer saída (defesa em profundidade:
  // ela nunca é impressa, mas se um dia um campo novo a carregar, o runner a esconde).
  if (preenchido(config.smtp_pass)) saida.mascarar(config.smtp_pass);

  const filtrado = filtrarConfigAuth(config);
  config = null; // daqui para a frente só existe o que passou pela lista fechada
  const { linhas, markdown } = montarRelatorio({ projeto, ref, filtrado });
  for (const linha of linhas) saida.log(linha);
  saida.resumo(markdown);
  return 0;
}

/** A saída real: stdout/stderr do job e o resumo do run (GITHUB_STEP_SUMMARY). */
function saidaDoProcesso() {
  return {
    log: (linha) => console.log(linha),
    erro: (linha) => console.error(linha),
    resumo: (markdown) => {
      const destino = process.env.GITHUB_STEP_SUMMARY;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem do runner do GitHub Actions (GITHUB_STEP_SUMMARY), não de entrada de usuário.
      if (destino) fs.appendFileSync(destino, `${markdown}\n`);
    },
    mascarar: (valor) =>
      process.stdout.write(`::add-mask::${escaparDadoDeComando(valor)}\n`),
  };
}

async function main() {
  process.exitCode = await medir({
    projeto: process.env.PROJETO,
    env: process.env,
    fetchImpl: globalThis.fetch,
    saida: saidaDoProcesso(),
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  ALVOS,
  API_BASE,
  filtrarConfigAuth,
  montarRelatorio,
  escaparDadoDeComando,
  medir,
  main,
};
