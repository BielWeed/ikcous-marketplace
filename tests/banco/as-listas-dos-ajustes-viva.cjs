"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */
// Prova viva da 20261643000000 (as listas dos ajustes nao somem entre aparelhos). So no clone descartavel do
// rodar-isolado.cjs (CI_BANCO_EFEMERO=1 + localhost): faz COMMIT de verdade (duas conexoes ao mesmo tempo).
//
//  A. consultas 203a e 203b positivas com a migration no ar, e as antecessoras (8e, 9a, 40a, 47a, 60a) tambem (no F, desfeita);
//  B. upsert_store_config: lista vista igual grava; diferente recusa com LST01 + DETAIL e nada grava (nem a outra
//     coluna do mesmo pedido); formas como conjunto; vitrines pelo jsonb inteiro (ordem importa, ordem de chave nao);
//     vitrine nunca salva (NULL ou jsonb null) aceita; `vistos` malformado = 22023; sem `vistos` grava como antes;
//  C. salvar_politica_de_devolucao: o mesmo para as tres listas, inclusive lista vista que nao vai no pedido;
//  D. DUAS conexoes com a mesma lista vista: a segunda espera a primeira e e recusada (a trava FOR UPDATE). Nas vitrines
//     a trava e a UNICA espera (o mutante sem FOR UPDATE grava as duas); na politica o INSERT ... ON CONFLICT DO NOTHING
//     do corpo antigo ja espera a linha da primeira, entao ali a corrida segura mesmo sem a trava — o mutante morde nas
//     vitrines, e a trava da politica fica pelo texto (teste estatico) e pela simetria;
//  E. ACL e atributos de sempre (anon segue sem EXECUTE);
//  F. rollback: corpos de volta byte a byte, 203a negativa e 203b positiva, `vistos` ignorado, rollback repetido
//     recusa, reaplicar (LF e CRLF) e idempotente; pre-voo recusa corpo desconhecido.
// Mutantes (cada um tem de REPROVAR esta prova): MUTANTE_LISTAS_SEM_TRAVA=1 (tira o FOR UPDATE das duas) e
// MUTANTE_LISTAS_SEM_CONFERENCIA=1 (desliga os dois blocos de conferencia).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  NOME_DA_MIGRATION: NOME,
  HASH_UPSERT_DESTA,
  HASH_POLITICA_DESTA,
} = require("./as-listas-dos-ajustes-posterior.cjs");

const DIR = path.join(__dirname, "../../supabase/migrations");
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const ler = (n) => fs.readFileSync(path.join(DIR, n), "utf8");
const consulta = (n) =>
  fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const C203A = consulta(
  "203a-conferir-as-listas-dos-ajustes-nao-somem-entre-aparelhos-aplicado",
);
const C203B = consulta(
  "203b-antes-as-listas-dos-ajustes-nao-somem-entre-aparelhos-base-vigente",
);
const SIG_UP = "public.upsert_store_config(jsonb)";
const SIG_PO = "public.salvar_politica_de_devolucao(jsonb)";

async function conectar(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  // service_role: o chamador de confianca das duas RPCs (is_admin/is_admin_atual pelo GUC `role`).
  await c.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await c.query("SET ROLE service_role");
  return c;
}

