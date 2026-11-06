"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices vem de listas fechadas deste arquivo. */
// 20261399900000: a busca de Pedidos acha o telefone colado com o +55 (get_admin_orders_paged corta o 55 dos digitos da busca
// com 12 ou 13 digitos que comecam por 55, a mesma regra da busca de Clientes e da do CRM).
// Somente Postgres descartavel do rpc-ci, nunca banco de loja. A prova nao roda automaticamente fora do
// CI_BANCO_EFEMERO=1 + localhost (efemero.cjs).
//
// O que esta prova mostra, em linguagem de balcao:
//   * "+55 34 98888-7777", "5534988887777" e "55 34 98888 7777" (o numero colado do WhatsApp) acham o pedido guardado como
//     "(34) 98888-7777"; telefone fixo (12 digitos com o 55) e o que vem do whatsapp do pedido tambem;
//   * no corpo ANTIGO (o da 20261387000000, na mesma semente) nenhum desses achava: e' o defeito, medido;
//   * o DDD 55 (Santa Maria/RS) com 11 digitos NAO perde o 55; 12 digitos que nao comecam por 55 e 14 digitos nao se cortam;
//   * telefone guardado COM o 55 continua casando, digitado de qualquer jeito;
//   * tudo o que ja achava (numero do pedido, so digitos, 4 ultimos digitos) segue igual no JSON inteiro;
//   * contagem, pagina e filtros com a mesma regra; controles: cada pedaco da regra, tirado, muda o resultado;
//   * porta de admin, reaplicar (inclusive CRLF), preflight, rollback byte a byte, segundo rollback recusado e consultas 125a/125b.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399900000_a_busca_de_pedidos_acha_o_telefone_colado_com_o_55.sql";
const NOME_387 =
  "20261387000000_a_busca_de_pedido_pelo_numero_nao_vira_busca_de_telefone.sql";
const ASSINATURA =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";
const HASH_ANTES = "f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6";
const HASH_DEPOIS = "bf08545275eaa451a65e15feceb0ed8d";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const antes = ler(
  "scripts/publicacao/consultas/125b-antes-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-base-vigente.sql",
);
const depois = ler(
  "scripts/publicacao/consultas/125a-conferir-a-busca-de-pedidos-acha-o-telefone-colado-com-o-55-aplicado.sql",
);
const CORPO_DA_387 = ler(`supabase/migrations/${NOME_387}`).match(
  /CREATE OR REPLACE FUNCTION public\.get_admin_orders_paged\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
)[1];

const ADMIN = "5e399900-0000-4000-8000-000000000001";
const CLIENTE = "5e399900-0000-4000-8000-000000000002";
const id = (sufixo) => `5e399900-0000-4000-8000-${sufixo}`;

