"use strict";

/**
 * Prova VIVA da migration 20261399997000 (o pedido guarda quem vai receber: `create_marketplace_order_v23` e `create_marketplace_order_v24`
 * ganham UMA chave, `recipient_name`, na copia do endereco salvo para dentro do pedido; DADO DE CLIENTE), num Postgres EFEMERO local, sem
 * rede, com os papeis de verdade (anon, authenticated).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada (ja com a 20261399997000). TODO caso comeca numa transacao que termina em
 * ROLLBACK e monta o estado ANTES (os dois corpos da 20261397000000, reinstalados por CREATE OR REPLACE do texto da migration, byte a
 * byte) ou DEPOIS (a propria migration, por cima do ANTES).
 *
 *  COPIA       conta + endereco salvo, pelas DUAS portas do pedido (v23 "pagar na entrega" e v24 "pagar pelo app"), com e sem `{cpf}` no
 *              `p_address_data`: o nome de quem vai receber chega a `customer_data.address.recipient_name`, aparado; as 8 chaves de
 *              antes seguem iguais; nome so de espacos nao entra; nome igual ao do comprador entra (quem esconde e' o painel).
 *  SEM COPIA   compra sem conta (com e sem o id do endereco de outra pessoa), retirada na loja, conta sem `p_address_id` e endereco digitado de
 *              verdade em `p_address_data`: nenhum nome entra, exatamente como antes. Endereco de OUTRA pessoa e' recusado sem escrever.
 *  IDEMPOTENCIA a retentativa com a mesma chave devolve o pedido que ja nasceu e o nome da primeira vez fica.
 *  INTACTO     o MESMO roteiro rodado no ANTES e no DEPOIS devolve linhas de pedido e de item identicas (so `customer_data.address.recipient_name`
 *              difere); um pedido gravado ANTES fica identico depois da migration (nenhuma linha e' lida ou reescrita).
 *  CONTROLE    no estado ANTES a verificacao fica VERMELHA (o defeito); e com quatro mutantes (coluna errada, sem aparar, retirada copia, a
 *              copia sobrescreve o endereco digitado). A convidada com o id de endereco alheio e recusada ANTES do bloco (o freio 0-quater da 20261394000000):
 *              tirar a guarda da conta do bloco sozinha e EQUIVALENTE (defesa em profundidade) e sobrevive de proposito.
 *  MIGRATION   reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); o rollback devolve cada corpo byte a byte (md5, sha256 e
 *              texto) e a mesma ACL; o segundo rollback RECUSA; ida e volta termina igual; o pre-voo recusa SEM escrever em cada estado
 *              estranho (corpo desconhecido nas duas, ACL aberta, anon sem EXECUTE, atributo trocado, sobrecarga, funcao ausente, coluna
 *              ausente) e a migration SEM o pre-voo sobrescreve corpo desconhecido (o pre-voo e' a trava); o pos-voo reprovando desfaz TUDO.
 *  CONSULTAS   150a/150b: rol fechado de 9 linhas, positivas no estado certo, desvios nas linhas certas; as consultas vizinhas (31a, 37a, 47a,
 *              81a, 89a, 106a, 111a, 115a) seguem aprovando o corpo novo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-pedido-guarda-quem-vai-receber-viva.cjs
 */

/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Os indices vem de contadores e de listas fechadas deste arquivo; os caminhos sao montados de literais (as migrations do repositorio). */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  QUEM_VAI_RECEBER,
} = require("./o-pedido-guarda-quem-vai-receber-posterior.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const ARQ = QUEM_VAI_RECEBER.nome;
const lerLF = (nome) =>
  fs.readFileSync(path.join(PASTA, nome), "utf8").replace(/\r\n/g, "\n");
const MIG = lerLF(ARQ);
const RB = lerLF(`rollback-manual-${ARQ}`);
const A150 = "150a-conferir-o-pedido-guarda-quem-vai-receber-aplicado";
const B150 = "150b-antes-o-pedido-guarda-quem-vai-receber-base-vigente";
const lerConsulta = (n) =>
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "publicacao",
      "consultas",
      `${n}.sql`,
    ),
    "utf8",
  );

const FUNCOES = () => QUEM_VAI_RECEBER.funcoes;
const [F23, F24] = QUEM_VAI_RECEBER.funcoes;
const V23 = F23.nome;
const V24 = F24.nome;
const sha256 = (s) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, ""), "utf8").digest("hex");

let C = null; // a conexao unica da prova

