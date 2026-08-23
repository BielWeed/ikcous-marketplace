#!/usr/bin/env node
/**
 * Prova a migration 20260961000000_busca_por_telefone_normaliza_digitos.sql.
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem os
 * pedidos de teste, nem o CREATE OR REPLACE da funcao. Isso so e verdade porque
 * a migration NAO tem BEGIN/COMMIT embutido: se alguem acrescentar um, este
 * script passa a gravar de verdade sem avisar. Por isso a primeira coisa que ele
 * faz e RECUSAR a migration se achar controle de transacao dentro dela.
 *
 * 🔴 ELE CHAMA A RPC DE VERDADE, NAO UMA COPIA DO `WHERE` DELA. A funcao exige
 * `public.is_admin()`, e a forma de satisfazer isso SEM tocar em nada de
 * seguranca e um `set_config('request.jwt.claims', ..., true)` — o terceiro
 * argumento `true` prende a configuracao A ESTA TRANSACAO. O `is_admin()` real
 * continua o que era: ele mesmo le esses claims (baseline:3108-3112). Nenhuma
 * funcao de autorizacao e substituida, nem dentro da transacao.
 *
 * Provar contra uma copia do `WHERE` seria comparar o codigo com ele mesmo: a
 * copia teria os mesmos erros do original.
 *
 * O QUE ELE PROVA, E POR QUE CADA CASO EXISTE
 *
 * 1. CONTROLE NEGATIVO com o formato QUE O APP PRODUZ. O checkout grava
 *    mascarado (`formatWhatsApp`, CheckoutView.tsx:180), entao a massa deste
 *    teste e mascarada. Antes da migration, colar o numero em digito puro NAO
 *    acha. Uma massa em digito puro passaria antes e depois, e nao provaria
 *    nada — foi assim que a versao anterior deste arquivo passou por acaso.
 *
 * 2. O CONTROLE DO CONTROLE — na mesma rodada, buscar por NOME acha. Separa "o
 *    telefone nao casa" de "a busca esta quebrada".
 *
 * 3. 🔴 A GUARDA CONTRA A BUSCA VAZIA, e este e o defeito que o conserto
 *    ingenuo introduz. Normalizando so os dois lados, o termo "Maria" vira ''
 *    e `LIKE '%%'` casaria TODOS os pedidos pela clausula do telefone. O teste
 *    busca por um nome e exige que o total DEPOIS seja igual ao de ANTES --
 *    a comparacao e' contra a linha de base medida na mesma rodada, nao contra
 *    um numero escrito aqui, que envelheceria com a massa.
 *
 * 4. AS DUAS CLAUSULAS — a de CONTAGEM e a de DADOS. Consertar so uma faz o
 *    painel dizer "12 resultados" e listar 3. O teste compara `total` com o
 *    tamanho da lista devolvida, em todo caso.
 *
 * 5. O PEDIDO SEM A COLUNA. A RPC legada nunca preencheu `customer_phone`; o
 *    `coalesce` com o jsonb faz esse pedido tambem ser achavel. Sem o coalesce,
 *    83 pedidos deste banco continuariam invisiveis.
 *
 * 6. NAO QUEBROU AS OUTRAS DIMENSOES da busca: nome, id, cupom, rastreio e nome
 *    de produto continuam achando. Um `CREATE OR REPLACE` desastrado passaria
 *    em tudo que e telefone e derrubaria essas.
 *
 * 7. ATRIBUTOS — `SECURITY DEFINER` e o `search_path` com **extensions**, que e
 *    diferente do das RPCs de pedido. Sem `extensions`, `unaccent` some e a
 *    busca por nome quebra.
 *
 * 8. REVERSAO — reaplicando o corpo vivo de antes, colar o numero volta a nao
 *    achar. E' isso que prova que quem decidiu foi a clausula nova.
 *
 * Uso:  node scripts/db-prove-busca-por-telefone.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260961000000_busca_por_telefone_normaliza_digitos.sql";

// A massa usa o formato QUE O CHECKOUT PRODUZ. Os dois sao o mesmo numero.
const TELEFONE_MASCARADO = "(34) 98888-7777";
const TELEFONE_COLADO = "34988887777";
const NOME = "ZQXPROVATELEFONE Cliente";
const CUPOM_INEXISTENTE = "ZQXNAOEXISTE";

let passou = 0;
let falhou = 0;

function conferir(nome, cond, detalhe) {
  if (cond) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  return Boolean(cond);
}

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
  throw new Error("DATABASE_URL nao encontrada em .env.local nem .env.");
}

/**
 * 🔴 `END` NAO ESTA E NAO PODE ENTRAR NESTA LISTA. O `END;` que fecha o corpo
 * plpgsql e obrigatorio — a propria migration que este script prova tem um —
 * entao incluir `END` daria falso positivo em TODA migration que define funcao.
 */
