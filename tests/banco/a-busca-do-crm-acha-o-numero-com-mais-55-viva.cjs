"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261392100000_a_busca_do_crm_acha_o_numero_com_mais_55.sql (public.crm_clientes, o corte
 * do +55 nos digitos da busca) contra o Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do
 * dinheiro). Nunca banco de loja. Tudo numa transacao desfeita no fim.
 *
 * O que prova:
 *  (1) O numero colado com o +55 ("+55 34 99999-1234", "5534999991234", "55 34 99999 1234") acha a cliente guardada
 *      como "(34) 99999-1234" (no CRM, "34999991234"); "34999991234" e "999991234" continuam achando. A cliente
 *      guardada COM o 55 e achada pelos dois jeitos; a compradora sem conta (WhatsApp do pedido) tambem; o fixo de 12
 *      digitos com 55 tambem. BORDAS: DDD 55 com 11 digitos NAO perde o 55; 12 digitos que nao comecam por 55 nao se
 *      cortam; 3 digitos seguem so texto; nome e e-mail como antes.
 *  (2) CONTROLE: o corpo anterior (o da 20261231000000, pelo rollback-manual) NAO acha "5534999991234" (o defeito).
 *      Mutantes (corte so com 13 digitos; corte de qualquer termo longo sem conferir o 55; corte tambem com 11
 *      digitos; sem o corte) deixam a prova vermelha.
 *  (3) So o +55 muda: para termos sem +55 (vazio, nome, e-mail, numero sem 55, segmento), o JSON inteiro e' igual ao
 *      do corpo anterior.
 *  (4) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; rollback devolve o corpo da 20261231000000 byte a
 *      byte; rodar o rollback de novo deixa o mesmo estado; reaplicar depois do rollback volta.
 *  (5) Pre-voo recusa sem escrever (corpo desconhecido, ACL aberta para anon, sobrecarga); o rollback recusa corpo
 *      desconhecido; a conferencia final sabotada derruba o arquivo inteiro.
 *  (6) Consultas 102a/102b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-busca-do-crm-acha-o-numero-com-mais-55-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261392100000_a_busca_do_crm_acha_o_numero_com_mais_55.sql";
const NOME_ANTERIOR = "20261231000000_a_busca_do_crm_ignora_acento.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const corpoDe = (sql) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.crm_clientes\([^\n]*\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "9c4268178a50729b5f7b256b77882585";
const HASH_NOVO = "39a2a6de59041e09b6f1e466a6782dca";
const ASSINATURA = "public.crm_clientes(text,text,integer,integer)";
const C102A = "102a-conferir-a-busca-do-crm-acha-o-numero-com-mais-55-aplicado";
const C102B =
  "102b-antes-a-busca-do-crm-acha-o-numero-com-mais-55-base-vigente";
const CABECALHO_DA_FUNCAO = migration.match(
  /CREATE OR REPLACE FUNCTION public\.crm_clientes\([^\n]*\)[\s\S]*?\nAS \$\$/,
)[0];
const trocarCorpo = (c, corpo) => c.query(`${CABECALHO_DA_FUNCAO}${corpo}$$;`);
const CORTE =
  "  IF length(v_digitos) IN (12, 13) AND left(v_digitos, 2) = '55' THEN\n    v_digitos := substr(v_digitos, 3);\n  END IF;\n";

const ADMIN = "e3921000-1392-4000-8000-000000000001";
const PERFIS = [
  // [id, nome, WhatsApp como o cadastro guarda]
  [
    "e3921000-1392-4000-8000-000000000011",
    "Joana Mascarada",
    "(34) 99999-1234",
  ],
  ["e3921000-1392-4000-8000-000000000012", "Bia Com 55", "+55 34 98888-7777"],
  ["e3921000-1392-4000-8000-000000000013", "Ana Ddd 55", "(55) 98765-4321"],
  ["e3921000-1392-4000-8000-000000000014", "Paula Fixa", "(34) 3333-1234"],
  ["e3921000-1392-4000-8000-000000000015", "Pedro Fixo", "(34) 5678-9012"],
  ["e3921000-1392-4000-8000-000000000016", "Sem Zap", null],
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
  await c.query("SAVEPOINT caso3921");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3921");
    await c.query("RELEASE SAVEPOINT caso3921");
  }
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa3921");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa3921");
    await c.query("RELEASE SAVEPOINT recusa3921");
  }
}

async function fixture(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@crm3921.teste', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Crm', 'admin')",
    [ADMIN],
  );
  for (const [id, nome, zap] of PERFIS) {
    await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${nome.split(" ")[0].toLowerCase()}@crm3921.teste`,
    ]);
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES ($1, $2, 'customer', $3)",
      [id, nome, zap],
    );
  }
  // Uma COMPRADORA sem conta (venda paga): o WhatsApp vem do pedido.
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES (NULL, 'Clara Compradora', '{"whatsapp":"(34) 98888-0000","email":"clara@crm3921.teste"}'::jsonb,
             100, 100, 'delivered', 'online', 'online', 'pago', now(), now())`,
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
}

