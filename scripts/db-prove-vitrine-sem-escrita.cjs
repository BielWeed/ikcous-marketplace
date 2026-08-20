#!/usr/bin/env node
/**
 * Prova a correcao que fecha a escrita anonima na vitrine de produtos
 * (vw_produtos_public) sem comitar nada no banco.
 *
 *   supabase/migrations/20260821000100_revoke_escrita_anonima_vw_produtos_public.sql
 *
 * O BURACO
 *   vw_produtos_public nao tem security_invoker: o RLS e as checagens de
 *   permissao da tabela de baixo (produtos) rodam como o DONO da view
 *   (postgres), que e' isento do proprio RLS (relforcerowsecurity = false).
 *   A view e' auto-atualizavel e `anon` tem INSERT/UPDATE/DELETE nela --
 *   qualquer requisicao HTTP com a chave publica altera preco, estoque e
 *   nome de qualquer produto, e apaga produtos, sem login.
 *
 * TUDO DENTRO DE UMA TRANSACAO QUE TERMINA EM ROLLBACK
 *   A migration foi conferida: nao tem BEGIN/COMMIT proprio (o script se
 *   recusa a rodar se tiver -- senao o COMMIT dela fecharia esta transacao
 *   e o ROLLBACK final viraria no-op).
 *
 * POR QUE SAVEPOINT em volta de cada UPDATE/DELETE/INSERT
 *   Uma query que falha deixa a transacao "abortada" ate um ROLLBACK (ou
 *   ROLLBACK TO SAVEPOINT). Como o roteiro PRECISA que varias dessas
 *   tentativas falhem (isso e' o que prova a correcao), cada uma roda
 *   isolada num savepoint -- a falha esperada desfaz so aquela tentativa, e
 *   o resto do roteiro continua.
 *
 * POR QUE RESET ROLE antes de cada SET ROLE
 *   O pooler do Supabase mantem SET ROLE entre conexoes -- observado nesta
 *   maquina em 20/08/2026. Sem RESET ROLE explicito antes de cada troca, o
 *   script mediria o papel errado sem perceber. SET ROLE (sessao, nao
 *   LOCAL) e' desfeito por ROLLBACK TO SAVEPOINT se o savepoint for anterior
 *   a ele -- por isso o SAVEPOINT de cada tentativa e' criado DEPOIS do SET
 *   ROLE, para a troca de papel sobreviver a um ROLLBACK TO SAVEPOINT.
 *
 * O ROTEIRO
 *   1. Le um produto real e a contagem da vitrine (papel padrao da conexao,
 *      sem RLS -- so leitura, serve de referencia).
 *   2. ANTES da migration: anon tenta UPDATE em vw_produtos_public. TEM DE
 *      FUNCIONAR -- se falhar aqui, o buraco nao existe como descrito, ou o
 *      teste esta medindo a coisa errada, e o script para e reporta.
 *   3. Migration aplicada dentro da transacao.
 *   4. DEPOIS: anon tenta o mesmo UPDATE, mais DELETE e INSERT. OS TRES TEM
 *      DE FALHAR com erro de permissao.
 *   5. DEPOIS: a contagem da vitrine para anon e para authenticated
 *      continua igual a' contagem lida no passo 1 -- prova que o catalogo
 *      nao quebrou (a razao de NAO ligar security_invoker).
 *   6. ROLLBACK. Nada fica gravado.
 *
 * USO:  node scripts/db-prove-vitrine-sem-escrita.cjs
 * Sai com codigo 0 so se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260821000100_revoke_escrita_anonima_vw_produtos_public.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem de PROJECT_ROOT + uma das duas strings literais acima.
    // Nada aqui e' entrada de usuario, entao o alerta e' falso positivo.
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

function lerMigration() {
  // MIGRATION e' constante de modulo, montada de __dirname. Falso positivo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(MIGRATION, "utf8");
  // A trava que faz o ROLLBACK desta prova valer alguma coisa.
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
    throw new Error(
      "A migration tem BEGIN/COMMIT próprio: o ROLLBACK desta prova viraria no-op.",
    );
  }
  return sql;
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

/**
 * Tenta uma query isolada num SAVEPOINT: a falha esperada (permissão negada)
 * aborta só o savepoint, o resto da transação continua utilizável.
 */
