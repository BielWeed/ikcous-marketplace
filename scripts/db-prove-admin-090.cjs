#!/usr/bin/env node
/**
 * Prova a correção do ADMIN-090 (issue #101) sem comitar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado. Isso só
 * é verdade porque a migration NÃO tem BEGIN/COMMIT embutido — se alguém
 * acrescentar um, este script passa a gravar em produção sem avisar.
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`:
 *   reviews_insert_policy usa `(SELECT auth.uid()) = user_id`, e auth.uid()
 *   lê de `request.jwt.claims`. A DATABASE_URL conecta como `postgres`, que
 *   ignora RLS por completo — sem trocar o papel e sem as claims, o INSERT
 *   passaria sempre, com ou sem a migration, e o teste não mediria nada.
 *
 * O USUÁRIO É REAL: `reviews.user_id` tem FK para `profiles(id)`. UUID
 * inventado quebra a constraint antes de medir qualquer coisa — mesmo
 * raciocínio do db-prove-admin-080.cjs. O script pega um profile de verdade
 * do banco (só leitura), preferindo um que não seja admin (o cenário que a
 * issue descreve é o cliente comum, não o lojista).
 *
 * OS CASOS:
 *   ANTES da migration (policy viva hoje em produção, não olha o flag)
 *     1. Flag DESLIGADO -> o INSERT passa (o bug da #101, confirmado)
 *     2. Flag LIGADO    -> o INSERT passa (controle: o caminho comum nunca
 *        esteve quebrado)
 *   Migration aplicada DENTRO da transação
 *   DEPOIS da migration
 *     3. Flag DESLIGADO -> o INSERT é barrado pela RLS
 *     4. Flag LIGADO    -> o INSERT continua passando, exatamente como hoje
 *        (a garantia "desligar demais é tão ruim quanto desligar de menos")
 *   Guarda extra: reviews_select_policy não foi tocada pela migration — a
 *   migration só troca a policy de INSERT.
 *
 * USO:  node scripts/db-prove-admin-090.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260812020000_reviews_insert_respeita_enable_reviews.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem de PROJECT_ROOT + uma das duas strings literais acima.
    // Nada aqui é entrada de usuário, então o alerta é falso positivo.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Só leitura: um profile de verdade, preferindo um que não seja admin — o
 * cenário da issue é o cliente comum tentando burlar o interruptor. */
async function descobrirUsuarioComum(client) {
  const { rows } = await client.query(`
    SELECT id
      FROM public.profiles
     ORDER BY (role = 'customer') DESC, (role = 'admin') ASC
     LIMIT 1`);
  if (rows.length === 0) {
    throw new Error(
      "Nenhum profile encontrado — o teste não tem com quem rodar.",
    );
  }
  return rows[0].id;
}

async function criarProduto(client, nome) {
  // `custo` é NOT NULL sem default nesta tabela — omitir quebra o INSERT.
  const r = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
     VALUES ($1, 5.00, 10.00, 1, 'teste')
     RETURNING id`,
    [nome],
  );
  return r.rows[0].id;
}

async function definirFlag(client, ligado) {
  await client.query(
    "UPDATE public.store_config SET enable_reviews = $1 WHERE id = 1",
    [ligado],
  );
}

/**
 * Tenta inserir uma review como `userId`, isolado num SAVEPOINT — a exceção
 * esperada (quando a RLS barra) aborta a transação, e o savepoint devolve
 * ela ao normal para o próximo caso poder rodar.
 */
let contadorSavepoint = 0;
async function tentarInserirReview(client, userId, produtoId, rotulo) {
  const sp = `sp_review_${++contadorSavepoint}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: userId,
        role: "authenticated",
        app_metadata: { role: "authenticated" },
      }),
    ]);
    const { rows } = await client.query(
      `INSERT INTO public.reviews (product_id, user_id, rating, comment)
       VALUES ($1, $2, 5, 'PROVA ADMIN-090')
       RETURNING id`,
      [produtoId, userId],
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    await client.query("RESET ROLE");
    return { negado: false, id: rows[0].id, rotulo };
  } catch (erro) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query("RESET ROLE");
    return { negado: true, mensagem: erro.message, rotulo };
  }
}

