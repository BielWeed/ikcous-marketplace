"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261399990000_o_crm_nao_duplica_o_comprador_com_e_sem_55.sql (public.crm__vendas, a fonte de
 * todo comprador do CRM) contra o Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca
 * banco de loja. A maior parte numa transacao desfeita; a prova de atomicidade usa uma segunda conexao SEM BEGIN no clone
 * descartavel (rodar-isolado) e deixa o estado como encontrou.
 *
 * O que prova:
 *  (1) O MESMO WhatsApp com e sem o 55 e UM comprador: duas vendas de balcao ("5534999990000" e "(34) 99999-0000") viram
 *      uma chave so; o balcao com "+55 34 98888-0001" entra na CONTA cujo pedido pago tem "(34) 98888-0001"; o CRM
 *      (crm__clientes_rfm e crm_clientes) lista UM cartao com as duas vendas. A coluna whatsapp continua o numero digitado.
 *  (2) BORDAS: telefones DIFERENTES continuam diferentes (com e sem o 55); o DDD 55 de 11 digitos NAO perde o 55 e
 *      "5555999991234" (pais + DDD 55) e o mesmo comprador de "55999991234"; 12 digitos que nao comecam por 55 nao se cortam;
 *      WhatsApp ausente, vazio ou so pontuacao fica SEM chave (nunca junta dois compradores) e a conta sem WhatsApp segue pela
 *      conta; pedido cancelado nao entra; com duas contas para o mesmo numero o balcao vai para a que comprou por ULTIMO.
 *  (3) Quem le a crm__vendas: crm_visao conta UM comprador; crm__nunca_comprou segue sem listar quem ja comprou no balcao
 *      com o 55; crm__pedidos_nao_pagos deixa de listar como "pediu e nao pagou" quem ja comprou no balcao (com o 55) e pediu
 *      de novo sem o 55.
 *  (4) CONTROLE: o corpo anterior (o da 20261178000000, pelo rollback-manual) reprova a bateria (o defeito); mutantes
 *      (sem o corte na chave, sem o corte na fusao, so 13 digitos, sem conferir o tamanho, tambem 11 digitos, chave vazia
 *      para quem nao tem numero, fusao com a conta mais antiga) deixam a prova vermelha. So o 55 muda: o JSON de quem nao tem
 *      55 envolvido e igual ao do corpo anterior.
 *  (5) Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais; o rollback devolve o corpo da 20261178000000 byte a
 *      byte; rodar o rollback de novo deixa o mesmo estado; reaplicar depois do rollback volta.
 *  (6) Pre-voo recusa sem escrever (corpo desconhecido, ACL aberta para anon, authenticated ou PUBLIC, atributo diferente,
 *      sobrecarga); o rollback recusa corpo desconhecido; a conferencia final sabotada derruba o arquivo inteiro, inclusive
 *      numa conexao SEM BEGIN (o arquivo e UM lote: ou cai tudo ou nao cai nada).
 *  (7) Consultas 142a/142b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-crm-nao-duplica-o-comprador-com-e-sem-55-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261399990000_o_crm_nao_duplica_o_comprador_com_e_sem_55.sql";
