"use strict";
// SOMENTE Postgres efemero do CI (rodar-isolado.cjs); nunca banco de loja.
// Prova viva da 20261347000000: o codigo de barras nao repete entre produto e variacao.
// Parte 1 (uma transacao, desfeita no fim): comportamento nas duas direcoes, igualdade exata, nulos e vazios,
// variacao desligada, produto apagado, duplicata ANTIGA que nao trava a edicao, papeis reais, ACL, pre-voo
// contra objeto adulterado, mutante (gatilho desligado deixa a duplicata passar), ida e volta sem tocar dado.
// Parte 2 (conexoes reais, com COMMIT, no clone descartavel): a corrida de dois cadastros do mesmo codigo, um
// em cada tabela, nas duas ordens, e o mesmo cenario com o gatilho desligado como controle.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const ROOT = path.resolve(__dirname, "../..");
const ARQ =
  "20261347000000_o_codigo_de_barras_nao_repete_entre_produto_e_variacao.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const A = ler(
  "scripts/publicacao/consultas/74a-conferir-codigo-de-barras-entre-tabelas-aplicado.sql",
);
const B = ler(
  "scripts/publicacao/consultas/74b-antes-codigo-de-barras-entre-tabelas-ausente.sql",
);
const MENSAGEM =
  "Este código de barras já está em uso por outro produto ou variação.";
const CONSTRAINT = "codigo_barras_unico_entre_produto_e_variacao";
const id = (n) => `c3470000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const URL_EFEMERA = lerDatabaseUrlEfemera();
const C = new Client({ connectionString: URL_EFEMERA });

async function tentar(sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    const r = await C.query(sql, params);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    return {
      codigo: e.code,
      erro: e.message,
      detalhe: e.detail,
      constraint: e.constraint,
      coluna: e.column,
      tabela: e.table,
    };
  }
}
function recusada(r, quem) {
  assert.equal(
    r.codigo,
    "23505",
    `${quem}: esperava 23505, veio ${JSON.stringify(r)}`,
  );
  assert.equal(r.erro, MENSAGEM, quem);
  assert.match(
    r.detalhe ?? "",
    /codigo_barras/,
    `${quem}: o detalhe tem de citar codigo_barras (o front reconhece por ele)`,
  );
  assert.equal(r.constraint, CONSTRAINT, quem);
  assert.equal(r.coluna, "codigo_barras", quem);
}
async function conferir(sql, linhasEsperadas) {
  const linhas = (await C.query(sql)).rows;
  assert.equal(linhas.length, linhasEsperadas);
  return linhas;
}
async function tudoOk(sql, n) {
  const linhas = await conferir(sql, n);
  assert.ok(
    linhas.every((r) => r.ok === true),
    JSON.stringify(linhas),
  );
}
async function papel(nome, admin = false) {
  await C.query("RESET ROLE");
  await C.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      role: nome,
      app_metadata: { role: admin ? "admin" : "customer" },
    }),
  ]);
  // So literais fechados deste teste, nunca identificador recebido de rede.
  if (nome === "anon") await C.query("SET LOCAL ROLE anon");
  else if (nome === "authenticated")
    await C.query("SET LOCAL ROLE authenticated");
}
const SQL_PRODUTO = `INSERT INTO public.produtos (id, nome, preco_venda, custo, codigo_barras, deleted_at)
   VALUES ($1, $2, 10, 5, $3, CASE WHEN $4::boolean THEN now() END)`;
const produto = (n, codigo, apagado = false) =>
  C.query(SQL_PRODUTO, [id(n), `Fixture barras ${n}`, codigo, apagado]);
const variacao = (n, pai, codigo, ativa = true) =>
  C.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, codigo_barras, active)
     VALUES ($1, $2, 'Cor', $3, $4, $5)`,
    [id(n), id(pai), `Valor ${n}`, codigo, ativa],
  );
const tentarProduto = (n, codigo, apagado = false) =>
  tentar(SQL_PRODUTO, [id(n), `Fixture barras ${n}`, codigo, apagado]);
const tentarVariacao = (n, pai, codigo, ativa = true) =>
  tentar(
    `INSERT INTO public.product_variants (id, product_id, name, value, codigo_barras, active)
     VALUES ($1, $2, 'Cor', $3, $4, $5)`,
    [id(n), id(pai), `Valor ${n}`, codigo, ativa],
  );
