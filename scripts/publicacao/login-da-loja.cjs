#!/usr/bin/env node
/**
 * Login de UMA loja assinante (26/11/2026): `conferir` (só leitura) e `acertar`
 * (endereços e limite de e-mails do Supabase Auth). Chamado só por
 * .github/workflows/login-da-loja.yml; nenhuma API é chamada ao importar.
 * As regras (o que gravar, o que responder) moram em login-da-loja-regras.cjs,
 * que tem as fontes oficiais no cabeçalho.
 *
 * POR QUE EXISTE: a loja nova nasce com `site_url = http://localhost:3000`, e o
 * link do e-mail de confirmação/recuperação leva a uma página morta. `acertar`
 * troca o site_url pelo domínio da loja (store_config.dominio_publico, a fonte
 * única), põe `https://<dominio>/**` na lista e sobe o limite para 30/h quando
 * há remetente próprio. `conferir` diz SIM/NÃO/INCERTO para "a loja pode abrir o
 * cadastro para clientes" — a loja só abre com SIM.
 *
 * CHAMADAS (lista fechada, `CHAMADAS_PERMITIDAS`; qualquer outra PARA antes do
 * fetch): GET /config/auth (`v1-get-auth-service-config`, auth:read), GET
 * /functions (`v1-list-all-functions`, edge_functions:read), GET /secrets
 * (`v1-list-all-secrets`, secrets:read), POST /database/query
 * (`v1-run-a-query`, database:write) com `read_only: true` e a consulta FIXA, e
 * — só em `acertar` — PATCH /config/auth (`v1-update-auth-service-config`,
 * auth:write) com chaves de CAMPOS_URLS e nada mais.
 *
 * TRAVAS (molde: ativar-email-do-login.cjs):
 *  - loja fora de ALVOS PARA antes de ler qualquer segredo; ação desconhecida e
 *    expected_sha diferente do GITHUB_SHA PARAM antes de qualquer rede;
 *  - só o segredo da PRÓPRIA loja; 401/403 PARAM sem tentar outro;
 *  - `redirect: "error"` e prazo de 30 s em todo fetch;
 *  - token, smtp_pass e o segredo do hook só passam por `::add-mask::`, antes de
 *    qualquer saída; corpo cru e mensagem de exceção nunca vão para o log (no
 *    máximo o status HTTP numérico);
 *  - `acertar` relê depois de cada PATCH e confirma o pedido; se QUALQUER outro
 *    campo do Auth mudou entre antes e depois, PARA com "estado DESCONHECIDO".
 *    Os endereços e o limite vão em PATCHes separados: o limite pode ser recusado
 *    pelo Supabase (400 sem SMTP), e isso não pode impedir os endereços.
 *
 * Idempotência: a 2ª execução de `acertar` não faz PATCH (o plano sai vazio).
 * Os valores de ANTES (não secretos) saem no log e no resumo: é com eles que se
 * desfaz à mão. Testado por tests/ci_login_da_loja_test.ts.
 */
const fs = require("node:fs");
const { isDeepStrictEqual } = require("node:util");
const { resolverRef } = require("./conferir-banco.cjs");
const { ALVOS, escaparDadoDeComando } = require("./medir-auth-da-loja.cjs");
const regras = require("./login-da-loja-regras.cjs");

const { Parada, parar } = regras;
const ACOES = Object.freeze(["conferir", "acertar"]);
const NOME_SEGREDO = "SEND_EMAIL_HOOK_SECRET";
const CHAMADAS_PERMITIDAS = Object.freeze(
  new Set([
    "GET /config/auth",
    "GET /functions",
    "GET /secrets",
    "POST /database/query",
    "PATCH /config/auth",
  ]),
);
const PARTES_DO_PATCH = Object.freeze([
  Object.freeze(["site_url", "uri_allow_list"]),
  Object.freeze(["rate_limit_email_sent"]),
]);

const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const texto = (v) => typeof v === "string" && v.trim() !== "";

function conferirConfig(config, saida) {
  if (!objeto(config)) parar("configuração de Auth inesperada");
  // Máscaras defensivas antes de qualquer validação/saída.
  for (const v of [config.hook_send_email_secrets, config.smtp_pass])
    if (texto(v)) saida.mascarar(v);
  return config;
}

