#!/usr/bin/env node
/**
 * Google OAuth de UMA loja: medir, ativar e desativar. Nada roda ao importar.
 * Fontes oficiais conferidas em 15/11/2026:
 * https://supabase.com/docs/reference/api/v1-update-auth-service-config
 * https://supabase.com/docs/reference/api/v1-get-auth-service-config
 * https://supabase.com/docs/guides/auth/social-login/auth-google
 * https://raw.githubusercontent.com/supabase/cli/v2.54.11/pkg/config/auth.go
 * https://raw.githubusercontent.com/supabase/cli/v2.54.11/pkg/config/secret.go
 * https://raw.githubusercontent.com/supabase/cli/develop/apps/cli/src/commands/config/push/push.secret.ts
 * https://raw.githubusercontent.com/supabase/cli/develop/docs/adr/0019-config-api-response-passthrough.md
 *
 * GET/PATCH /v1/projects/{ref}/config/auth: enabled é booleano anulável,
 * client_id/secret/uri_allow_list são strings anuláveis. Lista de URLs em CSV
 * (strings.Join(AdditionalRedirectUrls, ",") no CLI). PATCH recebe segredo puro;
 * respostas de config devolvem HMAC-SHA256(ref, segredo), hex sem prefixo.
 * Nunca imprime nem persiste resposta, segredo ou digest. Se o servidor divergir
 * desse contrato, falha fechado e NÃO declara a ativação confirmada.
 *
 * Snapshot COMPLETO em memória + releitura: só as chaves do PATCH podem mudar.
 * Ativar inclui origem/** sem remover entradas existentes (inclusive caminhos e
 * curingas antigos). A ORIGEM digitada é só https://host público, até 5.
 * O molde /** libera a volta em caminhos da loja; a origem pelada não libera.
 * Não toca site_url. Desfazer: mesma loja/SHA, acao=desativar; altera só enabled.
 * Desativar tenta o PATCH de emergência mesmo sem leitura inicial válida;
 * nesse caso a releitura prova só enabled=false, nunca as outras políticas.
 * A seleção da turma é explícita; não existe associação automática loja/turma.
 * Só a turma selecionada pode receber segredo; medir/desativar não o exigem.
 * Máscaras ::add-mask:: são a única passagem por stdout, antes de qualquer uso,
 * consumidas pelo runner. Nunca use segredo em argumento, arquivo ou resumo.
 */
const fs = require("node:fs");
const { createHmac, timingSafeEqual } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { resolverRef } = require("./conferir-banco.cjs");
const { ALVOS, escaparDadoDeComando } = require("./medir-auth-da-loja.cjs");

const ACOES = Object.freeze(["medir", "ativar", "desativar"]);
const TURMAS = Object.freeze({
  "turma-1": "GOOGLE_OAUTH_SECRET_TURMA_1",
  "turma-2": "GOOGLE_OAUTH_SECRET_TURMA_2",
  "turma-3": "GOOGLE_OAUTH_SECRET_TURMA_3",
  "turma-4": "GOOGLE_OAUTH_SECRET_TURMA_4",
});
const CAMPOS = Object.freeze([
  "external_google_enabled",
  "external_google_client_id",
  "external_google_secret",
  "uri_allow_list",
]);
const texto = (v) => typeof v === "string" && v.trim() !== "";
const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const idValido = (v) =>
  typeof v === "string" &&
  /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(v);
class Parada extends Error {}
const parar = (mensagem) => {
  throw new Parada(mensagem);
};

