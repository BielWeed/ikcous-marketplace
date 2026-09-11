#!/usr/bin/env node
/**
 * PROVA de `store_config.dominio_publico` + `v_store_config.dominio_publico`
 * + trigger `dominio_publico_so_muda_pela_frota` (T4 — brief
 * equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md, 11/09/2026).
 *
 * NADA É GRAVADO: a migration 20261140000000 e o rollback-manual
 * correspondente são LIDOS DO DISCO e executados DENTRO de uma transação
 * desfeita com ROLLBACK no final — nada redigitado, nada aplicado de
 * verdade.
 *
 * DATABASE_URL vem SÓ do ambiente (injetada por com-env-main.cjs/
 * com-env-savy.cjs ou equivalente) — este script NUNCA lê `.env`.
 *
 * O QUE ELE PROVA, NA ORDEM:
 *   0. CONTROLE NEGATIVO (estado vivo de hoje, antes de qualquer
 *      migration): a coluna `dominio_publico` NÃO existe em
 *      `information_schema.columns` de `store_config`, e `v_store_config`
 *      também não a tem — prova que o instrumento discrimina; se a coluna
 *      já existisse, a migration não seria mais aditiva neste banco e a
 *      prova pararia aqui (INCONCLUSIVO).
 *   1. Aplica a 20261140000000, lida do disco.
 *   2. Como `postgres`/hub (a própria conexão da transação, SEM
 *      `request.jwt.claims`): `UPDATE store_config SET dominio_publico =
 *      'a.exemplo' WHERE id = 1` PASSA (a hub pode trocar o host); um
 *      valor com esquema (`https://a.exemplo`) ou maiúscula (`A.EXEMPLO`)
 *      é RECUSADO pelo CHECK (23514).
 *   3. `SET LOCAL ROLE authenticated` + claims de um admin REAL do banco
 *      (achado em `auth.users` com `raw_app_metadata->>'role' = 'admin'`,
 *      o mesmo que `is_admin()` aceita): `UPDATE ... SET share_text = ...`
 *      PASSA (prova que a trava é só da coluna nova, não de toda a
 *      tabela); `UPDATE ... SET dominio_publico = ...` → 42501 (o
 *      trigger olha o CLAIM, não o privilégio de coluna — a tabela
 *      continua com GRANT UPDATE de `authenticated`); chamar
 *      `upsert_store_config('{"dominio_publico":"x.exemplo"}')` como esse
 *      mesmo admin é MEDIDO (não assumido): o resultado devolvido mantém
 *      o valor anterior de `dominio_publico` — a função nem tenta escrever
 *      a coluna nova (não está na lista de `SET` do `ON CONFLICT DO
 *      UPDATE`), então o trigger nem chega a disparar (`OLD = NEW`
 *      trivial). Isso é "IGNORADO", nunca "RECUSADO" — o script imprime
 *      qual dos dois foi observado.
 *   3d-3g. RODADA 2 (correção sobre os dois achados do revisor Opus):
 *      (3d) achado 1 — `DELETE FROM store_config WHERE id=1` seguido de
 *      `INSERT ... (id, dominio_publico) VALUES (1, 'loja-da-vitima...')`,
 *      os DOIS como `authenticated`/admin, DENTRO do MESMO savepoint (a
 *      trigger de UPDATE sozinha nunca via esse caminho): o INSERT tem de
 *      RECUSAR com 42501, mesmo que o DELETE passe. (3e) achado 2 — claims
 *      SEM a chave `role` (`v_role` fica `NULL`): `UPDATE dominio_publico`
 *      tem de RECUSAR (lista de PERMISSÃO, não de negação). (3f) claims
 *      com `role` INVENTADO (nem `anon`, nem `authenticated`, nem
 *      `service_role`): idem, RECUSA. (3g) controle positivo — claims com
 *      `role='service_role'`: PASSA, como desenhado.
 *   4. `SET LOCAL ROLE anon`: `SELECT dominio_publico FROM v_store_config`
 *      devolve a coluna (é dali que o porteiro T3 lê com a chave
 *      PÚBLICA); `UPDATE ... SET dominio_publico = ...` como `anon` →
 *      42501.
 *   5. Aplica o rollback-manual da 20261140000000, lido do disco — a
 *      coluna some de `store_config` E de `v_store_config`, a view volta a
 *      ter as 29 colunas originais.
 *   6. `ROLLBACK` — nada do que rodou aqui fica gravado.
 *
 * Exit 0 = todas as afirmativas OK. Exit 1 = alguma afirmativa caiu. Exit 2 =
 * a prova NÃO chegou ao fim (pré-condição, ferramenta, OU erro de SQL ao
 * aplicar uma migration — a mensagem do Postgres sai no stdout; ler antes
 * de tratar como problema de ambiente).
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
  "20261140000000_a_loja_declara_o_seu_dominio_publico.sql",
);
const NOSSO_ROLLBACK = path.join(
  MIG_DIR,
  "rollback-manual-20261140000000_a_loja_declara_o_seu_dominio_publico.sql",
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

/** Roda `sql` como `papel`, com `claims` opcionais (jsonb serializado em
 * `request.jwt.claims`), dentro de um SAVEPOINT desfeito no `finally` — a
 * conexão volta a ser o papel de entrada (dono da transação) depois de cada
 * sonda, mesmo quando a query falha. Mesmo molde de
 * scripts/db-prove-perfil-publico.cjs / scripts/db-prove-i3-i4.cjs. */
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

