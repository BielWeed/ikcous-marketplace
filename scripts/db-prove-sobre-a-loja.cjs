#!/usr/bin/env node
/**
 * PROVA de `store_config.{store_address,store_description}` + `v_store_config`
 * + o CASE do ON CONFLICT da upsert_store_config — frente "Sobre a Loja"
 * (pedido do dono 20/09/2026), migration 20261167000000.
 *
 * NADA É GRAVADO: a migration 20261167000000 e o rollback-manual
 * correspondente são LIDOS DO DISCO e executados DENTRO de uma transação
 * desfeita com ROLLBACK no final — nada redigitado, nada aplicado de
 * verdade. Mesmo molde de scripts/db-prove-configuracao-publica.cjs (a
 * 20261150).
 *
 * DATABASE_URL vem do ambiente OU do .env do projeto (mesma precedência e
 * mesma leitura do scripts/db-apply.cjs — o script lê, nunca o agente).
 *
 * O QUE ELE PROVA, NA ORDEM:
 *   0. CONTROLE NEGATIVO: as duas colunas NÃO existem em store_config nem
 *      em v_store_config — se já existirem, a migration não é mais aditiva
 *      neste banco e a prova para (INCONCLUSIVO).
 *   1. Aplica a 20261167000000, lida do disco.
 *   2. `anon` lê as duas colunas pela view: NULL/NULL antes do lojista
 *      preencher (ausência honesta).
 *   3. Semente do conteúdo prévio (o que "já existia" antes do salvar):
 *      UPDATE direto grava só a descrição (caminho da hub, como o
 *      semear-configuracao faz).
 *   4. SONDAGEM 1 (savepoint + ROLLBACK TO): upsert_store_config com payload
 *      só do ENDEREÇO — o RETURNING da própria RPC confirma: endereço
 *      gravado E descrição PRESERVADA (o coração do aceite "salvar um campo
 *      não apaga os outros"), medido DENTRO do savepoint antes de desfazer.
 *   5. SONDAGEM 2: payload VAZIO ({} de um form que só abriu e salvou) —
 *      RETURNING mantém endereço e descrição intactos.
 *   6. Aplica o rollback-manual, lido do disco — as colunas somem da tabela
 *      E da view.
 *   7. ROLLBACK — nada do que rodou aqui fica gravado.
 *
 * Exit 0 = todas as afirmativas OK. Exit 1 = alguma afirmativa caiu. Exit 2 =
 * a prova NÃO chegou ao fim (pré-condição, ferramenta, OU erro de SQL ao
 * aplicar uma migration — a mensagem do Postgres sai no stdout).
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIG_DIR = path.join(PROJECT_ROOT, "supabase/migrations");

const NOSSA_MIGRATION = path.join(
  MIG_DIR,
  "20261167000000_sobre_a_loja_ganha_endereco_e_descricao.sql",
);
const NOSSO_ROLLBACK = path.join(
  MIG_DIR,
  "rollback-manual-20261167000000_sobre_a_loja_ganha_endereco_e_descricao.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Mesma precedência e leitura do scripts/db-apply.cjs (execução local de
  // dev; no CI a URL é injetada no ambiente). Caminho fixo do próprio
  // repositório, montado da lista abaixo — sem entrada externa.
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- arquivo do próprio repositório
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem: arquivo do próprio repositório
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha)
      return linha.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
  }
  throw new Error(
    "DATABASE_URL não encontrada no ambiente nem no .env do projeto.",
  );
}

let falhas = 0;
function afirmar(condicao, descricao, detalhe) {
  if (condicao) {
    console.log(`  OK  ${descricao}`);
  } else {
    falhas += 1;
    console.error(`FALHOU  ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- migrations da lista fixa NOSSA_MIGRATION/NOSSO_ROLLBACK, montadas no topo deste arquivo
  const migration = fs.readFileSync(NOSSA_MIGRATION, "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
  const rollback = fs.readFileSync(NOSSO_ROLLBACK, "utf8");
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();

  try {
    await client.query("BEGIN");

    // 0. Controle negativo
    const antes = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('store_config','v_store_config')
          AND column_name IN ('store_address','store_description')`,
    );
    afirmar(
      antes.rowCount === 0,
      "controle negativo: as colunas não existem antes da migration",
      `encontradas: ${antes.rowCount}`,
    );
    if (antes.rowCount !== 0) {
      console.error(
        "PROVA INCONCLUSIVA: o banco já tem as colunas — a migration não é aditiva aqui.",
      );
      process.exitCode = 2;
      return;
    }

    // 1. Aplica a migration lida do disco
    try {
      await client.query(migration);
      console.log("  OK  migration 20261167000000 aplicada na transação");
    } catch (e) {
      console.error(
        `ERRO DE SQL na migration (mensagem do Postgres abaixo):\n${e.message}`,
      );
      process.exitCode = 2;
      return;
    }

    // 2. anon lê a view: NULL/NULL (ausência honesta)
    await client.query("SET LOCAL ROLE anon");
    const leituraAnon = await client.query(
      "SELECT store_address, store_description FROM public.v_store_config",
    );
    afirmar(leituraAnon.rowCount === 1, "anon lê a view (1 linha)");
    afirmar(
      leituraAnon.rows[0].store_address === null &&
        leituraAnon.rows[0].store_description === null,
      "anon vê NULL/NULL antes do lojista preencher",
    );
    await client.query("RESET ROLE");

    // 3. Semente do conteúdo prévio (caminho da hub, direto na tabela)
    await client.query(
      "UPDATE public.store_config SET store_description = 'descrição semente da prova' WHERE id = 1",
    );

    // 4. SONDAGEM 1: payload só do endereço — descrição PRESERVADA
    await client.query("SAVEPOINT sondar");
    const sondagem1 = await client.query(
      "SELECT public.upsert_store_config($1::jsonb) AS retornado",
      [JSON.stringify({ store_address: "Rua da Prova, 123" })],
    );
    const retorno1 = sondagem1.rows[0].retornado;
    afirmar(
      retorno1.store_address === "Rua da Prova, 123",
      "salvar SÓ o endereço grava o endereço",
      `veio: ${JSON.stringify(retorno1.store_address)}`,
    );
    afirmar(
      retorno1.store_description === "descrição semente da prova",
      "salvar SÓ o endereço PRESERVA a descrição (o aceite central)",
      `veio: ${JSON.stringify(retorno1.store_description)}`,
    );
    afirmar(
      retorno1.business_hours !== undefined,
      "o RETURNING devolve a linha inteira (o comparador do front confere coluna a coluna)",
    );
    await client.query("ROLLBACK TO SAVEPOINT sondar");

    // 5. SONDAGEM 2: payload vazio não toca em nada
    await client.query("SAVEPOINT sondar2");
    const sondagem2 = await client.query(
      "SELECT public.upsert_store_config($1::jsonb) AS retornado",
      ["{}"],
    );
    const retorno2 = sondagem2.rows[0].retornado;
    afirmar(
      retorno2.store_address === null &&
        retorno2.store_description === "descrição semente da prova",
      "payload vazio ({}): endereço e descrição intactos",
      `veio: ${JSON.stringify({
        a: retorno2.store_address,
        d: retorno2.store_description,
      })}`,
    );
    await client.query("ROLLBACK TO SAVEPOINT sondar2");

    // 6. Rollback lido do disco
    await client.query(rollback);
    const depois = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('store_config','v_store_config')
          AND column_name IN ('store_address','store_description')`,
    );
    afirmar(
      depois.rowCount === 0,
      "rollback: as colunas somem da tabela e da view",
      `sobraram: ${depois.rowCount}`,
    );

    // 7. ROLLBACK final — nada fica
  } finally {
    await client.query("ROLLBACK");
    console.log("  OK  ROLLBACK final — nada do que rodou aqui ficou gravado");
    await client.end();
  }

  if (falhas > 0) {
    console.error(`\nPROVA REPROVADA: ${falhas} afirmativa(s) caíram.`);
    process.exitCode = 1;
  } else {
    console.log("\nPROVA VERDE: todas as afirmativas OK.");
  }
}

main().catch((e) => {
  console.error(`prova não chegou ao fim: ${e.message}`);
  process.exitCode = 2;
});