let contadorSavepoint = 0;
async function tentar(client, sql, params, rotulo) {
  const sp = `sp_vitrine_${++contadorSavepoint}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const r = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { negado: false, rowCount: r.rowCount, rotulo };
  } catch (erro) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { negado: true, mensagem: erro.message, rotulo };
  }
}

async function trocarPara(client, papel) {
  // O pooler mantém SET ROLE entre conexões — nunca trocar sem antes limpar.
  await client.query("RESET ROLE");
  if (papel) await client.query(`SET ROLE ${papel}`);
}

async function main() {
  const migrationSql = lerMigration();

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await trocarPara(client, null);
  await client.query("BEGIN");

  try {
    const { rows: idRows } = await client.query(
      "SELECT id FROM public.vw_produtos_public ORDER BY id LIMIT 1",
    );
    if (idRows.length === 0) {
      throw new Error(
        "vw_produtos_public não devolveu nenhuma linha — sem massa para provar.",
      );
    }
    const produtoId = idRows[0].id;

    const { rows: contRows } = await client.query(
      "SELECT count(*)::int AS n FROM public.vw_produtos_public",
    );
    const totalAntes = contRows[0].n;
    console.log(
      `Produto de prova: ${produtoId} · contagem da vitrine antes: ${totalAntes}\n`,
    );

    console.log("=== 1. ANTES da migration: o buraco reproduz? ===");
    await trocarPara(client, "anon");
    const updateAntes = await tentar(
      client,
      "UPDATE public.vw_produtos_public SET preco_venda = 0.01 WHERE id = $1",
      [produtoId],
      "UPDATE como anon, antes",
    );
    conferir(
      "ANTES da migration, anon consegue UPDATE em vw_produtos_public (o buraco descrito)",
      !updateAntes.negado && updateAntes.rowCount === 1,
      updateAntes.negado
        ? updateAntes.mensagem
        : `rowCount=${updateAntes.rowCount}`,
    );
    if (updateAntes.negado) {
      throw new Error(
        "O buraco NÃO reproduziu antes da migration. Pare e investigue: ou o buraco não existe como descrito, ou o teste está medindo a coisa errada.",
      );
    }

    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");
    await trocarPara(client, null);
    await client.query(migrationSql);
    console.log("  aplicada dentro da transação");

    console.log(
      "\n=== 3. DEPOIS: anon é barrado em UPDATE, DELETE e INSERT ===",
    );
    await trocarPara(client, "anon");
    const updateDepois = await tentar(
      client,
      "UPDATE public.vw_produtos_public SET preco_venda = 0.02 WHERE id = $1",
      [produtoId],
      "UPDATE como anon, depois",
    );
    conferir(
      "DEPOIS da migration, o UPDATE de anon é barrado por permissão",
      updateDepois.negado && /permission denied/i.test(updateDepois.mensagem),
      updateDepois.negado ? updateDepois.mensagem : "não foi negado",
    );

    await trocarPara(client, "anon");
    const deleteDepois = await tentar(
      client,
      "DELETE FROM public.vw_produtos_public WHERE id = $1",
      [produtoId],
      "DELETE como anon, depois",
    );
    conferir(
      "DEPOIS da migration, o DELETE de anon é barrado por permissão",
      deleteDepois.negado && /permission denied/i.test(deleteDepois.mensagem),
      deleteDepois.negado ? deleteDepois.mensagem : "não foi negado",
    );

    await trocarPara(client, "anon");
    const insertDepois = await tentar(
      client,
      "INSERT INTO public.vw_produtos_public (nome, preco_venda) VALUES ('PROVA VITRINE-SEM-ESCRITA', 1.00)",
      [],
      "INSERT como anon, depois",
    );
    conferir(
      "DEPOIS da migration, o INSERT de anon é barrado por permissão",
      insertDepois.negado && /permission denied/i.test(insertDepois.mensagem),
      insertDepois.negado ? insertDepois.mensagem : "não foi negado",
    );

    console.log(
      "\n=== 4. O catálogo continua de pé (mesma contagem de antes) ===",
    );
    await trocarPara(client, "anon");
    const { rows: contAnonDepois } = await client.query(
      "SELECT count(*)::int AS n FROM public.vw_produtos_public",
    );
    conferir(
      "contagem da vitrine para anon não mudou",
      contAnonDepois[0].n === totalAntes,
      `antes ${totalAntes}, depois(anon) ${contAnonDepois[0].n}`,
    );

    await trocarPara(client, "authenticated");
    const { rows: contAuthDepois } = await client.query(
      "SELECT count(*)::int AS n FROM public.vw_produtos_public",
    );
    conferir(
      "contagem da vitrine para authenticated não mudou",
      contAuthDepois[0].n === totalAntes,
      `antes ${totalAntes}, depois(authenticated) ${contAuthDepois[0].n}`,
    );
  } finally {
    await trocarPara(client, null).catch(() => {});
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
