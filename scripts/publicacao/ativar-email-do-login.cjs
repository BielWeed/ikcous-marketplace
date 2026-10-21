#!/usr/bin/env node
/**
 * Send Email Hook de UMA loja: medir, preparar sem desligar, ativar, desativar.
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
 * Ativar exige auth-send-email ACTIVE e verify_jwt === false (Auth usa webhook).
 * Preparar preserva hook já ligado e não rotaciona: estado parcial/estranho
 * PARA sem escrita. Auth devolve HMAC-SHA256(ref, texto puro), em 64 hex
 * minúsculos; não devolve v1,whsec_. A igualdade só pode ser conferida na
 * preparação nova, quando o texto puro existe em memória. Nas outras ações,
 * "preparado" é URI esperada + formato do hash + segredo presente na função,
 * NÃO prova de igualdade dos segredos. O hash de /secrets não permite compará-los.
 * Fontes: supabase/cli (main), apps/cli-go/pkg/config/{auth,secret}.go,
 * apps/cli/src/commands/config/push/push.secret.ts e
 * docs/adr/0019-config-api-response-passthrough.md.
 *
 * A criação do segredo e o PATCH NÃO são uma transação: interrupção pode deixar o segredo
 * só na função; não tente reparar/rotacionar automaticamente. Revisão humana
 * deve decidir a recuperação, mantendo o hook desligado.
 *
 * Saída fechada, sem corpo cru nem mensagens de exceção. A ÚNICA passagem de
 * segredo por stdout é o protocolo ::add-mask::, consumido/ocultado pelo runner,
 * antes do uso. Não se usa segredo em argumento de comando, arquivo ou resumo.
 * A presença de Gmail não prova decifragem nem entrega; isso exige teste real.
 */
const fs = require("node:fs");
const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
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
const formatoHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const hookPreparado = (config, uri, segredoPresente) =>
  config.hook_send_email_uri === uri &&
  formatoHash(config.hook_send_email_secrets) &&
  segredoPresente;

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

function relatar({
  saida,
  config,
  uri,
  funcao,
  verifyJwt,
  segredo,
  segredoConferido = false,
  gmail,
}) {
  const simNao = (v) => (v ? "sim" : "não");
  // URI remota só sai se for byte a byte a URI construída do alvo fechado.
  const linhas = [
    `hook ativado: ${simNao(config.hook_send_email_enabled === true)}`,
    `URI do hook: ${config.hook_send_email_uri === uri ? uri : vazio(config.hook_send_email_uri) ? "ausente" : "diferente da esperada"}`,
    `hook preparado: ${segredo === undefined ? "não medido" : simNao(hookPreparado(config, uri, segredo))}`,
    `campo do Auth: ${formatoHash(config.hook_send_email_secrets) ? "hash presente" : vazio(config.hook_send_email_secrets) ? "ausente" : "presente, mas fora do formato de hash"}`,
    `função ativa: ${funcao === undefined ? "não medido" : simNao(funcao)}`,
    `verify_jwt da função: ${typeof verifyJwt === "boolean" ? String(verifyJwt) : "desconhecido"}`,
    `igualdade entre Auth e função: ${segredoConferido ? "confirmada nesta preparação" : "não verificada (texto puro indisponível)"}`,
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
      let depois;
      try {
        const resposta = await chamar("/config/auth", "PATCH", patch);
        conferirConfig(resposta, saida);
        depois = await lerConfig();
        for (const [chave, valor] of Object.entries(patch)) {
          let confirmado;
          if (chave === "hook_send_email_secrets") {
            // O PATCH leva texto puro; a releitura retorna o HMAC desse texto.
            const esperado = createHmac("sha256", ref)
              .update(valor, "utf8")
              .digest("hex");
            saida.mascarar(esperado);
            const recebido = depois.hook_send_email_secrets;
            confirmado =
              formatoHash(recebido) &&
              timingSafeEqual(
                Buffer.from(recebido, "hex"),
                Buffer.from(esperado, "hex"),
              );
          } else
            confirmado = isDeepStrictEqual(Reflect.get(depois, chave), valor);
          if (!confirmado) parar("releitura não confirmou o PATCH");
        }
        // Compara também os campos do hook NÃO pedidos neste PATCH.
        const restantes = (c) =>
          Object.fromEntries(
            Object.entries(c).filter(([k]) => !Object.hasOwn(patch, k)),
          );
        if (antes && !isDeepStrictEqual(restantes(antes), restantes(depois)))
          parar(
            "outra configuração mudou durante a operação; verificação incompleta",
          );
      } catch (erro) {
        parar(
          `${erro instanceof Parada ? erro.message : "conferência do PATCH não completou"}; estado do hook DESCONHECIDO; rode medir antes de tentar novamente`,
        );
      }
      if (!antes)
        parar(
          "hook desativado confirmado por releitura; verificação incompleta das outras políticas",
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
      let segredoConferido = false;
      const preparado = hookPreparado(config, uri, segredoPresente());
      if (preparado) {
        if (config.hook_send_email_enabled === true) {
          const mensagem = "hook já ligado, nada a preparar";
          saida.log(mensagem);
          saida.resumo(mensagem);
        }
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
        segredoConferido = true;
      }
      relatar({ saida, config, uri, segredo: true, segredoConferido });
      return 0;
    }

    const functions = conferirLista(await chamar("/functions"), "slug");
    if (
      !functions.every((f) =>
        ["ACTIVE", "REMOVED", "THROTTLED"].includes(f.status),
      )
    )
      parar("estado da função inesperado");
    const authSendEmail = functions.find((f) => f.slug === "auth-send-email");
    const funcao = authSendEmail?.status === "ACTIVE";
    const verifyJwt = authSendEmail?.verify_jwt;
    if (acao === "medir") {
      relatar({
        saida,
        config,
        uri,
        funcao,
        verifyJwt,
        segredo: segredoPresente(),
      });
      return 0;
    }

    if (!funcao) parar("função auth-send-email ausente ou inativa");
    if (verifyJwt !== false)
      parar(
        "função auth-send-email precisa ser publicada sem verificação de login (verify_jwt=false), porque o Auth chama com assinatura de webhook, não com login",
      );
    if (!segredoPresente()) parar("segredo da função ausente");
    if (!hookPreparado(config, uri, segredoPresente()))
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
    relatar({
      saida,
      config,
      uri,
      funcao,
      verifyJwt,
      segredo: true,
      gmail: true,
    });
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
