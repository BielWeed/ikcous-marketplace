#!/usr/bin/env node
/**
 * Send Email Hook de UMA loja: medir, preparar (desligado), ativar, desativar.
 * Chamado só por ativar-email-do-login.yml; nenhuma API é chamada ao importar.
 *
 * Fontes oficiais conferidas em 21/10/2026:
 * https://supabase.com/docs/reference/api/v1-update-auth-service-config
 * https://supabase.com/docs/reference/api/v1-list-all-secrets
 * https://supabase.com/docs/reference/api/v1-bulk-create-secrets
 * https://supabase.com/docs/reference/api/v1-list-all-functions
 * https://supabase.com/docs/reference/api/v1-run-a-query
 * https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 * Schema expandido (CreateSecretBody, FunctionResponse_Output, AuthConfig):
 * https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json
 *
 * PATCH só leva campos do hook. Snapshot em memória + releitura comparam TODAS
 * as outras políticas, sem imprimi-las nem gravá-las. Desativar não depende de
 * function, segredo, Gmail ou leitura inicial bem-sucedida: tenta o PATCH mesmo
 * sem snapshot; nesse caso não declara a verificação completa.
 *
 * Preparar não rotaciona: estado parcial/estranho PARA sem escrita. A criação
 * do segredo e o PATCH NÃO são uma transação: interrupção pode deixar o segredo
 * só na função; não tente reparar/rotacionar automaticamente. Revisão humana
 * deve decidir a recuperação, mantendo o hook desligado.
 *
 * Saída fechada, sem corpo cru nem mensagens de exceção. A ÚNICA passagem de
 * segredo por stdout é o protocolo ::add-mask::, consumido/ocultado pelo runner,
 * antes do uso. Não se usa segredo em argumento de comando, arquivo ou resumo.
 * A presença de Gmail não prova decifragem nem entrega; isso exige teste real.
 */
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { resolverRef } = require("./conferir-banco.cjs");
const { ALVOS, escaparDadoDeComando } = require("./medir-auth-da-loja.cjs");

const ACOES = Object.freeze(["medir", "preparar", "ativar", "desativar"]);
const NOME_SEGREDO = "SEND_EMAIL_HOOK_SECRET";
const CAMPOS_HOOK = Object.freeze([
  "hook_send_email_enabled",
  "hook_send_email_uri",
  "hook_send_email_secrets",
]);
// app_settings.value é TEXTO JSON (gravarValor, email-da-loja.ts:293).
// Só EXISTS volta. JSON inválido provoca erro fechado; nenhum valor é devolvido.
const CONSULTA_GMAIL = `SELECT EXISTS (
  SELECT 1 FROM public.app_settings
  WHERE key = 'email_da_loja'
    AND jsonb_typeof(value::jsonb) = 'object'
    AND jsonb_typeof(value::jsonb -> 'usuario') = 'string'
    AND length(btrim(value::jsonb ->> 'usuario')) > 0
    AND jsonb_typeof(value::jsonb -> 'senha_cifrada') = 'string'
    AND length(btrim(value::jsonb ->> 'senha_cifrada')) > 0
    AND jsonb_typeof(value::jsonb -> 'iv') = 'string'
    AND length(btrim(value::jsonb ->> 'iv')) > 0
) AS gmail_cadastrado`;

const objeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const texto = (v) => typeof v === "string" && v.trim() !== "";
const vazio = (v) => v === null || v === "";
const formatoSegredo = (v) =>
  typeof v === "string" &&
  /^v1,whsec_[A-Za-z0-9+/]{43}=$/.test(v) &&
  Buffer.from(v.slice(9), "base64").toString("base64") === v.slice(9);

class Parada extends Error {}
const parar = (mensagem) => {
  throw new Parada(mensagem);
};