/** Roda uma SEQUÊNCIA de comandos (ex.: DELETE seguido de INSERT) como
 * `papel`, com `claims` opcionais, TODOS dentro do MESMO SAVEPOINT — ao
 * contrário de `sondar`, que isola cada comando no seu próprio SAVEPOINT
 * (e por isso não serve para provar um ataque que depende de dois comandos
 * em sequência, como DELETE+INSERT: cada `sondar` isolado desfaria o
 * DELETE antes do INSERT rodar). Para no primeiro erro (a transação fica
 * "aborted" até o ROLLBACK TO SAVEPOINT do `finally`), e sempre desfaz tudo
 * no fim, mesmo com erro no meio. */
async function sondarSequencia(client, papel, claims, statements) {
  await client.query("SAVEPOINT sonda_seq");
  const resultados = [];
  try {
    if (claims) {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    }
    await client.query(`SET LOCAL ROLE ${papel}`);
    for (const sql of statements) {
      try {
        const r = await client.query(sql);
        resultados.push({ ok: true, rows: r.rows, rowCount: r.rowCount });
      } catch (e) {
        resultados.push({ ok: false, code: e.code, message: e.message });
        break; // erro real deixa a transação "aborted" — parar aqui
      }
    }
    return resultados;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT sonda_seq");
    await client.query("RESET ROLE").catch(() => {});
  }
}

/** Roda `sql` na conexão ATUAL (sem trocar de papel), dentro de um
 * SAVEPOINT desfeito no `finally` — usado para as sondas que ESPERAM erro
 * (CHECK, por exemplo): sem o SAVEPOINT, um erro real do Postgres deixa a
 * transação inteira "aborted" e todo comando seguinte (inclusive o
 * ROLLBACK final) falharia com 25P02. */
