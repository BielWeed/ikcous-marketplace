"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados; os indices e os nomes de funcao vem de listas fechadas deste arquivo. */
/**
 * PROVA VIVA da migration 20261403000000_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha.sql
 * (public.get_admin_customers_paged e public.get_admin_user_detail) contra o Postgres EFEMERO com as migrations aplicadas
 * do zero (rpc-ci, job do dinheiro). Nunca banco de loja. A maior parte numa transacao desfeita; a prova de atomicidade usa
 * uma segunda conexao SEM BEGIN no clone descartavel (rodar-isolado) e deixa o estado como encontrou.
 *
 * O que prova:
 *  (1) A mesma pessoa tem o MESMO total no CRM (crm_clientes), na lista de Clientes e na ficha: a conta com 1 pedido pago
 *      (R$ 100) e 1 venda de balcao paga SEM conta com o mesmo WhatsApp (R$ 100) -- com o 55 de um lado, do outro, e com
 *      DDD 55 -- e 2 pedidos / R$ 200 nas tres; a ficha traz o campo novo balcao_mesmo_whatsapp = {1, 100} e a lista
 *      'orders' que ela ja devolvia NAO muda.
 *  (2) BORDAS: balcao cancelado e balcao sem pagar nao contam; varias vendas de balcao somam; pedido da propria conta sem pagar
 *      segue como era (a lista o conta em orders_count, nao o soma); WhatsApp em DUAS contas: o balcao vai para UMA so (a que
 *      comprou por ultimo, regra do CRM) e nunca soma nas duas; numero diferente, conta sem balcao e perfil so com WhatsApp
 *      (sem pedido pago) ficam como o CRM os trata.
 *  (3) ORDENACAO: a lista em paginas de 3 ordenada por total_spent nao repete nem esconde ninguem, e a mesma chamada duas vezes
 *      da a mesma ordem -- com o corpo novo E com o anterior.
 *  (4) PERMISSAO: sem ser admin atual as duas funcoes recusam; crm__vendas continua sem EXECUTE para anon e authenticated.
 *  (5) CONTROLE: os corpos anteriores (pelo rollback-manual) reprovam a MESMA bateria na MESMA fixture (o defeito); o que nao
 *      tem balcao sai IGUAL nos dois corpos; mutantes (sem a uniao com o balcao na lista, so a contagem, so a soma, sem a
 *      uniao na ficha, identidade por user_id puro, sem o filtro de pedido sem conta, chave ausente, CRM de outra data) deixam
 *      a prova vermelha.
 *  (6) DADO QUE JA EXISTIA: a fixture existe ANTES da migration; desfeita (corpos anteriores) mostra R$ 100, aplicada mostra
 *      R$ 200, e nenhuma linha de perfil, pedido ou endereco muda. Reaplicar 2x deixa OID, dono, ACL, atributos e texto iguais;
 *      o rollback devolve os dois corpos byte a byte; rodar o rollback de novo deixa o mesmo estado; reaplicar volta.
 *  (7) Pre-voo recusa sem escrever (corpo desconhecido em cada funcao, ACL aberta, atributo diferente, sobrecarga, crm__vendas
 *      com outro retorno); o rollback recusa corpo desconhecido; a conferencia final sabotada derruba o arquivo inteiro numa
 *      conexao SEM BEGIN: as DUAS trocas caem juntas.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-total-do-cliente-e-o-mesmo-nas-tres-telas-viva.cjs
 * O servidor precisa estar em UTC (como o container do CI): em outro fuso, colunas timestamp sem fuso saem do futuro e a prova da vizinha tambem fica vermelha.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME =
  "20261403000000_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const FN = {
  lista: {
    nome: "get_admin_customers_paged",
    assinatura:
      "public.get_admin_customers_paged(text,text,text,integer,integer)",
  },
  ficha: {
    nome: "get_admin_user_detail",
    assinatura: "public.get_admin_user_detail(uuid)",
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
  lista: corpoDe(migration, "lista"),
  ficha: corpoDe(migration, "ficha"),
};
const CORPO_ANTES = {
  lista: corpoDe(rollback, "lista"),
  ficha: corpoDe(rollback, "ficha"),
};
const HASH_NOVO = {
  lista: "309bbd903420f146423c7cf0512b91b3",
  ficha: "e7977d4d60b6114bb8247097b8ae3d4b",
};
const HASH_ANTES = {
  lista: "35212d373895b2a9ede613198fc4c794",
  ficha: "4dec3f232e1905ad62688b8bcd098b2a",
};

const ADMIN = "e3003000-1403-4000-8000-000000000001";
const CLIENTE_COMUM = "e3003000-1403-4000-8000-000000000002";
let seq = 0;
const novoId = () =>
  `e3003000-1403-4000-8000-${String(++seq + 100).padStart(12, "0")}`;

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
/** A recusa tem de vir do pre-voo e nao deixar nada escrito: o texto das duas funcoes e o mesmo depois de desfeito o savepoint. */
async function recusa(c, rotulo, sql, padrao) {
  const antes = await hashes(c);
  await c.query("SAVEPOINT recusa3000");
  try {
    await assert.rejects(() => c.query(sql), padrao, rotulo);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa3000");
    await c.query("RELEASE SAVEPOINT recusa3000");
  }
  assert.deepEqual(
    await hashes(c),
    antes,
    `${rotulo}: a recusa nao pode ter escrito nada`,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------------------------------
async function perfil(c, nome, zapDoPerfil) {
  const id = novoId();
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `${id.slice(-6)}@total3000.teste`,
  ]);
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES ($1, $2, 'customer', $3)",
    [id, nome, zapDoPerfil ?? null],
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

/** Cada pessoa: o que as TRES telas tem de dizer. `crm` nulo = a conta nao tem linha propria de comprador no CRM. */
const PESSOAS = {};
async function fixture(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin@total3000.teste', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Total', 'admin')",
    [ADMIN],
  );
  await c.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'comum@total3000.teste')",
    [CLIENTE_COMUM],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Comum', 'customer')",
    [CLIENTE_COMUM],
  );

  const pessoa = async (chave, nome, zapPerfil, esperado) => {
    const uid = await perfil(c, nome, zapPerfil);
    PESSOAS[chave] = { uid, nome, ...esperado };
    return uid;
  };

  // P1: o caso do dono. Conta com 1 pedido pago (R$ 100, WhatsApp SEM o 55) + 1 venda de balcao paga sem conta (R$ 100, COM o 55).
  let u = await pessoa("p1", "Pessoa Um Balcao Com 55", "(34) 98111-0001", {
    lista: [2, 200],
    crm: [2, 200],
    balcao: [1, 100],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Um Balcao Com 55",
    zap: "(34) 98111-0001",
    horas: 20,
    canal: "online",
  });
  await pedido(c, { nome: "Balcao Um", zap: "+55 34 98111-0001", horas: 8 });

  // P1b: varias vendas de balcao somam (60 + 40), uma delas com o numero colado.
  u = await pessoa("p1b", "Pessoa Um B Varios Balcoes", null, {
    lista: [3, 200],
    crm: [3, 200],
    balcao: [2, 100],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Um B",
    zap: "34981110011",
    horas: 21,
    canal: "online",
  });
  await pedido(c, {
    nome: "Balcao Um B 1",
    zap: "(34) 98111-0011",
    total: 60,
    horas: 9,
  });
  await pedido(c, {
    nome: "Balcao Um B 2",
    zap: "5534981110011",
    total: 40,
    horas: 7,
  });

  // P2: o contrario: a conta grava o numero COM o 55 e o balcao SEM.
  u = await pessoa("p2", "Pessoa Dois Conta Com 55", null, {
    lista: [2, 200],
    crm: [2, 200],
    balcao: [1, 100],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Dois",
    zap: "5534982220002",
    horas: 22,
    canal: "online",
  });
  await pedido(c, { nome: "Balcao Dois", zap: "(34) 98222-0002", horas: 8 });

  // P3: balcao CANCELADO (paga e anulada) nao conta.
  u = await pessoa("p3", "Pessoa Tres Balcao Cancelado", null, {
    lista: [1, 100],
    crm: [1, 100],
    balcao: [0, 0],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Tres",
    zap: "34983330003",
    horas: 23,
    canal: "online",
  });
  await pedido(c, {
    nome: "Balcao Tres Anulado",
    zap: "34983330003",
    status: "cancelled",
    horas: 8,
  });

  // P4: balcao SEM PAGAR nao conta.
  u = await pessoa("p4", "Pessoa Quatro Balcao Nao Pago", null, {
    lista: [1, 100],
    crm: [1, 100],
    balcao: [0, 0],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Quatro",
    zap: "34984440004",
    horas: 24,
    canal: "online",
  });
  await pedido(c, {
    nome: "Balcao Quatro Aberto",
    zap: "34984440004",
    status: "pending",
    pagamento: "aguardando",
    horas: 8,
  });

  // P5: pedido da PROPRIA conta sem pagar (a lista o conta, nao o soma) + balcao pago de R$ 50.
  u = await pessoa("p5", "Pessoa Cinco Pedido Proprio Aberto", null, {
    lista: [3, 150],
    crm: [2, 150],
    balcao: [1, 50],
    pedidosNaFicha: 2,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Cinco",
    zap: "34985550005",
    horas: 25,
    canal: "online",
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Cinco Aberto",
    zap: "34985550005",
    status: "pending",
    pagamento: "aguardando",
    total: 40,
    horas: 3,
    canal: "online",
  });
  await pedido(c, {
    nome: "Balcao Cinco",
    zap: "(34) 98555-0005",
    total: 50,
    horas: 6,
  });

  // P6: o MESMO WhatsApp em DUAS contas; o balcao vai para a que comprou por ULTIMO (B) e nunca para as duas.
  u = await pessoa("p6a", "Pessoa Seis A Mais Antiga", null, {
    lista: [1, 100],
    crm: [1, 100],
    balcao: [0, 0],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Seis A",
    zap: "(34) 98666-0006",
    horas: 40,
    canal: "online",
  });
  u = await pessoa("p6b", "Pessoa Seis B Mais Nova", null, {
    lista: [2, 200],
    crm: [2, 200],
    balcao: [1, 100],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Seis B",
    zap: "5534986660006",
    horas: 30,
    canal: "online",
  });
  await pedido(c, { nome: "Balcao Seis", zap: "34986660006", horas: 2 });

  // P7: numero DIFERENTE: o balcao e outra pessoa (continua com a chave wa: no CRM).
  u = await pessoa("p7", "Pessoa Sete Numero Diferente", null, {
    lista: [1, 100],
    crm: [1, 100],
    balcao: [0, 0],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Sete",
    zap: "34987770007",
    horas: 26,
    canal: "online",
  });
  await pedido(c, { nome: "Balcao Sete", zap: "34987770008", horas: 4 });

  // P8: conta sem balcao nenhum: igual a antes.
  u = await pessoa("p8", "Pessoa Oito Sem Balcao", null, {
    lista: [1, 100],
    crm: [1, 100],
    balcao: [0, 0],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Oito",
    zap: "34988880009",
    horas: 27,
    canal: "online",
  });

  // P9: perfil SO com o WhatsApp (nenhum pedido pago da conta): o CRM nao funde (a identidade nasce do pedido pago da conta); a lista e a ficha tambem nao.
  u = await pessoa("p9", "Pessoa Nove So Perfil", "(34) 98999-0010", {
    lista: [0, 0],
    crm: null,
    balcao: [0, 0],
    pedidosNaFicha: 0,
  });
  await pedido(c, { nome: "Balcao Nove", zap: "34989990010", horas: 4 });

  // P10: DDD 55 (Santa Maria) com 11 digitos: pais + DDD 55 e a mesma pessoa; sem o DDD ("999991234") e outra.
  u = await pessoa("p10", "Pessoa Dez Ddd 55", null, {
    lista: [2, 200],
    crm: [2, 200],
    balcao: [1, 100],
    pedidosNaFicha: 1,
  });
  await pedido(c, {
    uid: u,
    nome: "Pessoa Dez",
    zap: "(55) 99999-1234",
    horas: 28,
    canal: "online",
  });
  await pedido(c, { nome: "Balcao Dez", zap: "+55 55 99999-1234", horas: 4 });
  await pedido(c, { nome: "Balcao Dez Sem Ddd", zap: "999991234", horas: 4 });

  // Perfis de enchimento (total 0, empatados): a paginacao por OFFSET tem de seguir estavel com eles.
  for (let i = 0; i < 7; i++) await perfil(c, `Enchimento ${i}`, null);

  // o admin da prova (is_admin() le o usuario da sessao)
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Leituras: as tres telas
// ---------------------------------------------------------------------------------------------------------------------
const num = (x) => Number(x);
async function lista(
  c,
  busca = "",
  campo = "created_at",
  dir = "desc",
  p = 0,
  t = 500,
) {
  return (
    await c.query(
      "SELECT public.get_admin_customers_paged($1, $2, $3, $4, $5) AS r",
      [busca, campo, dir, p, t],
    )
  ).rows[0].r;
}
async function ficha(c, uid) {
  return (await c.query("SELECT public.get_admin_user_detail($1) AS r", [uid]))
    .rows[0].r;
}
async function crm(c) {
  const r = (
    await c.query("SELECT public.crm_clientes(NULL, NULL, 200, 0) AS r")
  ).rows[0].r;
  const porUsuario = new Map();
  for (const x of r.clientes)
    if (
      x.user_id &&
      x.segmento !== "nunca_comprou" &&
      x.segmento !== "pediu_nao_pagou"
    )
      porUsuario.set(x.user_id, x);
  return porUsuario;
}