const existe = async (tabela, n) =>
  Number(
    (
      await C.query(
        tabela === "p"
          ? "SELECT count(*) AS n FROM public.produtos WHERE id=$1"
          : "SELECT count(*) AS n FROM public.product_variants WHERE id=$1",
        [id(n)],
      )
    ).rows[0].n,
  ) === 1;
// Retrato das LINHAS das fixtures (dado) e da ESTRUTURA (indices, ACL, policies, gatilhos alheios).
async function retratoDeDados() {
  return (
    await C.query(
      `SELECT
         (SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) FROM public.produtos p WHERE p.id::text LIKE 'c3470000-%') AS produtos,
         (SELECT md5(coalesce(string_agg(to_jsonb(v)::text, '|' ORDER BY v.id), '')) FROM public.product_variants v WHERE v.id::text LIKE 'c3470000-%') AS variacoes`,
    )
  ).rows[0];
}
async function retratoDeEstrutura() {
  return (
    await C.query(
      `SELECT
         (SELECT jsonb_agg(i.indexdef ORDER BY i.indexname) FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename IN ('produtos','product_variants')) AS indices,
         (SELECT jsonb_agg(c.relname || ':' || coalesce(c.relacl::text,'') || ':' || c.relrowsecurity ORDER BY c.relname) FROM pg_class c WHERE c.oid IN ('public.produtos'::regclass,'public.product_variants'::regclass)) AS acl,
         (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename, p.policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN ('produtos','product_variants')) AS policies,
         (SELECT jsonb_agg(t.tgname ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid IN ('public.produtos'::regclass,'public.product_variants'::regclass) AND NOT t.tgisinternal AND t.tgname NOT LIKE '%codigo_barras_livre%') AS gatilhos_alheios`,
    )
  ).rows[0];
}