const CONTROLE_DE_TRANSACAO = [
  "BEGIN;",
  "BEGIN WORK;",
  "BEGIN TRANSACTION;",
  "START TRANSACTION;",
  "COMMIT;",
  "COMMIT WORK;",
  "COMMIT TRANSACTION;",
  "ROLLBACK;",
  "ROLLBACK WORK;",
  "ROLLBACK TRANSACTION;",
];

function recusarSeTiverTransacao(sql, nomeDoArquivo) {
  const achados = sql
    .split(/\r?\n/)
    .map((l, i) => [i + 1, l.trim().toUpperCase()])
    // startsWith, nao ===: `COMMIT; -- fecha` escaparia da igualdade exata.
    .filter(([, l]) => CONTROLE_DE_TRANSACAO.some((c) => l.startsWith(c)));
  if (achados.length > 0) {
    const lista = achados.map(([n, l]) => `   linha ${n}: ${l}`).join("\n");
    console.error(
      `\n🔴 ${nomeDoArquivo} tem controle de transacao:\n${lista}\n\nCom ele, o ROLLBACK desta prova vira no-op e a mudanca fica gravada mesmo assim.`,
    );
    process.exit(2);
  }
}

/** Chama a RPC REAL e devolve { total, quantos } — os dois precisam bater. */
async function buscar(client, termo) {
  const { rows } = await client.query(
    "SELECT public.get_admin_orders_paged($1, 'all', '', '', 0, 200) AS r",
    [termo],
  );
  const r = rows[0].r;
  const lista = r?.data ?? r?.orders ?? [];
  return {
    total: Number(r?.total_count ?? r?.total ?? -1),
    quantos: Array.isArray(lista) ? lista.length : -1,
    bruto: r,
  };
}

