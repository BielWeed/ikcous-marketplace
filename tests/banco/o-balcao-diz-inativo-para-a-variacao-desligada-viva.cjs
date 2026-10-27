"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261393100000_o_balcao_diz_inativo_para_a_variacao_desligada.sql (public.buscar_por_codigo_barras,
 * a variacao DESLIGADA com o codigo cai no terceiro caso "cadastrado mas inativo") contra o Postgres EFEMERO com as migrations
 * aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de loja. Tudo numa transacao desfeita no fim (a funcao so le).
 *
 * O que prova:
 *  (1) A bateria de codigos, com a fixture criada ANTES de qualquer troca de corpo: produto ativo e produto inativo seguem como
 *      eram; variacao ATIVA segue como era; variacao DESLIGADA (active falso) e variacao com active NULL passam a ser achadas
 *      (encontrado, origem 'variante', produto.ativo falso, variacoes []); o preco e o estoque sao os da variacao (override ZERO
 *      e' preco, override NULL cai no preco do produto); variacao desligada de produto INATIVO tambem; variacao desligada de
 *      produto APAGADO segue "nao encontrado"; o codigo de um produto ativo vence o da variacao desligada que o repete; o
 *      codigo e' igualdade (um EAN e' prefixo de outro, o outro e' o que e' achado); espaco e CRLF em volta sao aparados.
 *  (2) Contrato: as 8 chaves da resposta em TODOS os casos; produto e variante do caso novo tem as mesmas chaves que o da
 *      variacao ativa, e a resposta da variacao desligada e' IGUAL a da mesma linha ligada, so com produto.ativo falso.
 *  (3) O DEFEITO, com o CONTROLE no corpo da 20261381000000 (rollback): a variacao desligada volta "nao encontrado" ("cadastre o
 *      produto"), e os casos que ja eram achados dao a MESMA resposta nos dois corpos.
 *  (4) Porta: cliente comum, ex-admin (so profiles rebaixado) e sessao ausente seguem recusados (42501) buscando o
 *      codigo da variacao desligada; o codigo vazio e o acima de 64 caracteres seguem recusados (22023).
 *  (5) Dados intactos: o md5 de produtos e product_variants e' o mesmo antes e depois de buscar, reaplicar e desfazer.
 *  (6) Mutantes (active = false no lugar de IS DISTINCT FROM true, sem o filtro de produto apagado, 'ativo' verdadeiro, origem
 *      'produto', sem a lista vazia, LIKE no lugar de =, variacao desligada vencendo o produto) deixam a bateria vermelha; o
 *      corpo anterior reprova a bateria.
 *  (7) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; o rollback devolve o corpo da 20261381000000 byte a byte; o
 *      rollback de novo deixa o mesmo estado; reaplicar depois volta; o rollback da 20261381000000 RECUSA com o corpo desta no ar
 *      e o helper de provas (o-balcao-diz-inativo-posterior.cjs) o desfaz primeiro.
 *  (8) Pre-voo recusa sem escrever (corpo desconhecido, ACL aberta para anon e para PUBLIC, authenticated sem EXECUTE, sobrecarga,
 *      SECURITY INVOKER, VOLATILE, search_path trocado); o rollback recusa corpo desconhecido; a conferencia final sabotada
 *      derruba o arquivo inteiro.
 *  (9) Consultas 104a/104b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco; a 86a e a 9a aceitam o
 *      corpo desta migration como sucessor do da 20261381000000.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-balcao-diz-inativo-para-a-variacao-desligada-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  desfazerBalcaoDizInativoNaTransacao,
  BALCAO_DIZ_INATIVO,
} = require("./o-balcao-diz-inativo-posterior.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261393100000_o_balcao_diz_inativo_para_a_variacao_desligada.sql";
const NOME_81 =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const rollback81 = ler(`supabase/migrations/rollback-manual-${NOME_81}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const REGEX_DA_FUNCAO =
  /CREATE OR REPLACE FUNCTION public\.buscar_por_codigo_barras\(p_codigo text\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/;
const corpoDe = (sql) => sql.match(REGEX_DA_FUNCAO)[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_81}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "e1b93114cd9deee7eda6801ef37ff1f9";
const HASH_NOVO = "3e2276ae97a7f2aef487e55d259ba7a3";
const ASSINATURA = "public.buscar_por_codigo_barras(text)";
const C104A =
  "104a-conferir-o-balcao-diz-inativo-para-a-variacao-desligada-aplicado";
const C104B =
  "104b-antes-o-balcao-diz-inativo-para-a-variacao-desligada-base-vigente";
const CABECALHO_DA_FUNCAO = migration.match(
  /CREATE OR REPLACE FUNCTION public\.buscar_por_codigo_barras\(p_codigo text\)[\s\S]*?\nAS \$function\$/,
)[0];
const trocarCorpo = (c, corpo) =>
  c.query(`${CABECALHO_DA_FUNCAO}${corpo}$function$;`);

const ADMIN = "b3931000-0000-4000-8000-000000000001";
const CLIENTE = "b3931000-0000-4000-8000-000000000002";
const EX_ADMIN = "b3931000-0000-4000-8000-000000000003";
const EAN = {
  produtoAtivo: "7931000000011",
  produtoInativo: "7931000000028",
  varLigada: "7932000000018",
  varDesligada: "7932000000025",
  varNula: "7932000000032",
  varZero: "7932000000049",
  varSemPreco: "7932000000056",
  varDeInativo: "7934000000012",
  varDeApagado: "7933000000015",
  colisao: "7935000000019",
  // 14 digitos, e a varDesligada (13) e' prefixo dele: so a igualdade acha o certo.
  maior: "79320000000250",
  ninguem: "7939999999990",
  // 12 digitos: so PREFIXO de variacoes desligadas (a varDesligada e a varNula comecam por ele) e nao e codigo de nada.
  soPrefixo: "793200000002",
};
const CHAVES = [
  "codigo",
  "encontrado",
  "estoque",
  "origem",
  "preco",
  "produto",
  "variacoes",
  "variante",
];

async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso1393b");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso1393b");
    await c.query("RELEASE SAVEPOINT caso1393b");
  }
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa1393b");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa1393b");
    await c.query("RELEASE SAVEPOINT recusa1393b");
  }
}
const buscar = async (c, codigo) =>
  (await c.query("SELECT public.buscar_por_codigo_barras($1) AS r", [codigo]))
    .rows[0].r;
// Uma conexao so': as buscas vao em fila, nunca em paralelo.
const buscarTodos = async (c, codigos) => {
  const saida = [];
  for (const codigo of codigos) saida.push(await buscar(c, codigo));
  return saida;
};
const CASOS_QUE_NAO_MUDAM = [
  EAN.produtoAtivo,
  EAN.produtoInativo,
  EAN.varLigada,
  EAN.colisao,
  EAN.maior,
  EAN.varDeApagado,
  EAN.ninguem,
  EAN.soPrefixo,
];
async function comoUsuario(c, id, acao) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [id]);
  try {
    return await acao();
  } finally {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
  }
}
const dumpDosDados = async (c) =>
  (
    await c.query(
      `SELECT md5(COALESCE((SELECT string_agg(to_jsonb(x)::text, '|' ORDER BY x.id) FROM public.produtos x), '')
              || '#' ||
              COALESCE((SELECT string_agg(to_jsonb(v)::text, '|' ORDER BY v.id) FROM public.product_variants v), '')) AS h`,
    )
  ).rows[0].h;

/** Cria a fixture (dentro da transacao da prova). Devolve os ids que a bateria compara. */
async function fixture(c) {
  const ids = {};
  const produto = async (rotulo, o) => {
    const r = await c.query(
      `INSERT INTO public.produtos (nome, codigo_barras, categoria, custo, preco_venda, estoque, ativo, deleted_at)
       VALUES ($1, $2, 'Geral1393b', 10, 20, $3, $4, $5) RETURNING id`,
      [
        `Prova1393b ${rotulo}`,
        o.ean ?? null,
        o.estoque ?? 100,
        o.ativo ?? true,
        o.apagado ? new Date().toISOString() : null,
      ],
    );
    ids[rotulo] = r.rows[0].id;
    return r.rows[0].id;
  };
  const variacao = async (rotulo, pai, o) => {
    const r = await c.query(
      `INSERT INTO public.product_variants (product_id, name, value, sku, codigo_barras, active, stock_increment, price_override)
       VALUES ($1, 'Cor', $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        pai,
        o.valor,
        `SKU1393b-${rotulo}`,
        o.ean,
        o.ativa === undefined ? true : o.ativa,
        o.estoque ?? 10,
        o.preco === undefined ? null : o.preco,
      ],
    );
    ids[rotulo] = r.rows[0].id;
    return r.rows[0].id;
  };
  await produto("produtoAtivo", { ean: EAN.produtoAtivo });
  await produto("produtoInativo", { ean: EAN.produtoInativo, ativo: false });
  const tenis = await produto("tenis", {});
  await variacao("varLigada", tenis, { valor: "Ligada", ean: EAN.varLigada });
  await variacao("varDesligada", tenis, {
    valor: "Desligada",
    ean: EAN.varDesligada,
    ativa: false,
    estoque: 7,
    preco: 12.34,
  });
  // active NULL: a coluna aceita (default true), e "nao e' true" e' desligada.
  await variacao("varNula", tenis, {
    valor: "Nula",
    ean: EAN.varNula,
    ativa: null,
    estoque: 4,
    preco: 15.5,
  });
  await variacao("varZero", tenis, {
    valor: "Brinde",
    ean: EAN.varZero,
    ativa: false,
    estoque: 3,
    preco: 0,
  });
  await variacao("varSemPreco", tenis, {
    valor: "SemPreco",
    ean: EAN.varSemPreco,
    ativa: false,
    estoque: 2,
    preco: null,
  });
  const paiInativo = await produto("paiInativo", { ativo: false });
  await variacao("varDeInativo", paiInativo, {
    valor: "DeInativo",
    ean: EAN.varDeInativo,
    ativa: false,
  });
  const paiApagado = await produto("paiApagado", { apagado: true });
  await variacao("varDeApagado", paiApagado, {
    valor: "DeApagado",
    ean: EAN.varDeApagado,
    ativa: false,
  });
  // O codigo repetido entre variacao DESLIGADA e produto ATIVO: so existe em dado antigo (o gatilho de hoje recusa), entao a
  // linha entra com os gatilhos de usuario desligados, na transacao desta prova.
  const paiColisao = await produto("paiColisao", {});
  await variacao("varColisao", paiColisao, {
    valor: "Colisao",
    ean: EAN.colisao,
    ativa: false,
  });
  await c.query("SET LOCAL session_replication_role = replica");
  await produto("produtoColisao", { ean: EAN.colisao });
  await c.query("SET LOCAL session_replication_role = origin");
  await produto("produtoMaior", { ean: EAN.maior });
  return ids;
}