async function parte1() {
  await C.query("BEGIN");
  try {
    // 0. Aplicada (o CI aplicou do zero): 74a verde; 74b so reprova a ausencia (os objetos existem).
    await tudoOk(A, 5);
    const antesB = await conferir(B, 3);
    assert.deepEqual(
      antesB.filter((r) => r.ok === false).map((r) => r.item),
      ["gatilhos de codigo de barras: funcoes e gatilhos ausentes"],
    );

    // 1. Produto com X; variacao de OUTRO produto com X e' recusada, e nada e' gravado.
    await produto(1, "7891000000011");
    await produto(2, null);
    recusada(
      await tentarVariacao(101, 2, "7891000000011"),
      "variacao com o codigo do produto",
    );
    assert.equal(
      await existe("v", 101),
      false,
      "a recusa nao grava a variacao",
    );

    // 2. Variacao com Y; produto depois com Y e' recusado (a outra direcao).
    await variacao(102, 2, "7891000000028");
    recusada(
      await tentarProduto(3, "7891000000028"),
      "produto com o codigo da variacao",
    );
    assert.equal(await existe("p", 3), false, "a recusa nao grava o produto");

    // 3. O proprio registro mantendo o codigo (e o painel regravando a linha inteira) passa.
    await C.query(
      "UPDATE public.produtos SET codigo_barras='7891000000011', nome='P1 editado' WHERE id=$1",
      [id(1)],
    );
    await C.query(
      "UPDATE public.product_variants SET codigo_barras='7891000000028', value='Verde' WHERE id=$1",
      [id(102)],
    );

    // 4. Trocar o codigo para um que a outra tabela tem e' recusado nas duas direcoes; a linha nao muda.
    recusada(
      await tentar(
        "UPDATE public.produtos SET codigo_barras='7891000000028' WHERE id=$1",
        [id(1)],
      ),
      "update do produto para o codigo da variacao",
    );
    recusada(
      await tentar(
        "UPDATE public.product_variants SET codigo_barras='7891000000011' WHERE id=$1",
        [id(102)],
      ),
      "update da variacao para o codigo do produto",
    );
    assert.equal(
      (
        await C.query("SELECT codigo_barras FROM public.produtos WHERE id=$1", [
          id(1),
        ])
      ).rows[0].codigo_barras,
      "7891000000011",
    );
    assert.equal(
      (
        await C.query(
          "SELECT codigo_barras FROM public.product_variants WHERE id=$1",
          [id(102)],
        )
      ).rows[0].codigo_barras,
      "7891000000028",
    );

    // 5. Soltar o codigo libera: o produto muda para W e a variacao ja pode usar X; X de volta no produto e' recusado.
    await C.query(
      "UPDATE public.produtos SET codigo_barras='7891000000035' WHERE id=$1",
      [id(1)],
    );
    await variacao(103, 2, "7891000000011");
    recusada(
      await tentar(
        "UPDATE public.produtos SET codigo_barras='7891000000011' WHERE id=$1",
        [id(1)],
      ),
      "voltar ao codigo que a variacao assumiu",
    );

    // 6. Nulos e vazios repetidos passam (nao e' codigo): NULL, '' e so-branco, em produto e em variacao.
    await produto(4, null);
    await produto(5, null);
    await produto(6, "");
    await produto(7, "   ");
    await variacao(104, 2, null);
    await variacao(105, 2, null);
    await variacao(106, 2, "");
    await variacao(107, 2, "   ");

    // 7. Variacao DESLIGADA continua reservando o codigo.
    await variacao(108, 2, "7891000000042", false);
    recusada(
      await tentarProduto(8, "7891000000042"),
      "produto com o codigo de variacao desligada",
    );

    // 8. Produto apagado (soft delete) nao segura codigo; produto gravado ja apagado nao e' checado.
    await produto(9, "7891000000059", true);
    await variacao(109, 2, "7891000000059");
    recusada(
      await tentarProduto(10, "7891000000059"),
      "produto vivo contra a variacao que assumiu o codigo do apagado",
    );
    await produto(11, "7891000000042", true);

    // 9. Igualdade EXATA (como o indice e o balcao): maiuscula/minuscula e zero a esquerda sao codigos diferentes.
    await produto(12, "ABC-1");
    await variacao(110, 2, "abc-1");
    await produto(13, "07891000000066");
    await variacao(111, 2, "7891000000066");

    // 10. Papeis reais: o admin passa pela view e pela tabela e leva a mesma recusa; cliente e visitante nao gravam.
    await papel("authenticated", true);
    recusada(
      await tentar(
        "INSERT INTO public.vw_produtos_admin (id, nome, preco_venda, custo, codigo_barras) VALUES ($1,'Via view',10,5,'7891000000028')",
        [id(20)],
      ),
      "admin pela view com o codigo da variacao",
    );
    recusada(
      await tentarVariacao(112, 2, "7891000000035"),
      "admin com o codigo do produto",
    );
    await C.query(
      "INSERT INTO public.vw_produtos_admin (id, nome, preco_venda, custo, codigo_barras) VALUES ($1,'Via view',10,5,'7891000000073')",
      [id(21)],
    );
    await C.query(
      "UPDATE public.vw_produtos_admin SET nome='Via view editada', codigo_barras='7891000000073' WHERE id=$1",
      [id(21)],
    );
    await papel("authenticated", false);
    const cliente = await tentarVariacao(113, 2, "7891000000099");
    assert.ok(cliente.codigo, "cliente comum nao grava variacao");
    const clienteComCodigoDoProduto = await tentarVariacao(
      114,
      2,
      "7891000000035",
    );
    assert.ok(
      ["23505", "42501"].includes(clienteComCodigoDoProduto.codigo),
      "cliente comum nunca consegue gravar",
    );
    await papel("anon");
    assert.equal(
      (await tentarVariacao(115, 2, "7891000000099")).codigo,
      "42501",
      "visitante nao grava",
    );
    await C.query("RESET ROLE");

    // 11. ACL: ninguem de fora chama a funcao do gatilho.
    await papel("authenticated", true);
    for (const f of [
      "produto_codigo_barras_livre_de_variacao",
      "variacao_codigo_barras_livre_de_produto",
    ]) {
      assert.equal((await tentar(`SELECT public.${f}()`)).codigo, "42501", f);
    }
    await C.query("RESET ROLE");

    // 12. Mutante: com os gatilhos desligados a duplicata ENTRA (e' isto que a prova pega se o gatilho sumir).
    await C.query(
      "ALTER TABLE public.produtos DISABLE TRIGGER tr_produto_codigo_barras_livre_de_variacao",
    );
    await produto(14, "7891000000028");
    assert.equal(
      await existe("p", 14),
      true,
      "controle: sem o gatilho a duplicata entra",
    );
    await C.query(
      "ALTER TABLE public.produtos ENABLE TRIGGER tr_produto_codigo_barras_livre_de_variacao",
    );
    await C.query("DELETE FROM public.produtos WHERE id=$1", [id(14)]);
    await tudoOk(A, 5);

    // 13. Pre-voo recusa objeto ADULTERADO (cada adulteracao desfeita no savepoint).
    for (const [rotulo, adulterar] of [
      [
        "corpo da funcao do produto",
        "CREATE OR REPLACE FUNCTION public.produto_codigo_barras_livre_de_variacao() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$",
      ],
      [
        "corpo da funcao da variacao",
        "CREATE OR REPLACE FUNCTION public.variacao_codigo_barras_livre_de_produto() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$",
      ],
      [
        "sobrecarga da funcao",
        "CREATE FUNCTION public.produto_codigo_barras_livre_de_variacao(x int) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$",
      ],
      [
        "gatilho do produto em outra coluna",
        "CREATE OR REPLACE TRIGGER tr_produto_codigo_barras_livre_de_variacao BEFORE INSERT OR UPDATE OF nome ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.produto_codigo_barras_livre_de_variacao()",
      ],
      [
        "gatilho da variacao so no INSERT",
        "CREATE OR REPLACE TRIGGER tr_variacao_codigo_barras_livre_de_produto BEFORE INSERT ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.variacao_codigo_barras_livre_de_produto()",
      ],
      [
        "gatilho do produto com WHEN",
        "CREATE OR REPLACE TRIGGER tr_produto_codigo_barras_livre_de_variacao BEFORE INSERT OR UPDATE OF codigo_barras ON public.produtos FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.produto_codigo_barras_livre_de_variacao()",
      ],
    ]) {
      await C.query("SAVEPOINT adulterado");
      await C.query(adulterar);
      const ida = await tentar(migration);
      assert.match(
        ida.erro ?? "",
        /B1_BASELINE_DIVERGENT/,
        `ida deveria recusar: ${rotulo}`,
      );
      const volta = await tentar(rollback);
      assert.match(
        volta.erro ?? "",
        /B1_BASELINE_DIVERGENT/,
        `rollback deveria recusar: ${rotulo}`,
      );
      await C.query("ROLLBACK TO SAVEPOINT adulterado");
      await C.query("RELEASE SAVEPOINT adulterado");
    }
    await tudoOk(A, 5);

    // 14. Ida e volta: o rollback e a reaplicacao (duas vezes cada) nao tocam dado, indice, ACL nem policy.
    const dados = await retratoDeDados();
    const estrutura = await retratoDeEstrutura();
    await C.query(rollback);
    await C.query(rollback);
    await tudoOk(B, 3);
    const aposRollback = await conferir(A, 5);
    assert.ok(
      aposRollback.some((r) => r.ok === false),
      "74a reprova sem os objetos",
    );
    assert.deepEqual(await retratoDeDados(), dados, "o rollback nao toca dado");
    assert.deepEqual(
      await retratoDeEstrutura(),
      estrutura,
      "o rollback nao toca indice, ACL nem policy",
    );

    // 15. DUPLICATA ANTIGA (gravada sem o gatilho): a migration nao a recusa nem a altera, e ela nao trava a edicao.
    await produto(30, "7891000000080");
    await variacao(130, 2, "7891000000080");
    const comDuplicata = await retratoDeDados();
    await C.query(migration);
    await C.query(migration);
    await tudoOk(A, 5);
    assert.deepEqual(
      await retratoDeDados(),
      comDuplicata,
      "reaplicar nao toca a duplicata antiga",
    );
    assert.deepEqual(
      await retratoDeEstrutura(),
      estrutura,
      "a migration nao muda indice, ACL nem policy",
    );
    await C.query(
      "UPDATE public.produtos SET nome='P30 editado', preco_venda=99 WHERE id=$1",
      [id(30)],
    );
    await C.query(
      "UPDATE public.produtos SET nome='P30 de novo', codigo_barras='7891000000080' WHERE id=$1",
      [id(30)],
    );
    await C.query(
      "UPDATE public.product_variants SET value='Rosa', codigo_barras='7891000000080' WHERE id=$1",
      [id(130)],
    );
    await C.query(
      "UPDATE public.produtos SET preco_venda = preco_venda + 1 WHERE id LIKE 'c3470000-%'".replace(
        "id LIKE",
        "id::text LIKE",
      ),
    );
    // Mas MUDAR o codigo para o que a outra tabela segura continua barrado, e sair da duplicata e' livre.
    await C.query(
      "UPDATE public.produtos SET codigo_barras='7891000000097' WHERE id=$1",
      [id(30)],
    );
    recusada(
      await tentar(
        "UPDATE public.produtos SET codigo_barras='7891000000080' WHERE id=$1",
        [id(30)],
      ),
      "voltar a duplicata antiga",
    );
    await C.query("UPDATE public.produtos SET codigo_barras=NULL WHERE id=$1", [
      id(30),
    ]);

    // 16. Depois da ida e volta tudo continua protegido.
    recusada(
      await tentarVariacao(116, 2, "7891000000035"),
      "apos a reaplicacao",
    );
    await tudoOk(A, 5);
  } finally {
    await C.query("ROLLBACK");
  }
}