function conferirLista(lista, campo) {
  if (
    !Array.isArray(lista) ||
    !lista.every((item) => objeto(item) && texto(Reflect.get(item, campo)))
  )
    parar("lista da Management API inesperada");
  const nomes = lista.map((item) => Reflect.get(item, campo));
  if (new Set(nomes).size !== nomes.length) parar("lista com nomes duplicados");
  return lista;
}

const textoDoLimite = (v) =>
  v === null || v === undefined
    ? "(vazio)"
    : Number.isInteger(v)
      ? String(v)
      : "(formato inesperado)";

function linhasDeValores(titulo, c) {
  return [
    `${titulo} site_url: ${regras.textoDeUrl(c.site_url)}`,
    `${titulo} uri_allow_list: ${regras.textoDeUrl(c.uri_allow_list)}`,
    `${titulo} rate_limit_email_sent: ${textoDoLimite(c.rate_limit_email_sent)}`,
  ];
}

const EXPLICACAO = Object.freeze({
  SIM: "a loja pode abrir o cadastro para clientes",
  NÃO: "não abrir o cadastro para clientes: corrija o que FALTA (endereços e limite: acao=acertar)",
  INCERTO: "medição incompleta: rode conferir de novo antes de abrir",
});

function relatar(saida, projeto, d) {
  const linhas = [
    `login da loja ${projeto}:`,
    ...d.itens.map((i) => `${i.estado} — ${i.nome}: ${i.detalhe}`),
    `veredito: ${d.veredito} (${Reflect.get(EXPLICACAO, d.veredito)})`,
  ];
  for (const linha of linhas) saida.log(linha);
  saida.resumo(linhas.join("\n"));
}