function validarOrigens(valor) {
  if (!texto(valor))
    parar("origens HTTPS são obrigatórias para medir ou ativar");
  const origens = valor.split(",").map((v) => v.trim());
  if (origens.length > 5) parar("no máximo cinco origens por operação");
  for (const origem of origens) {
    if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(origem))
      parar(
        "origem inválida; use somente https://host sem caminho, porta ou curinga",
      );
    const url = new URL(origem);
    const host = url.hostname;
    const partes = host.split(".");
    if (
      url.origin !== origem ||
      host.length > 253 ||
      partes.length < 2 ||
      !partes.every(
        (p) =>
          p.length > 0 &&
          p.length <= 63 &&
          /^[a-z0-9-]+$/.test(p) &&
          !p.startsWith("-") &&
          !p.endsWith("-"),
      ) ||
      /^[0-9.]+$/.test(host) ||
      ["localhost", "localdomain", "local", "internal"].some(
        (v) => host === v || host.endsWith("." + v),
      )
    )
      parar("origem inválida ou local; localhost não é permitido");
  }
  return [...new Set(origens)];
}
const moldeDaOrigem = (origem) => `${origem}/**`;
const listaDeUris = (config) =>
  (config.uri_allow_list ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

function conferirConfig(config, saida) {
  if (!objeto(config)) parar("configuração de Auth inesperada");
  // Somente máscaras defensivas; nenhum valor remoto vai para relatório.
  for (const v of [
    config.external_google_secret,
    config.smtp_pass,
    config.hook_send_email_secrets,
  ])
    if (texto(v)) saida.mascarar(v);
  if (!CAMPOS.every((k) => Object.hasOwn(config, k)))
    parar("campos obrigatórios ausentes na configuração de Auth");
  if (
    config.external_google_enabled !== null &&
    typeof config.external_google_enabled !== "boolean"
  )
    parar("estado do Google inesperado");
  for (const k of CAMPOS.slice(1))
    if (
      Reflect.get(config, k) !== null &&
      typeof Reflect.get(config, k) !== "string"
    )
      parar("configuração do Google inesperada");
  return config;
}
function relatar({ config, origens, acao, saida }) {
  const valido = idValido(config.external_google_client_id);
  const simNao = (v) => (v ? "sim" : "não");
  const linhas = [
    `Google ligado: ${simNao(config.external_google_enabled === true)}`,
    `client id configurado: ${simNao(texto(config.external_google_client_id))}`,
    `client id últimos seis: ${valido ? config.external_google_client_id.slice(-6) : "indisponível"}`,
    `redirecionamento da volta liberado: ${origens.length ? simNao(origens.every((v) => listaDeUris(config).includes(moldeDaOrigem(v)))) : "não medido (desativação)"}`,
    acao === "medir"
      ? "outras configurações: somente leitura; nenhum PATCH enviado (sem comparação temporal)"
      : "outras configurações: preservadas; snapshot completo comparado em memória",
    "ok",
  ];
  for (const linha of linhas) saida.log(linha);
  saida.resumo(linhas.join("\n"));
}

/** Tudo externo é injetado; os testes nunca chamam a API real. */
async function executar({ projeto, acao, env, fetchImpl, saida }) {
  try {
    if (!Object.hasOwn(ALVOS, projeto)) parar("projeto desconhecido");
    if (!ACOES.includes(acao)) parar("ação desconhecida");
    if (!Object.hasOwn(TURMAS, env.TURMA)) parar("turma desconhecida");
    if (
      !/^[a-fA-F0-9]{40}$/.test(env.EXPECTED_SHA ?? "") ||
      !/^[a-fA-F0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
      env.EXPECTED_SHA.toLowerCase() !== env.GITHUB_SHA.toLowerCase()
    )
      parar("expected_sha completo e igual ao GITHUB_SHA é obrigatório");
    const alvo = Reflect.get(ALVOS, projeto);
    const token = Reflect.get(env, alvo.segredo);
    if (!texto(token)) parar(alvo.semAcesso);
    saida.mascarar(token);
    const nomeSegredo = Reflect.get(TURMAS, env.TURMA);
    const segredo =
      acao === "ativar" ? Reflect.get(env, nomeSegredo) : undefined;
    if (texto(segredo)) saida.mascarar(segredo);
    if (
      acao === "ativar" &&
      Object.values(TURMAS).some(
        (nome) => nome !== nomeSegredo && texto(Reflect.get(env, nome)),
      )
    )
      parar("segredo de turma não selecionada presente; seleção inconsistente");
    const origens = acao === "desativar" ? [] : validarOrigens(env.ORIGENS);
    if (acao === "ativar") {
      if (!idValido(env.CLIENT_ID)) parar("client id do Google inválido");
      if (!texto(segredo)) parar("segredo da turma selecionada ausente");
    }
    const ref = resolverRef(projeto);
    const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
    const chamar = async (method = "GET", patch = undefined) => {
      const r = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(patch === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(patch === undefined ? {} : { body: JSON.stringify(patch) }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 401 || r.status === 403) parar(alvo.semAcesso);
      if (r.status !== 200)
        parar("HTTP inesperado na Management API (corpo não impresso)");
      return conferirConfig(JSON.parse(await r.text()), saida);
    };
    let antes;
    if (acao === "desativar") {
      try {
        antes = await chamar();
      } catch {
        antes = null;
      }
    } else {
      antes = await chamar();
    }
    if (acao === "medir") {
      relatar({ config: antes, origens, acao, saida });
      return 0;
    }
    const patch =
      acao === "desativar"
        ? { external_google_enabled: false }
        : {
            external_google_enabled: true,
            external_google_client_id: env.CLIENT_ID,
            external_google_secret: segredo,
            uri_allow_list: [
              ...new Set([
                ...listaDeUris(antes),
                ...origens.map(moldeDaOrigem),
              ]),
            ].join(","),
          };
    const permitidos =
      acao === "desativar" ? ["external_google_enabled"] : CAMPOS;
    if (!Object.keys(patch).every((k) => permitidos.includes(k)))
      parar("PATCH fora dos campos permitidos");
    let depois;
    try {
      await chamar("PATCH", patch);
      depois = await chamar();
      for (const [k, valor] of Object.entries(patch)) {
        if (k === "external_google_secret") {
          const esperado = createHmac("sha256", ref)
            .update(valor, "utf8")
            .digest("hex");
          saida.mascarar(esperado);
          const recebido = depois.external_google_secret;
          if (
            typeof recebido !== "string" ||
            !/^[a-f0-9]{64}$/.test(recebido) ||
            !timingSafeEqual(
              Buffer.from(recebido, "hex"),
              Buffer.from(esperado, "hex"),
            )
          )
            parar("releitura não confirmou o segredo");
        } else if (!isDeepStrictEqual(Reflect.get(depois, k), valor))
          parar("releitura não confirmou o PATCH");
      }
      const restantes = (c) =>
        Object.fromEntries(
          Object.entries(c).filter(([k]) => !Object.hasOwn(patch, k)),
        );
      if (antes && !isDeepStrictEqual(restantes(antes), restantes(depois)))
        parar("outra configuração mudou durante a operação");
      if (!origens.every((v) => listaDeUris(depois).includes(moldeDaOrigem(v))))
        parar("origens não confirmadas na releitura");
    } catch {
      parar(
        "conferência do PATCH não completou; estado do Google DESCONHECIDO; rode medir antes de tentar novamente",
      );
    }
    if (!antes)
      parar(
        "Google desativado confirmado por releitura; verificação incompleta das outras políticas",
      );
    relatar({ config: depois, origens, acao, saida });
    return 0;
  } catch (erro) {
    // Só mensagens fixas nossas; JSON/transporte podem carregar segredo.
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
module.exports = { executar, main, saidaDoProcesso };