// Cada pedido e uma linha inserida com o created_at dado (ordem deterministica, o mais novo primeiro).
const PEDIDOS = {
  // O telefone como o checkout grava: mascarado e SEM o codigo do pais.
  zap: {
    id: id("0000000000a1"),
    nome: "Cliente Zap",
    fone: "(34) 98888-7777",
    criado: "2001-10-01T12:00:00Z",
  },
  // Guardado COM o 55 (so digitos).
  com55: {
    id: id("0000000000a2"),
    nome: "Cliente Com 55",
    fone: "5534977776666",
    criado: "2001-10-02T12:00:00Z",
  },
  // DDD 55 (Santa Maria/RS): o 55 e' o DDD, nao o pais.
  ddd55: {
    id: id("0000000000a3"),
    nome: "Cliente Santa Maria",
    fone: "(55) 99999-1234",
    criado: "2001-10-03T12:00:00Z",
  },
  // Quase o mesmo numero do de cima, com outro DDD: so casaria se o 55 fosse cortado dos 11 digitos.
  outroDdd: {
    id: id("0000000000a4"),
    nome: "Cliente Outro Ddd",
    fone: "(34) 99999-1234",
    criado: "2001-10-04T12:00:00Z",
  },
  // 12 digitos que NAO comecam por 55: "993456789012" contem "3456789012" (o que sobraria de um corte errado).
  doze993: {
    id: id("0000000000a5"),
    nome: "Cliente Doze A",
    fone: "993456789012",
    criado: "2001-10-05T12:00:00Z",
  },
  doze123: {
    id: id("0000000000a6"),
    nome: "Cliente Doze B",
    fone: "123456789012",
    criado: "2001-10-06T12:00:00Z",
  },
  // Fixo: "(34) 3333-4444" = 10 digitos; com o +55 sao 12.
  fixo: {
    id: id("0000000000a7"),
    nome: "Cliente Fixo",
    fone: "(34) 3333-4444",
    criado: "2001-10-07T12:00:00Z",
  },
  // Sem customer_phone: o whatsapp vem do jsonb do pedido (o coalesce que a busca ja tinha).
  json: {
    id: id("0000000000a8"),
    nome: "Cliente Json",
    fone: null,
    whatsapp: "(21) 97777-3333",
    criado: "2001-10-08T12:00:00Z",
  },
  // O numero do pedido que o painel mostra ("#3884BE"): letra e digito juntos.
  numero: {
    id: id("0000003884be"),
    nome: "Cliente Do Numero",
    fone: "(34) 90000-0001",
    criado: "2001-10-09T12:00:00Z",
  },
  // Mesmo numero do "zap" com OUTRO DDD (44): "4988887777" (o que sobraria de um corte de 3 digitos) estaria contido aqui.
  zap44: {
    id: id("0000000000a9"),
    nome: "Cliente Zap Outro Ddd",
    fone: "(44) 98888-7777",
    criado: "2001-10-10T12:00:00Z",
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
        canal, payment_method, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 100, 100, 'pending', 'online', 'pix', $6, $6)`,
    [
      p.id,
      CLIENTE,
      p.nome,
      p.fone,
      JSON.stringify(p.whatsapp ? { whatsapp: p.whatsapp } : {}),
      p.criado,
    ],
  );
}

async function buscar(c, termo, extra = {}) {
  const r = (
    await c.query(
      "SELECT public.get_admin_orders_paged($1, $2, $3, $4, $5, $6, $7, $8) AS r",
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
async function hashVivo(c) {
  return (
    await c.query(
      `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].h;
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso3999");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3999");
    await c.query("RELEASE SAVEPOINT caso3999");
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

// O que o corpo NOVO deve responder. Cada linha: [termo, ids esperados em ordem (o mais novo primeiro)].
const ESPERADO_NOVO = [
  // O defeito: o numero colado do WhatsApp, de qualquer jeito.
  ["+55 34 98888-7777", ordem("zap")],
  ["5534988887777", ordem("zap")],
  ["55 34 98888 7777", ordem("zap")],
  ["+55 (34) 98888-7777", ordem("zap")],
  ["  +55 34 98888-7777  ", ordem("zap")],
  // Fixo: +55 com 10 digitos = 12.
  ["+55 34 3333-4444", ordem("fixo")],
  // O whatsapp que vem do jsonb do pedido.
  ["+55 21 97777-3333", ordem("json")],
  // Guardado COM o 55: casa digitado com o +55 e sem ele.
  ["+55 34 97777-6666", ordem("com55")],
  ["5534977776666", ordem("com55")],
  ["34 97777-6666", ordem("com55")],
  // DDD 55: 11 digitos nao se cortam; com o +55 na frente sao 13 e o corte tira so o do pais.
  ["55999991234", ordem("ddd55")],
  ["(55) 99999-1234", ordem("ddd55")],
  ["+55 55 99999-1234", ordem("ddd55")],
  // O que ja achava continua achando.
  ["34 98888-7777", ordem("zap")],
  ["34988887777", ordem("zap")],
  ["88887777", ordem("zap44", "zap")],
  ["5534", ordem("com55")],
  ["3884BE", ordem("numero")],
  ["Cliente Fixo", ordem("fixo")],
  // Nao se corta onde nao e' o +55 do Brasil.
  ["123456789012", ordem("doze123")], // 12 digitos que nao comecam por 55
  ["55123456789012", []], // 14 digitos
  ["+12 34 98888-7777", []], // 13 digitos que nao comecam por 55
  // Letra no termo: nao e' telefone (a guarda da 20261387000000).
  ["+55 34 98888-7777 x", []],
  // Quatro digitos: ainda telefone (e nao e' o caso do corte).
  ["1234", ordem("doze123", "outroDdd", "ddd55")],
  // Poucos digitos: nunca telefone.
  ["888", []],
  // Lista sem busca: todos, o mais novo primeiro.
  [
    "  ",
    ordem(
      "zap44",
      "numero",
      "json",
      "fixo",
      "doze123",
      "doze993",
      "outroDdd",
      "ddd55",
      "com55",
      "zap",
    ),
  ],
];

