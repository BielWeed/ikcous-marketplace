"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// 20261387: a busca de pedido pelo NUMERO nao vira busca de TELEFONE.
// Somente Postgres descartavel do rpc-ci, nunca banco de loja. A prova nao roda
// automaticamente fora do CI_BANCO_EFEMERO=1 + localhost (efemero.cjs).
//
// O que esta prova mostra, em linguagem de balcao:
//   * o numero que o painel mostra ("#3884BE") acha o pedido e NAO acha o pedido
//     de outra pessoa que tem os mesmos digitos no telefone (no corpo antigo achava);
//   * nome com numero junto ("Cliente 3884") nao vira busca de telefone;
//   * telefone continua achando: mascarado, so digitos, os 4 ultimos digitos;
//   * numero que e so digito ("#123456") tambem acha o telefone, mas o pedido do
//     numero vem PRIMEIRO, mesmo com o telefone mais novo;
//   * contagem, paginacao, filtros e ordem de sempre ficam iguais;
//   * controles: cada pedaco da regra, tirado, muda o resultado (o teste nao e cego);
//   * porta de admin, reaplicar, preflight, rollback byte a byte e consultas 92a/92b.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261387000000_a_busca_de_pedido_pelo_numero_nao_vira_busca_de_telefone.sql";
const ASSINATURA =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const antes = ler(
  "scripts/publicacao/consultas/92b-antes-a-busca-de-pedido-pelo-numero-base-vigente.sql",
);
const depois = ler(
  "scripts/publicacao/consultas/92a-conferir-a-busca-de-pedido-pelo-numero-aplicado.sql",
);
const CORPO_DA_99 = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
).match(
  /CREATE OR REPLACE FUNCTION public\.get_admin_orders_paged\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
)[1];

const ADMIN = "5e387000-0000-4000-8000-000000000001";
const CLIENTE = "5e387000-0000-4000-8000-000000000002";
const id = (sufixo) => `5e387000-0000-4000-8000-${sufixo}`;

// Cada pedido e uma linha inserida com o created_at dado (ordem deterministica).
const PEDIDOS = {
  // O pedido do numero "3884BE" (letra e digito juntos).
  numero: {
    id: id("0000003884be"),
    nome: "Cliente Do Numero",
    fone: "(34) 90000-0001",
    criado: "2001-10-01T12:00:00Z",
  },
  // OUTRA pessoa: o telefone tem 3884 no meio. E mais nova que o pedido do numero.
  fone3884: {
    id: id("0000000000aa"),
    nome: "Cliente Do Telefone",
    fone: "(34) 93884-5555",
    criado: "2001-10-10T12:00:00Z",
  },
  neutro: {
    id: id("0000000000bb"),
    nome: "Cliente Neutro",
    fone: "(11) 94444-0000",
    criado: "2001-10-05T12:00:00Z",
  },
  // O numero que e so digito: "123456".
  soDigito: {
    id: id("000000123456"),
    nome: "Cliente Numero Digito",
    fone: "(34) 95005-1111",
    criado: "2001-10-02T12:00:00Z",
  },
  // Telefone com os mesmos digitos do numero acima, e MAIS NOVO que ele.
  fone123456: {
    id: id("0000000000cc"),
    nome: "Cliente Telefone Digito",
    fone: "(34) 12345-6000",
    criado: "2001-10-12T12:00:00Z",
  },
  // Rastreio/cupom/produto para provar que os outros caminhos de busca seguem.
  rastreio: {
    id: id("0000000000dd"),
    nome: "Cliente Rastreio",
    fone: "(21) 98888-2222",
    criado: "2001-10-06T12:00:00Z",
    tracking: "BR778899XY",
    cupom: "FRETE-OUTUBRO",
    status: "shipping",
  },
};
// Os pedidos da prova nascem em 2001 e toda busca olha so essa janela: pedido que outra prova tenha
// deixado no banco clonado nao entra na conta (nem na contagem, nem na ordem).
const JANELA_INICIO = "2001-01-01T00:00:00Z";
const JANELA_FIM = "2001-12-31T23:59:59Z";
const ordem = (...chaves) => chaves.map((k) => PEDIDOS[k].id);

