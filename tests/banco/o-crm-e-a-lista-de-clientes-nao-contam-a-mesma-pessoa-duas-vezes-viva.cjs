"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices e os nomes de funcao vem de listas fechadas deste arquivo. */
/**
 * PROVA VIVA da migration 20261399993000_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes.sql (public.crm__nunca_comprou e
 * public.get_admin_customers_paged) contra o Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci, job do dinheiro). Nunca banco de
 * loja. A maior parte numa transacao desfeita; a prova de atomicidade usa uma segunda conexao SEM BEGIN no clone descartavel (rodar-isolado) e
 * deixa o estado como encontrou.
 *
 * O que prova:
 *  (1) D1: a pessoa com CONTA e nenhum pedido ligado a ela, cuja venda avulsa (anulada paga, devolvida, sem pagar; com o 55 de um lado, do outro
 *      ou de nenhum) tem o MESMO WhatsApp, aparece UMA vez (em "Pediu e nao pagou") no CRM > Clientes e sai de "nunca comprou"; crm_visao conta
 *      os dois segmentos como a lista. Quem realmente nunca comprou, quem nao tem WhatsApp, numero diferente, DDD 55 de 11 digitos e a outra CONTA
 *      com o mesmo numero de uma conta que ja pediu continuam em "nunca comprou"; a venda PAGA segue tirando o perfil de la.
 *  (2) D2: conta com dois enderecos principais (a corrida dos dois aparelhos) soma UM pedido e R$ 100 na lista e no ranking (nao 2 e R$ 200) e e
 *      UMA linha mesmo com cidades diferentes; sem endereco, com um endereco principal e so com enderecos nao principais ficam como antes;
 *      o mais novo vence, nulo perde e no empate de data vence o menor id; a lista em paginas de 2 nao repete cliente; a busca pela cidade do
 *      principal escolhido acha UMA vez; as chaves do JSON sao as de antes.
 *  (3) CONTROLE: os corpos anteriores (os das migrations 20261183000000 e 20261392000000, pelo rollback-manual) reprovam a bateria na MESMA
 *      fixture (o defeito); a linha de quem nao tem o problema e igual nos dois corpos; mutantes (sem a exclusao nova, sem o corte do 55 de cada lado,
 *      corta tambem 11 digitos, sem o filtro de conta, sem o limite de um, endereco mais antigo, sem o desempate pelo id, nulo primeiro, juncao
 *      interna, sem o filtro de principal) deixam a prova vermelha.
 *  (4) Reaplicar 2x deixa OID, dono, ACL, atributos e texto das duas funcoes iguais; o rollback devolve os dois corpos byte a byte; rodar o
 *      rollback de novo deixa o mesmo estado; reaplicar depois do rollback volta. Nenhuma linha de dado muda.
 *  (5) Pre-voo recusa sem escrever (corpo desconhecido em cada funcao, ACL aberta, atributo diferente, sobrecarga); o rollback recusa corpo
 *      desconhecido; a conferencia final sabotada derruba o arquivo inteiro numa conexao SEM BEGIN: as DUAS trocas caem juntas.
 *  (6) Consultas 145a/145b leem o estado certo nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261399993000_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const FN = {
  nunca: {
    nome: "crm__nunca_comprou",
    assinatura: "public.crm__nunca_comprou(timestamptz)",
  },
  clientes: {
    nome: "get_admin_customers_paged",
    assinatura:
      "public.get_admin_customers_paged(text,text,text,integer,integer)",
  },
};
const reCabecalho = (nome) =>
  new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${nome}\\([^\\n]*\\)[\\s\\S]*?\\nAS \\$\\$`,
  );
const reCorpo = (nome) =>
  new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${nome}\\([^\\n]*\\)[\\s\\S]*?\\nAS \\$\\$([\\s\\S]*?)\\$\\$;`,
  );
const corpoDe = (sql, chave) => sql.match(reCorpo(FN[chave].nome))[1];
const cabecalhoDe = (chave) => migration.match(reCabecalho(FN[chave].nome))[0];
const trocarCorpo = (c, chave, corpo) =>
  c.query(`${cabecalhoDe(chave)}${corpo}$$;`);

const CORPO_NOVO = {
  nunca: corpoDe(migration, "nunca"),
  clientes: corpoDe(migration, "clientes"),
};
const CORPO_ANTES = {
  nunca: corpoDe(rollback, "nunca"),
  clientes: corpoDe(rollback, "clientes"),
};
const HASH_NOVO = {
  nunca: "3aa94ac8dc4ce19db958e6d93cbea7a8",
  clientes: "35212d373895b2a9ede613198fc4c794",
};
const HASH_ANTES = {
  nunca: "9a83cf34789b8b67c245648c8d82fc42",
  clientes: "1c71829d75e3d8f17bf7fb01019c05ec",
};
const C145A =
  "145a-conferir-o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-aplicado";
const C145B =
  "145b-antes-o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-base-vigente";

const ADMIN = "e3993000-1399-4000-8000-000000000001";
let seq = 0;
const novoId = () =>
  `e3993000-1399-4000-8000-${String(++seq + 100).padStart(12, "0")}`;

async function funcao(c, chave) {
  const a = (
    await c.query(
      `SELECT to_jsonb(p) AS a FROM pg_proc p WHERE oid = '${FN[chave].assinatura}'::regprocedure`,
    )
  ).rows[0].a;
  return { ...a, prosrc: a.prosrc.replace(/\r/g, "") };
}
async function atributos(c) {
  const r = {};
  for (const k of Object.keys(FN)) {
    const { prosrc: _corpo, ...resto } = await funcao(c, k);
    r[k] = resto;
  }
  return r;
}
async function hashes(c) {
  const r = {};
  for (const k of Object.keys(FN)) r[k] = md5((await funcao(c, k)).prosrc);
  return r;
}
async function isolado(c, rotulo, acao) {
  await c.query(`SAVEPOINT ${rotulo}`);
  try {
    return await acao();
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${rotulo}`);
    await c.query(`RELEASE SAVEPOINT ${rotulo}`);
  }
}
/** A recusa tem de vir do pre-voo e nao deixar nada escrito: o corpo e o texto das duas funcoes sao os mesmos depois de desfeito o savepoint. */
async function recusa(c, rotulo, sql, padrao) {
  const antes = await hashes(c);
  await c.query("SAVEPOINT recusa3993");
  try {
    await assert.rejects(() => c.query(sql), padrao, rotulo);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa3993");
    await c.query("RELEASE SAVEPOINT recusa3993");
  }
  assert.deepEqual(
    await hashes(c),
    antes,
    `${rotulo}: a recusa nao pode ter escrito nada`,
  );
}