async function hash(c, sig) {
  return (
    await c.query(
      "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h;
}

async function catalogo(c) {
  return (
    await c.query(
      `SELECT proname, oid::bigint AS oid, proowner::bigint AS dono, proacl::text AS acl, proconfig::text AS config,
              prosecdef, provolatile, pronargs, pronargdefaults
         FROM pg_proc WHERE oid IN (to_regprocedure($1), to_regprocedure($2)) ORDER BY proname`,
      [SIG_UP, SIG_PO],
    )
  ).rows;
}

async function rol(c, sql) {
  const r = await c.query(sql);
  return r.rows;
}

// As consultas ANTECESSORAS que medem um dos dois corpos: aceitam o desta como sucessor (e o de antes, desfeita).
const ANTECESSORAS = [
  "8e-conferir-92-a-202-aplicado",
  "9a-conferir-60-a-66-aplicado",
  "40a-conferir-identidade-legal-da-loja-aplicado",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
  "60a-conferir-estilo-card-frete-aplicado",
];
const DAS_DUAS = /upsert_store_config|salvar_politica_de_devolucao/;
async function antecessorasPositivas(c, quando) {
  for (const n of ANTECESSORAS) {
    const linhas = await rol(c, consulta(n));
    assert.ok(
      linhas.some((x) => DAS_DUAS.test(x.item)),
      `${n}: mede um dos dois corpos`,
    );
    assert.deepEqual(
      linhas.filter((x) => x.ok !== true).map((x) => x.item),
      [],
      `${n} positiva ${quando}`,
    );
  }
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const dono = new Client({ connectionString: url });
  await dono.connect();

  // A sucessora 20261652000000 (a loja nova confirma a entrega e o pagamento) redefine o upsert: esta prova mede a 1643
  // isolada, entao a 1652 sai do clone antes (COMMIT: as conexoes da prova sao outras).
  await dono.query("BEGIN");
  await require("./a-loja-nova-confirma-posterior.cjs").desfazerConfirmacaoDaLojaNovaNaTransacao(
    dono,
  );
  await dono.query("COMMIT");
  assert.equal(await hash(dono, SIG_UP), HASH_UPSERT_DESTA, "a 1643 no ar");
  assert.equal(await hash(dono, SIG_PO), HASH_POLITICA_DESTA, "a 1643 no ar");
  const catalogoAntes = await catalogo(dono);

  // A. consultas (antes dos mutantes: o vermelho de um mutante cai na guarda dele, nao aqui)
  assert.ok(
    (await rol(dono, C203A)).every((x) => x.ok === true),
    "203a positiva com a 1643 no ar",
  );
  assert.equal((await rol(dono, C203A)).length, 4);
  assert.ok(
    (await rol(dono, C203B)).every((x) => x.ok === true),
    "203b positiva com a 1643 no ar (reaplicacao)",
  );
  assert.equal((await rol(dono, C203B)).length, 4);
  await antecessorasPositivas(dono, "com a 1643 no ar");

  // MUTANTES (so com a variavel ligada): o corpo desta, com uma decisao tirada.
  const mutante = (definicao, troca) => {
    const corpo = definicao.replace(/\r/g, "");
    for (const [de] of troca) {
      assert.ok(corpo.includes(de), `mutante: trecho ausente ${de}`);
    }
    return troca.reduce((t, [de, para]) => t.split(de).join(para), corpo);
  };
  const defs = async () =>
    (
      await dono.query(
        "SELECT pg_get_functiondef(to_regprocedure($1)) AS up, pg_get_functiondef(to_regprocedure($2)) AS po",
        [SIG_UP, SIG_PO],
      )
    ).rows[0];
  if (process.env.MUTANTE_LISTAS_SEM_TRAVA === "1") {
    const d = await defs();
    await dono.query(mutante(d.up, [["\n       FOR UPDATE;", ";"]]));
    await dono.query(
      mutante(d.po, [["WHERE id = 1 FOR UPDATE;", "WHERE id = 1;"]]),
    );
    console.log("MUTANTE aplicado: sem a trava FOR UPDATE");
  }
  if (process.env.MUTANTE_LISTAS_SEM_CONFERENCIA === "1") {
    const d = await defs();
    await dono.query(
      mutante(d.up, [["IF config_json ? 'vistos' THEN", "IF false THEN"]]),
    );
    await dono.query(
      mutante(d.po, [["IF p ? 'vistos' THEN", "IF false THEN"]]),
    );
    console.log("MUTANTE aplicado: sem a conferencia da lista vista");
  }

  const c = await conectar(url);
  const up = async (j) =>
    (
      await c.query("SELECT public.upsert_store_config($1::jsonb) AS r", [
        JSON.stringify(j),
      ])
    ).rows[0].r;
  const pol = async (j) =>
    (
      await c.query(
        "SELECT public.salvar_politica_de_devolucao($1::jsonb) AS r",
        [JSON.stringify(j)],
      )
    ).rows[0].r;
  const recusa = async (fn, codigo, detalhe) => {
    await c.query("SAVEPOINT recusa");
    let erro = null;
    try {
      await fn();
    } catch (e) {
      erro = e;
    }
    await c.query("ROLLBACK TO SAVEPOINT recusa");
    assert.ok(erro, `devia recusar com ${codigo}`);
    assert.equal(erro.code, codigo, erro.message);
    if (detalhe !== undefined) assert.equal(erro.detail, detalhe);
  };

  // Le o estado DENTRO da transacao de `c`, como dono (service_role nao enxerga a linha pela RLS): sem
  // isto a comparacao "nada mudou" passaria com `undefined === undefined`.
  const estado = async (sql) => {
    await c.query("RESET ROLE");
    try {
      const linhas = (await c.query(sql)).rows;
      assert.equal(linhas.length, 1, `uma linha em: ${sql}`);
      return linhas[0];
    } finally {
      await c.query("SET ROLE service_role");
    }
  };

  // B. upsert_store_config
  await c.query("BEGIN");
  await up({ store_name: "Loja ficticia" });
  await c.query("RESET ROLE");
  await c.query(
    "UPDATE public.store_config SET home_sections = NULL WHERE id = 1",
  );
  await c.query("SET ROLE service_role");
  let r = await up({
    home_sections: [{ id: "a" }],
    vistos: { home_sections: [{ id: "de-fabrica" }] },
  });
  assert.deepEqual(r.home_sections, [{ id: "a" }], "vitrine NULL aceita");
  r = await up({
    home_sections: [{ id: "a" }, { id: "b" }],
    vistos: { home_sections: [{ id: "a" }] },
  });
  assert.deepEqual(r.home_sections, [{ id: "a" }, { id: "b" }]);
  await recusa(
    () =>
      up({
        home_sections: [{ id: "x" }],
        vistos: { home_sections: [{ id: "a" }] },
      }),
    "LST01",
    "home_sections",
  );
  await recusa(
    () =>
      up({
        home_sections: [{ id: "x" }],
        vistos: { home_sections: [{ id: "b" }, { id: "a" }] },
      }),
    "LST01",
    "home_sections",
  );
  await up({
    home_sections: [{ id: "a", titulo: "T", ativa: true }],
    vistos: { home_sections: [{ id: "a" }, { id: "b" }] },
  });
  r = await up({
    home_sections: [{ id: "a", titulo: "U", ativa: true }],
    vistos: { home_sections: [{ ativa: true, titulo: "T", id: "a" }] },
  });
  assert.deepEqual(r.home_sections, [{ id: "a", titulo: "U", ativa: true }]);

  await up({ formas_pagamento_entrega: ["pix", "card", "cash"] });
  r = await up({
    formas_pagamento_entrega: ["pix", "cash"],
    vistos: { formas_pagamento_entrega: ["cash", "card", "pix"] },
  });
  assert.deepEqual(
    r.formas_pagamento_entrega,
    ["pix", "cash"],
    "formas como conjunto",
  );
  await recusa(
    () =>
      up({
        formas_pagamento_entrega: ["pix"],
        vistos: { formas_pagamento_entrega: ["pix"] },
      }),
    "LST01",
    "formas_pagamento_entrega",
  );
  const antes = await estado(
    "SELECT store_name, formas_pagamento_entrega, updated_at FROM public.store_config",
  );
  await recusa(
    () =>
      up({
        store_name: "Outro nome",
        formas_pagamento_entrega: ["cash"],
        vistos: { formas_pagamento_entrega: ["card"] },
      }),
    "LST01",
    "formas_pagamento_entrega",
  );
  assert.deepEqual(
    await estado(
      "SELECT store_name, formas_pagamento_entrega, updated_at FROM public.store_config",
    ),
    antes,
    "a recusa nao grava nada do pedido",
  );
  for (const vistos of [
    null,
    [],
    "pix",
    1,
    { outra_coluna: [] },
    { formas_pagamento_entrega: "pix" },
    { formas_pagamento_entrega: [1] },
    { formas_pagamento_entrega: null },
  ]) {
    await recusa(() => up({ store_name: "X", vistos }), "22023");
  }
  r = await up({
    home_sections: [{ id: "z" }],
    formas_pagamento_entrega: ["card"],
  });
  assert.deepEqual(
    r.home_sections,
    [{ id: "z" }],
    "sem vistos grava por cima como antes",
  );
  await up({ home_sections: null });
  r = await up({
    home_sections: [{ id: "q" }],
    vistos: { home_sections: [{ id: "qualquer" }] },
  });
  assert.deepEqual(r.home_sections, [{ id: "q" }], "vitrine jsonb null aceita");
  await c.query("ROLLBACK");

  // C. salvar_politica_de_devolucao
  await c.query("BEGIN");
  await pol({
    categorias_sem_troca: [],
    metodos_locais: ["entrega_na_loja", "coleta"],
  });
  let p = await pol({
    categorias_sem_troca: ["Roupa"],
    vistos: { categorias_sem_troca: [] },
  });
  assert.deepEqual(p.categorias_sem_troca, ["Roupa"]);
  assert.equal("updated_by" in p, false, "updated_by segue fora da resposta");
  await recusa(
    () =>
      pol({
        categorias_sem_troca: ["Calcados"],
        vistos: { categorias_sem_troca: [] },
      }),
    "LST01",
    "categorias_sem_troca",
  );
  await pol({
    categorias_sem_troca: ["Roupa", "Calcados"],
    vistos: { categorias_sem_troca: ["Roupa", "Roupa"] },
  });
  await recusa(
    () =>
      pol({
        metodos_locais: ["coleta"],
        vistos: { metodos_locais: ["coleta"] },
      }),
    "LST01",
    "metodos_locais",
  );
  p = await pol({
    metodos_locais: ["coleta"],
    vistos: { metodos_locais: ["coleta", "entrega_na_loja"] },
  });
  assert.deepEqual(p.metodos_locais, ["coleta"]);
  const prazoAntes = await estado(
    "SELECT prazo_troca_dias FROM public.politica_devolucao",
  );
  await recusa(
    () =>
      pol({
        prazo_troca_dias: 10,
        metodos_nacionais: [],
        vistos: { metodos_nacionais: ["envio_proprio"] },
      }),
    "LST01",
    "metodos_nacionais",
  );
  assert.deepEqual(
    await estado("SELECT prazo_troca_dias FROM public.politica_devolucao"),
    prazoAntes,
    "a recusa nao grava o prazo do mesmo pedido",
  );
  await recusa(
    () =>
      pol({
        prazo_troca_dias: 13,
        vistos: { categorias_sem_troca: ["Roupa"] },
      }),
    "LST01",
    "categorias_sem_troca",
  );
  for (const vistos of [
    null,
    [],
    { outra: [] },
    { metodos_locais: "coleta" },
    { metodos_locais: [true] },
    { metodos_locais: null },
  ]) {
    await recusa(() => pol({ prazo_troca_dias: 10, vistos }), "22023");
  }
  p = await pol({ prazo_troca_dias: 12 });
  assert.equal(p.prazo_troca_dias, 12, "sem vistos grava como antes");
  await c.query("ROLLBACK");

  // D. duas conexoes, a mesma lista vista: a segunda espera a primeira e e recusada
  const a = await conectar(url);
  const b = await conectar(url);
  const corrida = async (sql, montar) => {
    await a.query("BEGIN");
    await a.query(sql, [JSON.stringify(montar("A"))]);
    await b.query("BEGIN");
    const segunda = b.query(sql, [JSON.stringify(montar("B"))]).then(
      () => "gravou",
      (e) => e.code,
    );
    await new Promise((resolver) => setTimeout(resolver, 400));
    await a.query("COMMIT");
    const resultado = await segunda;
    await b.query("ROLLBACK");
    return resultado;
  };
  // Estado de partida gravado de verdade (o clone e descartavel): politica e vitrines ja salvas.
  await c.query("SELECT public.salvar_politica_de_devolucao($1::jsonb)", [
    JSON.stringify({ categorias_sem_troca: ["Base"] }),
  ]);
  await c.query("SELECT public.upsert_store_config($1::jsonb)", [
    JSON.stringify({ home_sections: [{ id: "base" }] }),
  ]);
  assert.equal(
    await corrida(
      "SELECT public.salvar_politica_de_devolucao($1::jsonb)",
      (quem) => ({
        categorias_sem_troca: ["Base", quem],
        vistos: { categorias_sem_troca: ["Base"] },
      }),
    ),
    "LST01",
    "politica: a segunda conexao confere contra o que a primeira gravou",
  );
  assert.equal(
    await corrida("SELECT public.upsert_store_config($1::jsonb)", (quem) => ({
      home_sections: [{ id: "base" }, { id: quem }],
      vistos: { home_sections: [{ id: "base" }] },
    })),
    "LST01",
    "vitrines: a segunda conexao confere contra o que a primeira gravou",
  );
  assert.deepEqual(
    (
      await estado(
        "SELECT categorias_sem_troca FROM public.politica_devolucao WHERE id = 1",
      )
    ).categorias_sem_troca,
    ["Base", "A"],
    "so a primeira gravou",
  );
  await a.end();
  await b.end();

  // E. ACL e atributos
  await c.query("RESET ROLE");
  assert.deepEqual(await catalogo(dono), catalogoAntes, "catalogo intacto");
  await c.query("BEGIN");
  await c.query("SET LOCAL ROLE anon");
  await recusa(
    () => c.query("SELECT public.upsert_store_config('{}'::jsonb)"),
    "42501",
  );
  await recusa(
    () => c.query("SELECT public.salvar_politica_de_devolucao('{}'::jsonb)"),
    "42501",
  );
  await c.query("ROLLBACK");
  await c.end();

  // F. rollback, reaplicar e pre-voo
  await dono.query("BEGIN");
  await dono.query(ler(`rollback-manual-${NOME}`));
  assert.equal(await hash(dono, SIG_UP), "aa4ed730ac6ad3d3c2644b4285ff39a9");
  assert.equal(await hash(dono, SIG_PO), "043f816330a66b290fd04d272a4ee934");
  assert.deepEqual(
    await catalogo(dono),
    catalogoAntes,
    "rollback preserva o catalogo",
  );
  assert.equal(
    (await rol(dono, C203A)).every((x) => x.ok === true),
    false,
    "203a negativa sem a 1643",
  );
  assert.ok(
    (await rol(dono, C203B)).every((x) => x.ok === true),
    "203b positiva na base",
  );
  await antecessorasPositivas(dono, "com a 1643 desfeita");
  await dono.query("SAVEPOINT repetido");
  await assert.rejects(
    dono.query(ler(`rollback-manual-${NOME}`)),
    /B1_BASELINE_DIVERGENT/,
  );
  await dono.query("ROLLBACK TO SAVEPOINT repetido");
  await dono.query("SET LOCAL ROLE service_role");
  const velho = (
    await dono.query("SELECT public.upsert_store_config($1::jsonb) AS r", [
      JSON.stringify({
        home_sections: [{ id: "velho" }],
        vistos: { home_sections: [{ id: "nada" }] },
      }),
    ])
  ).rows[0].r;
  assert.deepEqual(
    velho.home_sections,
    [{ id: "velho" }],
    "o corpo antigo ignora `vistos`",
  );
  await dono.query("RESET ROLE");
  await dono.query(ler(NOME));
  await dono.query(ler(NOME).replace(/\r?\n/g, "\r\n"));
  assert.equal(await hash(dono, SIG_UP), HASH_UPSERT_DESTA);
  assert.equal(await hash(dono, SIG_PO), HASH_POLITICA_DESTA);
  assert.ok(
    (await rol(dono, C203A)).every((x) => x.ok === true),
    "203a positiva de novo",
  );
  await dono.query("ROLLBACK");

  await dono.query("BEGIN");
  await dono.query(
    "CREATE OR REPLACE FUNCTION public.salvar_politica_de_devolucao(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN p; END $f$",
  );
  // a 8e reprova SO a linha da funcao com corpo estranho (o sucessor aceito e o desta, nao qualquer um)
  assert.deepEqual(
    (await rol(dono, consulta("8e-conferir-92-a-202-aplicado")))
      .filter((x) => x.ok !== true)
      .map((x) => x.item),
    ["corpo final salvar_politica_de_devolucao"],
    "8e negativa so na politica com corpo estranho",
  );
  await dono.query("SAVEPOINT preVoo");
  await assert.rejects(dono.query(ler(NOME)), /B1_BASELINE_DIVERGENT/);
  await dono.query("ROLLBACK TO SAVEPOINT preVoo");
  await dono.query("ROLLBACK");
  await dono.end();
  console.log(
    "PASSOU as listas dos ajustes: lista vista igual grava, diferente recusa (LST01) sem gravar, conjunto/jsonb, NULL aceita, malformado 22023, duas conexoes, ACL, rollback, reaplicar e pre-voo.",
  );
}

main().catch((e) => falhar("FALHOU", e.stack || e.message));