/** A bateria: o que a lista, a ficha e o CRM tem de dizer sobre a fixture. Devolve a lista de erros (vazia = verde). */
async function bateria(c) {
  const erros = [];
  const confere = (rotulo, vivo, esperado) => {
    if (JSON.stringify(vivo) !== JSON.stringify(esperado))
      erros.push(
        `${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(vivo)}`,
      );
  };
  const todos = await lista(c);
  const porId = new Map(todos.data.map((d) => [d.id, d]));
  const clientesCrm = await crm(c);

  const somaBalcaoEntreContas = [];
  for (const [chave, p] of Object.entries(PESSOAS)) {
    const l = porId.get(p.uid);
    confere(
      `${chave} lista (pedidos, total)`,
      l ? [num(l.orders_count), num(l.total_spent)] : null,
      p.lista,
    );
    const x = clientesCrm.get(p.uid);
    confere(
      `${chave} CRM (pedidos, receita)`,
      x ? [num(x.pedidos), num(x.receita)] : null,
      p.crm,
    );
    const f = await ficha(c, p.uid);
    const b = f.balcao_mesmo_whatsapp;
    confere(
      `${chave} ficha (balcao pedidos, total)`,
      b ? [num(b.pedidos), num(b.total)] : null,
      p.balcao,
    );
    confere(
      `${chave} ficha: a lista de pedidos continua so a da conta`,
      f.orders.length,
      p.pedidosNaFicha,
    );
    confere(
      `${chave} ficha: so pedidos DA conta`,
      f.orders.every((o) => o.user_id === p.uid),
      true,
    );
    confere(
      `${chave} ficha: as chaves de antes + a nova`,
      Object.keys(f).sort(),
      ["addresses", "balcao_mesmo_whatsapp", "cart_items", "orders", "profile"],
    );
    if (b) somaBalcaoEntreContas.push(num(b.pedidos));
  }
  // Os dois WhatsApp iguais: o balcao entra em UMA conta so (a conta A nao o soma).
  confere(
    "WhatsApp em duas contas: o balcao nao soma nas duas",
    [PESSOAS.p6a, PESSOAS.p6b].map((p) => num(porId.get(p.uid).total_spent)),
    [100, 200],
  );
  // CRM = lista = ficha (R$ 200 / 2 pedidos) para o caso do dono, com e sem o 55, e o campo novo com R$ 100 de balcao.
  for (const k of ["p1", "p2", "p10"]) {
    const p = PESSOAS[k];
    const l = porId.get(p.uid);
    const x = clientesCrm.get(p.uid);
    const f = await ficha(c, p.uid);
    confere(
      `${k}: CRM = lista`,
      [num(x?.receita), num(x?.pedidos)],
      [num(l.total_spent), num(l.orders_count)],
    );
    confere(
      `${k}: ficha = conta + balcao = lista`,
      f.orders
        .filter((o) => o.payment_status === "pago")
        .reduce((s, o) => s + num(o.total), 0) +
        num(f.balcao_mesmo_whatsapp?.total),
      num(l.total_spent),
    );
  }
  // Pessoas e enchimento: ninguem some nem repete (a lista inteira, uma linha por perfil).
  const perfis = num(
    (await c.query("SELECT count(*) AS n FROM public.profiles")).rows[0].n,
  );
  confere("total_count = perfis", todos.total_count, perfis);
  confere("linhas = perfis", todos.data.length, perfis);
  confere(
    "chaves do JSON da lista (as de antes)",
    Object.keys(todos.data[0] ?? {}).sort(),
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
  // A busca continua juntando o balcao (a juncao nova nao pode ser perdida por causa do filtro).
  const achado = await lista(c, "Pessoa Um Balcao Com 55");
  confere(
    "busca por nome acha a pessoa com o total do CRM",
    [
      achado.data.length,
      num(achado.data[0]?.orders_count),
      num(achado.data[0]?.total_spent),
    ],
    [1, 2, 200],
  );
  // Ranking por "quem mais comprou": o topo e quem tem R$ 200 (o CRM), nao quem tem so 1 pedido na conta.
  const rank = await lista(c, "", "total_spent", "desc", 0, 3);
  confere(
    "ranking: o topo tem R$ 200",
    rank.data.map((d) => num(d.total_spent)),
    [200, 200, 200],
  );
  // O resto da ordenacao: ver bateriaOrdenacao.
  return erros;
}

/** A ordenacao fica deterministica e a paginacao por OFFSET nao repete nem esconde ninguem (vale para o corpo novo E o anterior). */
async function bateriaOrdenacao(c) {
  const erros = [];
  const perfis = num(
    (await c.query("SELECT count(*) AS n FROM public.profiles")).rows[0].n,
  );
  for (const [campo, dir] of [
    ["total_spent", "desc"],
    ["total_spent", "asc"],
    ["orders_count", "desc"],
    ["created_at", "desc"],
    ["full_name", "asc"],
  ]) {
    const inteira = (await lista(c, "", campo, dir, 0, 500)).data.map(
      (d) => d.id,
    );
    const outraVez = (await lista(c, "", campo, dir, 0, 500)).data.map(
      (d) => d.id,
    );
    if (JSON.stringify(inteira) !== JSON.stringify(outraVez))
      erros.push(`${campo} ${dir}: a mesma chamada deu duas ordens`);
    const paginas = [];
    for (let p = 0; p < Math.ceil(perfis / 3) + 1; p++)
      for (const d of (await lista(c, "", campo, dir, p, 3)).data)
        paginas.push(d.id);
    if (paginas.length !== new Set(paginas).size)
      erros.push(`${campo} ${dir}: cliente repetido entre as paginas`);
    if (paginas.length !== perfis)
      erros.push(
        `${campo} ${dir}: pagina escondeu cliente (${paginas.length} de ${perfis})`,
      );
    if (JSON.stringify(paginas) !== JSON.stringify(inteira))
      erros.push(
        `${campo} ${dir}: as paginas de 3 nao seguem a ordem da lista inteira`,
      );
  }
  // por total_spent: nao crescente (desc) e, no empate, id crescente.
  const t = (await lista(c, "", "total_spent", "desc", 0, 500)).data;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1];
    const b = t[i];
    if (num(a.total_spent) < num(b.total_spent))
      erros.push(`total_spent desc fora de ordem em ${i}`);
    if (num(a.total_spent) === num(b.total_spent) && a.id > b.id)
      erros.push(`desempate por id fora de ordem em ${i}`);
  }
  return erros;
}