/** A aba Clientes do CRM: os nomes achados, ordenados (e o JSON bruto em `.bruto`). */
async function crm(c, busca, segmento = null) {
  const bruto = (
    await c.query("SELECT public.crm_clientes($1, $2, 200, 0) AS r", [
      segmento,
      busca,
    ])
  ).rows[0].r;
  const nomes = bruto.clientes.map((l) => l.nome).sort();
  nomes.bruto = bruto;
  return nomes;
}

const CASOS = [
  // [termo, quem tem de ser achado]
  ["+55 34 99999-1234", ["Joana Mascarada"]],
  ["5534999991234", ["Joana Mascarada"]],
  ["55 34 99999 1234", ["Joana Mascarada"]],
  ["34999991234", ["Joana Mascarada"]],
  ["999991234", ["Joana Mascarada"]],
  ["5534988887777", ["Bia Com 55"]],
  ["+55 34 98888-7777", ["Bia Com 55"]],
  ["34988887777", ["Bia Com 55"]],
  ["+55 34 98888-0000", ["Clara Compradora"]],
  ["34988880000", ["Clara Compradora"]],
  ["55 34 3333-1234", ["Paula Fixa"]],
  // BORDA: DDD 55 de 11 digitos nao perde o 55 (ninguem tem 55999991234; cortando, acharia a Joana).
  ["55999991234", []],
  ["55987654321", ["Ana Ddd 55"]],
  ["+55 55 98765-4321", ["Ana Ddd 55"]],
  // BORDA: 12 digitos que nao comecam por 55 nao se cortam (cortando, "3456789012" acharia o Pedro).
  ["123456789012", []],
  ["3456789012", ["Pedro Fixo"]],
  // BORDA: 3 digitos seguem so texto; nome e e-mail como antes.
  ["553", []],
  ["joana", ["Joana Mascarada"]],
  ["bia@crm3921", ["Bia Com 55"]],
];
async function bateria(c) {
  const erros = [];
  for (const [termo, esperado] of CASOS) {
    const achados = [...(await crm(c, termo))];
    if (JSON.stringify(achados) !== JSON.stringify(esperado))
      erros.push(
        `${termo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(achados)}`,
      );
  }
  return erros;
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261231000000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261392100000",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o anterior nao e o da 20261231000000",
    );
    const semOCorte = CORPO_NOVO.replace(
      /\n {2}-- Com 12 ou 13 digitos[\s\S]*?END IF;\n/,
      "\n",
    );
    assert.equal(
      semOCorte,
      CORPO_ANTES,
      "o corpo novo tem de ser o anterior mais o corte do 55, e nada mais",
    );
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido; so o corte do 55 mudou)",
    );

    await fixture(c);

    // ---- 1. A bateria inteira no corpo novo. ----
    const verde = await bateria(c);
    assert.deepEqual(verde, [], verde.join("\n"));
    console.log(
      `  PASSOU ${CASOS.length} buscas: o +55 colado acha, sem o 55 continua achando, e as bordas (DDD 55, 12 digitos sem 55, 3 digitos) ficam`,
    );

    // ---- 2. Controle e mutantes. ----
    const controle = await isolado(c, async () => {
      await c.query(rollback);
      assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
      return {
        mais55: [...(await crm(c, "5534999991234"))],
        sem55: [...(await crm(c, "34999991234"))],
      };
    });
    assert.deepEqual(controle, { mais55: [], sem55: ["Joana Mascarada"] });
    const mutantes = [
      ["sem o corte", (s) => s.replace(CORTE, "")],
      [
        "corte so com 13 digitos",
        (s) => s.replace("IN (12, 13) AND left", "IN (13) AND left"),
      ],
      [
        "corta qualquer termo longo sem conferir o 55",
        (s) => s.replace("AND left(v_digitos, 2) = '55' THEN", "THEN"),
      ],
      [
        "corta tambem com 11 digitos (o DDD 55)",
        (s) => s.replace("IN (12, 13) AND left", "IN (11, 12, 13) AND left"),
      ],
    ];
    for (const [nome, mutar] of mutantes) {
      const corpo = mutar(CORPO_NOVO);
      assert.notEqual(corpo, CORPO_NOVO, `o mutante "${nome}" nao mudou nada`);
      const erros = await isolado(c, async () => {
        await trocarCorpo(c, corpo);
        return bateria(c);
      });
      assert.ok(erros.length > 0, `o mutante "${nome}" sobreviveu`);
    }
    const errosAnterior = await isolado(c, async () => {
      await c.query(rollback);
      return bateria(c);
    });
    assert.ok(
      errosAnterior.length >= 6,
      `o corpo anterior teria de reprovar a bateria (${errosAnterior.length})`,
    );
    console.log(
      `  PASSOU controle: o corpo anterior nao acha o +55 (${errosAnterior.length} buscas erradas); ${mutantes.length} mutantes reprovam`,
    );

    // ---- 3. Sem +55 no termo, o JSON inteiro e' o mesmo do corpo anterior. ----
    const termosIguais = [
      [null, null],
      [null, ""],
      [null, "   "],
      [null, "joana"],
      [null, "crm3921"],
      [null, "34999991234"],
      [null, "3333"],
      [null, "553"],
      ["nunca_comprou", null],
      ["nunca_comprou", "34999991234"],
      [null, "zzzqq"],
    ];
    const foto = async () => {
      const out = [];
      for (const [segmento, busca] of termosIguais)
        out.push((await crm(c, busca, segmento)).bruto);
      return out;
    };
    const novo = await foto();
    const antigo = await isolado(c, async () => {
      await c.query(rollback);
      return foto();
    });
    assert.deepEqual(novo, antigo, "uma busca sem +55 mudou de resposta");
    console.log(
      `  PASSOU ${termosIguais.length} buscas sem +55 devolvem o mesmo JSON do corpo anterior`,
    );

    // ---- 4. Reaplicar, rollback byte a byte, rollback de novo, reaplicar depois do rollback. ----
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
        "o rollback nao devolveu o corpo da 20261231000000 byte a byte",
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
    console.log(
      "  PASSOU reaplicar 2x, rollback byte a byte, rollback 2x igual e reaplicar volta",
    );

    // ---- 5. Pre-voo recusa sem escrever; a conferencia que falha desfaz o arquivo inteiro. ----
    const sabotagens = [
      [
        "corpo desconhecido",
        () =>
          trocarCorpo(
            c,
            CORPO_NOVO.replace("-- Com 12 ou 13", "-- com 12 ou 13"),
          ),
      ],
      [
        "ACL aberta para anon",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
      ],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.crm_clientes(p_busca text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
          ),
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
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN\n    RAISE EXCEPTION 'conferencia 20261392100000`,
        `IF v_hash IS DISTINCT FROM 'nao-e-este' THEN\n    RAISE EXCEPTION 'conferencia 20261392100000`,
      );
      assert.notEqual(conferenciaSabotada, migration);
      await recusa(c, conferenciaSabotada, /conferencia 20261392100000/);
      assert.equal(
        md5((await funcao(c)).prosrc),
        HASH_ANTES,
        "a migration que falhou na conferencia deixou o corpo novo gravado",
      );
    });
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens) e a conferencia que falha nao deixa nada`,
    );

    // ---- 6. Consultas 102a/102b nos dois sentidos, com o rol fechado. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows.filter((r) => r.ok !== true).map((r) => r.item);
    };
    assert.deepEqual(await consulta(C102A), []);
    assert.deepEqual(await consulta(C102B), [
      "crm_clientes: corpo exato (md5)",
    ]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C102B), []);
      assert.deepEqual(await consulta(C102A), [
        "crm_clientes: corpo exato (md5)",
      ]);
    });
    // Os portoes vizinhos que medem esta funcao (8e do lote 92-202 e 32a do lote da busca) aceitam o corpo novo E o da 231,
    // e reprovam um corpo estranho.
    const reprovadasDe = async (nome) =>
      (await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item);
    const VIZINHOS = [
      "8e-conferir-92-a-202-aplicado",
      "32a-conferir-busca-de-clientes-aplicado",
    ];
    for (const v of VIZINHOS)
      assert.deepEqual(
        await reprovadasDe(v),
        [],
        `${v}: reprovou o corpo da 3921`,
      );
    await isolado(c, async () => {
      await c.query(rollback);
      for (const v of VIZINHOS)
        assert.deepEqual(
          await reprovadasDe(v),
          [],
          `${v}: reprovou o corpo da 231`,
        );
    });
    await isolado(c, async () => {
      await trocarCorpo(c, `${CORPO_NOVO} `);
      for (const v of VIZINHOS)
        assert.ok(
          (await reprovadasDe(v)).length > 0,
          `${v}: aceitou um corpo estranho`,
        );
    });
    console.log(
      "  PASSOU consultas 102a/102b nos dois sentidos, rol fechado; 8e e 32a aceitam o corpo da 231 e o da 3921 e reprovam corpo estranho",
    );

    console.log(
      "\n[a-busca-do-crm-acha-o-numero-com-mais-55] todas as provas passaram.",
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