async function inserirPedido(c, p) {
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, status,
        canal, payment_method, tracking_code, coupon_code, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, 100, 100, $5, 'online', 'pix', $6, $7, $8, $8)`,
    [
      p.id,
      CLIENTE,
      p.nome,
      p.fone,
      p.status || "pending",
      p.tracking || null,
      p.cupom || null,
      p.criado,
    ],
  );
}

async function buscar(c, termo, extra = {}) {
  const r = (
    await c.query(
      `SELECT public.get_admin_orders_paged($1, $2, $3, $4, $5, $6, $7, $8) AS r`,
      [
        termo,
        extra.status || "all",
        JANELA_INICIO,
        JANELA_FIM,
        extra.pagina ?? 0,
        extra.tamanho ?? 50,
        extra.pagamento || "all",
        extra.canal || "all",
      ],
    )
  ).rows[0].r;
  return {
    ids: r.data.map((o) => o.id),
    total: Number(r.total_count),
    chaves: Object.keys(r).sort(),
    linhaChaves: r.data.length ? Object.keys(r.data[0]).sort() : [],
  };
}

async function fotografar(c) {
  return (
    await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY id), '[]') FROM public.marketplace_orders o) AS pedidos,
    (SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY id), '[]') FROM public.marketplace_order_history h) AS historico,
    (SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY id), '[]') FROM public.marketplace_order_items i) AS itens`)
  ).rows[0];
}
async function funcao(c) {
  const atributos = (
    await c.query(`SELECT to_jsonb(p) AS atributos FROM pg_proc p
    WHERE oid = '${ASSINATURA}'::regprocedure`)
  ).rows[0].atributos;
  return { ...atributos, prosrc: atributos.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso387");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso387");
    await c.query("RELEASE SAVEPOINT caso387");
  }
}
async function recusa(c, acao, codigo, mensagem) {
  await isolado(c, async () => {
    await assert.rejects(
      acao,
      (e) => e.code === codigo && mensagem.test(e.message),
    );
  });
}
async function conferir(c, sql, positivo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(linhas.length, 4);
  assert.equal(
    linhas.every((l) => l.ok === true),
    positivo,
  );
}

// O que o corpo NOVO deve responder. Cada linha: [termo, ids esperados em ordem].
// "numero" = so o pedido do numero; o telefone da outra pessoa NAO entra.
const ESPERADO_NOVO = [
  ["3884BE", ordem("numero")],
  ["3884be", ordem("numero")],
  ["3884Be", ordem("numero")],
  ["  3884BE  ", ordem("numero")],
  // Nome com numero junto nao e telefone.
  ["Cliente 3884", []],
  ["12345abc", []],
  // Quatro digitos puros: ainda e telefone (e tambem pedaco do id): os dois, o mais novo antes.
  ["3884", ordem("fone3884", "numero")],
  // Telefone: mascarado, so digitos, formato com +, os 4 ultimos.
  ["(34) 93884-5555", ordem("fone3884")],
  ["34938845555", ordem("fone3884")],
  ["+34 93884.5555", ordem("fone3884")],
  ["5555", ordem("fone3884")],
  ["93884", ordem("fone3884")],
  // Poucos digitos: nunca telefone (a guarda de 4 da 20260961).
  ["888", []],
  ["22", []],
  // O numero que e so digito: o pedido do numero PRIMEIRO, o telefone mais novo depois.
  ["123456", ordem("soDigito", "fone123456")],
  // Os outros caminhos da busca seguem.
  ["Telefone", ordem("fone123456", "fone3884")],
  ["BR778899XY", ordem("rastreio")],
  ["frete-outubro", ordem("rastreio")],
  [
    "  ",
    ordem("fone123456", "fone3884", "rastreio", "neutro", "soDigito", "numero"),
  ],
];
// O texto "Telefone" casa o NOME de dois clientes ("Cliente Do Telefone" e "Cliente Telefone Digito").

async function medirTudo(c) {
  const saida = [];
  for (const [termo] of ESPERADO_NOVO) saida.push(await buscar(c, termo));
  // Paginacao com o pedido do numero na primeira posicao: pagina 0 de 1 traz ele, pagina 1 o telefone.
  saida.push(await buscar(c, "123456", { tamanho: 1, pagina: 0 }));
  saida.push(await buscar(c, "123456", { tamanho: 1, pagina: 1 }));
  // Filtros seguem valendo junto com a busca.
  saida.push(await buscar(c, "BR778899XY", { status: "shipping" }));
  saida.push(await buscar(c, "BR778899XY", { status: "pending" }));
  saida.push(await buscar(c, "123456", { canal: "presencial" }));
  return saida;
}

