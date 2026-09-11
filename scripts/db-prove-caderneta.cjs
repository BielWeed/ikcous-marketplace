#!/usr/bin/env node
/**
 * PROVA de `frota_lojas`/`frota_segredo`/`resolver_loja` (T5 — brief
 * equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md).
 *
 * NADA É GRAVADO: a migration 20261141000000 e o rollback-manual
 * correspondente são LIDOS DO DISCO e executados DENTRO de uma transação
 * desfeita com ROLLBACK no final — nada redigitado, nada aplicado de
 * verdade.
 *
 * DATABASE_URL vem SÓ do ambiente (injetada por com-env-main.cjs/
 * com-env-savy.cjs ou equivalente) — este script NUNCA lê `.env`.
 *
 * O QUE ELE PROVA, NA ORDEM:
 *   0. CONTROLE NEGATIVO: `frota_lojas`, `frota_segredo` e `resolver_loja`
 *      NÃO existem no banco vivo (antes de qualquer migration) — prova que
 *      o instrumento discrimina; se isto já desse "existem", a suíte
 *      inteira seria vácuo.
 *   1. Aplica a 20261141000000, lida do disco.
 *   2. Fixture DENTRO da transação: um segredo de teste (hash via
 *      `extensions.crypt(..., extensions.gen_salt('bf', CUSTO_BF))`) e DUAS
 *      lojas de brinquedo — `prova-a` (ativa, host `a.exemplo`) e
 *      `prova-b-inativa` (`ativa = false`, host `b.exemplo`).
 *   2.5. Latência: baseline de `SELECT 1` (sem bcrypt, N=5) e N=20
 *      chamadas de `resolver_loja` com CHAVE ERRADA (pior caso — sempre
 *      computa o `crypt()` inteiro). O round-trip desta máquina até o
 *      pooler já passa de 150 ms SOZINHO (achado da rodada B, T5b) — por
 *      isso a afirmativa compara o DELTA (máximo bruto − baseline mínimo,
 *      que isola o custo do `gen_salt('bf', CUSTO_BF)` da rede) contra o
 *      alvo de 150 ms, não o número bruto. O mesmo `CUSTO_BF` vai para o
 *      cabeçalho da migration como convenção de seed da hub.
 *   3. Como `anon`: SELECT direto em `frota_lojas` → 42501 (achado
 *      confirmado no banco vivo: `ALTER DEFAULT PRIVILEGES` do schema
 *      `public` concederia SELECT de graça sem o REVOKE explícito da
 *      migration — é ISSO que esta afirmativa prova que está fechado);
 *      `resolver_loja('a.exemplo', 'errado')` → 0 linhas SEM ERRO (sem
 *      oráculo); `resolver_loja('a.exemplo', segredo)` → 1 linha, é
 *      `prova-a`; `resolver_loja('A.EXEMPLO', segredo)` → 1 linha (mesma
 *      loja — comparação case-insensitive); `resolver_loja('b.exemplo',
 *      segredo)` → 0 linhas (loja inativa, mesmo com a chave certa);
 *      `resolver_loja` tem EXECUTE para `anon`, NÃO tem para `PUBLIC`.
 *   4. Como `authenticated`: `resolver_loja(...)` → 42501 (sem EXECUTE —
 *      só `anon` chama esta RPC); `resolver_loja` NÃO tem EXECUTE para
 *      `authenticated` nem para `service_role` (nunca service_role no
 *      porteiro).
 *   5. Aplica o rollback-manual, lido do disco — as duas tabelas e a
 *      função somem.
 *   6. `ROLLBACK` — nada do que rodou aqui fica gravado.
 *
 * Exit 0 = todas as afirmativas OK. Exit 1 = alguma afirmativa caiu. Exit 2
 * = a prova NÃO chegou ao fim (pré-condição, ferramenta, OU erro de SQL ao
 * aplicar uma migration — a mensagem do Postgres sai no stdout; ler antes
 * de tratar como problema de ambiente).
 *
 * NÃO RODAR db-apply POR ESTE AGENTE (trava da bancada) — a hub aplica de
 * verdade. Este script só abre transação e faz ROLLBACK.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIG_DIR = path.join(PROJECT_ROOT, "supabase/migrations");

const NOSSA_MIGRATION = path.join(
  MIG_DIR,
  "20261141000000_caderneta_da_frota.sql",
);
const NOSSO_ROLLBACK = path.join(
  MIG_DIR,
  "rollback-manual-20261141000000_caderneta_da_frota.sql",
);

// Custo do hash bcrypt (`gen_salt('bf', <custo>)`) usado para gerar o hash
// de `frota_segredo` — decisão da rodada B (T5b, 11/09/2026): a migration
// não semeia o segredo (a hub faz isso fora da migration), então o custo
// explícito é decidido e documentado AQUI, medindo a latência real de
// `resolver_loja` contra o banco vivo com o segredo já fixado neste custo,
// e o mesmo número é copiado para o cabeçalho da migration.
//
// A JUSTIFICATIVA VERDADEIRA (corrigida na rodada C, T5c — a anterior dizia
// "o default é fácil de atacar", o que não é o risco real aqui): o segredo
// que este hash protege NÃO é a senha de uma pessoa — é uma string de 32
// bytes aleatórios gerada pela hub (ver cabeçalho da migration, seção
// "CONVENÇÃO DE CHAMADA"/"DADOS EXISTENTES"). Um segredo com essa entropia
// não sofre força bruta por dicionário nem por busca exaustiva em tempo
// viável, com QUALQUER custo de bcrypt, inclusive o default (6). O custo
// escolhido aqui (10) não existe para "dificultar o ataque" — existe para
// não deixar `resolver_loja` (chamada em TODA primeira abertura de página
// pelo porteiro, T3b) lenta: é o maior custo que, medido na rodada B contra
// o banco vivo da principal, manteve o DELTA (latência isolada do bcrypt,
// separada do round-trip de rede — ver seção "2.5" abaixo) abaixo do alvo
// de 150ms — medido em 80–82ms nas duas rodadas de 11/09/2026 (colado no
// relatório da tarefa T5b e no cabeçalho da migration).
const CUSTO_BF = 10;
const N_MEDICAO_LATENCIA = 20;
const LIMITE_MS_LATENCIA = 150;

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

/** Roda `sql` como `papel`, dentro de um SAVEPOINT desfeito no `finally` —
 * a conexão volta a ser o papel de entrada (dono da transação) depois de
 * cada sonda, mesmo quando a query falha. Mesmo molde de
 * scripts/db-prove-perfil-publico.cjs / scripts/db-prove-i3-i4.cjs. */