const NOME_ANTERIOR = "20261178000000_o_crm_e_o_inicio_leem_a_loja.sql";
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
    /CREATE OR REPLACE FUNCTION public\.crm__vendas\([^\n]*\)[\s\S]*?\nAS \$\$([\s\S]*?)\$\$;/,
  )[1];
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_ANTERIOR}`));
const CORPO_NOVO = corpoDe(migration);
const HASH_ANTES = "8a802f6324c86cdc0be214b4d5ac69bb";
const HASH_NOVO = "bd683b55c36dff83eefa0282077d9a63";
const ASSINATURA = "public.crm__vendas(timestamptz)";
const C142A =
  "142a-conferir-o-crm-nao-duplica-o-comprador-com-e-sem-55-aplicado";
const C142B =
  "142b-antes-o-crm-nao-duplica-o-comprador-com-e-sem-55-base-vigente";
// O cabecalho (CREATE OR REPLACE ... AS $$) da migration, para trocar so o corpo nos mutantes e nas sabotagens.
const CABECALHO_DA_FUNCAO = migration.match(
  /CREATE OR REPLACE FUNCTION public\.crm__vendas\([^\n]*\)[\s\S]*?\nAS \$\$/,
)[0];
const trocarCorpo = (c, corpo) => c.query(`${CABECALHO_DA_FUNCAO}${corpo}$$;`);

const ADMIN = "e3999000-1399-4000-8000-000000000001";
const U1 = "e3999000-1399-4000-8000-000000000011"; // conta com pedido pago "(34) 98888-0001"
const U2 = "e3999000-1399-4000-8000-000000000012"; // conta sem WhatsApp nenhum
const U3 = "e3999000-1399-4000-8000-000000000013"; // conta que comprou por ULTIMO com "5534977770000"
const U4 = "e3999000-1399-4000-8000-000000000014"; // conta que comprou ANTES com "(34) 97777-0000"
const U5 = "e3999000-1399-4000-8000-000000000015"; // perfil que nunca comprou, "(34) 99999-0000"
const CONTAS = [
  [U1, "Conta Um"],
  [U2, "Conta Dois"],
  [U3, "Conta Tres"],
  [U4, "Conta Quatro"],
  [U5, "Perfil Sem Pedido"],
];

/** [apelido, user_id, WhatsApp como o pedido grava (ou undefined: sem a chave), horas atras, status, pagamento, canal] */
const VENDAS = [
  // (1) o mesmo numero com e sem o 55: balcao sem conta.
  ["Dora Balcao", null, "5534999990000", 10],
  ["Dora Balcao", null, "(34) 99999-0000", 9],
  // (1) a conta e o balcao com "+55": a fusao.
  ["Conta Um", U1, "(34) 98888-0001", 20, "delivered", "pago", "online"],
  ["Balcao Da Um", null, "+55 34 98888-0001", 8],
  // (2) numeros DIFERENTES (um com o 55, outro sem): continuam dois.
  ["Eva Balcao", null, "5534999990002", 7],
  ["Edu Balcao", null, "34999990003", 6],
  // (2) DDD 55 de 11 digitos nao perde o 55; pais + DDD 55 (13 digitos) e o mesmo comprador; sem DDD e outro.
  ["Fabi Balcao", null, "55999991234", 5],
  ["Fabi Balcao", null, "5555999991234", 4],
  ["Gil Balcao", null, "999991234", 3],
  // (1) fixo (10 digitos): pais + fixo tem 12 digitos, o mesmo comprador do fixo sem o 55.
  ["Paula Fixa", null, "553433331234", 3],
  ["Paula Fixa", null, "(34) 3333-1234", 3],
  // (2) 12 digitos que nao comecam por 55 nao se cortam; o de 10 digitos e outro.
  ["Hugo Balcao", null, "123456789012", 3],
  ["Ivo Balcao", null, "3456789012", 3],
  // (2) sem numero: ausente, vazio, so pontuacao -- nenhum vira chave e nenhum junta com outro.
  ["Sem Zap Ausente", null, undefined, 2],
  ["Sem Zap Vazio", null, "", 2],
  ["Sem Zap Pontuacao", null, "(--) ---", 2],
  // (2) conta sem WhatsApp: a chave e a conta.
  ["Conta Dois", U2, undefined, 2, "delivered", "pago", "online"],
  // (2) pedido cancelado nao entra, mesmo com o numero de outro comprador.
  ["Cancelada", null, "5534999990000", 2, "cancelled"],
  // (2) duas contas para o mesmo numero (uma com o 55, outra sem): o balcao vai para a que comprou por ULTIMO.
  ["Conta Quatro", U4, "(34) 97777-0000", 30, "delivered", "pago", "online"],
  ["Conta Tres", U3, "5534977770000", 25, "delivered", "pago", "online"],
  ["Balcao Das Contas", null, "34977770000", 1],
  // (3) o balcao com o 55 que depois pede de novo sem o 55 (esse pedido fica sem pagar).
  ["Joao Balcao", null, "5534966660000", 12],
  // (3) o perfil U5 tem o mesmo numero da Dora ("(34) 99999-0000") e nenhum pedido (ver a conta U5 acima).
];
// Pedido NAO pago: quem comprou no balcao com o 55 ("Joao Balcao") pede de novo SEM o 55 e nao paga.
const NAO_PAGO = ["Joao Balcao", "(34) 96666-0000"];

async function funcao(c) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${ASSINATURA}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
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
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa3999");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa3999");
    await c.query("RELEASE SAVEPOINT recusa3999");
  }
}

async function fixture(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@crm3999.teste', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Crm', 'admin')",
    [ADMIN],
  );
  for (const [id, nome] of CONTAS) {
    await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${id.slice(-2)}@crm3999.teste`,
    ]);
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES ($1, $2, 'customer', $3)",
      [id, nome, id === U5 ? "(34) 99999-0000" : null],
    );
  }
  const insere = async (
    nome,
    userId,
    zap,
    horas,
    status,
    pagamento,
    canal,
    pagoEm,
  ) => {
    const dados = zap === undefined ? {} : { whatsapp: zap };
    await c.query(
      `INSERT INTO public.marketplace_orders
         (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
          payment_status, paid_at, created_at)
       VALUES ($1, $2, $3::jsonb, 100, 100, $4, $5, 'online', $6,
               CASE WHEN $7::boolean THEN now() - ($8 || ' hours')::interval ELSE NULL END,
               now() - ($8 || ' hours')::interval)`,
      [
        userId,
        nome,
        JSON.stringify(dados),
        status ?? "delivered",
        canal ?? "presencial",
        pagamento ?? "pago",
        pagoEm,
        String(horas),
      ],
    );
  };
  for (const [nome, userId, zap, horas, status, pagamento, canal] of VENDAS)
    await insere(nome, userId, zap, horas, status, pagamento, canal, true);
  await insere(
    NAO_PAGO[0],
    null,
    NAO_PAGO[1],
    1,
    "pending",
    "aguardando",
    "online",
    false,
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
}