// ---------------------------------------------------------------------------
// Texto das funcoes: a definicao da migration e o corpo de cada uma
// ---------------------------------------------------------------------------
/** O CREATE OR REPLACE inteiro de `f` dentro de `texto` (a migration ou o rollback). */
function definicaoEm(texto, f) {
  const ini = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${f.nome}(`);
  assert.ok(ini >= 0, `sem ${f.nome}`);
  const fecha = texto.indexOf(`\n${f.delim};`, ini);
  assert.ok(fecha > ini);
  return texto.slice(ini, fecha + 1 + f.delim.length + 1);
}
const corpoDe = (definicao, f) => {
  const a = definicao.indexOf(`AS ${f.delim}`) + `AS ${f.delim}`.length;
  return definicao.slice(a, definicao.length - f.delim.length - 1);
};
const DEF_ANTES = Object.fromEntries(
  FUNCOES().map((f) => [f.nome, QUEM_VAI_RECEBER.definicaoDe(f)]),
);
const DEF_DEPOIS = Object.fromEntries(
  FUNCOES().map((f) => [f.nome, definicaoEm(MIG, f)]),
);
assert.equal(md5(corpoDe(DEF_ANTES[V23], F23)), F23.hashAntes);
assert.equal(md5(corpoDe(DEF_ANTES[V24], F24)), F24.hashAntes);
assert.equal(md5(corpoDe(DEF_DEPOIS[V23], F23)), F23.hashDesta);
assert.equal(md5(corpoDe(DEF_DEPOIS[V24], F24)), F24.hashDesta);

const instalarAntes = async () => {
  for (const f of FUNCOES()) await C.query(DEF_ANTES[f.nome]);
};
const instalarDepois = async () => {
  await instalarAntes();
  await C.query(MIG);
};
const hashes = async () => {
  const r = {};
  for (const f of FUNCOES())
    r[f.nome] = (
      await C.query(
        "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [f.assinatura],
      )
    ).rows[0]?.h;
  return r;
};
const prosrcs = async () => {
  const r = {};
  for (const f of FUNCOES())
    r[f.nome] = (
      await C.query(
        "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
        [f.assinatura],
      )
    ).rows[0]?.prosrc;
  return r;
};
const retrato = async () => {
  const r = {};
  for (const f of FUNCOES())
    r[f.nome] = (
      await C.query(
        "SELECT p.oid::int AS oid, p.proacl::text AS acl, p.proowner::regrole::text AS dono, (to_jsonb(p) - 'prosrc')::text AS atributos FROM pg_proc p WHERE p.oid = to_regprocedure($1)",
        [f.assinatura],
      )
    ).rows[0];
  return r;
};
const esperarHashes = async (estado, rotulo) => {
  const h = await hashes();
  for (const f of FUNCOES())
    assert.equal(
      h[f.nome],
      estado === "antes" ? f.hashAntes : f.hashDesta,
      `${rotulo}: ${f.nome} nao esta no estado ${estado}`,
    );
};

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** Uma transacao por caso, sempre desfeita, ja no estado pedido ("antes", "depois" ou "nenhum"). */
async function emTransacao(f, { estado = "antes", semente = false } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes" || estado === "depois") {
      await instalarAntes();
      await esperarHashes("antes", "montagem");
    }
    if (estado === "depois") {
      await C.query(MIG);
      await esperarHashes("depois", "montagem");
    }
    if (semente) await semear();
    return await f();
  } finally {
    await C.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// Semente, chamadas e leitura do pedido
// ---------------------------------------------------------------------------
const U = {
  cliente: "7e7e3997-7000-4000-8000-0000000000d1",
  outra: "7e7e3997-7000-4000-8000-0000000000d2",
};
const PROD = "7e7e3997-7000-4000-8000-0000000000f1";
const END = {
  presente: "7e7e3997-7000-4000-8000-0000000000e1", // recebe: Maria Presente (diferente de quem compra)
  aparar: "7e7e3997-7000-4000-8000-0000000000e2", // '  Joao Aparado  '
  vazio: "7e7e3997-7000-4000-8000-0000000000e3", // '   ' (so espacos)
  igual: "7e7e3997-7000-4000-8000-0000000000e4", // o mesmo nome de quem compra
  alheio: "7e7e3997-7000-4000-8000-0000000000e5", // de OUTRA pessoa
};
const CASA = {
  cep: "38500-100",
  street: "Rua da Prova",
  number: "10",
  complement: "Apto 2",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
  reference: "Portao azul",
};
const DIGITADO = {
  cep: "38500-120",
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};
const CPF_VALIDO = "52998224725";
const COMPRADOR = "Cliente Prova";

async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@3997.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $3, 'customer'), ($2, 'Outra Prova', 'customer')",
    [U.cliente, U.outra, COMPRADOR],
  );
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, ARRAY['pix', 'card', 'cash'], 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta 3997', 100, 1000, true, 40, false)",
    [PROD],
  );
  const ins = (id, uid, nome, recebe) =>
    C.query(
      `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, complement,
                                          neighborhood, city, state, reference, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false)`,
      [
        id,
        uid,
        nome,
        recebe,
        CASA.cep,
        CASA.street,
        CASA.number,
        CASA.complement,
        CASA.neighborhood,
        CASA.city,
        CASA.state,
        CASA.reference,
      ],
    );
  await ins(END.presente, U.cliente, "Casa", "Maria Presente");
  await ins(END.aparar, U.cliente, "Trabalho", "  Joao Aparado  ");
  await ins(END.vazio, U.cliente, "Sitio", "   ");
  await ins(END.igual, U.cliente, "Minha casa", COMPRADOR);
  await ins(END.alheio, U.outra, "Casa da outra", "Pessoa Alheia");
}

/** Roda `sql` como `papel`, com o auth.uid() pedido; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], uid = "") {
  await C.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
  if (papel) await C.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await C.query(sql, params)).rows;
  } finally {
    await C.query("RESET ROLE").catch(() => {});
  }
}
/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], uid = "") {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, uid);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code, detalhe: e.detail };
  }
}

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid, NULL::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;

/**
 * Faz o pedido pelo CAMINHO do checkout. `porta` 'v23' (pagar na entrega, cash) ou 'v24' (pagar pelo app, online); `logado` decide a conta
 * (a v24 so aceita online com conta). `enderecoId` e `dados` (p_address_data) como o front manda.
 */
async function pedir({
  porta,
  logado = true,
  enderecoId = null,
  dados = null,
  opcao = "local-delivery",
  cep = CASA.cep,
  chave,
}) {
  return tentar(
    logado ? "authenticated" : "anon",
    SQL_PEDIDO(porta === "v24" ? V24 : V23),
    [
      JSON.stringify([{ product_id: PROD, variant_id: null, quantity: 1 }]),
      "100.00",
      0,
      porta === "v24" ? "online" : "cash",
      enderecoId,
      dados === null ? null : JSON.stringify(dados),
      cep,
      opcao,
      chave ?? crypto.randomUUID(),
    ],
    logado ? U.cliente : "",
  );
}
const lerPedido = async (id) =>
  (
    await C.query(
      "SELECT to_jsonb(o) AS o FROM public.marketplace_orders o WHERE o.id = $1",
      [id],
    )
  ).rows[0]?.o;
const contarPedidos = async () =>
  Number(
    (await C.query("SELECT count(*)::int AS n FROM public.marketplace_orders"))
      .rows[0].n,
  );

// ---------------------------------------------------------------------------
// O COMPORTAMENTO esperado — devolve a lista de falhas (vazia = passou). E' a MESMA que roda no estado DEPOIS (tem de dar vazio) e nos
// controles/mutantes (nao vazio).
// ---------------------------------------------------------------------------
const falha = (f, rotulo, obtido, esperado) =>
  f.push(
    `${rotulo}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`,
  );

async function verificar() {
  const f = [];
  const endereco = async (r, rotulo) => {
    if (!r.linhas) {
      f.push(`${rotulo}: o pedido foi recusado: ${r.erro}`);
      return undefined;
    }
    const o = await lerPedido(r.linhas[0].id);
    return {
      o,
      address: o.customer_data.address,
      texto: JSON.stringify(o.customer_data),
    };
  };
  for (const porta of ["v23", "v24"]) {
    // COPIA: o nome chega, aparado, com as 8 chaves de antes; com e sem {cpf}.
    for (const [rotulo, dados] of [
      ["sem p_address_data", null],
      ["so {cpf}", { cpf: CPF_VALIDO }],
    ]) {
      const a = await endereco(
        await pedir({ porta, enderecoId: END.presente, dados }),
        `${porta}/presente/${rotulo}`,
      );
      if (a) {
        try {
          assert.deepEqual(a.address, {
            ...CASA,
            recipient_name: "Maria Presente",
          });
        } catch {
          falha(
            f,
            `${porta}/presente/${rotulo}: customer_data.address`,
            a.address,
            { ...CASA, recipient_name: "Maria Presente" },
          );
        }
        if (a.o.customer_data.address_id !== END.presente)
          f.push(`${porta}/presente/${rotulo}: address_id mudou`);
      }
    }
    const aparado = await endereco(
      await pedir({ porta, enderecoId: END.aparar }),
      `${porta}/aparar`,
    );
    if (aparado && aparado.address?.recipient_name !== "Joao Aparado")
      falha(
        f,
        `${porta}/aparar: recipient_name`,
        aparado.address?.recipient_name,
        "Joao Aparado",
      );
    const vazio = await endereco(
      await pedir({ porta, enderecoId: END.vazio }),
      `${porta}/vazio`,
    );
    if (vazio) {
      if (vazio.address && "recipient_name" in vazio.address)
        f.push(
          `${porta}/vazio: nome so de espacos entrou: ${JSON.stringify(vazio.address)}`,
        );
      try {
        assert.deepEqual(vazio.address, CASA);
      } catch {
        falha(f, `${porta}/vazio: as 8 chaves`, vazio.address, CASA);
      }
    }
    const igual = await endereco(
      await pedir({ porta, enderecoId: END.igual }),
      `${porta}/igual`,
    );
    if (igual && igual.address?.recipient_name !== COMPRADOR)
      falha(
        f,
        `${porta}/igual: recipient_name`,
        igual.address?.recipient_name,
        COMPRADOR,
      );

    // SEM COPIA: conta sem endereco; endereco digitado; convidada com o id de outra pessoa.
    const semId = await endereco(
      await pedir({ porta, enderecoId: null }),
      `${porta}/conta sem p_address_id`,
    );
    if (semId && semId.address !== null)
      falha(f, `${porta}/conta sem p_address_id: address`, semId.address, null);
    const digitado = await endereco(
      await pedir({
        porta,
        enderecoId: END.presente,
        dados: DIGITADO,
        cep: DIGITADO.cep,
      }),
      `${porta}/endereco digitado`,
    );
    if (digitado) {
      try {
        assert.deepEqual(digitado.address, DIGITADO);
      } catch {
        falha(
          f,
          `${porta}/endereco digitado: address`,
          digitado.address,
          DIGITADO,
        );
      }
    }
    // Endereco de OUTRA pessoa: recusa sem escrever.
    const antes = await contarPedidos();
    const alheio = await pedir({ porta, enderecoId: END.alheio });
    if (alheio.linhas) f.push(`${porta}/endereco alheio: o pedido NASCEU`);
    else if (!/Endere.o inv.lido ou n.o pertence ao usu.rio/.test(alheio.erro))
      f.push(
        `${porta}/endereco alheio: recusa com outra frase: ${alheio.erro}`,
      );
    if ((await contarPedidos()) !== antes)
      f.push(`${porta}/endereco alheio: escreveu pedido`);
  }

  // RETIRADA NA LOJA (so a v23 aceita retirada pelo app? as duas portas aceitam; medimos a v23 e a v24 com conta).
  for (const porta of ["v23", "v24"]) {
    const r = await endereco(
      await pedir({ porta, enderecoId: END.presente, opcao: "store-pickup" }),
      `${porta}/retirada`,
    );
    if (r) {
      if (r.address !== null)
        falha(f, `${porta}/retirada: address`, r.address, null);
      if (r.texto.includes("Maria Presente"))
        f.push(`${porta}/retirada: o nome entrou no pedido`);
      if (!r.o.customer_data.pickup_address)
        f.push(`${porta}/retirada: sem o endereco da loja`);
    }
  }

  // COMPRA SEM CONTA (so a v23 "pagar na entrega" aceita visitante).
  const conv1 = await endereco(
    await pedir({
      porta: "v23",
      logado: false,
      enderecoId: null,
      dados: DIGITADO,
      cep: DIGITADO.cep,
    }),
    "convidada/digitado",
  );
  if (conv1) {
    try {
      assert.deepEqual(conv1.address, DIGITADO);
    } catch {
      falha(f, "convidada/digitado: address", conv1.address, DIGITADO);
    }
  }
  // O visitante nao pode apontar para endereco salvo: o freio da porta (0-quater, a) recusa ANTES do bloco da copia, com a frase do passo 1.
  const antesConv = await contarPedidos();
  const conv2 = await pedir({
    porta: "v23",
    logado: false,
    enderecoId: END.presente,
    dados: null,
    cep: CASA.cep,
  });
  if (conv2.linhas)
    f.push("convidada com o id do endereco de outra pessoa: o pedido NASCEU");
  else if (!/Endere.o inv.lido ou n.o pertence ao usu.rio/.test(conv2.erro))
    f.push(
      `convidada com o id do endereco de outra pessoa: recusa com outra frase: ${conv2.erro}`,
    );
  if ((await contarPedidos()) !== antesConv)
    f.push("convidada com o id do endereco de outra pessoa: escreveu pedido");

  // IDEMPOTENCIA: editar o nome entre as duas tentativas nao muda o pedido que ja nasceu.
  const chave = crypto.randomUUID();
  const p1 = await pedir({ porta: "v23", enderecoId: END.presente, chave });
  await C.query(
    "UPDATE public.user_addresses SET recipient_name = 'Nome Trocado Depois' WHERE id = $1",
    [END.presente],
  );
  const p2 = await pedir({ porta: "v23", enderecoId: END.presente, chave });
  await C.query(
    "UPDATE public.user_addresses SET recipient_name = 'Maria Presente' WHERE id = $1",
    [END.presente],
  );
  if (!p1.linhas || !p2.linhas)
    f.push(`idempotencia: recusou (${p1.erro ?? ""} ${p2.erro ?? ""})`);
  else {
    if (p1.linhas[0].id !== p2.linhas[0].id)
      f.push("idempotencia: a retentativa criou outro pedido");
    const nome = (await lerPedido(p1.linhas[0].id)).customer_data.address
      ?.recipient_name;
    if (nome !== "Maria Presente")
      falha(f, "idempotencia: o nome da primeira vez", nome, "Maria Presente");
  }
  return f;
}

/** Os corpos da migration sabotados (ainda SQL valido): `de` -> `para` dentro da definicao de cada funcao. */
function definicoesSabotadas(de, para) {
  const r = {};
  for (const f of FUNCOES()) {
    const d = DEF_DEPOIS[f.nome];
    assert.equal(
      d.split(de).length - 1,
      1,
      `a sabotagem ${JSON.stringify(de.slice(0, 50))} nao e unica em ${f.nome}`,
    );
    r[f.nome] = d.replace(de, () => para);
    assert.notEqual(r[f.nome], d, "a sabotagem nao mudou a definicao");
  }
  return r;
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------
prova(
  "COPIA (DEPOIS): v23 e v24 gravam o nome de quem vai receber (aparado), com as 8 chaves de antes; sem copia na convidada, na retirada, sem endereco e com endereco digitado; alheio recusado; idempotencia",
  () =>
    emTransacao(
      async () => {
        assert.deepEqual(await verificar(), []);
      },
      { estado: "depois", semente: true },
    ),
);

prova(
  "CONTROLE (ANTES): sem a migration o pedido nasce SEM o nome (o defeito) e a MESMA verificacao fica vermelha, so nas linhas do nome",
  () =>
    emTransacao(
      async () => {
        const r = await pedir({ porta: "v23", enderecoId: END.presente });
        assert.ok(r.linhas, r.erro);
        const o = await lerPedido(r.linhas[0].id);
        assert.deepEqual(
          o.customer_data.address,
          CASA,
          "no ANTES o endereco copiado tem so as 8 chaves",
        );
        const falhas = await verificar();
        assert.ok(
          falhas.length > 0,
          "a verificacao NAO ficou vermelha no estado ANTES",
        );
        assert.ok(
          falhas.some((x) => x.startsWith("v23/presente/sem p_address_data")),
        );
        assert.ok(
          falhas.some((x) => x.startsWith("v24/presente/sem p_address_data")),
        );
        assert.ok(falhas.some((x) => x.startsWith("v23/aparar")));
        assert.ok(falhas.some((x) => x.startsWith("v24/igual")));
        // O que nao muda nao reprova: retirada, convidada, sem id, digitado, alheio.
        for (const x of falhas)
          assert.match(
            x,
            /presente|aparar|igual|idempotencia/,
            `reprovou algo que nao e do nome: ${x}`,
          );
      },
      { estado: "antes", semente: true },
    ),
);

for (const [rotulo, de, para, linhaEsperada] of [
  [
    "a chave copia a coluna ERRADA (street)",
    "'recipient_name', NULLIF(btrim(ua.recipient_name), '')",
    "'recipient_name', ua.street",
    /presente|aparar|igual/,
  ],
  [
    "sem aparar (so ua.recipient_name)",
    "NULLIF(btrim(ua.recipient_name), '')",
    "ua.recipient_name",
    /aparar|vazio/,
  ],
  [
    "a retirada na loja tambem copia (tira a guarda do store-pickup)",
    "AND p_address_id IS NOT NULL\n       AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN\n        SELECT jsonb_strip_nulls(",
    "AND p_address_id IS NOT NULL THEN\n        SELECT jsonb_strip_nulls(",
    /retirada/,
  ],
  [
    "a copia SOBRESCREVE o endereco digitado (tira a condicao de nao ter vindo endereco)",
    "IF v_address_data_sem_cpf IS NULL\n       AND v_user_id IS NOT NULL\n       AND p_address_id IS NOT NULL",
    "IF v_user_id IS NOT NULL\n       AND p_address_id IS NOT NULL",
    /endereco digitado/,
  ],
]) {
  prova(`MUTANTE vermelho — ${rotulo}`, async () => {
    await C.query("BEGIN");
    try {
      await instalarDepois();
      const sab = definicoesSabotadas(de, para);
      for (const f of FUNCOES()) await C.query(sab[f.nome]);
      await semear();
      const falhas = await verificar();
      assert.ok(falhas.length > 0, `o mutante "${rotulo}" NAO ficou vermelho`);
      assert.ok(
        falhas.some((x) => linhaEsperada.test(x)),
        `o mutante "${rotulo}" devia reprovar a linha certa; reprovou: ${falhas.slice(0, 3).join(" | ")}`,
      );
    } finally {
      await C.query("ROLLBACK");
    }
  });
}

prova(
  "INTACTO: o mesmo roteiro no ANTES e no DEPOIS grava linhas de pedido e de item identicas (so customer_data.address.recipient_name difere)",
  () =>
    emTransacao(
      async () => {
        const roteiro = [
          { porta: "v23", enderecoId: END.presente },
          { porta: "v24", enderecoId: END.presente },
          { porta: "v23", enderecoId: END.presente, opcao: "store-pickup" },
          { porta: "v23", enderecoId: null },
          {
            porta: "v23",
            enderecoId: END.presente,
            dados: DIGITADO,
            cep: DIGITADO.cep,
          },
          {
            porta: "v23",
            logado: false,
            enderecoId: null,
            dados: DIGITADO,
            cep: DIGITADO.cep,
          },
        ];
        const rodar = async () => {
          const out = [];
          for (const passo of roteiro) {
            const r = await pedir(passo);
            assert.ok(r.linhas, r.erro);
            const id = r.linhas[0].id;
            const linha = await lerPedido(id);
            const itens = (
              await C.query(
                "SELECT to_jsonb(i) - 'id' - 'order_id' AS i FROM public.marketplace_order_items i WHERE i.order_id = $1 ORDER BY i.id",
                [id],
              )
            ).rows.map((x) => x.i);
            // Sem o que muda por pedido (id, chave) e sem o nome (a unica diferenca esperada).
            const { id: _id, idempotency_key: _chave, ...o } = linha;
            if (
              o.customer_data?.address &&
              typeof o.customer_data.address === "object"
            ) {
              const { recipient_name: _nome, ...semNome } =
                o.customer_data.address;
              o.customer_data = { ...o.customer_data, address: semNome };
            }
            out.push({ o, itens });
          }
          return out;
        };
        const antes = await rodar();
        assert.equal(await aplicar(MIG), null);
        await esperarHashes("depois", "apos aplicar");
        const depois = await rodar();
        assert.deepEqual(
          depois,
          antes,
          "o roteiro gravou linhas diferentes (alem do nome)",
        );
      },
      { estado: "antes", semente: true },
    ),
);

prova(
  "DADO: um pedido gravado ANTES fica identico depois da migration (sem backfill: nenhuma linha de pedido ou de endereco muda)",
  () =>
    emTransacao(
      async () => {
        const r = await pedir({ porta: "v23", enderecoId: END.presente });
        assert.ok(r.linhas, r.erro);
        const id = r.linhas[0].id;
        const foto = async () => ({
          pedidos: (
            await C.query(
              "SELECT to_jsonb(o) AS o FROM public.marketplace_orders o ORDER BY o.id",
            )
          ).rows,
          enderecos: (
            await C.query(
              "SELECT to_jsonb(a) AS a FROM public.user_addresses a ORDER BY a.id",
            )
          ).rows,
          itens: (
            await C.query(
              "SELECT to_jsonb(i) AS i FROM public.marketplace_order_items i ORDER BY i.id",
            )
          ).rows,
        });
        const antes = await foto();
        assert.equal(
          (await lerPedido(id)).customer_data.address.recipient_name,
          undefined,
        );
        assert.equal(await aplicar(MIG), null);
        await esperarHashes("depois", "apos aplicar");
        assert.deepEqual(await foto(), antes, "a migration mexeu em dado");
        // E o pedido antigo continua sem o nome: nada o recria do endereco de hoje.
        assert.equal(
          (await lerPedido(id)).customer_data.address.recipient_name,
          undefined,
        );
      },
      { estado: "antes", semente: true },
    ),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL, atributos); atributos, OID, dono e ACL iguais ao ANTES; o rollback tambem roda em CRLF",
  () =>
    emTransacao(
      async () => {
        const antes = await retrato();
        assert.equal(await aplicar(MIG), null);
        const d1 = await retrato();
        assert.equal(await aplicar(MIG), null, "reaplicar 2x falhou");
        assert.deepEqual(await retrato(), d1);
        assert.equal(
          await aplicar(MIG.replace(/\n/g, "\r\n")),
          null,
          "a migration em CRLF falhou",
        );
        await esperarHashes("depois", "CRLF");
        assert.deepEqual(await retrato(), d1);
        assert.deepEqual(d1, antes, "oid, dono, ACL ou atributos mudaram");
        assert.equal(
          await aplicar(RB.replace(/\n/g, "\r\n")),
          null,
          "o rollback em CRLF falhou",
        );
        await esperarHashes("antes", "rollback CRLF");
      },
      { estado: "antes" },
    ),
);

prova(
  "ROLLBACK: devolve cada corpo byte a byte (md5, sha256 e texto) e a mesma ACL; o segundo rollback RECUSA sem escrever; ida e volta termina igual",
  () =>
    emTransacao(
      async () => {
        const antes = await prosrcs();
        const retratoAntes = await retrato();
        assert.equal(await aplicar(MIG), null);
        const d1 = await prosrcs();
        const retratoDepois = await retrato();
        assert.equal(await aplicar(RB), null, "o rollback falhou");
        await esperarHashes("antes", "rollback");
        const volta = await prosrcs();
        for (const f of FUNCOES()) {
          assert.equal(
            volta[f.nome],
            antes[f.nome],
            `${f.nome}: o rollback nao devolve o texto byte a byte`,
          );
          assert.equal(sha256(volta[f.nome]), sha256(antes[f.nome]));
          assert.equal(
            volta[f.nome],
            corpoDe(DEF_ANTES[f.nome], f),
            `${f.nome}: o rollback != texto da migration anterior`,
          );
        }
        assert.deepEqual(await retrato(), retratoAntes);
        const recusa = await aplicar(RB);
        assert.ok(recusa, "o segundo rollback devia recusar");
        assert.match(recusa.erro, /B1_BASELINE_DIVERGENT/);
        await esperarHashes("antes", "segundo rollback");
        assert.equal(await aplicar(MIG), null);
        assert.deepEqual(await prosrcs(), d1, "ida e volta nao termina igual");
        assert.deepEqual(await retrato(), retratoDepois);
      },
      { estado: "antes" },
    ),
);

for (const alvo of FUNCOES()) {
  prova(
    `PRE-VOO: com o corpo de ${alvo.nome} desconhecido, a migration RECUSA (B1_BASELINE_DIVERGENT) e o rollback tambem, sem escrever nada`,
    () =>
      emTransacao(
        async () => {
          const f = alvo;
          const d = DEF_ANTES[f.nome].replace(
            `AS ${f.delim}\n`,
            () => `AS ${f.delim}\n    -- corpo desconhecido\n`,
          );
          assert.notEqual(d, DEF_ANTES[f.nome]);
          await C.query(d);
          const foto = await prosrcs();
          const r = await aplicar(MIG);
          assert.ok(r, "a migration devia recusar");
          assert.match(r.erro, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(await prosrcs(), foto, "o pre-voo escreveu");
          const rr = await aplicar(RB);
          assert.ok(rr, "o rollback devia recusar");
          assert.match(rr.erro, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await prosrcs(),
            foto,
            "o pre-voo do rollback escreveu",
          );
        },
        { estado: "antes" },
      ),
  );
}

const ESTADOS_ESTRANHOS = [
  [
    "ACL aberta (PUBLIC executa a v24)",
    () => C.query(`GRANT EXECUTE ON FUNCTION ${F24.assinatura} TO PUBLIC`),
  ],
  [
    "anon sem EXECUTE na v23 (o checkout da convidada quebraria)",
    () => C.query(`REVOKE EXECUTE ON FUNCTION ${F23.assinatura} FROM anon`),
  ],
  [
    "atributo trocado (a v24 vira SECURITY INVOKER)",
    () => C.query(`ALTER FUNCTION ${F24.assinatura} SECURITY INVOKER`),
  ],
  [
    "sobrecarga (uma segunda create_marketplace_order_v23 em public)",
    () =>
      C.query(
        "CREATE FUNCTION public.create_marketplace_order_v23(p_x integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
      ),
  ],
  [
    "funcao ausente (a v24 nao existe)",
    () => C.query(`DROP FUNCTION ${F24.assinatura}`),
  ],
  [
    "coluna user_addresses.recipient_name ausente",
    () =>
      C.query(
        "ALTER TABLE public.user_addresses RENAME COLUMN recipient_name TO recipient_name_x",
      ),
  ],
];
for (const [rotulo, montar] of ESTADOS_ESTRANHOS) {
  prova(
    `PRE-VOO (estado estranho): ${rotulo} -> RECUSA (B1_BASELINE_DIVERGENT) sem escrever`,
    () =>
      emTransacao(
        async () => {
          await montar();
          const foto = await C.query(
            "SELECT proname, md5(prosrc) AS h FROM pg_proc WHERE proname IN ('create_marketplace_order_v23', 'create_marketplace_order_v24') ORDER BY proname, h",
          );
          const r = await aplicar(MIG);
          assert.ok(r, `a migration devia recusar: ${rotulo}`);
          assert.match(r.erro, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            (
              await C.query(
                "SELECT proname, md5(prosrc) AS h FROM pg_proc WHERE proname IN ('create_marketplace_order_v23', 'create_marketplace_order_v24') ORDER BY proname, h",
              )
            ).rows,
            foto.rows,
            "o pre-voo escreveu",
          );
        },
        { estado: "antes" },
      ),
  );
}

prova(
  "PRE-VOO e' a trava (mutante morto): a migration SEM o bloco de pre-voo sobrescreve um corpo desconhecido; com ele, recusa",
  () =>
    emTransacao(
      async () => {
        const d = DEF_ANTES[V23].replace(
          "AS $function$\n",
          () => "AS $function$\n    -- corpo desconhecido\n",
        );
        await C.query(d);
        const ini = MIG.indexOf("DO $preflight_20261399997000$");
        const fim =
          MIG.indexOf("END $preflight_20261399997000$;") +
          "END $preflight_20261399997000$;".length;
        assert.ok(ini > 0 && fim > ini);
        const semPreVoo =
          MIG.slice(0, ini) +
          MIG.slice(fim).replace(
            "current_setting('ikcous.quemrecebe_atributos')::jsonb",
            "v_atributos",
          );
        // Sem a fotografia do pre-voo a comparacao do pos-voo some; o que importa aqui: o corpo desconhecido e' sobrescrito.
        const r = await aplicar(semPreVoo);
        assert.equal(
          r,
          null,
          `sem o pre-voo a migration devia aplicar sobre o corpo desconhecido: ${r?.erro}`,
        );
        assert.equal(
          (await hashes())[V23],
          F23.hashDesta,
          "o corpo desconhecido foi sobrescrito sem o pre-voo",
        );
      },
      { estado: "antes" },
    ),
);

prova(
  "POS-VOO: se uma das duas funcoes sair com o corpo errado, o pos-voo RECUSA e a transacao desfaz TUDO (nenhuma fica pela metade)",
  () =>
    emTransacao(
      async () => {
        // Migration sabotada: a v24 e' instalada SEM a chave (o corpo vigente). O pre-voo passa; o pos-voo reprova pelo hash.
        const velho = definicaoEm(MIG, F24);
        const mut = MIG.replace(velho, () => DEF_ANTES[V24]);
        assert.notEqual(mut, MIG);
        const antes = await prosrcs();
        const r = await aplicar(mut);
        assert.ok(r, "o pos-voo devia recusar");
        assert.match(r.erro, /POSVOO_20261399997000/);
        assert.deepEqual(
          await prosrcs(),
          antes,
          "a migration ficou pela metade",
        );
        await esperarHashes("antes", "apos o pos-voo recusar");
      },
      { estado: "antes" },
    ),
);

const VIZINHAS = [
  "31a-conferir-endereco-da-compra-fica-no-pedido",
  "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
  "81a-conferir-compra-online-trava-preco-e-chave-aplicado",
  "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado",
  "106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado",
  "111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado",
  "115a-conferir-o-desconto-do-cupom-e-arredondado-ao-centavo-aplicado",
];

prova(
  "CONSULTAS: 150a/150b tem rol fechado de 9 linhas, positivas no estado certo; no outro estado reprovam EXATAMENTE o corpo e a chave das duas funcoes; as vizinhas aceitam o corpo novo",
  () =>
    emTransacao(
      async () => {
        const rodar = async (n) => (await C.query(lerConsulta(n))).rows;
        const ruins = (linhas) =>
          linhas
            .filter((l) => l.ok !== true)
            .map((l) => l.item)
            .sort();
        const esperadasRuins = FUNCOES()
          .flatMap((f) => [
            `${f.nome}: corpo exato (md5)`,
            `${f.nome}: o corpo copia o nome de quem vai receber (uma vez)`,
          ])
          .sort();
        for (const [estado, boa, ma] of [
          ["antes", B150, A150],
          ["depois", A150, B150],
        ]) {
          await instalarAntes();
          if (estado === "depois") await C.query(MIG);
          const b = await rodar(boa);
          const m = await rodar(ma);
          assert.equal(b.length, 9, "rol fechado de 9 linhas");
          assert.equal(new Set(b.map((l) => l.item)).size, 9);
          assert.deepEqual(
            ruins(b),
            [],
            `a consulta certa para o estado ${estado} devia aprovar tudo`,
          );
          assert.deepEqual(
            ruins(m),
            esperadasRuins,
            `a consulta do outro estado devia reprovar so os corpos (estado ${estado})`,
          );
        }
        // ACL aberta e atributos trocados reprovam a linha certa.
        await C.query("SAVEPOINT acl");
        await C.query(`GRANT EXECUTE ON FUNCTION ${F23.assinatura} TO PUBLIC`);
        assert.deepEqual(ruins(await rodar(A150)), [
          `${V23}: EXECUTE para anon, authenticated e service_role, sem PUBLIC`,
        ]);
        await C.query("ROLLBACK TO SAVEPOINT acl");
        await C.query("SAVEPOINT attr");
        await C.query(`ALTER FUNCTION ${F24.assinatura} SECURITY INVOKER`);
        assert.deepEqual(ruins(await rodar(A150)), [
          `${V24}: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno uuid)`,
        ]);
        await C.query("ROLLBACK TO SAVEPOINT attr");
        // As vizinhas aceitam o corpo novo: nenhuma linha de CORPO das duas funcoes reprova no estado DEPOIS.
        for (const n of VIZINHAS) {
          const linhas = await rodar(n);
          const corpos = linhas.filter(
            (l) =>
              /create_marketplace_order_v2[34].*corpo/.test(l.item) &&
              l.ok !== true,
          );
          assert.deepEqual(
            corpos.map((l) => `${l.item} vivo=${l.vivo}`),
            [],
            `${n}: nao aceita o corpo da 20261399997000`,
          );
        }
      },
      { estado: "antes" },
    ),
);

// ---------------------------------------------------------------------------
async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  let falhou = 0;
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok   ${nome}`);
      } catch (e) {
        falhou += 1;
        console.log(
          `  FALHOU ${nome}\n    ${String(e?.stack ? e.stack : e)
            .split("\n")
            .slice(0, 8)
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  console.log(`\n${PROVAS.length - falhou}/${PROVAS.length} provas passaram`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