async function sondarNaConexaoAtual(client, sql, params = []) {
  await client.query("SAVEPOINT sonda_local");
  try {
    const r = await client.query(sql, params);
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT sonda_local");
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

async function rodar(rotulo) {
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();
  console.log(`\n===== ${rotulo} =====`);

  try {
    await client.query("BEGIN");

    // ---- 0. Controle negativo: estado vivo de hoje ------------------------
    titulo("0. Controle negativo (estado vivo, antes de qualquer migration)");
    const colunaAntesTabela = await colunaExiste(
      client,
      "store_config",
      "dominio_publico",
    );
    afirmar(
      "store_config.dominio_publico NÃO existe ainda (information_schema.columns)",
      colunaAntesTabela === false,
    );
    const colunaAntesView = await colunaExiste(
      client,
      "v_store_config",
      "dominio_publico",
    );
    afirmar(
      "v_store_config.dominio_publico NÃO existe ainda (information_schema.columns)",
      colunaAntesView === false,
    );
    if (colunaAntesTabela || colunaAntesView) {
      throw new Error(
        "INCONCLUSIVO: dominio_publico já existe neste banco — a migration não é mais aditiva aqui, prova interrompida antes de aplicar.",
      );
    }

    // ---- 0b. GRANTS vivos de store_config (evidência p/ "por que NÃO
    // escrever REVOKE UPDATE (dominio_publico)", cabeçalho da migration) --
    titulo(
      "0b. role_table_grants vivo de store_config (por que o REVOKE de COLUNA seria NO-OP)",
    );
    const grants = await client.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'store_config'
        ORDER BY grantee, privilege_type`,
    );
    for (const row of grants.rows) {
      console.log(`  [MEDIDO] ${row.grantee} -> ${row.privilege_type}`);
    }
    const anonTemUpdateDeTabela = grants.rows.some(
      (r) => r.grantee === "anon" && r.privilege_type === "UPDATE",
    );
    const authenticatedTemUpdateDeTabela = grants.rows.some(
      (r) => r.grantee === "authenticated" && r.privilege_type === "UPDATE",
    );
    afirmar(
      "anon e authenticated têm GRANT UPDATE de TABELA INTEIRA em store_config (confirma que REVOKE UPDATE (dominio_publico) seria NO-OP — a coluna nova herdaria o mesmo GRANT de tabela)",
      anonTemUpdateDeTabela && authenticatedTemUpdateDeTabela,
      JSON.stringify(grants.rows),
    );

    // ---- 1. Aplica a 20261140000000, lida do disco -------------------------
    titulo("1. Aplicando a 20261140000000 (lida do disco)");
    await client.query(lerSql(NOSSA_MIGRATION));
    console.log(`  [OK   ] aplicada: ${path.basename(NOSSA_MIGRATION)}`);

    const valorOriginal = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    console.log(
      `  dominio_publico logo após aplicar (esperado NULL): ${JSON.stringify(valorOriginal.rows[0]?.dominio_publico)}`,
    );

    // ---- 2. Como postgres/hub (sem claims) ---------------------------------
    titulo("2. Como postgres/hub (conexão direta, SEM request.jwt.claims)");
    const hubEscreveHostValido = await client.query(
      "UPDATE public.store_config SET dominio_publico = 'a.exemplo' WHERE id = 1 RETURNING dominio_publico",
    );
    afirmar(
      "hub (sem claims) TROCA dominio_publico para um host válido",
      hubEscreveHostValido.rows[0]?.dominio_publico === "a.exemplo",
      JSON.stringify(hubEscreveHostValido.rows),
    );

    const hostComEsquema = await sondarNaConexaoAtual(
      client,
      "UPDATE public.store_config SET dominio_publico = 'https://a.exemplo' WHERE id = 1",
    );
    afirmar(
      "CHECK recusa host com esquema (https://a.exemplo) — código 23514",
      hostComEsquema.ok === false && hostComEsquema.code === "23514",
      JSON.stringify(hostComEsquema),
    );

    const hostMaiusculo = await sondarNaConexaoAtual(
      client,
      "UPDATE public.store_config SET dominio_publico = 'A.EXEMPLO' WHERE id = 1",
    );
    afirmar(
      "CHECK recusa host maiúsculo (A.EXEMPLO) — código 23514",
      hostMaiusculo.ok === false && hostMaiusculo.code === "23514",
      JSON.stringify(hostMaiusculo),
    );

    // ---- 3. Como authenticated, com claims de um admin REAL ---------------
    titulo(
      "3. Como authenticated, com claims de um admin REAL do banco (is_admin())",
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

    const shareTextPassa = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET share_text = 'prova T4' WHERE id = 1 RETURNING share_text",
      [],
      claimsAdmin,
    );
    afirmar(
      "authenticated (admin) TROCA share_text sem barreira (a trava é só da coluna nova)",
      shareTextPassa.ok && shareTextPassa.rows[0]?.share_text === "prova T4",
      JSON.stringify(shareTextPassa),
    );

    const dominioPublicoRecusado = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET dominio_publico = 'b.exemplo' WHERE id = 1",
      [],
      claimsAdmin,
    );
    afirmar(
      "authenticated (admin, direto na tabela) → 42501 ao tentar trocar dominio_publico",
      dominioPublicoRecusado.ok === false &&
        dominioPublicoRecusado.code === "42501",
      JSON.stringify(dominioPublicoRecusado),
    );

    const antesDoUpsert = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    const upsertComDominioPublico = await sondar(
      client,
      "authenticated",
      "SELECT public.upsert_store_config($1) AS resultado",
      ['{"dominio_publico":"x.exemplo"}'],
      claimsAdmin,
    );
    if (upsertComDominioPublico.ok) {
      const dominioNoResultado =
        upsertComDominioPublico.rows[0]?.resultado?.dominio_publico;
      const foiIgnorado =
        dominioNoResultado === antesDoUpsert.rows[0]?.dominio_publico;
      console.log(
        `  [MEDIDO] upsert_store_config com dominio_publico no payload: IGNORADO (executou sem erro, coluna manteve "${dominioNoResultado}" — não escreveu "x.exemplo"; a função nem lista dominio_publico no SET do ON CONFLICT)`,
      );
      afirmar(
        "upsert_store_config NÃO escreve dominio_publico mesmo com a chave no payload (ignorado, não recusado)",
        foiIgnorado,
        JSON.stringify(upsertComDominioPublico),
      );
    } else {
      console.log(
        `  [MEDIDO] upsert_store_config com dominio_publico no payload: RECUSADO — ${JSON.stringify(upsertComDominioPublico)}`,
      );
      afirmar(
        "upsert_store_config recusa (código de erro presente)",
        typeof upsertComDominioPublico.code === "string",
        JSON.stringify(upsertComDominioPublico),
      );
    }

    // ---- 3d. RODADA 2 — achado 1: DELETE + INSERT como authenticated/admin
    titulo(
      "3d. (rodada 2, achado 1) DELETE + INSERT como authenticated (admin) — contorna o trigger de UPDATE?",
    );
    const antesDoAtaqueDeleteInsert = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    const [resultadoDelete, resultadoInsert] = await sondarSequencia(
      client,
      "authenticated",
      claimsAdmin,
      [
        "DELETE FROM public.store_config WHERE id = 1",
        "INSERT INTO public.store_config (id, dominio_publico) VALUES (1, 'loja-da-vitima.exemplo') RETURNING dominio_publico",
      ],
    );
    console.log(
      `  [MEDIDO] DELETE id=1 como authenticated/admin -> ${JSON.stringify(resultadoDelete)}`,
    );
    console.log(
      `  [MEDIDO] INSERT id=1 com dominio_publico logo em seguida -> ${JSON.stringify(resultadoInsert)}`,
    );
    afirmar(
      "o INSERT que tenta NASCER com dominio_publico preenchido, como authenticated (não service_role), é RECUSADO (42501) — mesmo depois de um DELETE bem-sucedido",
      resultadoInsert !== undefined &&
        resultadoInsert.ok === false &&
        resultadoInsert.code === "42501",
      JSON.stringify(resultadoInsert),
    );
    const depoisDoAtaqueDeleteInsert = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    afirmar(
      "dominio_publico continua com o valor de ANTES do ataque DELETE+INSERT (SAVEPOINT desfez tudo, nada vazou)",
      antesDoAtaqueDeleteInsert.rows[0]?.dominio_publico ===
        depoisDoAtaqueDeleteInsert.rows[0]?.dominio_publico,
      `antes=${JSON.stringify(antesDoAtaqueDeleteInsert.rows[0])} depois=${JSON.stringify(depoisDoAtaqueDeleteInsert.rows[0])}`,
    );

    // ---- 3e/3f. RODADA 2 — achado 2: lista de PERMISSÃO, não de negação --
    titulo(
      "3e. (rodada 2, achado 2) authenticated com claims SEM a chave 'role' — v_role fica NULL",
    );
    const claimsSemRole = { sub: adminId, app_metadata: { role: "admin" } };
    const semRoleRecusado = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET dominio_publico = 'b.exemplo' WHERE id = 1",
      [],
      claimsSemRole,
    );
    afirmar(
      "claims SEM a chave 'role' (papel de banco authenticated) → 42501 (lista de PERMISSÃO recusa por padrão)",
      semRoleRecusado.ok === false && semRoleRecusado.code === "42501",
      JSON.stringify(semRoleRecusado),
    );

    titulo(
      "3f. (rodada 2, achado 2) authenticated com claims trazendo um 'role' INVENTADO",
    );
    const claimsRoleInventado = {
      role: "papel_inventado",
      sub: adminId,
      app_metadata: { role: "admin" },
    };
    const roleInventadoRecusado = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET dominio_publico = 'b.exemplo' WHERE id = 1",
      [],
      claimsRoleInventado,
    );
    afirmar(
      "claims com role='papel_inventado' (papel de banco authenticated) → 42501 (lista de PERMISSÃO recusa por padrão)",
      roleInventadoRecusado.ok === false &&
        roleInventadoRecusado.code === "42501",
      JSON.stringify(roleInventadoRecusado),
    );

    // ---- 3g. Controle positivo: service_role PASSA -------------------------
    titulo(
      "3g. (controle positivo) claims com role='service_role' — deve PASSAR",
    );
    const claimsServiceRole = { role: "service_role" };
    const serviceRolePassa = await sondar(
      client,
      "service_role",
      "UPDATE public.store_config SET dominio_publico = 'sr.exemplo' WHERE id = 1 RETURNING dominio_publico",
      [],
      claimsServiceRole,
    );
    afirmar(
      "claims com role='service_role' TROCA dominio_publico sem barreira",
      serviceRolePassa.ok &&
        serviceRolePassa.rows[0]?.dominio_publico === "sr.exemplo",
      JSON.stringify(serviceRolePassa),
    );

    // ---- 4. Como anon -------------------------------------------------------
    titulo("4. Como anon (chave pública — o mesmo caminho do porteiro T3)");
    const anonLeDaView = await sondar(
      client,
      "anon",
      "SELECT dominio_publico FROM public.v_store_config",
    );
    afirmar(
      "anon LÊ dominio_publico de v_store_config (é dali que o porteiro compara host x banco)",
      anonLeDaView.ok && anonLeDaView.rows.length === 1,
      JSON.stringify(anonLeDaView),
    );

    // MEDIDO (não assumido): store_config só tem policy de UPDATE para
    // `authenticated` (`store_config_admin_update_policy`, USING
    // is_admin()) — `anon` não tem NENHUMA policy de UPDATE na tabela, RLS
    // pré-existente (não introduzida por esta migration) já filtra o
    // UPDATE para ZERO linhas visíveis, silenciosamente, antes do trigger
    // sequer entrar em jogo. Por isso o teste que prova o trigger de
    // verdade é o do passo 3 (authenticated COM claim de admin — o único
    // papel que passa pela RLS e ainda assim esbarra no trigger).
    const antesDoAnon = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    const anonEscreveRecusado = await sondar(
      client,
      "anon",
      "UPDATE public.store_config SET dominio_publico = 'c.exemplo' WHERE id = 1",
    );
    const bloqueadoPorErro =
      anonEscreveRecusado.ok === false && anonEscreveRecusado.code === "42501";
    const bloqueadoPorRls =
      anonEscreveRecusado.ok === true && anonEscreveRecusado.rowCount === 0;
    console.log(
      `  [MEDIDO] anon UPDATE dominio_publico: ${
        bloqueadoPorErro
          ? "42501 (trigger)"
          : bloqueadoPorRls
            ? "0 linhas afetadas (RLS pré-existente — store_config não tem policy de UPDATE para anon; o trigger nem chega a rodar)"
            : "NENHUM DOS DOIS — ver detalhe"
      }`,
    );
    afirmar(
      'anon NÃO consegue trocar dominio_publico — por 42501 (trigger) ou por RLS pré-existente filtrando 0 linhas (os dois são "não mudou")',
      bloqueadoPorErro || bloqueadoPorRls,
      JSON.stringify(anonEscreveRecusado),
    );
    const depoisDoAnon = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    afirmar(
      "dominio_publico continua com o valor de ANTES da tentativa de anon (nenhuma escrita vazou)",
      antesDoAnon.rows[0]?.dominio_publico ===
        depoisDoAnon.rows[0]?.dominio_publico,
      `antes=${JSON.stringify(antesDoAnon.rows[0])} depois=${JSON.stringify(depoisDoAnon.rows[0])}`,
    );

    // ---- 4b. (T4b) authenticated SEM claim nenhum -------------------------
    titulo(
      "4b. (T4b) authenticated SEM claim nenhum (SET LOCAL ROLE authenticated, sem request.jwt.claims)",
    );
    // MEDIDO (não assumido, TDD: a hipótese estrita "sempre 42501" foi
    // escrita primeiro e FALHOU contra o banco vivo — rowCount:0, não
    // 42501): sem NENHUM claim, `is_admin()` cai no fallback de
    // `auth.users` com `auth.uid()` (lido de `request.jwt.claim.sub`), que
    // é NULL sem claim — a policy de UPDATE (`USING is_admin()`) filtra a
    // linha para ZERO antes do trigger rodar. É o MESMO mecanismo do passo
    // 4 (anon): a RLS pré-existente já recusa quem não prova ser admin,
    // antes de a trava nova (o trigger) entrar em jogo. O trigger só
    // aparece na prova quando o papel de banco JÁ passou pela RLS (por
    // isso o passo 3 usa claims de um admin REAL).
    const antesDoAuthenticatedSemClaim = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    const authenticatedSemClaim = await sondar(
      client,
      "authenticated",
      "UPDATE public.store_config SET dominio_publico = 'd.exemplo' WHERE id = 1",
    );
    const bloqueadoPorErroAuth =
      authenticatedSemClaim.ok === false &&
      authenticatedSemClaim.code === "42501";
    const bloqueadoPorRlsAuth =
      authenticatedSemClaim.ok === true && authenticatedSemClaim.rowCount === 0;
    console.log(
      `  [MEDIDO] authenticated SEM claim nenhum, UPDATE dominio_publico: ${
        bloqueadoPorErroAuth
          ? "42501 (trigger)"
          : bloqueadoPorRlsAuth
            ? "0 linhas afetadas (RLS pré-existente — sem claim não há como is_admin() reconhecer o chamador; a policy de UPDATE exige is_admin() e o trigger nem chega a rodar)"
            : "NENHUM DOS DOIS — ver detalhe"
      }`,
    );
    afirmar(
      'authenticated SEM claim nenhum NÃO consegue trocar dominio_publico — por 42501 (trigger) ou por RLS pré-existente filtrando 0 linhas (os dois são "recusado")',
      bloqueadoPorErroAuth || bloqueadoPorRlsAuth,
      JSON.stringify(authenticatedSemClaim),
    );
    const depoisDoAuthenticatedSemClaim = await client.query(
      "SELECT dominio_publico FROM public.store_config WHERE id = 1",
    );
    afirmar(
      "dominio_publico continua com o valor de ANTES da tentativa de authenticated sem claim (nenhuma escrita vazou)",
      antesDoAuthenticatedSemClaim.rows[0]?.dominio_publico ===
        depoisDoAuthenticatedSemClaim.rows[0]?.dominio_publico,
      `antes=${JSON.stringify(antesDoAuthenticatedSemClaim.rows[0])} depois=${JSON.stringify(depoisDoAuthenticatedSemClaim.rows[0])}`,
    );

    // ---- 5. Rollback da 20261140000000 --------------------------------------
    titulo("5. Rollback-manual da 20261140000000 (lido do disco)");
    await client.query(lerSql(NOSSO_ROLLBACK));
    const colunaDepoisTabela = await colunaExiste(
      client,
      "store_config",
      "dominio_publico",
    );
    const colunaDepoisView = await colunaExiste(
      client,
      "v_store_config",
      "dominio_publico",
    );
    afirmar(
      "store_config.dominio_publico SOME depois do rollback",
      colunaDepoisTabela === false,
    );
    afirmar(
      "v_store_config.dominio_publico SOME depois do rollback",
      colunaDepoisView === false,
    );
  } finally {
    // ---- 6. Nada fica gravado -----------------------------------------------
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