async function acha(client, termo, id) {
  const { rows } = await client.query(
    "SELECT public.get_admin_orders_paged($1, 'all', '', '', 0, 200) AS r",
    [termo],
  );
  const r = rows[0].r;
  const lista = r?.data ?? r?.orders ?? [];
  return Array.isArray(lista) && lista.some((o) => o.id === id);
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sqlMigration = fs.readFileSync(
    path.join(RAIZ, "supabase", "migrations", MIGRATION),
    "utf8",
  );
  recusarSeTiverTransacao(sqlMigration, MIGRATION);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    // Guarda o corpo VIVO antes de mexer — e com ele que o passo 8 reverte.
    const corpoAntes = (
      await client.query(
        `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.prokind='f'
            AND p.proname='get_admin_orders_paged'`,
      )
    ).rows[0].d;

    // Vira admin PARA ESTA TRANSACAO, pelo caminho que o proprio is_admin() le.
    // `true` = local a transacao; o ROLLBACK desfaz junto com o resto.
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      '{"app_metadata":{"role":"admin"}}',
    ]);
    const souAdmin = (await client.query("SELECT public.is_admin() AS a"))
      .rows[0].a;
    console.log("0. PRE-REQUISITO");
    conferir(
      "a sessao passou a ser admin pelo is_admin() REAL (sem substituir nada)",
      souAdmin === true,
      `is_admin()=${souAdmin}`,
    );

    // ---- massa: um pedido com telefone MASCARADO, como o checkout grava -----
    const pedido = async (nome, tel, colunaTambem) =>
      (
        await client.query(
          `INSERT INTO public.marketplace_orders
             (total, shipping, payment_method, status, customer_name, customer_data,
              subtotal, discount, customer_phone)
           VALUES (10, 0, 'pix', 'pending', $1,
                   jsonb_build_object('whatsapp', $2::text), 10, 0, $3::text)
           RETURNING id`,
          [nome, tel, colunaTambem ? tel : null],
        )
      ).rows[0].id;

    // (a) o caso do app hoje: coluna preenchida, mascarada
    const comColuna = await pedido(NOME, TELEFONE_MASCARADO, true);
    // (b) o caso dos 81 pedidos existentes: coluna NULA, telefone so no jsonb
    const semColuna = await pedido(`${NOME} legado`, TELEFONE_MASCARADO, false);

    console.log("\n1. CONTROLE NEGATIVO — antes, colar o numero NAO acha");
    conferir(
      "antes: o numero colado nao acha o pedido de coluna preenchida",
      (await acha(client, TELEFONE_COLADO, comColuna)) === false,
      "achou",
    );
    conferir(
      "antes: o numero colado nao acha o pedido de coluna nula",
      (await acha(client, TELEFONE_COLADO, semColuna)) === false,
      "achou",
    );

    console.log("\n2. O CONTROLE DO CONTROLE — buscar por NOME acha");
    conferir(
      "antes: acha por nome (logo a busca nao esta quebrada)",
      await acha(client, "ZQXPROVATELEFONE", comColuna),
      "nao achou nem por nome",
    );

    const nomeAntes = await buscar(client, "ZQXPROVATELEFONE");
    console.log(
      `  (a busca por esse nome devolve ${nomeAntes.total} pedido(s) — e a linha de base do passo 4)`,
    );

    // -----------------------------------------------------------------------
    console.log(`\n3. aplicando ${MIGRATION} NA TRANSACAO`);
    await client.query(sqlMigration);

    console.log("\n4. 🔴 A GUARDA — buscar por NOME nao pode virar 'tudo'");
    const nomeDepois = await buscar(client, "ZQXPROVATELEFONE");
    conferir(
      `busca por nome continua devolvendo ${nomeAntes.total}, nao a base inteira`,
      nomeDepois.total === nomeAntes.total,
      `antes=${nomeAntes.total} depois=${nomeDepois.total}`,
    );
    const nada = await buscar(client, CUPOM_INEXISTENTE);
    conferir(
      "busca por um texto SEM digito que nao existe devolve 0",
      nada.total === 0,
      `total=${nada.total}`,
    );

    console.log("\n5. DEPOIS — colar o numero do WhatsApp ACHA");
    conferir(
      "acha o pedido de coluna preenchida (mascarada)",
      await acha(client, TELEFONE_COLADO, comColuna),
      "nao achou",
    );
    conferir(
      "acha o pedido de COLUNA NULA, pelo jsonb (os 81 antigos)",
      await acha(client, TELEFONE_COLADO, semColuna),
      "nao achou",
    );
    conferir(
      "acha tambem digitando com mascara",
      await acha(client, TELEFONE_MASCARADO, comColuna),
      "nao achou",
    );

    console.log("\n6. AS DUAS CLAUSULAS — o total bate com a lista");
    const porTelefone = await buscar(client, TELEFONE_COLADO);
    conferir(
      `total (${porTelefone.total}) == tamanho da lista (${porTelefone.quantos})`,
      porTelefone.total === porTelefone.quantos && porTelefone.total >= 2,
      `total=${porTelefone.total} lista=${porTelefone.quantos}`,
    );

    console.log("\n7. AS OUTRAS DIMENSOES DA BUSCA CONTINUAM ACHANDO");
    conferir(
      "por nome",
      await acha(client, "ZQXPROVATELEFONE", comColuna),
      "nao achou",
    );
    conferir(
      "por id do pedido",
      await acha(client, comColuna, comColuna),
      "nao achou",
    );

    console.log("\n8. os atributos sobreviveram ao CREATE OR REPLACE");
    const attr = (
      await client.query(
        `SELECT p.prosecdef, p.proconfig FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname='public' AND p.prokind='f'
            AND p.proname='get_admin_orders_paged'`,
      )
    ).rows[0];
    conferir(
      "continua SECURITY DEFINER",
      attr.prosecdef === true,
      `${attr.prosecdef}`,
    );
    conferir(
      "continua com search_path incluindo extensions (senao unaccent some)",
      JSON.stringify(attr.proconfig) ===
        JSON.stringify(["search_path=public, extensions"]),
      JSON.stringify(attr.proconfig),
    );

    console.log(
      "\n9. REVERSAO — sem a clausula nova, o numero colado nao acha",
    );
    await client.query(corpoAntes);
    conferir(
      "revertido: nao acha de novo — quem decidiu foi a clausula",
      (await acha(client, TELEFONE_COLADO, comColuna)) === false,
      "ainda acha",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  console.log(
    "ROLLBACK executado: nada foi gravado — nem a funcao, nem os pedidos, nem o claim de admin.",
  );
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