/** Insere perfil (e a conta em auth.users). Devolve o id. */
async function perfil(c, nome, zap) {
  const id = novoId();
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `${id.slice(-6)}@crm3993.teste`,
  ]);
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES ($1, $2, 'customer', $3)",
    [id, nome, zap],
  );
  return id;
}
async function pedido(c, o) {
  const {
    uid = null,
    nome,
    zap,
    status = "delivered",
    pagamento = "pago",
    horas = 5,
    total = 100,
    canal = "presencial",
  } = o;
  const pago = ["pago", "pago_apos_expirar", "recebido_na_entrega"].includes(
    pagamento,
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $4, $5, $6, 'online', $7,
             CASE WHEN $8::boolean THEN now() - ($9 || ' hours')::interval ELSE NULL END,
             now() - ($9 || ' hours')::interval)`,
    [
      uid,
      nome,
      JSON.stringify(zap === undefined ? {} : { whatsapp: zap }),
      total,
      status,
      canal,
      pagamento,
      pago,
      String(horas),
    ],
  );
}
async function endereco(c, uid, cidade, uf, principal, horas) {
  await c.query(
    `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default, created_at)
     VALUES ($1, 'Casa', 'Cliente', '38400000', 'Rua A', '1', 'Centro', $2, $3, $4,
             CASE WHEN $5::text IS NULL THEN NULL ELSE now() - ($5 || ' hours')::interval END)`,
    [uid, cidade, uf, principal, horas === null ? null : String(horas ?? 1)],
  );
}

async function fixture(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@crm3993.teste', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Crm', 'admin')",
    [ADMIN],
  );
  // ---- D1: pessoas COM conta e nenhum pedido ligado a ela ----
  await perfil(c, "Ana Conta", "(34) 99999-0001");
  await pedido(c, {
    nome: "Ana Avulsa",
    zap: "34999990001",
    status: "cancelled",
    pagamento: "pago",
  }); // paga e ANULADA
  await perfil(c, "Bia Conta", "(34) 99999-0002");
  await pedido(c, {
    nome: "Bia Avulsa",
    zap: "5534999990002",
    status: "cancelled",
    pagamento: "aguardando",
  }); // a venda com o 55
  await perfil(c, "Bela Conta", "+55 34 99999-0012");
  await pedido(c, {
    nome: "Bela Avulsa",
    zap: "34999990012",
    status: "cancelled",
    pagamento: "pago",
  }); // o perfil com o 55
  await perfil(c, "Carla Nunca", "(34) 99999-0003");
  await perfil(c, "Dani Compradora", "(34) 99999-0004");
  await pedido(c, { nome: "Dani Avulsa", zap: "34999990004" }); // venda PAGA
  await perfil(c, "Eva Outra", "(34) 99999-0005");
  await pedido(c, {
    nome: "Outro Cliente",
    zap: "34999990099",
    status: "cancelled",
    pagamento: "aguardando",
  }); // outro numero
  await perfil(c, "Fabi Sem Zap", null);
  await pedido(c, {
    nome: "Sem Numero",
    zap: undefined,
    status: "cancelled",
    pagamento: "aguardando",
  });
  await perfil(c, "Gil Ddd55", "(55) 99999-1234"); // 55999991234: DDD 55, o 55 NAO sai
  await pedido(c, {
    nome: "Gil Sem Ddd",
    zap: "999991234",
    status: "cancelled",
    pagamento: "aguardando",
  });
  await perfil(c, "Hugo Pais Ddd55", "(55) 99999-4321");
  await pedido(c, {
    nome: "Hugo Avulso",
    zap: "5555999994321",
    status: "cancelled",
    pagamento: "aguardando",
  }); // pais + DDD 55 = o mesmo
  // outra CONTA com o mesmo numero de uma conta que ja pediu: sao duas contas (segue em "nunca comprou", como antes)
  const iris = await perfil(c, "Iris Conta", null);
  await pedido(c, {
    uid: iris,
    nome: "Iris Conta",
    zap: "34999990077",
    status: "pending",
    pagamento: "aguardando",
    canal: "online",
  });
  await perfil(c, "Ivo Outra Conta", "(34) 99999-0077");

  // ---- D2: os dois "primeiros enderecos" salvos ao mesmo tempo (o gatilho handle_default_address so desmarca linhas que ja existem) ----
  await c.query("ALTER TABLE public.user_addresses DISABLE TRIGGER USER");
  const c1 = await perfil(c, "Cli Dois Principais Igual", "(34) 98000-0001");
  await endereco(c, c1, "Uberlandia", "MG", true, 5);
  await endereco(c, c1, "Uberlandia", "MG", true, 4);
  await pedido(c, {
    uid: c1,
    nome: "Cli Dois Principais Igual",
    total: 100,
    canal: "online",
  });
  const c2 = await perfil(c, "Cli Dois Principais Cidades", "(34) 98000-0002");
  await endereco(c, c2, "Araguari", "MG", true, 10);
  await endereco(c, c2, "Patos de Minas", "MG", true, 2); // o mais NOVO vence
  await pedido(c, {
    uid: c2,
    nome: "Cli Dois Principais Cidades",
    total: 80,
    canal: "online",
  });
  const c3 = await perfil(c, "Cli Sem Endereco", "(34) 98000-0003");
  await pedido(c, {
    uid: c3,
    nome: "Cli Sem Endereco",
    total: 50,
    canal: "online",
  });
  const c4 = await perfil(c, "Cli Um Principal", "(34) 98000-0004");
  await endereco(c, c4, "Uberaba", "MG", true, 3);
  await endereco(c, c4, "Franca", "SP", false, 1);
  await pedido(c, {
    uid: c4,
    nome: "Cli Um Principal",
    total: 30,
    canal: "online",
  });
  await pedido(c, {
    uid: c4,
    nome: "Cli Um Principal",
    total: 20,
    canal: "online",
  });
  const c5 = await perfil(
    c,
    "Cli Dois Principais Sem Pedido",
    "(34) 98000-0005",
  );
  await endereco(c, c5, "Ituiutaba", "MG", true, 3);
  await endereco(c, c5, "Ituiutaba", "MG", true, 3);
  const c6 = await perfil(c, "Cli Empate De Data", "(34) 98000-0006");
  await c.query(
    `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default, created_at)
     VALUES ('ffffffff-0000-4000-8000-000000000001', $1, 'Casa', 'Cliente', '38400000', 'Rua A', '1', 'Centro', 'Cidade Z', 'MG', true, '2026-01-01'),
            ('00000000-ffff-4000-8000-000000000001', $1, 'Casa', 'Cliente', '38400000', 'Rua A', '1', 'Centro', 'Cidade A', 'MG', true, '2026-01-01')`,
    [c6],
  );
  const c7 = await perfil(c, "Cli Data Nula", "(34) 98000-0007");
  await c.query(
    `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default, created_at)
     VALUES ($1, 'Casa', 'Cliente', '38400000', 'Rua A', '1', 'Centro', 'Sem Data', 'MG', true, NULL),
            ($1, 'Casa', 'Cliente', '38400000', 'Rua A', '1', 'Centro', 'Com Data', 'MG', true, '2026-02-02')`,
    [c7],
  );
  await c.query("ALTER TABLE public.user_addresses ENABLE TRIGGER USER");
  // o admin da prova (is_admin() le o usuario da sessao)
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
}

const quantas = (arr, nome) => arr.filter((x) => x === nome).length;
const norm = (w) => {
  const d = String(w ?? "").replace(/\D/g, "");
  return (d.length === 12 || d.length === 13) && d.startsWith("55")
    ? d.slice(2)
    : d;
};

/** A bateria: o que a lista, o CRM e a tela Clientes tem de dizer sobre a fixture. Devolve a lista de erros (vazia = verde). */
async function bateria(c) {
  const erros = [];
  const confere = (rotulo, vivo, esperado) => {
    if (JSON.stringify(vivo) !== JSON.stringify(esperado))
      erros.push(
        `${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(vivo)}`,
      );
  };
  // ---- D1 ----
  const lista = (
    await c.query("SELECT public.crm_clientes(NULL, NULL, 200, 0) AS r")
  ).rows[0].r;
  const nomes = lista.clientes.map((x) => x.nome);
  const nunca = (
    await c.query("SELECT nome FROM public.crm__nunca_comprou(now())")
  ).rows.map((r) => r.nome);
  const naoPagos = (
    await c.query("SELECT nome FROM public.crm__pedidos_nao_pagos(now())")
  ).rows.map((r) => r.nome);
  for (const [conta, avulsa] of [
    ["Ana Conta", "Ana Avulsa"],
    ["Bia Conta", "Bia Avulsa"],
    ["Bela Conta", "Bela Avulsa"],
    ["Hugo Pais Ddd55", "Hugo Avulso"],
  ]) {
    confere(
      `D1 ${conta}: aparece uma vez so (conta, avulsa)`,
      [quantas(nomes, conta), quantas(nomes, avulsa)],
      [0, 1],
    );
    confere(`D1 ${conta} fora de nunca_comprou`, nunca.includes(conta), false);
    confere(
      `D1 ${avulsa} segue em pediu_nao_pagou`,
      naoPagos.includes(avulsa),
      true,
    );
  }
  for (const nome of [
    "Carla Nunca",
    "Eva Outra",
    "Fabi Sem Zap",
    "Gil Ddd55",
    "Ivo Outra Conta",
  ])
    confere(`D1 ${nome} continua em nunca_comprou`, nunca.includes(nome), true);
  confere(
    "D1 Outro Cliente (numero diferente) uma vez",
    quantas(nomes, "Outro Cliente"),
    1,
  );
  confere("D1 Gil Sem Ddd uma vez", quantas(nomes, "Gil Sem Ddd"), 1);
  confere(
    "D1 Dani (venda paga) fora de nunca_comprou",
    nunca.includes("Dani Compradora"),
    false,
  );
  confere(
    "D1 Dani aparece como compradora",
    nomes.includes("Dani Avulsa"),
    true,
  );
  const visao = (
    await c.query(
      "SELECT public.crm_visao(public.fin__dia(now()) - 3, public.fin__dia(now()) + 1) AS r",
    )
  ).rows[0].r;
  const seg = Object.fromEntries(
    visao.segmentos.map((s) => [s.segmento, s.clientes]),
  );
  confere(
    "D1 crm_visao.nunca_comprou = lista",
    seg.nunca_comprou,
    lista.clientes.filter((x) => x.segmento === "nunca_comprou").length,
  );
  confere(
    "D1 crm_visao.pediu_nao_pagou = lista",
    seg.pediu_nao_pagou,
    lista.clientes.filter((x) => x.segmento === "pediu_nao_pagou").length,
  );
  const zaps = lista.clientes
    .filter((x) => x.nome !== "Ivo Outra Conta")
    .map((x) => norm(x.whatsapp))
    .filter(Boolean);
  confere(
    "D1 nenhum WhatsApp repete na lista",
    zaps.length,
    new Set(zaps).size,
  );

  // ---- D2 ----
  const pag = async (
    busca = "",
    campo = "total_spent",
    dir = "desc",
    p = 0,
    t = 50,
  ) =>
    (
      await c.query(
        "SELECT public.get_admin_customers_paged($1, $2, $3, $4, $5) AS r",
        [busca, campo, dir, p, t],
      )
    ).rows[0].r;
  const todos = await pag("", "full_name", "asc", 0, 200);
  const linhas = (nome) => todos.data.filter((d) => d.full_name === nome);
  const num = (v) => Number(v);
  confere(
    "D2 C1 pedidos e total",
    linhas("Cli Dois Principais Igual").map((l) => [
      num(l.orders_count),
      num(l.total_spent),
    ]),
    [[1, 100]],
  );
  confere(
    "D2 C2 uma linha, o endereco mais novo",
    linhas("Cli Dois Principais Cidades").map((l) => [
      l.city,
      num(l.orders_count),
      num(l.total_spent),
    ]),
    [["Patos de Minas", 1, 80]],
  );
  confere(
    "D2 C3 sem endereco",
    linhas("Cli Sem Endereco").map((l) => [
      l.city,
      l.state,
      num(l.orders_count),
      num(l.total_spent),
    ]),
    [[null, null, 1, 50]],
  );
  confere(
    "D2 C4 um principal (igual a antes)",
    linhas("Cli Um Principal").map((l) => [
      l.city,
      l.state,
      num(l.orders_count),
      num(l.total_spent),
    ]),
    [["Uberaba", "MG", 2, 50]],
  );
  confere(
    "D2 C5 sem pedido: 0 e 0",
    linhas("Cli Dois Principais Sem Pedido").map((l) => [
      l.city,
      num(l.orders_count),
      num(l.total_spent),
    ]),
    [["Ituiutaba", 0, 0]],
  );
  confere(
    "D2 C6 empate de data: menor id vence",
    linhas("Cli Empate De Data").map((l) => l.city),
    ["Cidade A"],
  );
  confere(
    "D2 C7 data nula perde",
    linhas("Cli Data Nula").map((l) => l.city),
    ["Com Data"],
  );
  const perfis = num(
    (await c.query("SELECT count(*) AS n FROM public.profiles")).rows[0].n,
  );
  confere("D2 total_count = clientes", todos.total_count, perfis);
  confere("D2 linhas = clientes", todos.data.length, perfis);
  const rank = await pag("", "total_spent", "desc", 0, 3);
  confere(
    "D2 ranking",
    rank.data.slice(0, 2).map((d) => [d.full_name, num(d.total_spent)]),
    [
      ["Cli Dois Principais Igual", 100],
      ["Cli Dois Principais Cidades", 80],
    ],
  );
  const vistos = [];
  for (let p = 0; p < 12; p++)
    for (const d of (await pag("", "full_name", "asc", p, 2)).data)
      vistos.push(d.id);
  confere(
    "D2 nenhum cliente repete entre as paginas",
    vistos.length,
    new Set(vistos).size,
  );
  const b = await pag("Uberlandia");
  confere(
    "D2 busca pela cidade: uma vez",
    [b.data.map((d) => d.full_name), b.total_count],
    [["Cli Dois Principais Igual"], 1],
  );
  confere(
    "D2 endereco nao principal nao entra na busca",
    (await pag("Franca")).data.length,
    0,
  );
  confere(
    "D2 chaves do JSON",
    Object.keys(linhas("Cli Um Principal")[0] ?? {}).sort(),
    [
      "avatar_url",
      "city",
      "created_at",
      "email",
      "full_count",
      "full_name",
      "id",
      "is_push_subscribed",
      "last_order_date",
      "orders_count",
      "phone",
      "role",
      "state",
      "total_spent",
    ],
  );
  return erros;
}

/** O que NAO tem o problema sai igual nos dois corpos: quem tem um endereco so e quem nunca pediu nada. */
async function linhasSemProblema(c) {
  const um = (
    await c.query(
      "SELECT public.get_admin_customers_paged('Cli Um Principal', 'full_name', 'asc', 0, 50) AS r",
    )
  ).rows[0].r;
  const semEnd = (
    await c.query(
      "SELECT public.get_admin_customers_paged('Cli Sem Endereco', 'full_name', 'asc', 0, 50) AS r",
    )
  ).rows[0].r;
  const nunca = (
    await c.query(
      "SELECT chave, nome, whatsapp, cadastrado_em FROM public.crm__nunca_comprou(now()) WHERE nome IN ('Carla Nunca', 'Eva Outra', 'Fabi Sem Zap', 'Gil Ddd55') ORDER BY nome",
    )
  ).rows;
  return JSON.stringify({ um, semEnd, nunca });
}

const MUTANTES = [
  [
    "sem a exclusao nova",
    "nunca",
    (s) =>
      s.replace(
        /\n {5}AND NOT EXISTS \(\n {7}SELECT 1 FROM wa_nao_pagos wn[\s\S]*?\n {5}\)\n$/,
        "\n",
      ),
  ],
  [
    "o perfil sem cortar o 55",
    "nunca",
    (s) => {
      const i = s.indexOf("FROM wa_nao_pagos wn");
      return (
        s.slice(0, i) +
        s
          .slice(i)
          .replace(
            "CASE WHEN length(pw.wa) IN (12, 13) AND left(pw.wa, 2) = '55'\n               THEN substring(pw.wa FROM 3) ELSE pw.wa END",
            "pw.wa",
          )
      );
    },
  ],
  [
    "o pedido sem cortar o 55",
    "nunca",
    (s) => {
      const i = s.indexOf("wa_nao_pagos AS (");
      const j = s.indexOf(")\n  SELECT p.id::text");
      return (
        s.slice(0, i) +
        s
          .slice(i, j)
          .replace(
            "CASE WHEN length(d) IN (12, 13) AND left(d, 2) = '55'\n                THEN substring(d FROM 3) ELSE d END",
            "d",
          ) +
        s.slice(j)
      );
    },
  ],
  [
    "corta tambem 11 digitos (o DDD 55)",
    "nunca",
    (s) => {
      const i = s.indexOf("FROM wa_nao_pagos wn");
      return (
        s.slice(0, i) +
        s
          .slice(i)
          .replace("length(pw.wa) IN (12, 13)", "length(pw.wa) IN (11, 12, 13)")
      );
    },
  ],
  [
    "sem o filtro de registro sem conta",
    "nunca",
    (s) =>
      s.replace(
        "WHERE np.user_id IS NULL AND np.whatsapp IS NOT NULL",
        "WHERE np.whatsapp IS NOT NULL",
      ),
  ],
  [
    "so o pedido ainda em aberto",
    "nunca",
    (s) =>
      s.replace(
        "WHERE np.user_id IS NULL AND np.whatsapp IS NOT NULL",
        "WHERE np.valor_em_aberto > 0 AND np.user_id IS NULL AND np.whatsapp IS NOT NULL",
      ),
  ],
  [
    "sem o limite de um endereco",
    "clientes",
    (s) =>
      s.replace(
        "            LIMIT 1\n        ) addr ON true",
        "        ) addr ON true",
      ),
  ],
  [
    "o endereco mais antigo",
    "clientes",
    (s) =>
      s.replace(
        "ORDER BY a.created_at DESC NULLS LAST, a.id",
        "ORDER BY a.created_at ASC NULLS LAST, a.id",
      ),
  ],
  [
    "sem o desempate pelo id",
    "clientes",
    (s) =>
      s.replace(
        "ORDER BY a.created_at DESC NULLS LAST, a.id",
        "ORDER BY a.created_at DESC NULLS LAST",
      ),
  ],
  [
    "data nula primeiro",
    "clientes",
    (s) =>
      s.replace(
        "ORDER BY a.created_at DESC NULLS LAST, a.id",
        "ORDER BY a.created_at DESC, a.id",
      ),
  ],
  [
    "juncao interna",
    "clientes",
    (s) => s.replace("LEFT JOIN LATERAL (", "JOIN LATERAL ("),
  ],
  [
    "sem o filtro de endereco principal",
    "clientes",
    (s) =>
      s.replace(
        "WHERE a.user_id = p.id AND a.is_default = true",
        "WHERE a.user_id = p.id",
      ),
  ],
];

async function consulta(c, nome) {
  const sql = ler(`scripts/publicacao/consultas/${nome}.sql`);
  const r = await c.query(sql);
  return r.rows;
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o das migrations 20261183000000 e 20261392000000. ----
    for (const k of Object.keys(FN)) {
      const topo = await funcao(c, k);
      assert.equal(
        topo.prosrc,
        CORPO_NOVO[k],
        `o topo de ${k} nao e o da 20261399993000`,
      );
      assert.equal(md5(topo.prosrc), HASH_NOVO[k]);
      assert.equal(
        md5(CORPO_ANTES[k]),
        HASH_ANTES[k],
        `o anterior de ${k} nao e o conhecido`,
      );
    }
    console.log(
      "  PASSOU o topo instalado e os dois corpos desta migration (md5 conhecido); os anteriores sao os da 183 e da 392",
    );

    await fixture(c);

    // ---- 1. A bateria inteira nos corpos novos. ----
    const errosNovo = await bateria(c);
    assert.deepEqual(
      errosNovo,
      [],
      `a bateria reprovou no corpo novo:\n${errosNovo.join("\n")}`,
    );
    console.log("  PASSOU a bateria (D1 e D2) nos corpos novos");
    const semProblemaNovo = await linhasSemProblema(c);

    // ---- 2. CONTROLE: os corpos anteriores reprovam a MESMA bateria (o defeito), e o que nao tem o problema sai igual. ----
    const semProblemaAntes = await isolado(c, "controle3993", async () => {
      for (const k of Object.keys(FN)) await trocarCorpo(c, k, CORPO_ANTES[k]);
      const erros = await bateria(c);
      assert.ok(
        erros.length >= 8,
        `os corpos anteriores teriam de reprovar a bateria (${erros.length}): ${erros.join(" | ")}`,
      );
      for (const trecho of [
        "D1 Ana Conta: aparece uma vez so",
        "D2 C1 pedidos e total",
        "D2 C2 uma linha, o endereco mais novo",
      ])
        assert.ok(
          erros.some((e) => e.startsWith(trecho)),
          `o defeito ${trecho} tem de aparecer no controle`,
        );
      return linhasSemProblema(c);
    });
    assert.equal(
      semProblemaNovo,
      semProblemaAntes,
      "quem nao tem o problema tem de sair IGUAL nos dois corpos",
    );
    console.log(
      "  PASSOU o controle: os corpos anteriores reprovam a mesma bateria; as linhas sem o problema sao iguais",
    );

    // ---- 3. Mutantes: cada regra nova, quebrada de proposito, deixa a bateria vermelha. ----
    for (const [rotulo, k, muta] of MUTANTES) {
      await isolado(c, "mutante3993", async () => {
        const corpo = muta(CORPO_NOVO[k]);
        assert.notEqual(
          corpo,
          CORPO_NOVO[k],
          `o mutante "${rotulo}" nao mudou o corpo`,
        );
        await trocarCorpo(c, k, corpo);
        const erros = await bateria(c);
        assert.ok(erros.length > 0, `o mutante "${rotulo}" sobreviveu`);
      });
    }
    console.log(
      `  PASSOU ${MUTANTES.length} mutantes, todos mortos pela bateria`,
    );

    await c.query("ROLLBACK");

    // ---- 4. Ciclo: reaplicar, rollback, rollback de novo, reaplicar; dados intactos; ACL e atributos iguais. ----
    await c.query("BEGIN");
    const a0 = await atributos(c);
    const contagens = async () =>
      JSON.stringify(
        (
          await c.query(
            `SELECT (SELECT count(*) FROM public.profiles) AS p, (SELECT count(*) FROM public.marketplace_orders) AS o,
                    (SELECT count(*) FROM public.user_addresses) AS e, (SELECT count(*) FROM public.user_addresses WHERE is_default) AS d`,
          )
        ).rows[0],
      );
    const dados0 = await contagens();
    await c.query(migration);
    await c.query(migration);
    assert.deepEqual(
      await hashes(c),
      HASH_NOVO,
      "reaplicar 2x deixa os corpos desta migration",
    );
    assert.deepEqual(
      await atributos(c),
      a0,
      "reaplicar 2x: OID, dono, ACL e atributos iguais",
    );
    await c.query(rollback);
    assert.deepEqual(
      await hashes(c),
      HASH_ANTES,
      "o rollback devolve os dois corpos byte a byte (md5)",
    );
    for (const k of Object.keys(FN))
      assert.equal(
        (await funcao(c, k)).prosrc,
        CORPO_ANTES[k],
        `${k}: o texto voltou ao anterior`,
      );
    assert.deepEqual(
      await atributos(c),
      a0,
      "o rollback preserva OID, dono, ACL e atributos",
    );
    await c.query(rollback);
    assert.deepEqual(
      await hashes(c),
      HASH_ANTES,
      "rodar o rollback de novo deixa o mesmo estado",
    );
    await c.query(migration);
    assert.deepEqual(
      await hashes(c),
      HASH_NOVO,
      "reaplicar depois do rollback volta",
    );
    assert.equal(
      await contagens(),
      dados0,
      "nenhuma linha de dado mudou (perfis, pedidos e enderecos, inclusive os principais em dobro)",
    );
    console.log(
      "  PASSOU o ciclo: reaplicar 2x, rollback byte a byte, rollback 2x, reaplicar; atributos, ACL e dados intactos",
    );

    // ---- 5. Pre-voo recusa sem escrever; o rollback recusa corpo desconhecido. ----
    const corpoEstranho = (k) =>
      CORPO_NOVO[k].replace(/SELECT|BEGIN/, (m) => `${m} /* corpo estranho */`);
    await c.query("SAVEPOINT desfeito3993");
    await c.query(rollback); // base vigente: a migration APLICA
    for (const k of Object.keys(FN))
      await recusa(
        c,
        `corpo desconhecido de ${k}`,
        `${cabecalhoDe(k)}${corpoEstranho(k)}$$;\n${migration}`,
        /B1_BASELINE_DIVERGENT/,
      );
    await c.query("ROLLBACK TO SAVEPOINT desfeito3993");
    await c.query("RELEASE SAVEPOINT desfeito3993");
    await recusa(
      c,
      "anon executa crm__nunca_comprou",
      `GRANT EXECUTE ON FUNCTION ${FN.nunca.assinatura} TO anon; ${migration}`,
      /ACL/,
    );
    await recusa(
      c,
      "anon executa get_admin_customers_paged",
      `GRANT EXECUTE ON FUNCTION ${FN.clientes.assinatura} TO anon; ${migration}`,
      /ACL/,
    );
    await recusa(
      c,
      "atributo diferente (VOLATILE) em crm__nunca_comprou",
      `ALTER FUNCTION ${FN.nunca.assinatura} VOLATILE; ${migration}`,
      /atributos/,
    );
    await recusa(
      c,
      "sobrecarga de crm__nunca_comprou",
      `CREATE FUNCTION public.crm__nunca_comprou(p_ate timestamptz, p_x int) RETURNS int LANGUAGE sql AS 'SELECT 1'; ${migration}`,
      /sobrecarga/,
    );
    await recusa(
      c,
      "sobrecarga de get_admin_customers_paged",
      `CREATE FUNCTION public.get_admin_customers_paged(p_x int) RETURNS int LANGUAGE sql AS 'SELECT 1'; ${migration}`,
      /sobrecarga/,
    );
    await isolado(c, "rb3993", async () => {
      await trocarCorpo(c, "nunca", corpoEstranho("nunca"));
      await recusa(
        c,
        "o rollback com corpo desconhecido",
        rollback,
        /B1_BASELINE_DIVERGENT/,
      );
    });
    console.log(
      "  PASSOU o pre-voo: corpo desconhecido, ACL, atributo e sobrecarga recusam sem escrever; o rollback recusa corpo desconhecido",
    );

    // ---- 6. Consultas 145a/145b nos dois sentidos, com o rol fechado. ----
    const rol = (nome, linhas) =>
      assert.deepEqual(
        linhas.map((l) => l.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol fechado do conferir-banco`,
      );
    const novoA = await consulta(c, C145A);
    const novoB = await consulta(c, C145B);
    rol(C145A, novoA);
    rol(C145B, novoB);
    assert.ok(
      novoA.every((l) => l.ok === true),
      "145a positiva com a migration aplicada",
    );
    assert.equal(
      novoB.filter((l) => l.ok === false).length,
      2,
      "145b reprova SO as duas linhas dos corpos com a migration aplicada",
    );
    await c.query(rollback);
    const velhoA = await consulta(c, C145A);
    const velhoB = await consulta(c, C145B);
    assert.equal(
      velhoA.filter((l) => l.ok === false).length,
      2,
      "145a reprova SO as duas linhas dos corpos na base vigente",
    );
    assert.ok(
      velhoB.every((l) => l.ok === true),
      "145b positiva na base vigente",
    );
    await c.query("ROLLBACK");
    console.log(
      "  PASSOU as consultas 145a/145b nos dois sentidos, com o rol fechado",
    );

    // ---- 7. Atomicidade SEM BEGIN: a conferencia final sabotada derruba o arquivo inteiro; as DUAS trocas caem juntas. ----
    const c2 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c2.connect();
    try {
      await c2.query(rollback); // base vigente, gravada (autocommit): o clone e' descartavel
      assert.deepEqual(await hashes(c2), HASH_ANTES);
      const sabotada = migration.replace(
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO.clientes}' THEN\n    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_customers_paged`,
        `IF v_hash IS DISTINCT FROM '00000000000000000000000000000000' THEN\n    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_customers_paged`,
      );
      assert.notEqual(sabotada, migration, "a sabotagem nao aplicou no texto");
      await assert.rejects(() => c2.query(sabotada), /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(
        await hashes(c2),
        HASH_ANTES,
        "a conferencia sabotada derrubou o arquivo inteiro: NENHUM dos dois corpos ficou trocado",
      );
      await c2.query(migration); // devolve o estado em que o CI deixou o clone
      assert.deepEqual(await hashes(c2), HASH_NOVO);
    } finally {
      await c2.end();
    }
    console.log(
      "  PASSOU a atomicidade sem BEGIN: a conferencia sabotada derruba as duas trocas juntas",
    );
  } finally {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* conexao ja sem transacao */
    }
    await c.end();
  }
}

main().then(
  () => {
    console.log("OK: prova viva da 20261399993000");
  },
  (e) => {
    console.error("FALHOU:", e?.stack ?? e);
    process.exit(1);
  },
);