/** Dependências externas injetáveis; o teste só usa fetch falso. */
async function executar({ projeto, acao, env, fetchImpl, saida }) {
  try {
    if (typeof projeto !== "string" || !Object.hasOwn(ALVOS, projeto))
      parar("projeto desconhecido");
    if (!ACOES.includes(acao)) parar("ação desconhecida");
    const esperado = env.EXPECTED_SHA ?? "";
    const doRun = env.GITHUB_SHA ?? "";
    if (
      !/^[a-fA-F0-9]{40}$/.test(esperado) ||
      !/^[a-fA-F0-9]{40}$/.test(doRun) ||
      esperado.toLowerCase() !== doRun.toLowerCase()
    )
      parar("expected_sha completo e igual ao GITHUB_SHA é obrigatório");
    const alvo = Reflect.get(ALVOS, projeto);
    const token = Reflect.get(env, alvo.segredo);
    if (!texto(token)) parar(alvo.semAcesso);
    saida.mascarar(token);
    const ref = resolverRef(projeto);
    const base = `https://api.supabase.com/v1/projects/${ref}`;

    const chamar = async (caminho, method = "GET", body = undefined) => {
      if (!CHAMADAS_PERMITIDAS.has(`${method} ${caminho}`))
        parar("chamada fora da lista fechada");
      if (method === "PATCH" && acao !== "acertar")
        parar("conferir nunca grava");
      const r = await fetchImpl(base + caminho, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      const status = Number.isInteger(r.status) ? r.status : 0;
      if (status === 401 || status === 403) parar(alvo.semAcesso);
      const ok =
        caminho === "/database/query"
          ? status === 200 || status === 201
          : status === 200;
      if (!ok)
        parar(
          `HTTP ${status} inesperado na Management API (corpo não impresso)`,
        );
      return JSON.parse(await r.text());
    };
    const lerConfig = async () =>
      conferirConfig(await chamar("/config/auth"), saida);

    const consultar = async () => {
      const rows = await chamar("/database/query", "POST", {
        query: regras.CONSULTA_GMAIL,
        read_only: true,
      });
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        !objeto(rows[0]) ||
        !isDeepStrictEqual(Object.keys(rows[0]), [
          "dominio_publico",
          "gmail_cadastrado",
        ]) ||
        (rows[0].dominio_publico !== null &&
          typeof rows[0].dominio_publico !== "string") ||
        typeof rows[0].gmail_cadastrado !== "boolean"
      )
        parar("resposta da consulta da loja inesperada");
      return {
        dominio: rows[0].dominio_publico,
        gmail: rows[0].gmail_cadastrado,
      };
    };

    const conferir = async () => {
      const config = await lerConfig();
      const functions = conferirLista(await chamar("/functions"), "slug");
      if (
        !functions.every((f) =>
          ["ACTIVE", "REMOVED", "THROTTLED"].includes(f.status),
        )
      )
        parar("estado da função inesperado");
      const authSendEmail = functions.find((f) => f.slug === "auth-send-email");
      const secrets = conferirLista(await chamar("/secrets"), "name");
      const { dominio, gmail } = await consultar();
      const d = regras.diagnosticar({
        config,
        dominio,
        ref,
        funcao: authSendEmail?.status === "ACTIVE",
        verifyJwt: authSendEmail?.verify_jwt,
        segredoPresente: secrets.some((s) => s.name === NOME_SEGREDO),
        gmail,
      });
      relatar(saida, projeto, d);
      return d;
    };

    if (acao === "conferir") {
      const d = await conferir();
      return d.veredito === "SIM" ? 0 : 1;
    }

    // acertar
    const antes = await lerConfig();
    const { dominio } = await consultar();
    const { patch } = regras.planejarPatchUrls(antes, dominio);
    const linhasAntes = linhasDeValores("antes", antes);
    for (const linha of linhasAntes) saida.log(linha);
    saida.resumo(linhasAntes.join("\n"));

    let atual = antes;
    let gravou = false;
    for (const chaves of PARTES_DO_PATCH) {
      const parte = Object.fromEntries(
        Object.entries(patch).filter(([k]) => chaves.includes(k)),
      );
      if (Object.keys(parte).length === 0) continue;
      regras.conferirPatch(parte);
      try {
        conferirConfig(await chamar("/config/auth", "PATCH", parte), saida);
        gravou = true;
        const depois = await lerConfig();
        for (const [chave, valor] of Object.entries(parte))
          if (!isDeepStrictEqual(Reflect.get(depois, chave), valor))
            parar("releitura não confirmou o PATCH");
        const restantes = (c) =>
          Object.fromEntries(
            Object.entries(c).filter(([k]) => !Object.hasOwn(parte, k)),
          );
        if (!isDeepStrictEqual(restantes(atual), restantes(depois)))
          parar("outro campo do Auth mudou durante a operação");
        atual = depois;
      } catch (erro) {
        parar(
          `${erro instanceof Parada ? erro.message : "conferência do PATCH não completou"}; estado DESCONHECIDO; rode conferir antes de tentar de novo`,
        );
      }
    }

    const fim = gravou
      ? [
          "acertado e confirmado por releitura; para desfazer, volte aos valores de antes",
          ...linhasDeValores("depois", atual),
        ]
      : ["nada a acertar: endereços e limite já estão certos (nenhum PATCH)"];
    for (const linha of fim) saida.log(linha);
    saida.resumo(fim.join("\n"));
    // Termina conferindo; o veredito não muda o resultado do acertar (a loja
    // recém-nascida ainda não tem remetente próprio e fica NÃO até o Gmail).
    await conferir();
    return 0;
  } catch (erro) {
    // Só mensagens FIXAS nossas. Erro de transporte/JSON pode conter segredo.
    saida.erro(
      `FALHOU: ${erro instanceof Parada ? erro.message : "operação não completou (detalhes não impressos)"}`,
    );
    return 1;
  }
}

function saidaDoProcesso() {
  return {
    log: (linha) => console.log(linha),
    erro: (linha) => console.error(linha),
    resumo: (markdown) => {
      const destino = process.env.GITHUB_STEP_SUMMARY;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho do runner, não de entrada.
      if (destino) fs.appendFileSync(destino, `${markdown}\n`);
    },
    mascarar: (valor) =>
      process.stdout.write(`::add-mask::${escaparDadoDeComando(valor)}\n`),
  };
}
async function main() {
  process.exitCode = await executar({
    projeto: process.env.PROJETO,
    acao: process.env.ACAO,
    env: process.env,
    fetchImpl: globalThis.fetch,
    saida: saidaDoProcesso(),
  });
}
if (require.main === module) main();
module.exports = {
  executar,
  main,
  saidaDoProcesso,
  ACOES,
  CHAMADAS_PERMITIDAS,
};