async function medirTudo(c) {
  const saida = [];
  for (const [termo] of ESPERADO_NOVO) saida.push(await buscar(c, termo));
  // Paginacao: "1234" acha 3 (doze123, outroDdd, ddd55), 2 por pagina.
  saida.push(await buscar(c, "1234", { tamanho: 2, pagina: 0 }));
  saida.push(await buscar(c, "1234", { tamanho: 2, pagina: 1 }));
  // O corte vale junto com os filtros, na contagem e na pagina.
  saida.push(await buscar(c, "+55 34 98888-7777", { status: "pending" }));
  saida.push(await buscar(c, "+55 34 98888-7777", { status: "shipping" }));
  saida.push(await buscar(c, "+55 34 98888-7777", { canal: "online" }));
  saida.push(await buscar(c, "+55 34 98888-7777", { canal: "presencial" }));
  return saida;
}

function exigirNovo(medidas) {
  ESPERADO_NOVO.forEach(([termo, ids], i) => {
    assert.deepEqual(
      medidas.at(i).ids,
      ids,
      `NOVO: busca ${JSON.stringify(termo)}`,
    );
    assert.equal(
      medidas.at(i).total,
      ids.length,
      `NOVO: total_count de ${JSON.stringify(termo)} tem de ser o numero de pedidos achados (contagem e pagina com a mesma regra)`,
    );
  });
  const n = ESPERADO_NOVO.length;
  assert.deepEqual(medidas.at(n).ids, ordem("doze123", "outroDdd"), "pagina 0");
  assert.equal(medidas.at(n).total, 3);
  assert.deepEqual(medidas.at(n + 1).ids, ordem("ddd55"), "pagina 1");
  assert.equal(medidas.at(n + 1).total, 3);
  assert.deepEqual(medidas.at(n + 2).ids, ordem("zap"), "com status pending");
  assert.equal(medidas.at(n + 2).total, 1);
  assert.deepEqual(medidas.at(n + 3).ids, [], "com status shipping");
  assert.equal(medidas.at(n + 3).total, 0);
  assert.deepEqual(medidas.at(n + 4).ids, ordem("zap"), "canal online");
  assert.equal(medidas.at(n + 4).total, 1);
  assert.deepEqual(medidas.at(n + 5).ids, [], "canal presencial");
  assert.equal(medidas.at(n + 5).total, 0);
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    const topo = await funcao(c);
    assert.equal(
      await hashVivo(c),
      HASH_DEPOIS,
      "a arvore aplicada pelo CI nao deixou o corpo desta migration no ar",
    );
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin-busca-3999@fixture.invalid', '{"role":"admin"}'),
              ($2, 'cliente-busca-3999@fixture.invalid', '{}')`,
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

    // ---- Rollback: o corpo da 20261387000000 byte a byte; 125b positiva. ----
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(anterior.prosrc, CORPO_DA_387);
    assert.equal(await hashVivo(c), HASH_ANTES);
    await conferir(c, antes, true);
    await conferir(c, depois, false);
    const medidasAntigo = await medirTudo(c);

    // CONTROLE (o defeito de origem), medido no corpo antigo, na MESMA semente:
    const ix = (termo) => ESPERADO_NOVO.findIndex(([t]) => t === termo);
    for (const termo of [
      "+55 34 98888-7777",
      "5534988887777",
      "55 34 98888 7777",
      "+55 (34) 98888-7777",
      "  +55 34 98888-7777  ",
      "+55 34 3333-4444",
      "+55 21 97777-3333",
      "+55 55 99999-1234",
    ])
      assert.deepEqual(
        medidasAntigo[ix(termo)].ids,
        [],
        `ANTIGO: o numero colado do WhatsApp ${JSON.stringify(termo)} ja achava o pedido? o defeito nao existe mais`,
      );

    // O que NAO muda entre o corpo antigo e o novo: tudo menos o corte (mesmos ids, mesma ordem, mesmo total, mesmas colunas).
    const MUDAM = new Set([
      "+55 34 98888-7777",
      "5534988887777",
      "55 34 98888 7777",
      "+55 (34) 98888-7777",
      "  +55 34 98888-7777  ",
      "+55 34 3333-4444",
      "+55 21 97777-3333",
      "+55 55 99999-1234",
    ]);
    ESPERADO_NOVO.forEach(([termo], i) => {
      if (MUDAM.has(termo)) return;
      assert.deepEqual(
        medidasNovo[i],
        medidasAntigo[i],
        `a busca ${JSON.stringify(termo)} mudou entre o corpo antigo e o novo`,
      );
    });
    // Paginacao, filtros e canal: as buscas sem o corte so mudam onde o termo depende dele.
    const n = ESPERADO_NOVO.length;
    assert.deepEqual(medidasNovo[n], medidasAntigo[n], "pagina 0 mudou");
    assert.deepEqual(
      medidasNovo[n + 1],
      medidasAntigo[n + 1],
      "pagina 1 mudou",
    );
    assert.deepEqual(
      medidasAntigo[n + 2].ids,
      [],
      "ANTIGO: com filtro de status o +55 tambem nao achava",
    );
    assert.deepEqual(
      medidasAntigo[n + 4].ids,
      [],
      "ANTIGO: com filtro de canal o +55 tambem nao achava",
    );
    // E a ordem sem busca e a de sempre (created_at DESC).
    assert.deepEqual(
      medidasNovo[ix("  ")].ids,
      [...Object.values(PEDIDOS)]
        .sort((a, b) => (a.criado < b.criado ? 1 : -1))
        .map((p) => p.id),
    );
    assert.deepEqual(medidasNovo[0].chaves, medidasAntigo[0].chaves);
    // a busca [0] ("+55 ...") é justamente a que MUDA (o corpo antigo não acha): compara
    // uma que não muda, para provar que o formato das colunas é o mesmo.
    assert.deepEqual(
      medidasNovo[ix("34 98888-7777")].linhaChaves,
      medidasAntigo[ix("34 98888-7777")].linhaChaves,
    );

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
    const COND =
      "IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN";
    assert.equal(
      definicao.split(COND).length - 1,
      1,
      "a condicao do corte nao aparece exatamente uma vez",
    );
    const mutantes = [
      ["sem o corte (nunca corta)", COND, "IF false THEN"],
      [
        "corta so com 13 digitos (o fixo com +55 tem 12)",
        "IN (12, 13)",
        "IN (13)",
      ],
      [
        "corta so com 12 digitos (o celular com +55 tem 13)",
        "IN (12, 13)",
        "IN (12)",
      ],
      [
        "corta de 12 digitos para cima (14 digitos tambem)",
        "length(v_search_digitos) IN (12, 13)",
        "length(v_search_digitos) >= 12",
      ],
      [
        "corta tambem com 11 digitos (o DDD 55 perde o 55)",
        "IN (12, 13)",
        "IN (11, 12, 13)",
      ],
      [
        "corta sem exigir que comece por 55",
        " AND left(v_search_digitos, 2) = '55' THEN",
        " THEN",
      ],
      [
        "corta o 55 e mais um digito",
        "substr(v_search_digitos, 3)",
        "substr(v_search_digitos, 4)",
      ],
      [
        "corta e devolve so os 2 primeiros digitos",
        "substr(v_search_digitos, 3)",
        "left(v_search_digitos, 2)",
      ],
    ];
    for (const [nome, de, para] of mutantes) {
      const mutante = definicao.replace(de, () => para);
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
      () =>
        c.query("SELECT public.get_admin_orders_paged('+55 34 98888-7777')"),
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
      `ALTER FUNCTION ${ASSINATURA} STABLE`,
      `GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`,
      `GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO PUBLIC`,
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
    // Funcao ausente: o preflight recusa (nao cria nada do zero).
    await isolado(c, async () => {
      await c.query(`DROP FUNCTION ${ASSINATURA}`);
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
    // Ida e volta: o rollback em CRLF tambem vale.
    await c.query(migration);
    await c.query(rollback.replace(/\n/g, "\r\n"));
    assert.deepEqual(await funcao(c), anterior, "rollback em CRLF");
    await c.query(migration);
    assert.deepEqual(await funcao(c), topo, "ida, volta e ida");
    await conferir(c, depois, true);
    console.log(
      "PASSOU 3999: o numero colado do WhatsApp (+55 34 98888-7777, 5534988887777, fixo, whatsapp do jsonb, DDD 55 com +55) acha o pedido; no corpo antigo, na mesma semente, nao achava; DDD 55 com 11 digitos, 12 digitos sem 55 e 14 digitos nao se cortam; telefone guardado com o 55 segue casando; JSON do resto igual; total_count, pagina e filtros com a mesma regra; 8 controles; porta de admin; reaplicacao/CRLF; preflight (8 sabotagens, sobrecarga, ausente) e conferencia final desfaz; rollback exato e segundo recusado; consultas 125a/125b.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  await atomicidade();
}

// A conferencia final reprovando DESFAZ a troca. Prova que so vale SEM BEGIN: dentro de uma transacao aberta o ROLLBACK TO SAVEPOINT desfaria
// tudo de qualquer jeito e a prova seria vazia. Aqui o arquivo vai como UMA mensagem (uma transacao implicita), numa conexao propria, no clone
// descartavel do rpc-ci (efemero.cjs recusa qualquer outro banco). O estado de saida e' o de entrada (o corpo desta migration no ar).
async function atomicidade() {
  const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await solto.connect();
  try {
    const sabotada = migration.replace(
      "    IF length(v_search_digitos) IN (12, 13)",
      () =>
        "    -- um byte a mais\n    IF length(v_search_digitos) IN (12, 13)",
    );
    assert.notEqual(sabotada, migration);
    await solto.query(rollback); // estado ANTES, de verdade: o corpo da 20261387000000
    assert.equal(await hashVivo(solto), HASH_ANTES);
    await assert.rejects(
      () => solto.query(sabotada),
      /B1_BASELINE_DIVERGENT: conferencia 20261399900000/,
    );
    assert.equal(
      await hashVivo(solto),
      HASH_ANTES,
      "a conferencia reprovou mas a troca ficou gravada",
    );
    await solto.query(migration);
    assert.equal(await hashVivo(solto), HASH_DEPOIS);
    console.log(
      "PASSOU 3999 (atomicidade): a conferencia reprovando desfaz a troca; o arquivo vai como UMA mensagem, sem BEGIN.",
    );
  } finally {
    await solto.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