/** O que NAO tem balcao sai igual nos dois corpos: a lista e a ficha de quem so tem pedido da propria conta. */
async function linhasSemBalcao(c) {
  const saida = {};
  for (const k of ["p3", "p4", "p6a", "p7", "p8", "p9"]) {
    const uid = PESSOAS[k].uid;
    const l = (await lista(c, PESSOAS[k].nome)).data.find((d) => d.id === uid);
    const { balcao_mesmo_whatsapp: _novo, ...f } = await ficha(c, uid);
    saida[k] = { l, f };
  }
  return JSON.stringify(saida);
}

const MUTANTES = [
  [
    "lista sem a uniao com o balcao (a juncao nunca casa)",
    "lista",
    (s) => s.replace("ON bal.user_id = p.id", "ON false"),
  ],
  [
    "lista soma o balcao so na contagem",
    "lista",
    (s) =>
      s.replace(" + COALESCE(bal.total, 0) as total_spent", " as total_spent"),
  ],
  [
    "lista soma o balcao so no total",
    "lista",
    (s) =>
      s.replace(
        "COUNT(o.id) + COALESCE(bal.pedidos, 0) as orders_count",
        "COUNT(o.id) as orders_count",
      ),
  ],
  [
    "lista: identidade por user_id puro (so o pedido ligado a conta)",
    "lista",
    (s) => s.replace("AND bo.user_id IS NULL", "AND bo.user_id = v.user_id"),
  ],
  [
    "lista: sem o filtro de pedido sem conta (conta o da propria conta em dobro)",
    "lista",
    (s) => s.replace(" AND bo.user_id IS NULL", ""),
  ],
  [
    "lista: o CRM de outra data (sem nenhuma venda)",
    "lista",
    (s) =>
      s.replace(
        "public.crm__vendas(now())",
        "public.crm__vendas('1970-01-01'::timestamptz)",
      ),
  ],
  [
    "ficha: soma o balcao de TODAS as contas (sem o filtro da pessoa)",
    "ficha",
    (s) =>
      s.replace("WHERE v.user_id = p_user_id;", "WHERE v.user_id IS NOT NULL;"),
  ],
  [
    "ficha sem a uniao com o balcao",
    "ficha",
    (s) => s.replace("WHERE v.user_id = p_user_id;", "WHERE false;"),
  ],
  [
    "ficha: identidade por user_id puro",
    "ficha",
    (s) => s.replace("AND bo.user_id IS NULL", "AND bo.user_id = v.user_id"),
  ],
  [
    "ficha: sem o filtro de pedido sem conta (conta o da propria conta em dobro)",
    "ficha",
    (s) => s.replace(" AND bo.user_id IS NULL", ""),
  ],
  [
    "ficha: o campo novo nao sai no retorno",
    "ficha",
    (s) =>
      s.replace(
        "'balcao_mesmo_whatsapp', v_balcao",
        "'balcao_mesmo_whatsapp', NULL::jsonb",
      ),
  ],
  [
    "ficha: o CRM de outra data (sem nenhuma venda)",
    "ficha",
    (s) =>
      s.replace(
        "public.crm__vendas(now())",
        "public.crm__vendas('1970-01-01'::timestamptz)",
      ),
  ],
  [
    "ficha: some a lista de pedidos da conta junto com o balcao",
    "ficha",
    (s) => s.replace("WHERE mo.user_id = p_user_id", "WHERE false"),
  ],
];

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ---- 0. O topo instalado pelo CI e' o desta migration; o anterior e' o das migrations 20261399993000 e 20261199000000. ----
    for (const k of Object.keys(FN)) {
      const topo = await funcao(c, k);
      assert.equal(
        topo.prosrc,
        CORPO_NOVO[k],
        `o topo de ${k} nao e o da 20261403000000`,
      );
      assert.equal(md5(topo.prosrc), HASH_NOVO[k]);
      assert.equal(
        md5(CORPO_ANTES[k]),
        HASH_ANTES[k],
        `o anterior de ${k} nao e o conhecido`,
      );
    }
    console.log(
      "  PASSOU o topo instalado e os dois corpos desta migration (md5 conhecido); os anteriores sao os da 20261399993000 e da 20261199000000",
    );

    await fixture(c);

    // ---- 1. A bateria inteira nos corpos novos. ----
    const errosNovo = await bateria(c);
    assert.deepEqual(
      errosNovo,
      [],
      `a bateria reprovou no corpo novo:\n${errosNovo.join("\n")}`,
    );
    assert.deepEqual(await bateriaOrdenacao(c), [], "ordenacao do corpo novo");
    console.log(
      "  PASSOU a bateria: CRM = lista = ficha (R$ 200 / 2 pedidos) com e sem o 55; balcao cancelado e sem pagar fora; WhatsApp em duas contas conta UMA vez; ordenacao estavel",
    );
    const semBalcaoNovo = await linhasSemBalcao(c);

    // ---- 2. PERMISSAO: sem ser admin atual as duas funcoes recusam; a funcao interna do CRM continua fechada. ----
    await isolado(c, "perm3000", async () => {
      const recusaAdmin = async (rotulo, chamada) => {
        await c.query(`SAVEPOINT ${rotulo}`);
        try {
          await assert.rejects(chamada, /Acesso negado/, rotulo);
        } finally {
          await c.query(`ROLLBACK TO SAVEPOINT ${rotulo}`);
          await c.query(`RELEASE SAVEPOINT ${rotulo}`);
        }
      };
      await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [
        CLIENTE_COMUM,
      ]);
      await recusaAdmin("p_lista_comum", () => lista(c));
      await recusaAdmin("p_ficha_comum", () => ficha(c, PESSOAS.p1.uid));
      await c.query("SELECT set_config('app.rpc.user_id', '', true)");
      await recusaAdmin("p_lista_vazia", () => lista(c));
      await recusaAdmin("p_ficha_vazia", () => ficha(c, PESSOAS.p1.uid));
    });
    for (const papel of ["anon", "authenticated"]) {
      assert.equal(
        (
          await c.query(
            "SELECT has_function_privilege($1, 'public.crm__vendas(timestamptz)', 'EXECUTE') AS ok",
            [papel],
          )
        ).rows[0].ok,
        false,
        `${papel} nao executa crm__vendas`,
      );
    }
    assert.equal(
      (
        await c.query(
          "SELECT has_function_privilege('anon', 'public.get_admin_user_detail(uuid)', 'EXECUTE') AS ok",
        )
      ).rows[0].ok,
      false,
      "anon nao executa a ficha",
    );
    console.log(
      "  PASSOU a permissao: cliente comum e sessao vazia recusam nas duas funcoes; crm__vendas segue sem EXECUTE para anon e authenticated",
    );

    // ---- 3. CONTROLE + DADO QUE JA EXISTIA: os corpos anteriores reprovam a MESMA bateria (o defeito); o que nao tem balcao sai igual. ----
    const contagens = async () =>
      JSON.stringify(
        (
          await c.query(
            `SELECT (SELECT count(*) FROM public.profiles) AS p, (SELECT count(*) FROM public.marketplace_orders) AS o,
                    (SELECT count(*) FROM public.user_addresses) AS e,
                    (SELECT coalesce(sum(total), 0) FROM public.marketplace_orders) AS t`,
          )
        ).rows[0],
      );
    const dados0 = await contagens();
    const semBalcaoAntes = await isolado(c, "controle3000", async () => {
      for (const k of Object.keys(FN)) await trocarCorpo(c, k, CORPO_ANTES[k]);
      const erros = await bateria(c);
      assert.ok(
        erros.length >= 8,
        `os corpos anteriores teriam de reprovar a bateria (${erros.length}): ${erros.join(" | ")}`,
      );
      for (const trecho of [
        "p1 lista (pedidos, total)",
        "p2 lista (pedidos, total)",
        "p1 ficha (balcao pedidos, total)",
      ])
        assert.ok(
          erros.some((e) => e.startsWith(trecho)),
          `o defeito ${trecho} tem de aparecer no controle`,
        );
      // O dono: com o corpo anterior a lista mostra R$ 100 / 1 pedido e a ficha nem tem o campo; o CRM ja mostrava R$ 200.
      const l = (await lista(c, "Pessoa Um Balcao Com 55")).data[0];
      assert.deepEqual([num(l.orders_count), num(l.total_spent)], [1, 100]);
      assert.equal(
        (await ficha(c, PESSOAS.p1.uid)).balcao_mesmo_whatsapp,
        undefined,
      );
      assert.deepEqual(
        await bateriaOrdenacao(c),
        [],
        "a ordenacao SEM a mudanca tambem e estavel",
      );
      return linhasSemBalcao(c);
    });
    assert.equal(
      semBalcaoNovo,
      semBalcaoAntes,
      "quem nao tem balcao (lista e ficha, fora o campo novo) tem de sair IGUAL nos dois corpos",
    );
    // ... e aplicar a migration depois, SOBRE a mesma fixture que ja estava la, muda so o total (e a fixture nao se mexe).
    await c.query("SAVEPOINT existente3000");
    await c.query(rollback);
    assert.deepEqual(await hashes(c), HASH_ANTES);
    assert.deepEqual(
      (await lista(c, "Pessoa Um Balcao Com 55")).data.map((d) => [
        num(d.orders_count),
        num(d.total_spent),
      ]),
      [[1, 100]],
      "antes da migration a pessoa que ja existia mostra R$ 100",
    );
    await c.query(migration);
    assert.deepEqual(
      (await lista(c, "Pessoa Um Balcao Com 55")).data.map((d) => [
        num(d.orders_count),
        num(d.total_spent),
      ]),
      [[2, 200]],
      "depois da migration a MESMA pessoa mostra R$ 200",
    );
    assert.equal(
      await contagens(),
      dados0,
      "aplicar nao mexeu em nenhuma linha de dado",
    );
    await c.query("ROLLBACK TO SAVEPOINT existente3000");
    await c.query("RELEASE SAVEPOINT existente3000");
    console.log(
      "  PASSOU o controle: os corpos anteriores reprovam a mesma bateria; a pessoa que ja existia passa de R$ 100 para R$ 200 sem mexer em dado; quem nao tem balcao sai igual",
    );

    // ---- 4. Mutantes: cada regra nova, quebrada de proposito, deixa a bateria vermelha. ----
    for (const [rotulo, k, muta] of MUTANTES) {
      await isolado(c, "mutante3000", async () => {
        const corpo = muta(CORPO_NOVO[k]);
        assert.notEqual(
          corpo,
          CORPO_NOVO[k],
          `o mutante "${rotulo}" nao mudou o corpo`,
        );
        await trocarCorpo(c, k, corpo);
        let erros;
        try {
          erros = await bateria(c);
        } catch (e) {
          erros = [`erro de execucao: ${e.message}`];
        }
        assert.ok(erros.length > 0, `o mutante "${rotulo}" sobreviveu`);
        assert.ok(
          !erros[0].startsWith("erro de execucao"),
          `o mutante "${rotulo}" so morreu por erro de execucao (a guarda certa e o valor): ${erros[0]}`,
        );
        console.log(`    mutante morto: ${rotulo} -> ${erros[0].slice(0, 95)}`);
      });
    }
    console.log(
      `  PASSOU ${MUTANTES.length} mutantes, todos mortos pela bateria`,
    );

    await c.query("ROLLBACK");

    // ---- 5. Ciclo: reaplicar, rollback, rollback de novo, reaplicar; dados intactos; ACL e atributos iguais. ----
    await c.query("BEGIN");
    const a0 = await atributos(c);
    await fixture(c); // dados que ja existem ANTES de qualquer troca do ciclo
    const dados1 = await contagens();
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
      dados1,
      "nenhuma linha de dado mudou (perfis, pedidos, enderecos e valores)",
    );
    console.log(
      "  PASSOU o ciclo: reaplicar 2x, rollback byte a byte, rollback 2x, reaplicar; atributos, ACL e dados intactos",
    );

    // ---- 6. Pre-voo recusa sem escrever; o rollback recusa corpo desconhecido. ----
    const corpoEstranho = (k) =>
      CORPO_NOVO[k].replace(/SELECT|BEGIN/, (m) => `${m} /* corpo estranho */`);
    await c.query("SAVEPOINT desfeito3000");
    await c.query(rollback); // base vigente: a migration APLICA
    for (const k of Object.keys(FN))
      await recusa(
        c,
        `corpo desconhecido de ${k}`,
        `${cabecalhoDe(k)}${corpoEstranho(k)}$$;\n${migration}`,
        /B1_BASELINE_DIVERGENT/,
      );
    await c.query("ROLLBACK TO SAVEPOINT desfeito3000");
    await c.query("RELEASE SAVEPOINT desfeito3000");
    await recusa(
      c,
      "anon executa get_admin_customers_paged",
      `GRANT EXECUTE ON FUNCTION ${FN.lista.assinatura} TO anon; ${migration}`,
      /ACL/,
    );
    await recusa(
      c,
      "anon executa get_admin_user_detail",
      `GRANT EXECUTE ON FUNCTION ${FN.ficha.assinatura} TO anon; ${migration}`,
      /ACL/,
    );
    await recusa(
      c,
      "PUBLIC executa get_admin_user_detail",
      `GRANT EXECUTE ON FUNCTION ${FN.ficha.assinatura} TO PUBLIC; ${migration}`,
      /ACL/,
    );
    await recusa(
      c,
      "atributo diferente (STABLE) na ficha",
      `ALTER FUNCTION ${FN.ficha.assinatura} STABLE; ${migration}`,
      /atributos/,
    );
    await recusa(
      c,
      "sobrecarga de get_admin_customers_paged",
      `CREATE FUNCTION public.get_admin_customers_paged(p_x int) RETURNS int LANGUAGE sql AS 'SELECT 1'; ${migration}`,
      /sobrecarga/,
    );
    await recusa(
      c,
      "sobrecarga de get_admin_user_detail",
      `CREATE FUNCTION public.get_admin_user_detail(p_x int) RETURNS int LANGUAGE sql AS 'SELECT 1'; ${migration}`,
      /sobrecarga/,
    );
    await recusa(
      c,
      "sobrecarga de crm__vendas",
      `CREATE FUNCTION public.crm__vendas(p_ate timestamptz, p_x int) RETURNS int LANGUAGE sql AS 'SELECT 1'; ${migration}`,
      /B1_BASELINE_DIVERGENT.*crm__vendas/,
    );
    await isolado(c, "rb3000", async () => {
      await trocarCorpo(c, "ficha", corpoEstranho("ficha"));
      await recusa(
        c,
        "o rollback com corpo desconhecido",
        rollback,
        /B1_BASELINE_DIVERGENT/,
      );
    });
    console.log(
      "  PASSOU o pre-voo: corpo desconhecido, ACL, atributo, sobrecarga e crm__vendas diferente recusam sem escrever; o rollback recusa corpo desconhecido",
    );
    await c.query("ROLLBACK");

    // ---- 7. Atomicidade SEM BEGIN: a conferencia final sabotada derruba o arquivo inteiro; as DUAS trocas caem juntas. ----
    const c2 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c2.connect();
    try {
      await c2.query(rollback); // base vigente, gravada (autocommit): o clone e' descartavel
      assert.deepEqual(await hashes(c2), HASH_ANTES);
      const sabotada = migration.replace(
        `IF v_hash IS DISTINCT FROM '${HASH_NOVO.ficha}' THEN\n    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_user_detail`,
        `IF v_hash IS DISTINCT FROM '00000000000000000000000000000000' THEN\n    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo depois do CREATE OR REPLACE de get_admin_user_detail`,
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
    console.log("OK: prova viva da 20261403000000");
  },
  (e) => {
    console.error("FALHOU:", e?.stack ?? e);
    process.exit(1);
  },
);