function exigirNovo(medidas) {
  ESPERADO_NOVO.forEach(([termo, ids], i) => {
    assert.deepEqual(medidas[i].ids, ids, `NOVO: busca "${termo}"`);
    assert.equal(
      medidas[i].total,
      ids.length,
      `NOVO: total_count de "${termo}" tem de ser o numero de pedidos achados (contagem e pagina com a mesma regra)`,
    );
  });
  const n = ESPERADO_NOVO.length;
  assert.deepEqual(medidas[n].ids, ordem("soDigito"), "pagina 0 de 1");
  assert.equal(medidas[n].total, 2);
  assert.deepEqual(medidas[n + 1].ids, ordem("fone123456"), "pagina 1 de 1");
  assert.equal(medidas[n + 1].total, 2);
  assert.deepEqual(medidas[n + 2].ids, ordem("rastreio"));
  assert.deepEqual(medidas[n + 3].ids, []);
  assert.equal(medidas[n + 3].total, 0);
  assert.deepEqual(medidas[n + 4].ids, []);
  assert.equal(medidas[n + 4].total, 0);
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    const topo = await funcao(c);
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin-busca-387@fixture.invalid', '{"role":"admin"}'),
              ($2, 'cliente-busca-387@fixture.invalid', '{}')`,
      [ADMIN, CLIENTE],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin Busca Ficticio', 'admin'), ($2, 'Cliente Busca Ficticio', 'customer')
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [ADMIN, CLIENTE],
    );
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    for (const p of Object.values(PEDIDOS)) await inserirPedido(c, p);
    const dados = await fotografar(c);

    // ---- Corpo NOVO (a arvore inteira aplicada pelo CI) ----
    const medidasNovo = await medirTudo(c);
    exigirNovo(medidasNovo);
    // Mesma forma de resposta: chaves do objeto e colunas da linha.
    assert.deepEqual(medidasNovo[0].chaves, ["data", "total_count"]);
    const colunasNovo = medidasNovo[0].linhaChaves;
    assert.ok(
      colunasNovo.includes("items") && colunasNovo.includes("address"),
      "a linha perdeu items ou address",
    );

    // ---- Rollback: o corpo da 99 byte a byte; 92b positiva. ----
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(anterior.prosrc, CORPO_DA_99);
    await conferir(c, antes, true);
    await conferir(c, depois, false);
    const medidasAntigo = await medirTudo(c);

    // CONTROLE (o defeito de origem), medido no corpo antigo:
    const ix = (termo) => ESPERADO_NOVO.findIndex(([t]) => t === termo);
    assert.ok(
      medidasAntigo[ix("3884BE")].ids.includes(PEDIDOS.fone3884.id),
      "ANTIGO: a busca pelo numero 3884BE trazia o telefone de outra pessoa",
    );
    assert.ok(medidasAntigo[ix("3884BE")].ids.includes(PEDIDOS.numero.id));
    assert.deepEqual(
      medidasAntigo[ix("Cliente 3884")].ids,
      ordem("fone3884"),
      "ANTIGO: nome com numero virava busca de telefone",
    );
    assert.deepEqual(
      medidasAntigo[ix("12345abc")].ids,
      ordem("fone123456"),
      "ANTIGO: texto com letra virava busca de telefone",
    );
    assert.deepEqual(
      medidasAntigo[ix("123456")].ids,
      ordem("fone123456", "soDigito"),
      "ANTIGO: o telefone mais novo empurrava o pedido do numero para baixo",
    );

    // O que NAO muda entre o corpo antigo e o novo: telefone, poucos digitos, nome, rastreio,
    // cupom e a lista sem busca (mesmos ids, mesma ordem, mesmo total).
    for (const termo of [
      "3884",
      "(34) 93884-5555",
      "34938845555",
      "+34 93884.5555",
      "5555",
      "93884",
      "888",
      "22",
      "Telefone",
      "BR778899XY",
      "frete-outubro",
      "  ",
    ]) {
      assert.deepEqual(
        medidasNovo[ix(termo)],
        medidasAntigo[ix(termo)],
        `a busca "${termo}" mudou entre o corpo antigo e o novo`,
      );
    }
    // E a ordem sem busca e a de sempre (created_at DESC).
    assert.deepEqual(
      medidasNovo[ix("  ")].ids,
      [...Object.values(PEDIDOS)]
        .sort((a, b) => (a.criado < b.criado ? 1 : -1))
        .map((p) => p.id),
    );
    assert.deepEqual(medidasNovo[0].chaves, medidasAntigo[0].chaves);
    assert.deepEqual(medidasNovo[0].linhaChaves, medidasAntigo[0].linhaChaves);

    // ---- Reaplica o novo; nada de dado muda no apply ----
    await c.query(migration);
    assert.deepEqual(
      await fotografar(c),
      dados,
      "apply alterou pedido, historico ou item",
    );
    assert.deepEqual(
      await funcao(c),
      topo,
      "apply nao reproduziu o topo instalado pelo CI (OID, dono, ACL, atributos ou corpo)",
    );
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    exigirNovo(await medirTudo(c));

    // ---- CONTROLES: tirar cada pedaco da regra muda o resultado (o teste nao e cego). ----
    const definicao = (
      await c.query(
        `SELECT pg_get_functiondef('${ASSINATURA}'::regprocedure) AS d`,
      )
    ).rows[0].d;
    const mutantes = [
      [
        "sem a guarda de telefone nos DOIS blocos",
        /v_parece_telefone AND length\(v_search_digitos\) >= 4/g,
        "length(v_search_digitos) >= 4",
      ],
      [
        "sem a guarda de telefone so no bloco da contagem",
        /v_parece_telefone AND length\(v_search_digitos\) >= 4/,
        "length(v_search_digitos) >= 4",
      ],
      [
        "regra de telefone que aceita letra",
        /\^\[\+\]\?\[0-9\(\) \.-\]\+\$/,
        "^[+]?[0-9A-Za-z() .-]+$",
      ],
      [
        "regra de telefone que nunca aceita",
        /v_clean_search ~ '\^\[\+\]\?\[0-9\(\) \.-\]\+\$'/,
        "FALSE",
      ],
      [
        "sem o pedido do numero primeiro",
        /upper\(right\(o\.id::TEXT, 6\)\) = upper\(v_clean_search\)/,
        "FALSE",
      ],
      [
        "numero casado com os 6 PRIMEIROS caracteres",
        /right\(o\.id::TEXT, 6\)/,
        "left(o.id::TEXT, 6)",
      ],
      [
        "limiar de digitos de 4 para 1",
        /v_parece_telefone AND length\(v_search_digitos\) >= 4/g,
        "v_parece_telefone AND length(v_search_digitos) >= 1",
      ],
    ];
    for (const [nome, de, para] of mutantes) {
      const mutante = definicao.replace(de, para);
      assert.notEqual(
        mutante,
        definicao,
        `mutante "${nome}" nao mexeu no corpo`,
      );
      await isolado(c, async () => {
        await c.query(mutante);
        let passou = false;
        try {
          exigirNovo(await medirTudo(c));
          passou = true;
        } catch {
          // O esperado: a prova ficaria VERMELHA com este defeito.
        }
        assert.equal(passou, false, `mutante "${nome}" passou despercebido`);
      });
    }

    // ---- Porta: quem nao e admin nao enxerga nada (antes de qualquer leitura). ----
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [CLIENTE]);
    await recusa(
      c,
      () => c.query("SELECT public.get_admin_orders_paged('3884BE')"),
      "P0001",
      /Acesso negado/,
    );
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

    // ---- Reaplicar: mesmo estado, inclusive com fim de linha CRLF. ----
    await c.query(migration);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.deepEqual(await fotografar(c), dados, "reaplicar tocou dados");
    assert.deepEqual(
      await funcao(c),
      topo,
      "reaplicar mudou OID, dono, ACL ou atributos",
    );
    exigirNovo(await medirTudo(c));

    // ---- Corpo ou atributos desconhecidos: o preflight recusa sem escrever. ----
    for (const sabotagem of [
      definicao.replace("DECLARE", "-- corpo desconhecido\nDECLARE"),
      `ALTER FUNCTION ${ASSINATURA} SECURITY INVOKER`,
      `ALTER FUNCTION ${ASSINATURA} SET search_path TO pg_catalog`,
      `GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`,
      `REVOKE EXECUTE ON FUNCTION ${ASSINATURA} FROM service_role`,
      `REVOKE EXECUTE ON FUNCTION ${ASSINATURA} FROM authenticated`,
    ]) {
      await isolado(c, async () => {
        await c.query(sabotagem);
        const sabotada = await funcao(c);
        await recusa(
          c,
          () => c.query(migration),
          "P0001",
          /B1_BASELINE_DIVERGENT/,
        );
        assert.deepEqual(
          await funcao(c),
          sabotada,
          "preflight escreveu antes de recusar",
        );
        assert.deepEqual(await fotografar(c), dados);
      });
    }
    // Sobrecarga: uma segunda get_admin_orders_paged deixa o alvo ambiguo e o preflight recusa.
    await isolado(c, async () => {
      await c.query(
        `CREATE FUNCTION public.get_admin_orders_paged(p_search text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
      );
      await recusa(
        c,
        () => c.query(migration),
        "P0001",
        /B1_BASELINE_DIVERGENT/,
      );
    });

    // ---- Rollback: exato, sem tocar em dado; o segundo recusa. ----
    await c.query(rollback);
    assert.deepEqual(
      await funcao(c),
      anterior,
      "rollback nao devolveu corpo/atributos byte a byte",
    );
    assert.deepEqual(await fotografar(c), dados, "rollback tocou dados");
    await recusa(c, () => c.query(rollback), "P0001", /B1_BASELINE_DIVERGENT/);
    await conferir(c, antes, true);
    await c.query(migration);
    await conferir(c, depois, true);
    console.log(
      "PASSOU 387: o numero do pedido (3884BE) acha o pedido e nao o telefone de outra pessoa; nome com numero e texto com letra nao viram telefone; telefone (mascarado, so digitos, +, 4 ultimos) segue achando; o pedido do numero so-digito vem primeiro; total_count, paginacao, filtros e ordem iguais; 7 controles; porta de admin; reaplicacao/CRLF; preflight (6 sabotagens + sobrecarga); rollback exato; consultas 92a/92b.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
