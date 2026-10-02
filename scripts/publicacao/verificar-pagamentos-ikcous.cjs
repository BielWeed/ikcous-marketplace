#!/usr/bin/env node
"use strict";

// Destino dedicado: os workflows legados usam "loja" para outro projeto.
// Nao recebe destino, SQL ou nome de arquivo de inputs/variaveis.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
// Modo fechado de conferencia: CAF foi observado no bundle publico do site.
// Nunca recebe ref livre, URL ou SQL de caller.
const PUBLICADO =
  require.main === module && process.argv[2] === "--site-publicado-caf";
const REF = PUBLICADO ? "cafkrminfnokvgjqtkle" : "dekxabvqdsuukijblazl";
const ENDPOINT = `https://api.supabase.com/v1/projects/${REF}/database/query/read-only`;
const ROOT = path.resolve(__dirname, "../..");

const CONSULTAS = Object.freeze({
  funcoes: `SELECT v.chave, (p.oid IS NOT NULL) AS existe,
    md5(replace(p.prosrc, E'\\r', '')) AS corpo_md5,
    COALESCE(p.prosecdef, false) AS definer,
    COALESCE(p.proconfig @> ARRAY['search_path=public'], false) AS caminho_fixo,
    CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_executa,
    CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_executa,
    CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_executa
    FROM (VALUES
      ('liberar', 'public.liberar_cobranca_do_pedido(uuid,text)'),
      ('expirar', 'public.expirar_pedidos_vencidos()')
    ) AS v(chave, assinatura)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(v.assinatura)
    ORDER BY v.chave`,
  colunas: `SELECT v.coluna, (a.attname IS NOT NULL) AS existe,
    COALESCE(a.attnotnull, false) AS nao_nula
    FROM (VALUES ('gateway_payment_id'), ('tentativas_de_pagamento'),
      ('payment_status'), ('status'), ('paid_at'), ('metodo_online'),
      ('parcelas'), ('expires_at')) AS v(coluna)
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid = to_regclass('public.marketplace_orders')
      AND a.attname = v.coluna AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY v.coluna`,
  config:
    "SELECT id, credito, debito, parcelas_max FROM public.config_pagamento_cartao ORDER BY id LIMIT 2",
});

function hashesEsperados() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminho fixo do repositorio, sem input externo.
  const migration76 = fs.readFileSync(
    path.join(
      ROOT,
      "supabase/migrations/20261176000000_o_cartao_online_nasce.sql",
    ),
    "utf8",
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminho fixo do repositorio, sem input externo.
  const migration86 = fs.readFileSync(
    path.join(
      ROOT,
      "supabase/migrations/20261186000000_cartao_em_analise_segura_a_expiracao.sql",
    ),
    "utf8",
  );
  const liberar = migration76.match(
    /CREATE OR REPLACE FUNCTION public\.liberar_cobranca_do_pedido\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  );
  const expirar = migration86.match(/AS \$expirar\$([\s\S]*?)\$expirar\$;/);
  if (!liberar || !expirar)
    throw new Error("Corpo esperado nao encontrado nas migrations fixas.");
  const hash = (corpo) =>
    createHash("md5").update(corpo.replace(/\r/g, ""), "utf8").digest("hex");
  return { liberar: hash(liberar[1]), expirar: hash(expirar[1]) };
}

async function consultar(query, { token, fetchImpl }) {
  const resposta = await fetchImpl(ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!resposta.ok)
    throw new Error(
      `Supabase respondeu HTTP ${resposta.status}; corpo omitido.`,
    );
  const linhas = await resposta.json();
  if (!Array.isArray(linhas))
    throw new Error("Resposta de consulta invalida; conteudo omitido.");
  return linhas;
}

