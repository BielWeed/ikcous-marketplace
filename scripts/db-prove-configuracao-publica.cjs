#!/usr/bin/env node
/**
 * PROVA de `store_config.{mp_public_key,vapid_public_key,pagamento_online,
 * manutencao}` + `v_store_config` + a trigger `dominio_publico_so_muda_pela_frota`
 * (agora cobrindo as 5 colunas) — T1, brief
 * equipe/entregas/20260911-brief-escala-etapa3-uma-publicacao-para-todas.md,
 * spec equipe/entregas/20260911-spec-escala-etapa3-uma-publicacao-para-todas.md
 * (bloco A + ADENDO A.4), 11/09/2026.
 *
 * NADA É GRAVADO: a migration 20261150000000 e o rollback-manual
 * correspondente são LIDOS DO DISCO e executados DENTRO de uma transação
 * desfeita com ROLLBACK no final — nada redigitado, nada aplicado de
 * verdade. Mesmo molde de scripts/db-prove-dominio-publico.cjs (a 20261140).
 *
 * DATABASE_URL vem SÓ do ambiente (injetada por com-env-main.cjs/
 * com-env-savy.cjs ou equivalente) — este script NUNCA lê `.env`.
 *
 * O QUE ELE PROVA, NA ORDEM:
 *   0. CONTROLE NEGATIVO (estado vivo de hoje, antes de qualquer migration):
 *      nenhuma das 4 colunas existe em `information_schema.columns` de
 *      `store_config` nem de `v_store_config` — se já existirem, a
 *      migration não é mais aditiva neste banco e a prova para (INCONCLUSIVO).
 *   1. Aplica a 20261150000000, lida do disco.
 *   2. `anon` (`SET LOCAL ROLE anon`) lê as 4 colunas novas pela view
 *      (dá null/null/false/false antes da semente) — é dali que o app lê a
 *      chave pública do MP/VAPID e as duas flags.
 *   3. `authenticated` com claims de um admin REAL do banco tenta
 *      `UPDATE store_config SET pagamento_online = true` DIRETO na tabela →
 *      espera 42501 `DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA` (a trigger de
 *      UPDATE agora cobre esta coluna).
 *   4. `upsert_store_config` (lista FECHADA de 27 colunas) com o payload de
 *      ATAQUE (as 4 colunas novas mandadas de propósito no JSON, achado do
 *      revisor Opus: um payload benigno sem essas chaves não prova nada —
 *      a prova tem de TENTAR e falhar) PASSA sem tocar nenhuma das 4
 *      colunas novas — MEDIDO (não assumido): compara mp_public_key/
 *      vapid_public_key/pagamento_online/manutencao de ANTES da chamada
 *      contra o JSONB (`to_jsonb(public.store_config.*)`) que a própria
 *      função devolve, lido DENTRO do savepoint de `sondar`, ANTES do
 *      `ROLLBACK TO SAVEPOINT` que desfaz a chamada — nunca por uma query
 *      separada DEPOIS de `sondar` retornar (a essa altura o savepoint já
 *      desfez qualquer escrita e a comparação não provaria nada; achado da
 *      rodada 1 de correção).
 *   5. Conexão direta (a hub, sem claims): `UPDATE store_config SET
 *      pagamento_online = true, mp_public_key = 'APP_USR-teste' WHERE id=1`
 *      PASSA — é assim que `semear-configuracao.cjs` grava de verdade.
 *   6. Aplica o rollback-manual da 20261150000000, lido do disco — as 4
 *      colunas somem de `store_config` E de `v_store_config`.
 *   7. `ROLLBACK` — nada do que rodou aqui fica gravado.
 *
 * Exit 0 = todas as afirmativas OK. Exit 1 = alguma afirmativa caiu. Exit 2 =
 * a prova NÃO chegou ao fim (pré-condição, ferramenta, OU erro de SQL ao
 * aplicar uma migration — a mensagem do Postgres sai no stdout; ler antes de
 * tratar como problema de ambiente).
 *
 * NÃO RODAR CONTRA BANCO POR ESTE AGENTE fora do que a tarefa autoriza — a
 * hub aplica de verdade (`db-apply`, fora desta prova).
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIG_DIR = path.join(PROJECT_ROOT, "supabase/migrations");

const NOSSA_MIGRATION = path.join(
  MIG_DIR,
  "20261150000000_a_loja_declara_a_sua_configuracao_publica.sql",
);
const NOSSO_ROLLBACK = path.join(
  MIG_DIR,
  "rollback-manual-20261150000000_a_loja_declara_a_sua_configuracao_publica.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error(
    "DATABASE_URL não encontrada no ambiente — rode com com-env-main.cjs/com-env-savy.cjs (nunca lendo .env).",
  );
}

function lerSql(caminho) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem sempre da lista fixa deste arquivo, sem entrada externa
  return fs.readFileSync(caminho, "utf8");
}

let falhas = 0;
function afirmar(descricao, condicao, extra = "") {
  if (condicao) {
    console.log(`  [OK   ] ${descricao}`);
  } else {
    falhas += 1;
    console.log(`  [FALHOU] ${descricao}${extra ? ` — ${extra}` : ""}`);
  }
}

function titulo(t) {
  console.log(`\n-- ${t}`);
}

/** Roda `sql` como `papel`, com `claims` opcionais, dentro de um SAVEPOINT
 * desfeito no `finally` — mesmo molde de scripts/db-prove-dominio-publico.cjs. */
