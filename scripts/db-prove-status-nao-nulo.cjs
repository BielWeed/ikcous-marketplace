#!/usr/bin/env node
/**
 * Prova a migration 20260822000000_status_do_pedido_nunca_nulo.sql
 * (achado de 20/08/2026).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem o
 * pedido de teste, nem o UPDATE do backfill, nem o ALTER COLUMN. Isso so e
 * verdade porque a migration NAO tem BEGIN/COMMIT embutido: se alguem
 * acrescentar um, este script passa a gravar de verdade sem avisar.
 *
 * A CONEXAO ABRE EM MODO SOMENTE LEITURA (pooler do Supabase). Por isso o
 * primeiro comando dentro da transacao e
 * `SET default_transaction_read_only = off` — sem ele todo INSERT/UPDATE/
 * ALTER abaixo falha com "cannot execute ... in a read-only transaction",
 * e isso parece (mas nao e) um defeito da migration.
 *
 * O QUE ESTE SCRIPT PRECISA PROVAR, E POR QUE CADA CASO EXISTE
 *
 *   O defeito nao e "status fica NULL por acaso" — e que a CHECK existente
 *   nunca bloqueou isso, porque `NULL = ANY(array)` avalia para NULL e uma
 *   CHECK so reprova quando o resultado e FALSE. Entao a prova tem de
 *   mostrar as DUAS pontas: que o INSERT sem status passava ANTES (caso 1),
 *   e que ele deixa de gravar NULL DEPOIS (caso 4).
 *
 *   A correcao tem tres formas de falhar pela metade, e cada uma tem caso
 *   proprio:
 *     - so o DEFAULT, sem NOT NULL: um INSERT com `status = NULL` EXPLICITO
 *       ainda gravaria NULL (o DEFAULT so age quando a coluna e OMITIDA).
 *       Caso 5 testa exatamente isso.
 *     - so o NOT NULL, sem DEFAULT: o INSERT do checkout (que ja grava
 *       'pending' fixo) continuaria funcionando, mas qualquer INSERT futuro
 *       que confie em omitir a coluna quebraria em vez de herdar 'pending'.
 *       Caso 4 cobre o comportamento certo (omitir => 'pending').
 *     - a migration esquecer o dado que ja existia: caso 3 cria uma linha
 *       com status NULO ANTES de aplicar a migration e confere que o
 *       backfill (primeira instrucao da migration) a corrige — a borda que
 *       dói de verdade, porque e o caso que aconteceu em producao.
 *
 *   Caso 6 e 7 sao a rede de seguranca: a CHECK de valores validos continua
 *   viva (nem apertou demais, nem afrouxou), e `payment_status` — que tem
 *   NULL como estado legitimo de proposito — continua aceitando NULL.
 *
 * USO:  node scripts/db-prove-status-nao-nulo.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260822000000_status_do_pedido_nunca_nulo.sql";

let passou = 0;
let falhou = 0;

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrada.");
}

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function colunaStatus(client) {
  const { rows } = await client.query(`
    SELECT is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'marketplace_orders'
       AND column_name = 'status'`);
  return rows[0];
}

/**
 * INSERT minimo, preenchendo so as colunas NOT NULL da tabela hoje.
 *
 * Um INSERT que viola constraint aborta a transacao inteira no protocolo do
 * Postgres (diferente de uma excecao capturada dentro de PL/pgSQL) — todo
 * comando seguinte falharia com "current transaction is aborted" ate um
 * ROLLBACK. Por isso cada tentativa roda dentro do proprio SAVEPOINT: se
 * falhar, so aquele savepoint desfaz, e a transacao externa segue viva para
 * o proximo caso.
 */