/** As chaves de comprador que a crm__vendas devolve, com as vendas de cada uma (por apelido do pedido). */
async function chaves(c) {
  const rows = (
    await c.query(
      `SELECT chave, nome, user_id::text AS uid, whatsapp, total::float8 AS total
         FROM public.crm__vendas(now()) ORDER BY chave NULLS FIRST, nome, whatsapp NULLS FIRST`,
    )
  ).rows;
  const porChave = new Map();
  for (const r of rows) {
    const k = r.chave ?? "(sem chave)";
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(r);
  }
  return { rows, porChave };
}
const nomesDe = (porChave, k) =>
  (porChave.get(k) ?? []).map((r) => r.nome).sort();

/** A bateria: o que a crm__vendas e as RPCs do CRM tem de dizer sobre a fixture. Devolve a lista de erros (vazia = verde). */
async function bateria(c) {
  const erros = [];
  const confere = (rotulo, vivo, esperado) => {
    if (JSON.stringify(vivo) !== JSON.stringify(esperado))
      erros.push(
        `${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(vivo)}`,
      );
  };
  const { porChave } = await chaves(c);

  // (1) o mesmo numero com e sem o 55: UMA chave, as duas vendas.
  confere(
    "Dora: chave unica",
    [...porChave.keys()].filter((k) => k.endsWith("34999990000")),
    ["wa:34999990000"],
  );
  confere("Dora: as duas vendas", nomesDe(porChave, "wa:34999990000"), [
    "Dora Balcao",
    "Dora Balcao",
  ]);
  confere(
    "o balcao com o 55 NAO sobra com chave propria",
    porChave.has("wa:5534999990000"),
    false,
  );
  // (1) a fusao com a conta: a conta U1 tem as duas vendas (a online e a do balcao com "+55").
  confere(
    "fusao: a conta U1 tem a venda dela e a do balcao",
    nomesDe(porChave, U1),
    ["Balcao Da Um", "Conta Um"],
  );
  confere(
    "fusao: nenhuma chave wa: sobra para o balcao da conta",
    [...porChave.keys()].filter((k) => k.endsWith("34988880001")),
    [],
  );
  // (1) a coluna exibida continua o numero digitado.
  confere(
    "whatsapp exibido e o digitado",
    (porChave.get("wa:34999990000") ?? []).map((r) => r.whatsapp).sort(),
    ["34999990000", "5534999990000"],
  );

  // (2) numeros diferentes seguem diferentes (com e sem o 55).
  confere(
    "fixo com o 55 (12 digitos) e sem o 55 e UM comprador",
    nomesDe(porChave, "wa:3433331234"),
    ["Paula Fixa", "Paula Fixa"],
  );
  confere(
    "Eva e Edu sao dois",
    [porChave.has("wa:34999990002"), porChave.has("wa:34999990003")],
    [true, true],
  );
  confere("Eva so tem a venda dela", nomesDe(porChave, "wa:34999990002"), [
    "Eva Balcao",
  ]);
  confere("Edu so tem a venda dele", nomesDe(porChave, "wa:34999990003"), [
    "Edu Balcao",
  ]);
  // (2) DDD 55 e DDI + DDD 55.
  confere(
    "DDD 55 de 11 digitos nao perde o 55 e junta com o DDI + DDD 55",
    nomesDe(porChave, "wa:55999991234"),
    ["Fabi Balcao", "Fabi Balcao"],
  );
  confere(
    "sem DDD ('999991234') e outro comprador",
    nomesDe(porChave, "wa:999991234"),
    ["Gil Balcao"],
  );
  confere(
    "o DDD 55 NAO virou o numero sem o DDD",
    porChave.has("wa:999991234") &&
      nomesDe(porChave, "wa:999991234").includes("Fabi Balcao"),
    false,
  );
  // (2) 12 digitos sem 55 nao se cortam; 10 digitos e outro.
  confere(
    "12 digitos que nao comecam por 55 ficam inteiros",
    nomesDe(porChave, "wa:123456789012"),
    ["Hugo Balcao"],
  );
  confere("10 digitos e outro comprador", nomesDe(porChave, "wa:3456789012"), [
    "Ivo Balcao",
  ]);
  // (2) sem numero: sem chave, e nenhum junta com ninguem.
  confere(
    "sem numero fica sem chave (e nao junta com ninguem)",
    nomesDe(porChave, "(sem chave)"),
    ["Sem Zap Ausente", "Sem Zap Pontuacao", "Sem Zap Vazio"],
  );
  confere("nenhuma chave 'wa:' vazia", porChave.has("wa:"), false);
  confere("conta sem WhatsApp segue pela conta", nomesDe(porChave, U2), [
    "Conta Dois",
  ]);
  // (2) cancelada nao entra.
  confere(
    "pedido cancelado nao entra",
    [...porChave.values()].flat().some((r) => r.nome === "Cancelada"),
    false,
  );
  // (2) duas contas com o mesmo numero: o balcao vai para a que comprou por ultimo (U3), cada conta fica com a sua.
  confere(
    "conta U3 (comprou por ultimo) fica com o balcao",
    nomesDe(porChave, U3),
    ["Balcao Das Contas", "Conta Tres"],
  );
  confere("conta U4 fica so com a venda dela", nomesDe(porChave, U4), [
    "Conta Quatro",
  ]);

  // (3a) crm__clientes_rfm: um cartao por comprador, com as vendas somadas.
  const rfm = (
    await c.query(
      "SELECT chave, pedidos_total, receita_total::float8 AS receita FROM public.crm__clientes_rfm(now())",
    )
  ).rows;
  const rfmDe = (k) => rfm.find((r) => r.chave === k);
  confere(
    "rfm: Dora e um cartao de 2 pedidos",
    [rfmDe("wa:34999990000")?.pedidos_total, rfmDe("wa:34999990000")?.receita],
    [2, 200],
  );
  confere(
    "rfm: a conta U1 soma o pedido e o balcao",
    [rfmDe(U1)?.pedidos_total, rfmDe(U1)?.receita],
    [2, 200],
  );
  confere(
    "rfm: sem chave 'wa:5534999990000'",
    rfmDe("wa:5534999990000"),
    undefined,
  );
  confere(
    "rfm: quem nao tem numero nao vira cartao",
    rfm.some((r) => r.chave === null || r.chave === "wa:"),
    false,
  );

  // (3b) crm_clientes (a lista da aba Clientes): a Dora e UM cartao com 2 pedidos.
  const lista = (
    await c.query("SELECT public.crm_clientes(NULL, 'Dora', 200, 0) AS r")
  ).rows[0].r;
  confere(
    "crm_clientes: Dora e UM cartao de 2 pedidos",
    lista.clientes.map((l) => [
      l.nome,
      l.pedidos,
      l.segmento === "pediu_nao_pagou",
    ]),
    [["Dora Balcao", 2, false]],
  );
  confere("crm_clientes: total da busca", lista.total, 1);

  // (3c) crm_visao: os compradores do periodo contam UMA vez cada.
  const compradoresDistintos = (
    await c.query(
      "SELECT count(DISTINCT chave)::int AS n FROM public.crm__vendas(now()) WHERE chave IS NOT NULL",
    )
  ).rows[0].n;
  const visao = (
    await c.query(
      "SELECT public.crm_visao(public.fin__dia(now()) - 3, public.fin__dia(now()) + 1) AS r",
    )
  ).rows[0].r;
  confere(
    "crm_visao: compradores = chaves distintas",
    visao.kpis.clientes_compradores,
    compradoresDistintos,
  );
  // O numero esperado, contado a mao: Dora(1) + Conta Um(1) + Eva(1) + Edu(1) + Fabi(1) + Gil(1) + Hugo(1) + Ivo(1) + Conta Dois(1)
  // + Conta Tres(1) + Conta Quatro(1) + Joao(1) + Paula(1) = 13 compradores.
  confere(
    "crm_visao: 13 compradores contados a mao",
    visao.kpis.clientes_compradores,
    13,
  );

  // (3d) crm__nunca_comprou: o perfil U5 tem o numero da Dora (que comprou no balcao, com e sem o 55): nao e "nunca comprou".
  const nunca = (
    await c.query(
      "SELECT nome FROM public.crm__nunca_comprou(now()) ORDER BY nome",
    )
  ).rows.map((r) => r.nome);
  confere(
    "nunca_comprou: o perfil com o numero da Dora nao entra",
    nunca.includes("Perfil Sem Pedido"),
    false,
  );

  // (3e) crm__pedidos_nao_pagos: o Joao comprou no balcao COM o 55 e pediu de novo SEM o 55 -- ja e comprador, nao "pediu e nao pagou".
  const naoPagos = (
    await c.query(
      "SELECT nome FROM public.crm__pedidos_nao_pagos(now()) ORDER BY nome",
    )
  ).rows.map((r) => r.nome);
  confere(
    "nao_pagos: quem ja comprou no balcao (com o 55) nao vira 'pediu e nao pagou'",
    naoPagos.includes("Joao Balcao"),
    false,
  );
  return erros;
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o da 20261178000000. ----
    const topo = await funcao(c);
    assert.equal(
      topo.prosrc,
      CORPO_NOVO,
      "o topo instalado nao e o da 20261399990000",
    );
    assert.equal(md5(topo.prosrc), HASH_NOVO);
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o anterior nao e o da 20261178000000",
    );
    console.log(
      "  PASSOU o topo instalado e o corpo desta migration (md5 conhecido); o anterior e o da 20261178000000",
    );

    await fixture(c);

    // ---- 1. A bateria inteira no corpo novo. ----
    const verde = await bateria(c);
    assert.deepEqual(verde, [], verde.join("\n"));
    console.log(
      "  PASSOU a bateria no corpo novo: com e sem o 55 e UM comprador (balcao, conta, rfm, lista, crm_visao); as bordas (numeros diferentes, DDD 55, 12 digitos, sem numero, cancelada, duas contas) ficam",
    );

    // ---- 2. Controle e mutantes. ----
    const errosAnterior = await isolado(c, async () => {
      await c.query(rollback);
      assert.equal(md5((await funcao(c)).prosrc), HASH_ANTES);
      return bateria(c);
    });
    assert.ok(
      errosAnterior.length >= 6,
      `o corpo anterior teria de reprovar a bateria (${errosAnterior.length})`,
    );
    const mutantes = [
      [
        "sem o corte na chave",
        (s) => s.replace("'wa:' || b.wa_chave", "'wa:' || b.wa"),
      ],
      [
        "sem o corte na fusao",
        (s) => s.replace("w.wa_chave = b.wa_chave", "w.wa_chave = b.wa"),
      ],
      [
        "corte so com 13 digitos",
        (s) => s.replace("IN (12, 13) AND left", "IN (13) AND left"),
      ],
      [
        "corta qualquer numero que comece por 55 (sem conferir o tamanho)",
        (s) =>
          s.replace(
            "length(b.wa) IN (12, 13) AND left(b.wa, 2) = '55'",
            "left(b.wa, 2) = '55'",
          ),
      ],
      [
        "corta tambem com 11 digitos (o DDD 55)",
        (s) => s.replace("IN (12, 13) AND left", "IN (11, 12, 13) AND left"),
      ],
      [
        "chave vazia para quem nao tem numero",
        (s) =>
          s.replace(
            "CASE WHEN b.wa_chave IS NOT NULL THEN 'wa:' || b.wa_chave END",
            "'wa:' || COALESCE(b.wa_chave, '')",
          ),
      ],
      [
        "a fusao pega a conta mais ANTIGA",
        (s) =>
          s.replace(
            "ORDER BY b.wa_chave, b.pago_em DESC",
            "ORDER BY b.wa_chave, b.pago_em ASC",
          ),
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
    console.log(
      `  PASSOU controle: o corpo anterior reprova a bateria (${errosAnterior.length} erros); ${mutantes.length} mutantes reprovam`,
    );

    // ---- 3. So o 55 muda: sem 55 envolvido, a crm__vendas devolve as MESMAS linhas do corpo anterior. ----
    // As linhas de quem nao tem numero com DDI misturado (sem numero, contas sem numero, numeros de 10/11/12 digitos que nao comecam por 55 e
    // o DDD 55 de 11 digitos) tem de sair identicas, linha a linha, nos dois corpos.
    const SEM_55 = [
      "Edu Balcao",
      "Gil Balcao",
      "Hugo Balcao",
      "Ivo Balcao",
      "Sem Zap Ausente",
      "Sem Zap Vazio",
      "Sem Zap Pontuacao",
      "Conta Dois",
      "Conta Quatro",
      "Conta Um",
    ];
    const foto = async () =>
      (
        await c.query(
          `SELECT order_id::text, total::text, canal, forma, pago_em::text, dia::text, chave, user_id::text, nome, whatsapp, email
             FROM public.crm__vendas(now()) WHERE nome = ANY($1) ORDER BY order_id`,
          [SEM_55],
        )
      ).rows;
    const novo = await foto();
    const antigo = await isolado(c, async () => {
      await c.query(rollback);
      return foto();
    });
    assert.ok(novo.length >= SEM_55.length, "a foto sem 55 veio vazia");
    assert.deepEqual(novo, antigo, "uma venda sem o 55 mudou de linha");
    console.log(
      `  PASSOU ${novo.length} vendas sem o 55 envolvido devolvem a MESMA linha do corpo anterior`,
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
        "o rollback nao devolveu o corpo da 20261178000000 byte a byte",
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
            CORPO_NOVO.replace("-- O MESMO WhatsApp", "-- o mesmo WhatsApp"),
          ),
      ],
      [
        "ACL aberta para anon",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO anon`),
      ],
      [
        "ACL aberta para authenticated",
        () =>
          c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated`),
      ],
      [
        "ACL aberta para PUBLIC",
        () => c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO PUBLIC`),
      ],
      [
        "atributo diferente (SECURITY DEFINER)",
        () => c.query(`ALTER FUNCTION ${ASSINATURA} SECURITY DEFINER`),
      ],
      [
        "sobrecarga",
        () =>
          c.query(
            "CREATE FUNCTION public.crm__vendas(p_x text) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
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
        // O rollback tem o mesmo pre-voo fechado: ele tambem recusa estado desconhecido, sem escrever.
        await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await funcao(c),
          antes,
          `o rollback (${nome}) escreveu antes de recusar`,
        );
      });
    }
    await isolado(c, async () => {
      await c.query(rollback);
      const conferenciaSabotada = migration.replace(
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN`,
        `IF v_hash IS DISTINCT FROM 'nao-e-este' THEN`,
      );
      assert.notEqual(conferenciaSabotada, migration);
      await recusa(c, conferenciaSabotada, /B1_BASELINE_DIVERGENT/);
      assert.equal(
        md5((await funcao(c)).prosrc),
        HASH_ANTES,
        "a migration que falhou na conferencia deixou o corpo novo gravado",
      );
    });
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens, migration e rollback) e a conferencia que falha nao deixa nada`,
    );

    // ---- 6. Consultas 142a/142b nos dois sentidos, com o rol fechado. ----
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
    assert.deepEqual(await consulta(C142A), []);
    assert.deepEqual(await consulta(C142B), ["crm__vendas: corpo exato (md5)"]);
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C142B), []);
      assert.deepEqual(await consulta(C142A), [
        "crm__vendas: corpo exato (md5)",
      ]);
    });
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated`);
      for (const n of [C142A, C142B])
        assert.ok(
          (await consulta(n)).some((i) => i.includes("EXECUTE")),
          `${n}: nao reprovou a ACL aberta`,
        );
    });
    console.log(
      "  PASSOU consultas 142a/142b nos dois sentidos, rol fechado, e reprovam a ACL aberta",
    );
    await c.query("ROLLBACK");

    // ---- 7. Atomicidade numa conexao SEM BEGIN (o arquivo e UM lote). Clone descartavel: o estado volta ao que estava. ----
    const sem = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await sem.connect();
    try {
      const hash = async () => md5((await funcao(sem)).prosrc);
      assert.equal(await hash(), HASH_NOVO);
      await sem.query(rollback); // autocommit: grava o corpo anterior de verdade
      assert.equal(await hash(), HASH_ANTES);
      const conferenciaSabotada = migration.replace(
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO}' THEN`,
        `IF v_hash IS DISTINCT FROM 'nao-e-este' THEN`,
      );
      await assert.rejects(
        () => sem.query(conferenciaSabotada),
        /B1_BASELINE_DIVERGENT/,
      );
      assert.equal(
        await hash(),
        HASH_ANTES,
        "sem BEGIN, a migration que falhou na conferencia gravou o corpo novo (meia mudanca)",
      );
      await sem.query(migration); // autocommit: aplica de verdade
      assert.equal(await hash(), HASH_NOVO);
      console.log(
        "  PASSOU sem BEGIN: a conferencia que falha nao grava meia mudanca; aplicar e desfazer de verdade funciona e o estado volta ao encontrado",
      );
    } finally {
      await sem.end().catch(() => {});
    }

    console.log(
      "\n[o-crm-nao-duplica-o-comprador-com-e-sem-55] todas as provas passaram.",
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