function conferirConfig(config, saida) {
  if (!objeto(config)) parar("configuração de Auth inesperada");
  // Máscaras defensivas antes de qualquer validação/saída.
  for (const v of [config.hook_send_email_secrets, config.smtp_pass])
    if (texto(v)) saida.mascarar(v);
  if (
    typeof config.hook_send_email_enabled !== "boolean" &&
    config.hook_send_email_enabled !== null
  )
    parar("estado do hook inesperado");
  for (const v of [config.hook_send_email_uri, config.hook_send_email_secrets])
    if (v !== null && typeof v !== "string")
      parar("configuração do hook inesperada");
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

function relatar({ saida, config, uri, funcao, segredo, gmail }) {
  const simNao = (v) => (v ? "sim" : "não");
  // URI remota só sai se for byte a byte a URI construída do alvo fechado.
  const linhas = [
    `hook ativado: ${simNao(config.hook_send_email_enabled === true)}`,
    `URI do hook: ${config.hook_send_email_uri === uri ? uri : vazio(config.hook_send_email_uri) ? "ausente" : "diferente da esperada"}`,
    `hook preparado: ${simNao(config.hook_send_email_uri === uri && formatoSegredo(config.hook_send_email_secrets))}`,
    `função ativa: ${funcao === undefined ? "não medido" : simNao(funcao)}`,
    `segredo da função: ${segredo === undefined ? "não medido" : segredo ? "presente" : "ausente"}`,
    `nomes de segredos medidos: ${segredo === undefined ? "não medido" : NOME_SEGREDO}`,
    `Gmail cadastrado: ${gmail === undefined ? "não medido" : simNao(gmail)}`,
  ];
  for (const linha of linhas) saida.log(linha);
  saida.resumo(linhas.join("\n"));
}

/** Dependências externas injetáveis; teste só usa fetch falso. */
async function executar({ projeto, acao, env, fetchImpl, saida }) {
  try {
    if (!Object.hasOwn(ALVOS, projeto)) parar("projeto desconhecido");
    if (!ACOES.includes(acao)) parar("ação desconhecida");
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
    const ref = resolverRef(projeto);
    const uri = `https://${ref}.supabase.co/functions/v1/auth-send-email`;
    const base = `https://api.supabase.com/v1/projects/${ref}`;

    const chamar = async (caminho, method = "GET", body = undefined) => {
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
      const esperado = method === "POST" ? 201 : 200;
      if (r.status === 401 || r.status === 403) parar(alvo.semAcesso);
      if (r.status !== esperado)
        parar("HTTP inesperado na Management API (corpo não impresso)");
      const corpo = await r.text();
      // POST secrets documenta 201 SEM schema de resposta; a prova é o GET.
      if (caminho === "/secrets" && method === "POST") return null;
      return JSON.parse(corpo);
    };
    const lerConfig = async () =>
      conferirConfig(await chamar("/config/auth"), saida);

    const aplicar = async (antes, patch) => {
      if (
        !objeto(patch) ||
        !Object.keys(patch).every((k) => CAMPOS_HOOK.includes(k))
      )
        parar("PATCH fora dos campos do hook");
      const resposta = await chamar("/config/auth", "PATCH", patch);
      conferirConfig(resposta, saida);
      const depois = await lerConfig();
      for (const [chave, valor] of Object.entries(patch))
        if (!isDeepStrictEqual(Reflect.get(depois, chave), valor))
          parar("releitura não confirmou o PATCH");
      if (!antes)
        parar("hook desativado; verificação incompleta das outras políticas");
      // Compara também os campos do hook NÃO pedidos neste PATCH.
      const restantes = (c) =>
        Object.fromEntries(
          Object.entries(c).filter(([k]) => !Object.hasOwn(patch, k)),
        );
      if (!isDeepStrictEqual(restantes(antes), restantes(depois)))
        parar(
          "outra configuração mudou durante a operação; verificação incompleta",
        );
      return depois;
    };

    let config;
    if (acao === "desativar") {
      try {
        config = await lerConfig();
      } catch {
        config = null;
      }
      config = await aplicar(config, { hook_send_email_enabled: false });
      relatar({ saida, config, uri });
      return 0;
    }

    config = await lerConfig();
    let secrets = conferirLista(await chamar("/secrets"), "name");
    const segredoPresente = () => secrets.some((s) => s.name === NOME_SEGREDO);

    if (acao === "preparar") {
      const preparado =
        config.hook_send_email_uri === uri &&
        formatoSegredo(config.hook_send_email_secrets) &&
        segredoPresente();
      if (preparado) {
        if (config.hook_send_email_enabled === true)
          config = await aplicar(config, { hook_send_email_enabled: false });
      } else {
        if (
          segredoPresente() ||
          !vazio(config.hook_send_email_secrets) ||
          config.hook_send_email_enabled === true ||
          (!vazio(config.hook_send_email_uri) &&
            config.hook_send_email_uri !== uri)
        )
          parar("preparação parcial ou alheia; segredo não foi rotacionado");
        const segredo = `v1,whsec_${randomBytes(32).toString("base64")}`;
        // Mascara o segredo completo E a chave que a function usa sem prefixo.
        saida.mascarar(segredo);
        saida.mascarar(segredo.slice(9));
        await chamar("/secrets", "POST", [
          { name: NOME_SEGREDO, value: segredo },
        ]);
        secrets = conferirLista(await chamar("/secrets"), "name");
        if (!segredoPresente()) parar("segredo não confirmado na função");
        config = await aplicar(config, {
          hook_send_email_enabled: false,
          hook_send_email_uri: uri,
          hook_send_email_secrets: segredo,
        });
      }
      relatar({ saida, config, uri, segredo: true });
      return 0;
    }

    const functions = conferirLista(await chamar("/functions"), "slug");
    if (
      !functions.every((f) =>
        ["ACTIVE", "REMOVED", "THROTTLED"].includes(f.status),
      )
    )
      parar("estado da função inesperado");
    const funcao = functions.some(
      (f) => f.slug === "auth-send-email" && f.status === "ACTIVE",
    );
    if (acao === "medir") {
      relatar({ saida, config, uri, funcao, segredo: segredoPresente() });
      return 0;
    }

    if (!funcao) parar("função auth-send-email ausente ou inativa");
    if (!segredoPresente()) parar("segredo da função ausente");
    if (
      config.hook_send_email_uri !== uri ||
      !formatoSegredo(config.hook_send_email_secrets)
    )
      parar("hook ainda não preparado");
    const rows = await chamar("/database/query", "POST", {
      query: CONSULTA_GMAIL,
      read_only: true,
    });
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      !objeto(rows[0]) ||
      !isDeepStrictEqual(Object.keys(rows[0]), ["gmail_cadastrado"]) ||
      typeof rows[0].gmail_cadastrado !== "boolean"
    )
      parar("resposta da consulta de Gmail inesperada");
    if (!rows[0].gmail_cadastrado)
      parar("Gmail ainda não cadastrado no painel");
    config = await aplicar(config, { hook_send_email_enabled: true });
    relatar({ saida, config, uri, funcao, segredo: true, gmail: true });
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
module.exports = { executar, main, saidaDoProcesso };