async function parte2() {
  const conn = async () => {
    const c = new Client({ connectionString: URL_EFEMERA });
    await c.connect();
    return c;
  };
  const Aa = await conn();
  const Bb = await conn();
  const limpar = async () => {
    await C.query(
      "ALTER TABLE public.produtos ENABLE TRIGGER tr_produto_codigo_barras_livre_de_variacao",
    );
    await C.query(
      "ALTER TABLE public.product_variants ENABLE TRIGGER tr_variacao_codigo_barras_livre_de_produto",
    );
    await C.query(
      "DELETE FROM public.product_variants WHERE id::text LIKE 'c3470000-%'",
    );
    await C.query(
      "DELETE FROM public.produtos WHERE id::text LIKE 'c3470000-%'",
    );
  };
  try {
    await limpar();
    await C.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, custo) VALUES ($1,'Pai da corrida',10,5)",
      [id(900)],
    );
    await Bb.query("SET statement_timeout = '8s'");
    await Aa.query("SET statement_timeout = '8s'");

    const esperaNaTrava = async () => {
      for (let i = 0; i < 80; i++) {
        const r = await C.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted",
        );
        if (r.rows[0].n >= 1) return true;
        await new Promise((ok) => setTimeout(ok, 50));
      }
      return false;
    };
    // A grava primeiro (sem commitar); B tenta o mesmo codigo na OUTRA tabela e TEM de ficar esperando.
    const corrida = async (codigo, primeiro, idPrimeiro, idSegundo) => {
      await Aa.query("BEGIN");
      await Bb.query("BEGIN");
      if (primeiro === "produto") {
        await Aa.query(
          "INSERT INTO public.produtos (id, nome, preco_venda, custo, codigo_barras) VALUES ($1,'Corrida',10,5,$2)",
          [id(idPrimeiro), codigo],
        );
      } else {
        await Aa.query(
          "INSERT INTO public.product_variants (id, product_id, name, value, codigo_barras) VALUES ($1,$2,'Cor','Corrida',$3)",
          [id(idPrimeiro), id(900), codigo],
        );
      }
      const segundo =
        primeiro === "produto"
          ? Bb.query(
              "INSERT INTO public.product_variants (id, product_id, name, value, codigo_barras) VALUES ($1,$2,'Cor','Corrida 2',$3)",
              [id(idSegundo), id(900), codigo],
            ).then(
              () => ({ ok: true }),
              (e) => ({ ok: false, codigo: e.code, erro: e.message }),
            )
          : Bb.query(
              "INSERT INTO public.produtos (id, nome, preco_venda, custo, codigo_barras) VALUES ($1,'Corrida 2',10,5,$2)",
              [id(idSegundo), codigo],
            ).then(
              () => ({ ok: true }),
              (e) => ({ ok: false, codigo: e.code, erro: e.message }),
            );
      assert.equal(
        await esperaNaTrava(),
        true,
        `${primeiro} primeiro: o segundo cadastro tem de esperar na trava`,
      );
      await Aa.query("COMMIT");
      const resultado = await segundo;
      await Bb.query("ROLLBACK");
      return resultado;
    };
    const r1 = await corrida("CORRIDA-1", "produto", 901, 902);
    assert.equal(r1.ok, false);
    assert.equal(r1.codigo, "23505");
    assert.equal(r1.erro, MENSAGEM);
    const r2 = await corrida("CORRIDA-2", "variacao", 903, 904);
    assert.equal(r2.ok, false);
    assert.equal(r2.codigo, "23505");
    assert.equal(r2.erro, MENSAGEM);
    // Sobrou so o primeiro de cada par.
    const sobras = await C.query(
      `SELECT (SELECT count(*)::int FROM public.produtos WHERE codigo_barras IN ('CORRIDA-1','CORRIDA-2')) AS p,
              (SELECT count(*)::int FROM public.product_variants WHERE codigo_barras IN ('CORRIDA-1','CORRIDA-2')) AS v`,
    );
    assert.deepEqual(sobras.rows[0], { p: 1, v: 1 });

    // Codigos DIFERENTES nao se esperam (a trava e' por codigo, nao da tabela inteira).
    await Aa.query("BEGIN");
    await Bb.query("BEGIN");
    await Aa.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, custo, codigo_barras) VALUES ($1,'Livre A',10,5,'LIVRE-A')",
      [id(905)],
    );
    await Bb.query(
      "INSERT INTO public.product_variants (id, product_id, name, value, codigo_barras) VALUES ($1,$2,'Cor','Livre B','LIVRE-B')",
      [id(906), id(900)],
    );
    await Aa.query("COMMIT");
    await Bb.query("COMMIT");

    // CONTROLE (o que a prova pega se o gatilho sumir): sem ele os dois entram e a duplicata existe.
    await C.query(
      "ALTER TABLE public.produtos DISABLE TRIGGER tr_produto_codigo_barras_livre_de_variacao",
    );
    await C.query(
      "ALTER TABLE public.product_variants DISABLE TRIGGER tr_variacao_codigo_barras_livre_de_produto",
    );
    await Aa.query("BEGIN");
    await Bb.query("BEGIN");
    await Aa.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, custo, codigo_barras) VALUES ($1,'Sem gatilho',10,5,'CORRIDA-3')",
      [id(907)],
    );
    await Bb.query(
      "INSERT INTO public.product_variants (id, product_id, name, value, codigo_barras) VALUES ($1,$2,'Cor','Sem gatilho','CORRIDA-3')",
      [id(908), id(900)],
    );
    await Aa.query("COMMIT");
    await Bb.query("COMMIT");
    const dup = await C.query(
      `SELECT (SELECT count(*)::int FROM public.produtos WHERE codigo_barras='CORRIDA-3') AS p,
              (SELECT count(*)::int FROM public.product_variants WHERE codigo_barras='CORRIDA-3') AS v`,
    );
    assert.deepEqual(
      dup.rows[0],
      { p: 1, v: 1 },
      "controle: sem o gatilho a corrida grava a duplicata",
    );
  } finally {
    await Aa.query("ROLLBACK").catch(() => {});
    await Bb.query("ROLLBACK").catch(() => {});
    await limpar().catch((e) => console.error("[limpeza]", e.message));
    await Aa.end().catch(() => {});
    await Bb.end().catch(() => {});
  }
}

async function main() {
  await C.connect();
  try {
    await parte1();
    await parte2();
    console.log(
      "[codigo-de-barras-entre-tabelas] PASSOU: duas direcoes, igualdade exata, nulos/vazios, desligada, apagado, duplicata antiga, papeis, ACL, pre-voo adulterado, ida e volta sem tocar dado, corrida real e controle",
    );
  } finally {
    await C.end();
  }
}
main().catch((e) => {
  console.error(
    "[codigo-de-barras-entre-tabelas] FALHOU:",
    e.stack || e.message,
  );
  process.exitCode = 1;
});