async function sondar(client, papel, sql, params = [], claims = null) {
  await client.query("SAVEPOINT sonda");
  try {
    if (claims) {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    }
    await client.query(`SET LOCAL ROLE ${papel}`);
    try {
      const r = await client.query(sql, params);
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT sonda");
    await client.query("RESET ROLE").catch(() => {});
  }
}

async function colunaExiste(client, tabela, coluna) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [tabela, coluna],
  );
  return r.rows.length > 0;
}

async function achaAdminReal(client) {
  const r = await client.query(
    `SELECT id FROM auth.users WHERE raw_app_meta_data->>'role' = 'admin' LIMIT 1`,
  );
  return r.rows.length > 0 ? r.rows[0].id : null;
}

const COLUNAS_NOVAS = [
  "mp_public_key",
  "vapid_public_key",
  "pagamento_online",
  "manutencao",
];

async function rodar(rotulo) {
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();
  console.log(`\n===== ${rotulo} =====`);

  try {
    await client.query("BEGIN");

    // ---- 0. Controle negativo: estado vivo de hoje ------------------------
    titulo("0. Controle negativo (estado vivo, antes de qualquer migration)");
    for (const coluna of COLUNAS_NOVAS) {
      const naTabela = await colunaExiste(client, "store_config", coluna);
      afirmar(
        `store_config.${coluna} NÃO existe ainda (information_schema.columns)`,
        naTabela === false,
      );
      const naView = await colunaExiste(client, "v_store_config", coluna);
      afirmar(
        `v_store_config.${coluna} NÃO existe ainda (information_schema.columns)`,
        naView === false,
      );
      if (naTabela || naView) {
        throw new Error(
          `INCONCLUSIVO: ${coluna} já existe neste banco — a migration não é mais aditiva aqui, prova interrompida antes de aplicar.`,
        );
      }
    }

    // ---- 1. Aplica a 20261150000000, lida do disco -------------------------
    titulo("1. Aplicando a 20261150000000 (lida do disco)");
    await client.query(lerSql(NOSSA_MIGRATION));
    console.log(`  [OK   ] aplicada: ${path.basename(NOSSA_MIGRATION)}`);

    const valoresIniciais = await client.query(
      "SELECT mp_public_key, vapid_public_key, pagamento_online, manutencao FROM public.store_config WHERE id = 1",
    );
    console.log(
      `  valores logo após aplicar (esperado null/null/false/false): ${JSON.stringify(valoresIniciais.rows[0])}`,
    );
    afirmar(
      "as 4 colunas nascem com o default esperado (null, null, false, false)",
      valoresIniciais.rows[0]?.mp_public_key === null &&
        valoresIniciais.rows[0]?.vapid_public_key === null &&
        valoresIniciais.rows[0]?.pagamento_online === false &&
        valoresIniciais.rows[0]?.manutencao === false,
      JSON.stringify(valoresIniciais.rows[0]),
    );

    // ---- 2. Como anon (chave pública — o mesmo caminho do app/porteiro) ---
    titulo("2. Como anon (chave pública — o mesmo caminho do app/porteiro)");
    const anonLeDaView = await sondar(
      client,
      "anon",
      "SELECT mp_public_key, vapid_public_key, pagamento_online, manutencao FROM public.v_store_config",
    );
    afirmar(
      "anon LÊ as 4 colunas novas de v_store_config (é dali que o app lê a chave pública do MP/VAPID e as flags)",
      anonLeDaView.ok && anonLeDaView.rows.length === 1,
      JSON.stringify(anonLeDaView),
    );

    // ---- 3. Como authenticated, com claims de um admin REAL ---------------
    titulo(
      "3. Como authenticated, com claims de um admin REAL do banco (is_admin()) — a trigger de UPDATE agora cobre as 4 colunas novas",
    );
    const adminId = await achaAdminReal(client);
    if (!adminId) {
      throw new Error(
        "INCONCLUSIVO: nenhum auth.users com raw_app_meta_data->>'role'='admin' encontrado — pré-condição da prova não bateu.",
      );
    }
    console.log(`  admin encontrado: ${adminId}`);
    const claimsAdmin = {
      role: "authenticated",
      sub: adminId,
      app_metadata: { role: "admin" },
    };

    const pagamentoOnlineRecusado = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET pagamento_online = true WHERE id = 1",
      [],
      claimsAdmin,
    );
    afirmar(
      "authenticated (admin, direto na tabela) → 42501 ao tentar trocar pagamento_online",
      pagamentoOnlineRecusado.ok === false &&
        pagamentoOnlineRecusado.code === "42501",
      JSON.stringify(pagamentoOnlineRecusado),
    );

    const mpKeyRecusado = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET mp_public_key = 'APP_USR-vazamento' WHERE id = 1",
      [],
      claimsAdmin,
    );
    afirmar(
      "authenticated (admin, direto na tabela) → 42501 ao tentar trocar mp_public_key",
      mpKeyRecusado.ok === false && mpKeyRecusado.code === "42501",
      JSON.stringify(mpKeyRecusado),
    );

    // ---- 4. upsert_store_config NÃO toca as 4 colunas novas, NEM QUANDO O ---
    // ---- ATACANTE MANDA AS 4 CHAVES NO PAYLOAD (achado do revisor Opus: ----
    // ---- um payload benigno, sem essas chaves, não prova nada — a prova ----
    // ---- tem de TENTAR e falhar) --------------------------------------------
    titulo(
      "4. upsert_store_config (lista FECHADA de 27 colunas) com payload de ATAQUE (as 4 colunas novas no JSON) — não deve tocar nenhuma delas",
    );
    const antesDoUpsert = await client.query(
      "SELECT mp_public_key, vapid_public_key, pagamento_online, manutencao FROM public.store_config WHERE id = 1",
    );
    const payloadDeAtaque = JSON.stringify({
      store_name: "Prova T1 etapa 3",
      mp_public_key: "APP_USR-ATACANTE",
      vapid_public_key: "BATACANTE-vapid-key",
      pagamento_online: true,
      manutencao: true,
    });
    const upsertComAtaque = await sondar(
      client,
      "authenticated",
      "SELECT public.upsert_store_config($1) AS resultado",
      [payloadDeAtaque],
      claimsAdmin,
    );
    afirmar(
      "upsert_store_config com payload de ataque (store_name + as 4 colunas novas) executa sem erro",
      upsertComAtaque.ok === true,
      JSON.stringify(upsertComAtaque),
    );
    // "depois" MEDIDO DENTRO do savepoint que `sondar` desfaz: vem do JSONB
    // que a própria `upsert_store_config` devolve (`to_jsonb(public.
    // store_config.*)`, gerado ANTES do `ROLLBACK TO SAVEPOINT` no `finally`
    // de `sondar`) — nunca de uma query separada DEPOIS de `sondar`
    // retornar, porque nesse ponto o savepoint já desfez qualquer escrita e
    // a comparação nunca poderia falhar (achado da rodada 1: a foto
    // "depois" lia o mesmo estado da foto "antes", por construção). Mesmo
    // molde do passo 3 de scripts/db-prove-dominio-publico.cjs
    // (`dominioNoResultado`).
    const resultadoUpsert = upsertComAtaque.ok
      ? upsertComAtaque.rows[0]?.resultado
      : null;
    const depoisDoUpsertDentroDoSavepoint = resultadoUpsert && {
      mp_public_key: resultadoUpsert.mp_public_key,
      vapid_public_key: resultadoUpsert.vapid_public_key,
      pagamento_online: resultadoUpsert.pagamento_online,
      manutencao: resultadoUpsert.manutencao,
    };
    afirmar(
      "as 4 colunas novas continuam com o valor de ANTES do upsert MESMO com o ataque no payload (a função não as lista no INSERT nem no ON CONFLICT DO UPDATE) — medido no JSONB que o upsert devolveu, dentro do savepoint, antes do rollback",
      JSON.stringify(antesDoUpsert.rows[0]) ===
        JSON.stringify(depoisDoUpsertDentroDoSavepoint),
      `antes=${JSON.stringify(antesDoUpsert.rows[0])} depois(dentro do savepoint)=${JSON.stringify(depoisDoUpsertDentroDoSavepoint)}`,
    );
    afirmar(
      "só store_name muda (o campo que a função de fato lista) — o ataque nas outras 4 colunas foi ignorado, não recusado",
      resultadoUpsert?.store_name === "Prova T1 etapa 3",
      JSON.stringify(resultadoUpsert?.store_name),
    );

    // ---- 5. Conexão direta (a hub) GRAVA — é assim que a semente funciona --
    titulo(
      "5. Conexão direta (a hub, sem claims) grava as 4 colunas — é assim que semear-configuracao.cjs funciona",
    );
    const hubGrava = await client.query(
      `UPDATE public.store_config
          SET mp_public_key = 'APP_USR-teste-prova',
              vapid_public_key = 'Bteste-vapid-prova',
              pagamento_online = true,
              manutencao = false
        WHERE id = 1
        RETURNING mp_public_key, vapid_public_key, pagamento_online, manutencao`,
    );
    afirmar(
      "hub (sem claims) grava as 4 colunas de uma vez",
      hubGrava.rows[0]?.mp_public_key === "APP_USR-teste-prova" &&
        hubGrava.rows[0]?.vapid_public_key === "Bteste-vapid-prova" &&
        hubGrava.rows[0]?.pagamento_online === true &&
        hubGrava.rows[0]?.manutencao === false,
      JSON.stringify(hubGrava.rows[0]),
    );

    // ---- 6. Rollback da 20261150000000 --------------------------------------
    titulo("6. Rollback-manual da 20261150000000 (lido do disco)");
    await client.query(lerSql(NOSSO_ROLLBACK));
    for (const coluna of COLUNAS_NOVAS) {
      const naTabelaDepois = await colunaExiste(client, "store_config", coluna);
      const naViewDepois = await colunaExiste(client, "v_store_config", coluna);
      afirmar(
        `store_config.${coluna} SOME depois do rollback`,
        naTabelaDepois === false,
      );
      afirmar(
        `v_store_config.${coluna} SOME depois do rollback`,
        naViewDepois === false,
      );
    }
    const dominioPublicoSobrevive = await colunaExiste(
      client,
      "v_store_config",
      "dominio_publico",
    );
    afirmar(
      "v_store_config.dominio_publico continua existindo (o rollback desta migration não toca a 20261140)",
      dominioPublicoSobrevive === true,
    );
  } finally {
    // ---- 7. Nada fica gravado -----------------------------------------------
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    `\n${rotulo}: ${falhas === 0 ? "TODAS AS AFIRMATIVAS OK" : `${falhas} FALHA(S)`}`,
  );
}

(async () => {
  falhas = 0;
  await rodar(process.argv[2] || "banco");
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("INCONCLUSIVO:", e.message);
  process.exit(2);
});