async function sondar(client, papel, sql, params = []) {
  await client.query("SAVEPOINT sonda");
  try {
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

async function existemObjetos(client) {
  const t = await client.query(
    `SELECT c.relname AS nome
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('frota_lojas', 'frota_segredo')`,
  );
  const f = await client.query(
    `SELECT p.proname AS nome
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'resolver_loja'`,
  );
  return {
    tabelas: new Set(t.rows.map((row) => row.nome)),
    funcoes: new Set(f.rows.map((row) => row.nome)),
  };
}

async function podeExecutar(client, papel, assinatura) {
  const r = await client.query(
    "SELECT has_function_privilege($1, $2, 'EXECUTE') AS pode",
    [papel, assinatura],
  );
  return r.rows[0].pode;
}

async function temGrantDeTabela(client, papel, tabela) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = $1 AND grantee = $2`,
    [tabela, papel],
  );
  return r.rows.length > 0;
}

async function temGrantDeRotina(client, papel, nomeFuncao) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.role_routine_grants
      WHERE routine_schema = 'public' AND routine_name = $1
        AND grantee = $2 AND privilege_type = 'EXECUTE'`,
    [nomeFuncao, papel],
  );
  return r.rows.length > 0;
}

async function rodar(rotulo) {
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();
  console.log(`\n===== ${rotulo} =====`);

  try {
    await client.query("BEGIN");

    // ---- 0. Controle negativo ----------------------------------------------
    titulo("0. Controle negativo (estado vivo de hoje, antes da migration)");
    const antes = await existemObjetos(client);
    afirmar(
      "frota_lojas e frota_segredo NÃO existem ainda",
      antes.tabelas.size === 0,
      `encontradas: ${[...antes.tabelas].join(",") || "(nenhuma)"}`,
    );
    afirmar(
      "resolver_loja NÃO existe ainda",
      antes.funcoes.size === 0,
      `encontradas: ${[...antes.funcoes].join(",") || "(nenhuma)"}`,
    );

    // ---- 1. Aplica a migration, lida do disco ------------------------------
    titulo("1. Aplicando a 20261141000000 (lida do disco)");
    await client.query(lerSql(NOSSA_MIGRATION));
    console.log(`  [OK   ] aplicada: ${path.basename(NOSSA_MIGRATION)}`);

    const depoisDaMigration = await existemObjetos(client);
    afirmar(
      "frota_lojas, frota_segredo e resolver_loja existem depois de aplicar",
      depoisDaMigration.tabelas.size === 2 &&
        depoisDaMigration.funcoes.size === 1,
      JSON.stringify({
        tabelas: [...depoisDaMigration.tabelas],
        funcoes: [...depoisDaMigration.funcoes],
      }),
    );

    // Achado da revisão 11/09/2026 (rodada 2): resolver_loja tem de ser
    // VOLATILE, nunca STABLE/IMMUTABLE. CORRECAO da hub (11/09, medido): a
    // volatilidade NAO fecha o GET (respondeu 200); ela so faz o GET rodar
    // READ ONLY. Quem impede p_chave na URL e o POST do chamador. Medir no objeto REAL, nao so
    // no texto do arquivo.
    const volatilidade = await client.query(
      `SELECT p.provolatile
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'resolver_loja'`,
    );
    afirmar(
      "resolver_loja: provolatile = 'v' (VOLATILE) — GET roda READ ONLY, NAO e recusado (medido 200 em 11/09; a trava e o POST do chamador)",
      volatilidade.rows[0]?.provolatile === "v",
      JSON.stringify(volatilidade.rows[0]),
    );

    // ---- 2. Fixture DENTRO da transação -------------------------------------
    titulo(
      "2. Fixture — segredo de teste + 2 lojas de brinquedo (prova-a ativa, prova-b-inativa inativa)",
    );
    const SEGREDO = `prova-t5-${Date.now()}`;
    await client.query(
      `INSERT INTO public.frota_lojas
         (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa)
       VALUES
         ('prova-a', 'Prova A', 'a.exemplo', 'refprovaaaaaaaaaaaaa', 'https://refprovaaaaaaaaaaaaa.supabase.co', 'chave-publica-a', true),
         ('prova-b-inativa', 'Prova B (inativa)', 'b.exemplo', 'refprovabbbbbbbbbbbb', 'https://refprovabbbbbbbbbbbb.supabase.co', 'chave-publica-b', false)`,
    );
    await client.query(
      `INSERT INTO public.frota_segredo (id, hash)
       VALUES (1, extensions.crypt($1, extensions.gen_salt('bf', ${CUSTO_BF})))`,
      [SEGREDO],
    );
    console.log(
      `  [OK   ] fixture inserida: prova-a (ativa, a.exemplo), prova-b-inativa (inativa, b.exemplo), segredo de teste (hash bf, custo ${CUSTO_BF})`,
    );

    // ---- 2.5. Latência: baseline de rede + N chamadas com chave ERRADA -----
    // Achado desta medição (11/09/2026, T5b): o round-trip DESTA máquina de
    // desenvolvimento até o pooler da Supabase, sozinho, já passa de 900ms
    // (ver baseline abaixo) — MAIOR que o alvo de 150ms do brief, antes de
    // qualquer bcrypt. `sondar()` soma 5 idas-e-voltas por chamada
    // (SAVEPOINT, SET LOCAL ROLE, a query, ROLLBACK TO SAVEPOINT, RESET
    // ROLE), e é essa cadeia — não o cálculo do hash — que domina o número
    // bruto. Por isso a afirmativa de latência usa o DELTA (resolver_loja
    // MENOS o baseline sem bcrypt): é o único número que `CUSTO_BF` controla,
    // e o que decide se o porteiro (rodando na borda, perto do banco — RTT
    // bem menor que o desta máquina) fica lento por causa do gen_salt
    // escolhido. O número BRUTO continua impresso, sem filtro, para quem for
    // conferir — ver a divergência registrada no relatório da tarefa T5b.
    titulo("2.5a. Baseline de rede (SELECT 1 via anon, sem bcrypt, N=5)");
    const temposBaselineMs = [];
    for (let i = 0; i < 5; i += 1) {
      const inicioBaseline = Date.now();
      // Medição sequencial de propósito: latência de UMA chamada por vez,
      // não throughput agregado.
      await sondar(client, "anon", "SELECT 1");
      temposBaselineMs.push(Date.now() - inicioBaseline);
    }
    const baselineMinimoMs = Math.min(...temposBaselineMs);
    console.log(
      `  [MEDIDO] baseline (sem bcrypt) — mínimo=${baselineMinimoMs}ms — amostras: ${temposBaselineMs.join(",")}`,
    );

    titulo(
      `2.5b. Latência de resolver_loja com chave ERRADA (N=${N_MEDICAO_LATENCIA}, gen_salt('bf', ${CUSTO_BF}))`,
    );
    const temposMs = [];
    for (let i = 0; i < N_MEDICAO_LATENCIA; i += 1) {
      const inicio = Date.now();
      // Medição sequencial de propósito: latência de UMA chamada por vez,
      // não throughput agregado.
      await sondar(
        client,
        "anon",
        "SELECT * FROM public.resolver_loja($1, $2)",
        ["a.exemplo", `chave-errada-medicao-${i}`],
      );
      temposMs.push(Date.now() - inicio);
    }
    const mediaMs = temposMs.reduce((soma, t) => soma + t, 0) / temposMs.length;
    const maximoMs = Math.max(...temposMs);
    // deltaMaximo usa o MÍNIMO do baseline (a rede mais rápida observada)
    // como piso de rede — é a direção conservadora: qualquer coisa que sobre
    // depois de subtrair o round-trip MAIS RÁPIDO medido é atribuída ao
    // bcrypt, nunca o contrário (não quero SUBESTIMAR o custo do bcrypt).
    const deltaMaximoMs = maximoMs - baselineMinimoMs;
    console.log(
      `  [MEDIDO] BRUTO: N=${temposMs.length} média=${mediaMs.toFixed(1)}ms máximo=${maximoMs}ms (custo bf=${CUSTO_BF}) — amostras: ${temposMs.join(",")}`,
    );
    console.log(
      `  [MEDIDO] DELTA (máximo bruto − baseline mínimo, isola o custo do bcrypt da rede desta máquina): ${deltaMaximoMs}ms`,
    );
    afirmar(
      `latência ISOLADA do bcrypt (máximo − baseline de rede) < ${LIMITE_MS_LATENCIA}ms (custo bf=${CUSTO_BF}) — o alvo BRUTO do brief não é alcançável nesta rede (baseline já > 150ms), ver divergência no relatório`,
      deltaMaximoMs < LIMITE_MS_LATENCIA,
      `delta=${deltaMaximoMs}ms (bruto máximo=${maximoMs}ms, baseline mínimo=${baselineMinimoMs}ms)`,
    );

    // ---- 3. Como anon --------------------------------------------------------
    titulo("3. anon");
    const selectDireto = await sondar(
      client,
      "anon",
      "SELECT * FROM public.frota_lojas",
    );
    afirmar(
      "anon: SELECT direto em frota_lojas -> 42501 (o REVOKE fecha o default privilege do schema public)",
      !selectDireto.ok && selectDireto.code === "42501",
      JSON.stringify(selectDireto),
    );

    const errado = await sondar(
      client,
      "anon",
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["a.exemplo", "chave-errada-de-proposito"],
    );
    afirmar(
      "resolver_loja('a.exemplo', 'errado') -> 0 linhas, SEM ERRO (sem oráculo)",
      errado.ok && errado.rowCount === 0,
      JSON.stringify(errado),
    );

    const certo = await sondar(
      client,
      "anon",
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["a.exemplo", SEGREDO],
    );
    afirmar(
      "resolver_loja('a.exemplo', segredo) -> 1 linha, é prova-a",
      certo.ok && certo.rowCount === 1 && certo.rows[0].id === "prova-a",
      JSON.stringify(certo),
    );

    const maiuscula = await sondar(
      client,
      "anon",
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["A.EXEMPLO", SEGREDO],
    );
    afirmar(
      "resolver_loja('A.EXEMPLO', segredo) -> 1 linha (comparação case-insensitive)",
      maiuscula.ok &&
        maiuscula.rowCount === 1 &&
        maiuscula.rows[0].id === "prova-a",
      JSON.stringify(maiuscula),
    );

    const inativa = await sondar(
      client,
      "anon",
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["b.exemplo", SEGREDO],
    );
    afirmar(
      "resolver_loja('b.exemplo', segredo) -> 0 linhas (loja ativa=false, mesmo com a chave certa)",
      inativa.ok && inativa.rowCount === 0,
      JSON.stringify(inativa),
    );

    const podeAnon = await podeExecutar(
      client,
      "anon",
      "public.resolver_loja(text, text)",
    );
    afirmar("resolver_loja: anon TEM EXECUTE", podeAnon === true);
    const publicTemExecute = await temGrantDeRotina(
      client,
      "PUBLIC",
      "resolver_loja",
    );
    afirmar(
      "resolver_loja: PUBLIC NÃO TEM EXECUTE",
      publicTemExecute === false,
    );
    for (const tabela of ["frota_lojas", "frota_segredo"]) {
      const anonTemTabela = await temGrantDeTabela(client, "anon", tabela);
      const publicTemTabela = await temGrantDeTabela(client, "PUBLIC", tabela);
      afirmar(
        `${tabela}: anon NÃO TEM privilégio nenhum`,
        anonTemTabela === false,
      );
      afirmar(
        `${tabela}: PUBLIC NÃO TEM privilégio nenhum`,
        publicTemTabela === false,
      );
    }

    // ---- 4. Como authenticated -------------------------------------------
    titulo("4. authenticated");
    const authTentativa = await sondar(
      client,
      "authenticated",
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["a.exemplo", SEGREDO],
    );
    afirmar(
      "authenticated: resolver_loja(...) -> 42501 (sem EXECUTE, mesmo com a chave certa)",
      !authTentativa.ok && authTentativa.code === "42501",
      JSON.stringify(authTentativa),
    );
    const podeAuth = await podeExecutar(
      client,
      "authenticated",
      "public.resolver_loja(text, text)",
    );
    afirmar("resolver_loja: authenticated NÃO TEM EXECUTE", podeAuth === false);
    const podeServiceRole = await podeExecutar(
      client,
      "service_role",
      "public.resolver_loja(text, text)",
    );
    afirmar(
      "resolver_loja: service_role NÃO TEM EXECUTE (nunca service_role no porteiro)",
      podeServiceRole === false,
    );

    // ---- 5. Rollback da 20261141000000 -------------------------------------
    titulo("5. Rollback-manual da 20261141000000 (lido do disco)");
    await client.query(lerSql(NOSSO_ROLLBACK));
    const depoisDoRollback = await existemObjetos(client);
    afirmar(
      "frota_lojas, frota_segredo e resolver_loja somem depois do rollback",
      depoisDoRollback.tabelas.size === 0 &&
        depoisDoRollback.funcoes.size === 0,
      JSON.stringify({
        tabelas: [...depoisDoRollback.tabelas],
        funcoes: [...depoisDoRollback.funcoes],
      }),
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