function avaliar(resultados, hashes) {
  const checks = [];
  const conferir = (checagem, ok) => checks.push({ checagem, ok: ok === true });
  const funcoes = resultados.funcoes;
  conferir(
    "duas assinaturas financeiras exatas",
    funcoes.length === 2 &&
      new Set(funcoes.map((r) => r.chave)).size === 2 &&
      funcoes.every((r) => r.chave === "liberar" || r.chave === "expirar"),
  );
  for (const chave of ["liberar", "expirar"]) {
    const linhas = funcoes.filter((r) => r.chave === chave);
    const r = linhas.length === 1 ? linhas[0] : {};
    conferir(`${chave}: existe`, r.existe === true);
    const esperado = chave === "liberar" ? hashes.liberar : hashes.expirar;
    conferir(
      `${chave}: corpo identico a migration revisada`,
      r.corpo_md5 === esperado,
    );
    conferir(
      `${chave}: definer e search_path fixo`,
      r.definer === true && r.caminho_fixo === true,
    );
    conferir(
      `${chave}: anon e authenticated nao executam`,
      r.anon_executa === false && r.authenticated_executa === false,
    );
    // Expirar e chamada pelo pg_cron como postgres: nao exige grant a service_role.
    if (chave === "liberar") {
      conferir("liberar: service role executa", r.service_executa === true);
    }
  }
  const colunas = [
    "gateway_payment_id",
    "tentativas_de_pagamento",
    "payment_status",
    "status",
    "paid_at",
    "metodo_online",
    "parcelas",
    "expires_at",
  ];
  conferir(
    "colunas financeiras presentes sem duplicatas",
    resultados.colunas.length === colunas.length &&
      colunas.every(
        (c) =>
          resultados.colunas.filter((r) => r.coluna === c && r.existe === true)
            .length === 1,
      ),
  );
  conferir(
    "tentativas de pagamento nao aceita NULL",
    resultados.colunas.some(
      (r) => r.coluna === "tentativas_de_pagamento" && r.nao_nula === true,
    ),
  );
  const config = resultados.config;
  conferir(
    "config de cartao singleton",
    config.length === 1 && config[0].id === 1,
  );
  conferir(
    "credito ligado, debito desligado, 1 parcela",
    config.length === 1 &&
      config[0].id === 1 &&
      config[0].credito === true &&
      config[0].debito === false &&
      config[0].parcelas_max === 1,
  );
  return checks;
}

async function verificar({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || token.trim() === "")
    throw new Error("Token de Actions ausente.");
  const hashes = hashesEsperados();
  const funcoes = await consultar(CONSULTAS.funcoes, { token, fetchImpl });
  const colunas = await consultar(CONSULTAS.colunas, { token, fetchImpl });
  const config = await consultar(CONSULTAS.config, { token, fetchImpl });
  const resultados = { funcoes, colunas, config };
  const checks = avaliar(resultados, hashes);
  return {
    projeto: REF,
    somenteLeitura: true,
    diagnostico: {
      funcoes: funcoes.map((r) => ({
        chave:
          r.chave === "liberar" || r.chave === "expirar" ? r.chave : "invalida",
        corpo_md5: /^[a-f0-9]{32}$/.test(r.corpo_md5) ? r.corpo_md5 : null,
        anon_executa:
          typeof r.anon_executa === "boolean" ? r.anon_executa : null,
        authenticated_executa:
          typeof r.authenticated_executa === "boolean"
            ? r.authenticated_executa
            : null,
        service_executa:
          typeof r.service_executa === "boolean" ? r.service_executa : null,
      })),
      config: config.map((r) => ({
        id: r.id === 1 ? 1 : null,
        credito: typeof r.credito === "boolean" ? r.credito : null,
        debito: typeof r.debito === "boolean" ? r.debito : null,
        parcelas_max:
          Number.isInteger(r.parcelas_max) &&
          r.parcelas_max >= 1 &&
          r.parcelas_max <= 12
            ? r.parcelas_max
            : null,
      })),
    },
    checks,
    ok: checks.every((c) => c.ok),
  };
}

if (require.main === module) {
  verificar({ token: process.env.SUPABASE_ACCESS_TOKEN })
    .then((relatorio) => {
      console.log(JSON.stringify(relatorio, null, 2));
      process.exitCode = relatorio.ok ? 0 : 1;
    })
    .catch((erro) => {
      // Nunca imprime resposta, token, headers nem stack de rede.
      const conhecida =
        /^Supabase respondeu HTTP \d{3}; corpo omitido\.$/.test(erro.message) ||
        erro.message === "Token de Actions ausente." ||
        erro.message === "Corpo esperado nao encontrado nas migrations fixas.";
      console.error(
        conhecida
          ? erro.message
          : "Verificacao falhou; detalhes omitidos para preservar credenciais.",
      );
      process.exitCode = 1;
    });
}

module.exports = {
  REF,
  ENDPOINT,
  CONSULTAS,
  hashesEsperados,
  avaliar,
  verificar,
};