const norm = (r) => JSON.stringify(r);

/** A bateria inteira. Devolve a lista de erros (vazia = tudo certo). */
async function bateria(c, ids) {
  const erros = [];
  const confere = (cond, msg) => {
    if (!cond) erros.push(msg);
  };
  const r = {};
  for (const [k, codigo] of Object.entries(EAN)) r[k] = await buscar(c, codigo);

  // 1. Quem ja era achado continua sendo, igual.
  confere(
    r.produtoAtivo.encontrado === true &&
      r.produtoAtivo.origem === "produto" &&
      r.produtoAtivo.produto.ativo === true &&
      r.produtoAtivo.produto.id === ids.produtoAtivo &&
      r.produtoAtivo.produto.tem_variantes === false &&
      r.produtoAtivo.variante === null,
    `produto ativo mudou: ${norm(r.produtoAtivo)}`,
  );
  confere(
    r.produtoInativo.encontrado === true &&
      r.produtoInativo.origem === "produto" &&
      r.produtoInativo.produto.ativo === false &&
      r.produtoInativo.produto.id === ids.produtoInativo,
    `produto inativo mudou: ${norm(r.produtoInativo)}`,
  );
  confere(
    r.varLigada.encontrado === true &&
      r.varLigada.origem === "variante" &&
      r.varLigada.produto.ativo === true &&
      r.varLigada.variante.variant_id === ids.varLigada &&
      r.varLigada.variacoes.length === 0,
    `variacao ligada mudou: ${norm(r.varLigada)}`,
  );
  confere(
    r.ninguem.encontrado === false &&
      r.ninguem.origem === null &&
      r.ninguem.produto === null &&
      r.ninguem.variante === null &&
      r.ninguem.preco === null &&
      r.ninguem.estoque === null &&
      Array.isArray(r.ninguem.variacoes) &&
      r.ninguem.variacoes.length === 0 &&
      r.ninguem.codigo === EAN.ninguem,
    `codigo de ninguem mudou: ${norm(r.ninguem)}`,
  );

  // 2. O terceiro caso: variacao desligada / com active NULL.
  for (const [rotulo, esperaPreco, esperaEstoque] of [
    ["varDesligada", 12.34, 7],
    ["varNula", 15.5, 4],
    ["varZero", 0, 3],
    ["varSemPreco", 20, 2],
  ]) {
    const x = r[rotulo];
    confere(
      x.encontrado === true &&
        x.origem === "variante" &&
        x.produto?.ativo === false &&
        x.produto?.id === ids.tenis &&
        x.variante?.variant_id === ids[rotulo] &&
        Number(x.preco) === esperaPreco &&
        Number(x.estoque) === esperaEstoque &&
        Array.isArray(x.variacoes) &&
        x.variacoes.length === 0,
      `${rotulo} nao caiu no terceiro caso: ${norm(x)}`,
    );
  }
  confere(
    r.varDeInativo.encontrado === true &&
      r.varDeInativo.produto?.ativo === false &&
      r.varDeInativo.origem === "variante",
    `variacao desligada de produto inativo: ${norm(r.varDeInativo)}`,
  );
  confere(
    r.varDeApagado.encontrado === false &&
      r.varDeApagado.produto === null &&
      Array.isArray(r.varDeApagado.variacoes),
    `variacao desligada de produto APAGADO tem de seguir nao encontrada: ${norm(r.varDeApagado)}`,
  );

  // 3. Precedencia: o produto ativo que repete o codigo vence a variacao desligada.
  confere(
    r.colisao.encontrado === true &&
      r.colisao.origem === "produto" &&
      r.colisao.produto?.ativo === true &&
      r.colisao.produto?.id === ids.produtoColisao &&
      r.colisao.variante === null,
    `o produto devia vencer a variacao desligada: ${norm(r.colisao)}`,
  );

  // 4. Igualdade: o EAN de 14 digitos (a variacao desligada de 13 e' prefixo dele) acha o produto, e o de 13 acha a variacao.
  confere(
    r.maior.origem === "produto" && r.maior.produto?.id === ids.produtoMaior,
    `o EAN maior devia achar o produto: ${norm(r.maior)}`,
  );
  confere(
    r.varDesligada.variante?.variant_id === ids.varDesligada,
    "o EAN menor (prefixo do maior) devia achar a variacao",
  );

  confere(
    r.soPrefixo.encontrado === false && r.soPrefixo.produto === null,
    `um pedaco de codigo (prefixo de variacoes desligadas) nao acha nada: ${norm(r.soPrefixo)}`,
  );

  // 5. Normalizacao: espaco e CRLF em volta.
  const aparado = await buscar(c, `  ${EAN.varDesligada}\r\n`);
  confere(
    aparado.encontrado === true &&
      aparado.codigo === EAN.varDesligada &&
      aparado.variante?.variant_id === ids.varDesligada,
    `codigo com espaco e CRLF: ${norm(aparado)}`,
  );

  // 6. Contrato: as 8 chaves em todos os casos; produto e variante do caso novo tem as chaves do caso da variacao ligada.
  for (const [k, v] of Object.entries(r))
    confere(
      JSON.stringify(Object.keys(v).sort()) === JSON.stringify(CHAVES),
      `${k}: chaves da resposta diferentes (${Object.keys(v).sort()})`,
    );
  const chavesDe = (o) => JSON.stringify(Object.keys(o ?? {}).sort());
  for (const k of ["varDesligada", "varNula", "varZero", "varSemPreco"]) {
    confere(
      chavesDe(r[k].produto) === chavesDe(r.varLigada.produto),
      `${k}: chaves do produto diferentes das da variacao ligada`,
    );
    confere(
      chavesDe(r[k].variante) === chavesDe(r.varLigada.variante),
      `${k}: chaves da variante diferentes das da variacao ligada`,
    );
  }
  // A MESMA linha ligada e desligada: a resposta so difere em produto.ativo.
  await c.query("SAVEPOINT virar1393b");
  await c.query(
    "UPDATE public.product_variants SET active = true WHERE id = $1",
    [ids.varDesligada],
  );
  const ligada = await buscar(c, EAN.varDesligada);
  await c.query("ROLLBACK TO SAVEPOINT virar1393b");
  await c.query("RELEASE SAVEPOINT virar1393b");
  confere(
    norm({ ...ligada, produto: { ...ligada.produto, ativo: false } }) ===
      norm(r.varDesligada),
    "a variacao desligada devia responder igual a mesma variacao ligada, so com produto.ativo falso",
  );
  return erros;
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261381000000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261393100000",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(md5(CORPO_ANTES), HASH_ANTES);
    assert.equal(topo.prosecdef, true);
    assert.equal(topo.provolatile, "s");
    assert.deepEqual(topo.proconfig, ["search_path=pg_catalog, pg_temp"]);
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido)",
    );

    // ---- Atores e fixture (criados ANTES de qualquer troca de corpo; sao dados que ja existiam). ----
    for (const [id, papelAuth, papelPerfil] of [
      [ADMIN, "admin", "admin"],
      [CLIENTE, "customer", "customer"],
      [EX_ADMIN, "admin", "customer"],
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@balcao1393b.invalid', $2::jsonb)`,
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ($1, 'Ficticio 1393b', $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papelPerfil],
      );
      await c.query(
        "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
        [id, JSON.stringify(papelAuth === "admin" ? { role: "admin" } : {})],
      );
    }
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    const ids = await fixture(c);
    const dadosAntes = await dumpDosDados(c);

    // ---- 1+2. A bateria no corpo novo. ----
    const verde = await bateria(c, ids);
    assert.deepEqual(verde, [], verde.join("\n"));
    console.log(
      `  PASSOU a bateria: ${Object.keys(EAN).length} codigos + normalizacao + contrato de chaves + a mesma linha ligada/desligada`,
    );

    // ---- 3. O defeito, com o controle no corpo da 20261381000000. ----
    const controle = await isolado(c, async () => {
      await c.query(rollback);
      assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
      return {
        erros: await bateria(c, ids),
        desligada: await buscar(c, EAN.varDesligada),
        nula: await buscar(c, EAN.varNula),
        // os casos que ja eram achados: resposta do corpo anterior, para comparar com a do novo
        antes: await buscarTodos(c, CASOS_QUE_NAO_MUDAM),
      };
    });
    assert.equal(
      controle.desligada.encontrado,
      false,
      "controle: o corpo anterior devia dizer 'nao encontrado' (o defeito)",
    );
    assert.equal(controle.nula.encontrado, false);
    assert.ok(
      controle.erros.length >= 4,
      `o corpo anterior teria de reprovar a bateria (${controle.erros.length})`,
    );
    const depois = await buscarTodos(c, CASOS_QUE_NAO_MUDAM);
    assert.equal(
      norm(depois),
      norm(controle.antes),
      "um caso que ja era achado (ou nao achado) deu resposta DIFERENTE do corpo anterior",
    );
    console.log(
      `  PASSOU o defeito e o controle: corpo anterior -> 'nao encontrado' para a variacao desligada (${controle.erros.length} achados na bateria); os ${CASOS_QUE_NAO_MUDAM.length} casos que nao mudam dao a MESMA resposta nos dois corpos`,
    );

    // ---- 4. Porta. ----
    for (const [rotulo, id] of [
      ["cliente comum", CLIENTE],
      ["ex-admin", EX_ADMIN],
      ["sem sessao", ""],
    ]) {
      await isolado(c, () =>
        comoUsuario(c, id, async () => {
          await c.query("SAVEPOINT porta1393b");
          await assert.rejects(
            () => buscar(c, EAN.varDesligada),
            /Acesso negado/,
            `${rotulo} conseguiu ler a variacao desligada`,
          );
          await c.query("ROLLBACK TO SAVEPOINT porta1393b");
        }),
      );
    }
    for (const [rotulo, codigo] of [
      ["vazio", "   "],
      ["acima de 64", "9".repeat(65)],
    ]) {
      await c.query("SAVEPOINT vazio1393b");
      await assert.rejects(
        () => buscar(c, codigo),
        /Informe o código|inválido/,
        `codigo ${rotulo} devia ser recusado`,
      );
      await c.query("ROLLBACK TO SAVEPOINT vazio1393b");
    }
    for (const papel of ["anon"]) {
      assert.equal(
        (
          await c.query(
            "SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS ok",
            [papel, ASSINATURA],
          )
        ).rows[0].ok,
        false,
        `${papel} nao pode executar`,
      );
    }
    console.log(
      "  PASSOU a porta: cliente, ex-admin e sem sessao recusados; codigo vazio e acima de 64 recusados; anon sem EXECUTE",
    );

    // ---- 5/6. Mutantes. ----
    const NOVA_BUSCA =
      "WHERE v.codigo_barras = v_codigo\n              AND v.active IS DISTINCT FROM true\n              AND p.deleted_at IS NULL;";
    const MUTANTES = [
      [
        "active = false no lugar de IS DISTINCT FROM true (a variacao com active NULL some)",
        (s) =>
          s.replace(
            NOVA_BUSCA,
            "WHERE v.codigo_barras = v_codigo\n              AND v.active = false\n              AND p.deleted_at IS NULL;",
          ),
      ],
      [
        "sem o filtro de produto apagado na busca nova",
        (s) =>
          s.replace(
            NOVA_BUSCA,
            "WHERE v.codigo_barras = v_codigo\n              AND v.active IS DISTINCT FROM true;",
          ),
      ],
      [
        "'ativo' verdadeiro no produto do caso novo (o balcao adicionaria a peca desligada)",
        (s) => s.replace("'ativo', false,", "'ativo', true,"),
      ],
      [
        "origem 'produto' no caso novo",
        (s) =>
          s.replace(
            "v_origem := 'variante';\n                -- `SELECT ... INTO` sem linha do produto",
            "v_origem := 'produto';\n                -- `SELECT ... INTO` sem linha do produto",
          ),
      ],
      [
        "sem a lista vazia de variacoes no caso novo",
        (s) =>
          s.replace(
            "                v_variacoes := '[]'::jsonb;\n            ELSE",
            "            ELSE",
          ),
      ],
      [
        "LIKE no lugar de = na busca nova (prefixo)",
        (s) =>
          s.replace(
            NOVA_BUSCA,
            "WHERE v.codigo_barras LIKE v_codigo || '%'\n              AND v.active IS DISTINCT FROM true\n              AND p.deleted_at IS NULL;",
          ),
      ],
      [
        "a variacao desligada vence o produto ativo",
        (s) =>
          s.replace(
            "WHERE p.codigo_barras = v_codigo\n          AND p.deleted_at IS NULL;",
            "WHERE p.codigo_barras = v_codigo\n          AND p.deleted_at IS NULL\n          AND NOT EXISTS (SELECT 1 FROM public.product_variants vx WHERE vx.codigo_barras = v_codigo);",
          ),
      ],
      [
        "preco do produto no lugar do preco da variacao no caso novo",
        (s) => {
          const i = s.indexOf(NOVA_BUSCA);
          const velho =
            "COALESCE(v.price_override, p.preco_venda),\n                v.stock_increment";
          const ini = s.lastIndexOf(velho, i);
          assert.ok(ini >= 0, "preco do caso novo nao encontrado");
          return `${s.slice(0, ini)}p.preco_venda,\n                v.stock_increment${s.slice(ini + velho.length)}`;
        },
      ],
    ];
    for (const [nome, mutar] of MUTANTES) {
      const corpo = mutar(CORPO_NOVO);
      assert.notEqual(corpo, CORPO_NOVO, `o mutante "${nome}" nao mudou nada`);
      const erros = await isolado(c, async () => {
        await trocarCorpo(c, corpo);
        return bateria(c, ids);
      });
      assert.ok(erros.length > 0, `o mutante "${nome}" sobreviveu`);
    }
    console.log(
      `  PASSOU ${MUTANTES.length} mutantes reprovam a bateria; o corpo anterior tambem`,
    );

    // ---- 5. Dados intactos. ----
    assert.equal(
      await dumpDosDados(c),
      dadosAntes,
      "buscar (corpo novo, controle e mutantes) alterou produto ou variacao",
    );

    // ---- 7. Reaplicar, rollback byte a byte, rollback de novo, reaplicar; ordem com a 20261381000000. ----
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar 2x mudou OID, dono, ACL, atributos ou texto",
      );
      await c.query(rollback);
      const volta = await funcao(c);
      assert.equal(
        volta.prosrc,
        CORPO_ANTES,
        "o rollback nao devolveu o corpo da 20261381000000 byte a byte",
      );
      assert.deepEqual(
        { ...volta, prosrc: null },
        { ...topo, prosrc: null },
        "o rollback mexeu em atributo, dono ou ACL",
      );
      await c.query(rollback);
      assert.deepEqual(
        await funcao(c),
        volta,
        "rodar o rollback de novo mudou o estado",
      );
      await c.query(migration);
      assert.deepEqual(
        await funcao(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
    });
    assert.equal(
      await dumpDosDados(c),
      dadosAntes,
      "reaplicar ou desfazer alterou produto ou variacao",
    );
    // O rollback da 20261381000000 RECUSA com o corpo desta no ar; o helper desfaz esta primeiro.
    await isolado(c, async () => {
      await recusa(c, rollback81, /B1_BASELINE_DIVERGENT/);
      assert.equal(
        (await c.query(BALCAO_DIZ_INATIVO.noAr)).rows[0].sim,
        true,
        "o 'no ar' do helper devia ver esta migration",
      );
      await desfazerBalcaoDizInativoNaTransacao(c);
      assert.equal(
        (await funcao(c)).prosrc,
        CORPO_ANTES,
        "o helper nao devolveu o corpo da 20261381000000",
      );
      assert.equal((await c.query(BALCAO_DIZ_INATIVO.noAr)).rows[0].sim, false);
      await desfazerBalcaoDizInativoNaTransacao(c);
      assert.equal(
        (await funcao(c)).prosrc,
        CORPO_ANTES,
        "o helper, de novo, mudou o estado",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte, rollback 2x igual, reaplicar volta, dados intactos; o rollback da 20261381000000 recusa com o corpo desta e o helper o desfaz antes",
    );

    // ---- 8. Pre-voo recusa sem escrever; a conferencia que falha desfaz o arquivo inteiro. ----
    const sabotagens = [
      [
        "corpo desconhecido",
        () =>
          trocarCorpo(
            c,
            CORPO_NOVO.replace("-- 3) A VARIACAO", "-- 3) a variacao"),
          ),
      ],
      [
        "ACL aberta para anon",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
      ],
      [
        "ACL aberta para PUBLIC",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO PUBLIC`),
      ],
      [
        "authenticated sem EXECUTE",
        () =>
          c.query(
            `REVOKE EXECUTE ON FUNCTION ${ASSINATURA} FROM authenticated`,
          ),
      ],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.buscar_por_codigo_barras(p_x integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$",
          ),
      ],
      [
        "atributo trocado (SECURITY INVOKER)",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SECURITY INVOKER`),
      ],
      [
        "atributo trocado (VOLATILE)",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} VOLATILE`),
      ],
      [
        "search_path trocado",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SET search_path = public`),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await sabotar();
        const antes = await funcao(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await funcao(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        if (nome === "corpo desconhecido")
          await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      });
    }
    await isolado(c, async () => {
      await c.query(rollback);
      const conferenciaSabotada = migration.replace(
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN\n    RAISE EXCEPTION 'conferencia 20261393100000`,
        `IF v_hash IS DISTINCT FROM 'nao-e-este' THEN\n    RAISE EXCEPTION 'conferencia 20261393100000`,
      );
      assert.notEqual(conferenciaSabotada, migration);
      await recusa(c, conferenciaSabotada, /conferencia 20261393100000/);
      assert.equal(
        md5((await funcao(c)).prosrc),
        HASH_ANTES,
        "a migration que falhou na conferencia deixou o corpo novo gravado",
      );
    });
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens) e a conferencia que falha nao deixa nada`,
    );

    // ---- 9. Consultas 104a/104b nos dois sentidos, com o rol fechado; 86a e 9a aceitam o corpo desta. ----
    const rodar = async (nome) =>
      (await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows;
    const consulta = async (nome) => {
      const rows = await rodar(nome);
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows.filter((r) => r.ok !== true).map((r) => r.item);
    };
    const CORPO = "buscar_por_codigo_barras: corpo exato (md5)";
    assert.deepEqual(await consulta(C104A), []);
    assert.deepEqual(await consulta(C104B), [CORPO]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C104B), []);
      assert.deepEqual(await consulta(C104A), [CORPO]);
    });
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`);
      assert.deepEqual(await consulta(C104A), [
        "buscar_por_codigo_barras: EXECUTE so authenticated e service_role (sem PUBLIC nem anon)",
      ]);
    });
    const reprovadas = (rows) =>
      rows.filter((r) => r.ok !== true).map((r) => r.item);
    const i86 = "86a-conferir-ex-admin-no-resto-do-painel-aplicado";
    const r86 = reprovadas(await rodar(i86));
    assert.deepEqual(
      r86,
      [],
      `a 86a reprova com o corpo desta migration: ${r86.join("; ")}`,
    );
    await isolado(c, async () => {
      await trocarCorpo(c, CORPO_NOVO.replace("-- 3) A VARIACAO", "-- 3) a v"));
      assert.deepEqual(
        reprovadas(await rodar(i86)),
        ["RPC: public.buscar_por_codigo_barras(text)"],
        "a 86a devia reprovar so a linha da buscar_por_codigo_barras com um corpo desconhecido",
      );
    });
    const i9 = "9a-conferir-60-a-66-aplicado";
    const r9 = reprovadas(await rodar(i9));
    assert.ok(
      !r9.some((x) => /buscar_por_codigo_barras/.test(x)),
      `a 9a reprova buscar_por_codigo_barras com o corpo desta migration: ${r9.join("; ")}`,
    );
    await isolado(c, async () => {
      await c.query(rollback);
      const r = reprovadas(await rodar(i9));
      assert.ok(
        !r.some((x) => /buscar_por_codigo_barras/.test(x)),
        "a 9a tem de tolerar o corpo da 20261381000000 (loja que ainda nao recebeu esta migration)",
      );
    });
    console.log(
      "  PASSOU consultas 104a/104b nos dois sentidos, rol fechado; a 86a e a 9a aceitam o corpo desta migration (e a 86a recusa um corpo desconhecido)",
    );

    await c.query("ROLLBACK");
    console.log(
      "\n[o-balcao-diz-inativo-para-a-variacao-desligada] todas as provas passaram.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