async function policiasDeReviews(client) {
  const { rows } = await client.query(`
    SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
           pg_get_expr(polwithcheck, polrelid) AS with_check_expr
      FROM pg_policy
     WHERE polrelid = 'public.reviews'::regclass
     ORDER BY polname`);
  return rows;
}

async function main() {
  // MIGRATION é constante de módulo, montada de __dirname. Falso positivo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migrationSql = fs.readFileSync(MIGRATION, "utf8");

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await client.query("BEGIN");

  try {
    const userId = await descobrirUsuarioComum(client);
    const produtoId = await criarProduto(client, "PROVA ADMIN-090");

    const policiasAntes = await policiasDeReviews(client);
    console.log("=== Policies de reviews, antes ===");
    for (const p of policiasAntes) {
      console.log(`  ${p.polname} (${p.polcmd})`);
    }
    const selectPolicyAntes = policiasAntes.find(
      (p) => p.polname === "reviews_select_policy",
    );

    console.log("\n=== 1. O bug reproduz hoje (policy não olha o flag)? ===");
    await definirFlag(client, false);
    const antesOff = await tentarInserirReview(
      client,
      userId,
      produtoId,
      "flag OFF, antes",
    );
    conferir(
      "ANTES da migration, com o flag DESLIGADO, o INSERT ainda passa (o bug da #101)",
      !antesOff.negado,
      antesOff.negado ? antesOff.mensagem : undefined,
    );
    if (antesOff.negado) {
      throw new Error(
        "O bug não reproduziu ANTES da migration. Ou alguém já corrigiu por fora, ou o teste não está medindo o que promete — investigue antes de aplicar.",
      );
    }

    await definirFlag(client, true);
    const antesOn = await tentarInserirReview(
      client,
      userId,
      produtoId,
      "flag ON, antes",
    );
    conferir(
      "ANTES da migration, com o flag LIGADO, o INSERT passa (controle: o caminho comum nunca esteve quebrado)",
      !antesOn.negado,
      antesOn.negado ? antesOn.mensagem : undefined,
    );

    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");
    await client.query(migrationSql);

    console.log("\n=== 3. DEPOIS: flag desligado barra o INSERT ===");
    await definirFlag(client, false);
    const depoisOff = await tentarInserirReview(
      client,
      userId,
      produtoId,
      "flag OFF, depois",
    );
    conferir(
      "DEPOIS da migration, com o flag DESLIGADO, o INSERT é barrado pela RLS",
      depoisOff.negado,
      depoisOff.negado ? undefined : `inseriu id=${depoisOff.id}`,
    );

    console.log(
      "\n=== 4. DEPOIS: flag ligado continua permitindo o INSERT (desligar demais é tão ruim quanto desligar de menos) ===",
    );
    await definirFlag(client, true);
    const depoisOn = await tentarInserirReview(
      client,
      userId,
      produtoId,
      "flag ON, depois",
    );
    conferir(
      "DEPOIS da migration, com o flag LIGADO, o INSERT continua passando exatamente como hoje",
      !depoisOn.negado,
      depoisOn.negado ? depoisOn.mensagem : undefined,
    );

    console.log(
      "\n=== 5. Guarda: reviews_select_policy não foi tocada pela migration ===",
    );
    const policiasDepois = await policiasDeReviews(client);
    const selectPolicyDepois = policiasDepois.find(
      (p) => p.polname === "reviews_select_policy",
    );
    conferir(
      "reviews_select_policy continua com a mesma expressão de antes",
      selectPolicyAntes?.using_expr === selectPolicyDepois?.using_expr,
      `antes: ${selectPolicyAntes?.using_expr}; depois: ${selectPolicyDepois?.using_expr}`,
    );
    conferir(
      "a migration mexeu só na policy de INSERT — o número de policies de reviews não mudou",
      policiasAntes.length === policiasDepois.length,
      `antes ${policiasAntes.length}, depois ${policiasDepois.length}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