let contadorSavepoint = 0;
async function inserirPedido(client, { status, comColuna = true } = {}) {
  const dados = JSON.stringify({ whatsapp: "34999999999" });
  const savepoint = `sp_${++contadorSavepoint}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    let rows;
    if (comColuna) {
      const r = await client.query(
        `INSERT INTO public.marketplace_orders
           (customer_name, customer_data, total, subtotal, status)
         VALUES ('PROVA STATUS NAO NULO', $1::jsonb, 100, 100, $2)
         RETURNING id, status`,
        [dados, status],
      );
      rows = r.rows;
    } else {
      // Omite a coluna status por completo — e o caminho real de qualquer
      // INSERT que nao mencione status explicitamente.
      const r = await client.query(
        `INSERT INTO public.marketplace_orders
           (customer_name, customer_data, total, subtotal)
         VALUES ('PROVA STATUS NAO NULO', $1::jsonb, 100, 100)
         RETURNING id, status`,
        [dados],
      );
      rows = r.rows;
    }
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return { ok: true, id: rows[0].id, status: rows[0].status };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    return { ok: false, erro: e.message };
  }
}

const recusouPorNotNull = (r) =>
  r.ok === false &&
  /null value in column "status".*violates not-null/is.test(r.erro);

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");
  // A conexao (pooler) abre em modo somente leitura por padrao.
  await client.query("SET default_transaction_read_only = off");

  try {
    const antes = await colunaStatus(client);
    console.log(
      `coluna status hoje: is_nullable=${antes.is_nullable} default=${antes.column_default}`,
    );

    // =========================================================================
    // ANTES da migration: o defeito, reproduzido
    // =========================================================================
    console.log("\n=== antes da migration ===");

    // Declarado aqui fora, e nao com `var` dentro do `else`: o `var` dependia
    // de hoisting para ser lido no caso 3 mais abaixo, e o Biome do CI reprova
    // (`noVar` + `noInnerDeclarations`). `undefined` significa "o estado
    // 'antes' nao existia" — a migration ja estava viva quando a prova rodou.
    let idPreExistente;

    if (antes.is_nullable === "NO") {
      console.log(
        "  (pulado: a migration ja esta viva no banco, entao o estado 'antes' nao existe mais)",
      );
    } else {
      // caso 1: INSERT sem status e aceito e grava NULL (o defeito).
      const pAntes = await inserirPedido(client, { comColuna: false });
      conferir(
        "antes: INSERT sem status e ACEITO",
        pAntes.ok === true,
        pAntes.ok ? undefined : pAntes.erro,
      );
      conferir(
        "antes: o status gravado e NULL (o defeito)",
        pAntes.ok && pAntes.status === null,
        pAntes.ok ? `status veio '${pAntes.status}'` : undefined,
      );

      // caso 2: a CHECK existente NAO reprova NULL (NULL = ANY(...) e NULL,
      // nao FALSE) — e o mecanismo exato do defeito, nao so o efeito.
      const pExplicitoNulo = await inserirPedido(client, { status: null });
      conferir(
        "antes: INSERT com status = NULL explicito tambem e ACEITO (a CHECK nao pega NULL)",
        pExplicitoNulo.ok === true,
        pExplicitoNulo.ok ? undefined : pExplicitoNulo.erro,
      );

      // caso 3 (a borda que doi de verdade): uma linha que JA EXISTIA com
      // status NULO antes da migration precisa ser corrigida pelo backfill,
      // nao ignorada.
      idPreExistente = pAntes.id;
    }

    // =========================================================================
    // Aplica a migration DENTRO da transacao
    // =========================================================================
    // O caminho e montado de uma constante deste arquivo, nao de entrada.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sql = fs.readFileSync(
      path.join(RAIZ, "supabase", "migrations", MIGRATION),
      "utf8",
    );
    if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
      throw new Error(
        `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudanca ficaria gravada. Abortando.`,
      );
    }
    await client.query(sql);

    const depois = await colunaStatus(client);
    conferir(
      "migration aplicada: status agora e NOT NULL",
      depois.is_nullable === "NO",
      `is_nullable=${depois.is_nullable}`,
    );
    conferir(
      "migration aplicada: status agora tem DEFAULT 'pending'",
      depois.column_default?.includes("pending") === true,
      `default=${depois.column_default}`,
    );

    // =========================================================================
    // DEPOIS: o backfill e o comportamento novo
    // =========================================================================
    console.log("\n=== depois da migration ===");

    if (typeof idPreExistente !== "undefined") {
      const { rows } = await client.query(
        "SELECT status FROM public.marketplace_orders WHERE id = $1",
        [idPreExistente],
      );
      conferir(
        "backfill: a linha que ja existia com status NULO virou 'pending'",
        rows[0]?.status === "pending",
        `status veio '${rows[0]?.status}'`,
      );
    }

    // caso 4: INSERT sem status (o caminho real de qualquer chamador que
    // nao mencione a coluna) grava 'pending' pelo DEFAULT.
    const pDepoisOmisso = await inserirPedido(client, { comColuna: false });
    conferir(
      "depois: INSERT sem status grava 'pending' (DEFAULT)",
      pDepoisOmisso.ok === true && pDepoisOmisso.status === "pending",
      pDepoisOmisso.ok
        ? `status veio '${pDepoisOmisso.status}'`
        : pDepoisOmisso.erro,
    );

    // caso 5: INSERT com status = NULL EXPLICITO e recusado — o DEFAULT
    // sozinho nao pegaria isso, so o NOT NULL pega.
    const pDepoisExplicito = await inserirPedido(client, { status: null });
    conferir(
      "depois: INSERT com status = NULL explicito e RECUSADO (NOT NULL)",
      recusouPorNotNull(pDepoisExplicito),
      pDepoisExplicito.ok
        ? "o INSERT foi aceito — a trava sumiu"
        : pDepoisExplicito.erro,
    );

    // caso 6: a CHECK de valores validos continua viva, sem apertar nem
    // afrouxar. Um valor valido continua passando...
    const pValido = await inserirPedido(client, { status: "processing" });
    conferir(
      "depois: status valido explicito ('processing') continua aceito",
      pValido.ok === true && pValido.status === "processing",
      pValido.ok ? undefined : pValido.erro,
    );
    // ...e um valor fora da lista continua recusado pela CHECK original.
    const pInvalido = await inserirPedido(client, { status: "bogus" });
    conferir(
      "depois: status fora da lista permitida continua recusado pela CHECK",
      pInvalido.ok === false &&
        /marketplace_orders_status_check/i.test(pInvalido.erro),
      pInvalido.ok ? "o INSERT foi aceito — a CHECK sumiu" : pInvalido.erro,
    );

    // caso 7: payment_status NAO foi tocado — NULL ali continua legitimo
    // ("sem cobranca online").
    const dados = JSON.stringify({ whatsapp: "34999999999" });
    const rPaymentStatus = await client.query(
      `INSERT INTO public.marketplace_orders
         (customer_name, customer_data, total, subtotal, payment_status)
       VALUES ('PROVA STATUS NAO NULO', $1::jsonb, 100, 100, NULL)
       RETURNING payment_status`,
      [dados],
    );
    conferir(
      "depois: payment_status = NULL continua aceito (nao foi tocado)",
      rPaymentStatus.rows[0].payment_status === null,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  // =========================================================================
  // Confirma que o ROLLBACK desfez TUDO — nova conexao, fora de qualquer
  // transacao aberta por este script.
  // =========================================================================
  const clienteFinal = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await clienteFinal.connect();
  try {
    const colunaFinal = await colunaStatus(clienteFinal);
    conferir(
      "rollback: a coluna status voltou ao estado de antes (nada ficou gravado)",
      colunaFinal.is_nullable === "YES" && colunaFinal.column_default === null,
      `is_nullable=${colunaFinal.is_nullable} default=${colunaFinal.column_default}`,
    );
    const { rows: sobrou } = await clienteFinal.query(
      `SELECT count(*)::int AS n FROM public.marketplace_orders WHERE customer_name = 'PROVA STATUS NAO NULO'`,
    );
    conferir(
      "rollback: nenhuma linha de teste sobrou no banco",
      sobrou[0].n === 0,
      `sobraram ${sobrou[0].n}`,
    );
  } finally {
    await clienteFinal.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
