"use strict";

/**
 * Prova VIVA da migration 20261236000000 (a compra que dá R$ 0,00 não se paga pelo app: a
 * `create_marketplace_order_v24` recusa, ANTES de reservar estoque e de gastar a vaga do cupom, o pedido de
 * pagamento pelo app cujo total final já calculado pelo servidor é zero; dinheiro + estoque + cupom, decisão do
 * dono de 14/10/2026), num Postgres EFEMERO local, sem rede, com os papeis de verdade (anon, authenticated).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore ja tem a 20261236 (em CI ela tem),
 * TODO caso comeca pelo estado ANTES (o rollback-manual dela: CREATE OR REPLACE com o corpo da 20261229,
 * idempotente, conferido byte a byte contra o arquivo da 20261229) ou pelo estado DEPOIS (a propria migration).
 * Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  ANTES      controle: pelo caminho do pagamento pelo app ('online', v24) o pedido de R$ 0,00 NASCE: aguardando, com
 *             a reserva de 30 minutos, baixando o estoque e gastando a vaga do cupom de uso unico (o defeito).
 *  DEPOIS     (a) total zero + pagamento pelo app: recusa (P0001, a frase certa, o identificador no DETAIL), em quatro
 *             formas (entrega local, retirada, cupom de 100%, convidada), e NADA e' reservado nem gasto — provado
 *             por uma SEQUENCIA movida por gatilhos (que o rollback nao desfaz) no INSERT do pedido, na baixa do
 *             estoque e no uso do cupom: se a recusa viesse depois de qualquer um deles, a sequencia andaria;
 *             (b) total zero + pagar na retirada/entrega: o pedido nasce como hoje (v23 cash/pix, e a v24 chamada
 *             direto com cash); (c) total maior que zero pelo app: nasce como hoje (aguardando, prazo, estoque,
 *             cupom), inclusive na borda de R$ 0,01 e com o total do SERVIDOR (R$ 0,04) quando o cliente manda
 *             R$ 0,00 (tolerancia de R$ 0,05); (d) o cupom de uso unico nao e' gasto na recusa: depois dela a
 *             mesma vaga ainda compra na retirada, e so uma vez; (e) total divergente recebe a recusa de
 *             sempre (a trava do preco adulterado vem antes); (f) a retentativa de um pedido que ja nasceu
 *             (mesma chave) devolve o pedido, sem recusa.
 *  INTACTO    o corpo novo e' o antigo mais UM bloco (byte a byte); o mesmo roteiro de compras grava linhas
 *             identicas antes e depois; so o corpo da v24 muda (v23, ACL, oid, atributos, dados, outras funcoes).
 *  MUTANTES   sem a recusa; a recusa DEPOIS de reservar estoque e cupom; a recusa tambem na entrega; o limite em
 *             R$ 0,01; a decisao pelo total que o cliente mandou; so para quem tem conta: cada um deixa a
 *             verificacao certa VERMELHA.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO (md5 e sha256 do corpo
 *             da 20261229) e a mesma ACL; o pre-voo recusa SEM escrever (corpo desconhecido, a loja ainda no corpo da
 *             20261174, atributo, sobrecarga, funcao ausente, ACL aberta, anon sem EXECUTE); a conferencia final
 *             recusa estado ruim; a conferencia reprovando desfaz a troca.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ =
  "20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const VIVA_229 = fs.readFileSync(
  path.join(
    MIGRATIONS,
    "20261229000000_o_endereco_da_compra_fica_no_pedido.sql",
  ),
  "utf8",
);
const VIVA_174 = fs.readFileSync(
  path.join(MIGRATIONS, "20261174000000_formas_de_pagamento_por_loja.sql"),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const FN = {
  [V23]: `public.${V23}${ASSINATURA}`,
  [V24]: `public.${V24}${ASSINATURA}`,
};

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao `$function$;`: { cabeca (ate o `AS $function$`), corpo }. */
function funcaoDe(sql, fn) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const ab = sql.indexOf("$function$", ini);
  const corpoIni = ab + "$function$".length;
  const fim = sql.indexOf("$function$", corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}
const decl = (f, corpo) => `${f.cabeca + corpo}$function$;`;

// O corpo ANTIGO e' o da 20261229, LIDO DO ARQUIVO, nunca copiado para ca.
const ANTIGA = funcaoDe(VIVA_229, V24);
const ANTIGA_174 = funcaoDe(VIVA_174, V24);
const NOVA = funcaoDe(MIGRATION, V24);
const ROLL = funcaoDe(ROLLBACK, V24);
const H_ANTIGO = "b1ee9337105f442511c13a75977911b7";
const H_NOVO = "dc20132859f7dcc5c435f5daea2d31a2";
assert.equal(md5(ANTIGA.corpo), H_ANTIGO, "o corpo da 20261229 mudou");
// MODO MUTANTE DE ARQUIVO (PROVA_ARQUIVO_MUTADO=1): quem edita o ARQUIVO da migration para sabotar o corpo roda
// so a prova de COMPORTAMENTO (a que fica vermelha pelo que o corpo faz), sem as travas de hash e de bytes que
// reprovariam a edicao antes de qualquer comportamento ser medido; o corpo sabotado entra por CREATE OR REPLACE
// (o pre-voo e a conferencia da migration, que exigem o hash certo, ficam de fora). Nunca roda em CI.
const MUTADO = process.env.PROVA_ARQUIVO_MUTADO === "1";
if (!MUTADO) assert.equal(md5(NOVA.corpo), H_NOVO, "o corpo da 20261236 mudou");
assert.equal(
  ROLL.corpo,
  ANTIGA.corpo,
  "o rollback nao e o corpo da 20261229 byte a byte",
);
assert.equal(ROLL.cabeca, ANTIGA.cabeca, "a declaracao do rollback mudou");
assert.equal(
  NOVA.cabeca,
  ANTIGA.cabeca,
  "a declaracao mudou (assinatura, atributos)",
);

// O corpo NOVO = o antigo + UM bloco (6-ter), antes do 6-bis, e mais nada.
const ANCORA =
  "    -- 6-bis. O ENDEREÇO DA COMPRA FICA NO PEDIDO (20261229000000). Quem tem\n";
const iniBloco = NOVA.corpo.indexOf("    -- 6-ter.");
let BLOCO = "";
if (!MUTADO) {
  assert.ok(iniBloco > 0, "o bloco 6-ter nao esta no corpo novo");
  BLOCO = NOVA.corpo.slice(iniBloco, NOVA.corpo.indexOf(ANCORA));
  assert.equal(ANTIGA.corpo.split(ANCORA).length - 1, 1);
  assert.equal(
    ANTIGA.corpo.replace(ANCORA, () => BLOCO + ANCORA),
    NOVA.corpo,
    "o corpo novo nao e o antigo mais o bloco 6-ter, byte a byte",
  );
}

/** O estado DEPOIS: a migration inteira (pre-voo, troca e conferencia) ou, no modo mutante, so o corpo do arquivo. */
const instalarNova = () => C.query(MUTADO ? decl(NOVA, NOVA.corpo) : MIGRATION);

const FRASE =
  "Este pedido não tem valor a pagar pelo app. Escolha pagar na retirada ou na entrega, ou fale com a loja.";
const IDENTIFICADOR = "pedido_sem_valor_a_pagar_pelo_app";
const MSG_DIVERGENTE = "Os valores do pedido mudaram.";
const ACL_DE_SEMPRE = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const U = {
  cliente: "7e7e2360-0000-4000-8000-0000000000d1",
  admin: "7e7e2360-0000-4000-8000-0000000000a1",
};
const PROD = "7e7e2360-0000-4000-8000-0000000000f0";
const DIGITADO = {
  cep: "38500-120",
  street: "Rua Digitada",
  number: "5",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
};
const CEP_LOCAL = "38500-100";

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashVivo = async (fn) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.h;
const prosrcVivo = async (fn) =>
  (
    await C.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.prosrc;
const oidVivo = async (fn) =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN[fn]]))
    .rows[0].o;
const aclBruto = async (fn) =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN[fn]],
    )
  ).rows[0]?.a;
async function acl(fn) {
  const r = await C.query(
    `SELECT coalesce(array_agg(x::text ORDER BY x::text), '{}') AS a
       FROM pg_proc p, unnest(coalesce(p.proacl, acldefault('f', p.proowner))) AS x
      WHERE p.oid = to_regprocedure($1)`,
    [FN[fn]],
  );
  return r.rows[0].a;
}

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

/** Uma transacao por caso, sempre desfeita, ja no estado pedido: "antes" (rollback-manual) ou "depois" (migration). */
async function emTransacao(fn, { estado = "antes" } = {}) {
  await C.query("BEGIN");
  try {
    if (estado === "antes") {
      await C.query(ROLLBACK);
      assert.equal(await hashVivo(V24), H_ANTIGO, "o estado ANTES nao montou");
    } else if (estado === "depois") {
      await instalarNova();
      if (!MUTADO)
        assert.equal(await hashVivo(V24), H_NOVO, "o estado DEPOIS nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
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
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, NULL::uuid, $5::text,
     'Comprador Prova', '5534999990000', NULL::text, $6::jsonb, $7::text, $8::text, $9::uuid) AS id`;

/**
 * Faz o pedido pelo CAMINHO do checkout (`useOrders.createOrder`): uma unidade do produto de R$ 100, frete zero
 * (a loja de prova tem frete gratis "sempre" na entrega local e na retirada), `total` e' o que a tela mandou.
 */
async function pedir({
  rpc = V24,
  metodo = "online",
  uid = U.cliente,
  papel = "authenticated",
  dados = null,
  opcao = "local-delivery",
  cupom = null,
  chave = crypto.randomUUID(),
  cep = CEP_LOCAL,
  total,
}) {
  return tentar(
    papel,
    SQL_PEDIDO(rpc),
    [
      JSON.stringify([{ product_id: PROD, variant_id: null, quantity: 1 }]),
      total,
      0,
      metodo,
      cupom,
      dados === null ? null : JSON.stringify(dados),
      cep,
      opcao,
      chave,
    ],
    uid,
  );
}

const lerPedido = async (id) =>
  (
    await C.query(
      "SELECT to_jsonb(o) AS o FROM public.marketplace_orders o WHERE o.id = $1",
      [id],
    )
  ).rows[0]?.o;
const estoque = async () =>
  Number(
    (await C.query("SELECT estoque FROM public.produtos WHERE id = $1", [PROD]))
      .rows[0].estoque,
  );
const usosDoCupom = async (codigo) =>
  Number(
    (
      await C.query("SELECT usage_count FROM public.coupons WHERE code = $1", [
        codigo,
      ])
    ).rows[0]?.usage_count ?? -1,
  );
/** Quantas vezes a SEQUENCIA-SONDA andou: o rollback do savepoint nao a desfaz. */
const ticks = async () => {
  const r = (
    await C.query("SELECT is_called, last_value::int AS v FROM probe_zero_seq")
  ).rows[0];
  return r.is_called ? r.v : 0;
};
/** O que uma recusa NAO pode mexer: pedidos, estoque, uso do cupom e a sequencia-sonda. */
const foto = async (cupom = "ZEROUNICO") => ({
  pedidos: Number(
    (await C.query("SELECT count(*)::int AS n FROM public.marketplace_orders"))
      .rows[0].n,
  ),
  estoque: await estoque(),
  usosDoCupom: await usosDoCupom(cupom),
  ticks: await ticks(),
});

/** Pessoas, produto, loja, cupons e a sonda de ordem dentro da transacao do caso. */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@36.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente Prova', 'customer'), ($2, 'Admin Prova', 'admin')`,
    [U.cliente, U.admin],
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
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Azul 36', 100, 1000, true, 40, false)",
    [PROD],
  );
  for (const [codigo, tipo, valor, limite] of [
    ["ZEROUNICO", "fixed", 100, 1], // zera a compra; uso unico
    ["ZEROPCT", "percentage", 100, 100], // 100%
    ["PARCIAL", "fixed", 10, 100], // R$ 90
    ["QUASE", "fixed", 99.99, 100], // R$ 0,01
    ["QUASE04", "fixed", 99.96, 100], // R$ 0,04
  ])
    await C.query(
      `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
       VALUES ($1, $2, $3, true, 0, $4)`,
      [codigo, tipo, valor, limite],
    );
  // A SONDA DE ORDEM: uma sequencia que um gatilho move em cada coisa que a recusa NAO pode ter feito. Sequencia
  // nao e' desfeita por ROLLBACK (nem de savepoint): se a recusa viesse DEPOIS de inserir o pedido, baixar o
  // estoque ou gastar o cupom, o estado final voltaria limpo, mas a sequencia teria andado.
  await C.query(`
    CREATE SEQUENCE public.probe_zero_seq;
    CREATE FUNCTION public.probe_zero_tick() RETURNS trigger LANGUAGE plpgsql AS
      $f$ BEGIN PERFORM nextval('public.probe_zero_seq'); RETURN NEW; END $f$;
    CREATE TRIGGER probe_zero_pedido BEFORE INSERT ON public.marketplace_orders
      FOR EACH ROW EXECUTE FUNCTION public.probe_zero_tick();
    CREATE TRIGGER probe_zero_estoque BEFORE UPDATE ON public.produtos
      FOR EACH ROW EXECUTE FUNCTION public.probe_zero_tick();
    CREATE TRIGGER probe_zero_cupom BEFORE UPDATE ON public.coupons
      FOR EACH ROW EXECUTE FUNCTION public.probe_zero_tick();
  `);
}

// ---------------------------------------------------------------------------
// O COMPORTAMENTO esperado — uma verificacao por chave; devolve a lista de falhas (vazia = passou). E' a
// MESMA que roda sobre o corpo certo (tem de dar vazio) e sobre cada mutante (tem de dar nao vazio).
// ---------------------------------------------------------------------------
const CHECKS = {
  /** (a) total zero + pagamento pelo app: recusa com a frase e o identificador, e nada reservado nem gasto. */
  async zeroPeloApp() {
    const f = [];
    const casos = [
      ["conta, entrega local, cupom que zera (uso unico)", {}],
      ["conta, retirada na loja", { opcao: "store-pickup" }],
      ["conta, cupom de 100%", { cupom: "ZEROPCT" }],
      [
        "convidada, entrega local",
        { uid: "", papel: "anon", dados: DIGITADO, cep: DIGITADO.cep },
      ],
    ];
    for (const [rotulo, extra] of casos) {
      const antes = await foto();
      const r = await pedir({ cupom: "ZEROUNICO", total: 0, ...extra });
      if (r.linhas) {
        f.push(`zeroPeloApp(${rotulo}): o pedido de R$ 0,00 pelo app NASCEU`);
        continue;
      }
      if (r.erro !== FRASE)
        f.push(`zeroPeloApp(${rotulo}): mensagem inesperada: ${r.erro}`);
      if (r.codigo !== "P0001")
        f.push(`zeroPeloApp(${rotulo}): codigo ${r.codigo} (esperado P0001)`);
      if (!String(r.detalhe).startsWith(`${IDENTIFICADOR}:`))
        f.push(
          `zeroPeloApp(${rotulo}): DETAIL sem o identificador: ${r.detalhe}`,
        );
      const depois = await foto();
      for (const campo of Object.keys(antes))
        if (depois[campo] !== antes[campo])
          f.push(
            `zeroPeloApp(${rotulo}): ${campo} foi de ${antes[campo]} para ${depois[campo]} (a recusa tem de vir ANTES de reservar)`,
          );
    }
    return f;
  },
  /** (b) total zero + pagar na retirada/entrega: o pedido nasce como hoje (inclusive a v24 chamada direto com cash). */
  async zeroNaEntrega() {
    const f = [];
    const casos = [
      [
        "v23, cash, retirada na loja",
        { rpc: V23, metodo: "cash", opcao: "store-pickup" },
      ],
      ["v23, cash, entrega local", { rpc: V23, metodo: "cash" }],
      ["v23, pix na entrega", { rpc: V23, metodo: "pix" }],
      ["v24 direto, cash, entrega local", { rpc: V24, metodo: "cash" }],
    ];
    for (const [rotulo, extra] of casos) {
      const antes = await foto("ZEROPCT");
      const r = await pedir({ cupom: "ZEROPCT", total: 0, ...extra });
      if (!r.linhas) {
        f.push(`zeroNaEntrega(${rotulo}): recusado: ${r.erro}`);
        continue;
      }
      const o = await lerPedido(r.linhas[0].id);
      if (Number(o.total) !== 0)
        f.push(`zeroNaEntrega(${rotulo}): total ${o.total}`);
      if (o.payment_method !== extra.metodo)
        f.push(`zeroNaEntrega(${rotulo}): metodo ${o.payment_method}`);
      const depois = await foto("ZEROPCT");
      if (depois.estoque !== antes.estoque - 1)
        f.push(
          `zeroNaEntrega(${rotulo}): estoque ${antes.estoque} -> ${depois.estoque}`,
        );
      if (depois.usosDoCupom !== antes.usosDoCupom + 1)
        f.push(
          `zeroNaEntrega(${rotulo}): uso do cupom ${antes.usosDoCupom} -> ${depois.usosDoCupom}`,
        );
    }
    return f;
  },
  /** (c) total maior que zero pelo app: nasce como hoje, na borda de R$ 0,01 e com o total do SERVIDOR. */
  async positivoPeloApp() {
    const f = [];
    const casos = [
      ["R$ 100, sem cupom", { total: 100 }, 100, null],
      ["R$ 90, cupom parcial", { cupom: "PARCIAL", total: 90 }, 90, "PARCIAL"],
      ["borda: R$ 0,01", { cupom: "QUASE", total: 0.01 }, 0.01, "QUASE"],
      [
        "total do servidor R$ 0,04, cliente manda R$ 0,00 (tolerancia de R$ 0,05)",
        { cupom: "QUASE04", total: 0 },
        0.04,
        "QUASE04",
      ],
    ];
    for (const [rotulo, extra, esperado, cupom] of casos) {
      const antes = await foto(cupom ?? "ZEROUNICO");
      const r = await pedir(extra);
      if (!r.linhas) {
        f.push(`positivoPeloApp(${rotulo}): recusado: ${r.erro}`);
        continue;
      }
      const o = await lerPedido(r.linhas[0].id);
      if (Number(o.total) !== esperado)
        f.push(`positivoPeloApp(${rotulo}): total ${o.total}`);
      if (o.payment_method !== "online")
        f.push(`positivoPeloApp(${rotulo}): metodo ${o.payment_method}`);
      if (o.payment_status !== "aguardando" || !o.expires_at)
        f.push(
          `positivoPeloApp(${rotulo}): sem a reserva de sempre (${o.payment_status}, expires_at ${o.expires_at})`,
        );
      const depois = await foto(cupom ?? "ZEROUNICO");
      if (depois.estoque !== antes.estoque - 1)
        f.push(
          `positivoPeloApp(${rotulo}): estoque ${antes.estoque} -> ${depois.estoque}`,
        );
      if (cupom && depois.usosDoCupom !== antes.usosDoCupom + 1)
        f.push(
          `positivoPeloApp(${rotulo}): uso do cupom ${antes.usosDoCupom} -> ${depois.usosDoCupom}`,
        );
    }
    return f;
  },
  /** (d) o cupom de uso unico nao e' gasto na recusa: a mesma vaga ainda compra na retirada, e so uma vez. */
  async cupomUnicoNaoGasto() {
    const f = [];
    const recusa = await pedir({ cupom: "ZEROUNICO", total: 0 });
    if (recusa.linhas) {
      f.push("cupomUnicoNaoGasto: o pedido de R$ 0,00 pelo app NASCEU");
      return f;
    }
    if ((await usosDoCupom("ZEROUNICO")) !== 0)
      f.push(
        `cupomUnicoNaoGasto: a recusa gastou a vaga (usos ${await usosDoCupom("ZEROUNICO")})`,
      );
    const entrega = await pedir({
      rpc: V23,
      metodo: "cash",
      opcao: "store-pickup",
      cupom: "ZEROUNICO",
      total: 0,
    });
    if (!entrega.linhas)
      f.push(`cupomUnicoNaoGasto: a vaga nao estava mais la: ${entrega.erro}`);
    else if ((await usosDoCupom("ZEROUNICO")) !== 1)
      f.push(
        "cupomUnicoNaoGasto: a compra na retirada nao gastou a vaga uma vez",
      );
    const outra = await pedir({
      rpc: V23,
      metodo: "cash",
      opcao: "store-pickup",
      cupom: "ZEROUNICO",
      total: 0,
    });
    if (outra.linhas || !/atingiu o limite de usos/.test(outra.erro ?? ""))
      f.push(
        `cupomUnicoNaoGasto: segundo uso devia bater no limite: ${outra.erro}`,
      );
    return f;
  },
  /** (e) total divergente recebe a recusa de sempre: a trava do preco adulterado vem ANTES da nova. */
  async totalDivergente() {
    const antes = await foto();
    const r = await pedir({ cupom: "ZEROUNICO", total: 50 });
    const f = [];
    if (r.linhas)
      f.push("totalDivergente: o pedido com total adulterado nasceu");
    else if (!String(r.erro).startsWith(MSG_DIVERGENTE))
      f.push(`totalDivergente: mensagem inesperada: ${r.erro}`);
    const depois = await foto();
    for (const campo of Object.keys(antes))
      if (depois[campo] !== antes[campo])
        f.push(`totalDivergente: ${campo} mexeu`);
    return f;
  },
};

/** Roda TODAS as verificacoes sobre o que estiver vivo, uma transacao por verificacao; devolve as falhas. */
async function todasAsVerificacoes(montarEstado) {
  const falhas = [];
  for (const [nome, check] of Object.entries(CHECKS)) {
    await C.query("BEGIN");
    try {
      await montarEstado();
      await semear();
      for (const f of await check()) falhas.push(f);
    } catch (e) {
      falhas.push(`${nome}: EXCECAO ${e.message}`);
    } finally {
      await C.query("ROLLBACK");
    }
  }
  return falhas;
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com o corpo antigo (o da 20261229, byte a byte) o pedido de R$ 0,00 pelo app NASCE: aguardando, com a reserva de 30 minutos, baixando o estoque e gastando a vaga do cupom de uso unico (o defeito)",
  () =>
    emTransacao(async () => {
      assert.equal(await prosrcVivo(V24), ANTIGA.corpo);
      assert.deepEqual(await acl(V24), ACL_DE_SEMPRE);
      await semear();
      const antes = await foto();
      const r = await pedir({ cupom: "ZEROUNICO", total: 0 });
      assert.ok(r.linhas, `o controle devia nascer: ${r.erro}`);
      const o = await lerPedido(r.linhas[0].id);
      assert.equal(Number(o.total), 0);
      assert.equal(o.payment_method, "online");
      assert.equal(o.payment_status, "aguardando");
      assert.ok(o.expires_at, "sem a reserva de 30 minutos");
      const depois = await foto();
      assert.equal(depois.estoque, antes.estoque - 1, "baixou o estoque");
      assert.equal(
        depois.usosDoCupom,
        1,
        "gastou a vaga do cupom de uso unico",
      );
      assert.ok(depois.ticks > antes.ticks, "a sonda de ordem nao andou");
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: zero + app recusa (frase, identificador, nada reservado nem gasto; a sonda de ordem nao anda); zero + retirada/entrega nasce como hoje; positivo + app nasce como hoje (inclusive R$ 0,01 e o total do servidor R$ 0,04); o cupom de uso unico nao e' gasto na recusa; total divergente recebe a recusa de sempre",
  async () => {
    const falhas = await todasAsVerificacoes(instalarNova);
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

prova(
  "DEPOIS: pedido de R$ 0,00 pelo app que JA nasceu (antes da migration) e' devolvido na retentativa com a mesma chave, sem recusa; chave nova recusa",
  () =>
    emTransacao(async () => {
      await semear();
      const chave = crypto.randomUUID();
      const nasceu = await pedir({ cupom: "ZEROUNICO", total: 0, chave });
      assert.ok(nasceu.linhas, `o pedido antigo devia nascer: ${nasceu.erro}`);
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(V24), H_NOVO);
      const retentativa = await pedir({ cupom: "ZEROUNICO", total: 0, chave });
      assert.ok(
        retentativa.linhas,
        `a retentativa foi recusada: ${retentativa.erro}`,
      );
      assert.equal(retentativa.linhas[0].id, nasceu.linhas[0].id);
      // (o cupom de uso unico ja foi gasto pelo pedido antigo; a chave nova usa o de 100%)
      const nova = await pedir({ cupom: "ZEROPCT", total: 0 });
      assert.equal(nova.erro, FRASE, "a chave nova devia ser recusada");
    }),
);

// ---------------------------------------------------------------------------
// INTACTO: o resto do caminho do dinheiro
// ---------------------------------------------------------------------------

/** Escrubar o que muda de execucao para execucao (ids novos, relogio): o resto tem de ser identico. */
function normalizar(v) {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        k === "coupon_id" ? x !== null : normalizar(x),
      ]),
    );
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return "<ts>";
  return v;
}

/** O mesmo roteiro de compras que passam (pelo app e na entrega, com e sem cupom, retirada, convidada). */
async function roteiro() {
  await semear();
  const passos = [
    { total: 100 },
    { cupom: "PARCIAL", total: 90 },
    { total: 100, opcao: "store-pickup" },
    { rpc: V23, metodo: "cash", total: 100 },
    { rpc: V23, metodo: "cash", cupom: "ZEROPCT", total: 0 },
    {
      rpc: V23,
      metodo: "pix",
      cupom: "ZEROUNICO",
      total: 0,
      opcao: "store-pickup",
    },
    {
      uid: "",
      papel: "anon",
      dados: DIGITADO,
      cep: DIGITADO.cep,
      total: 100,
    },
  ];
  const pedidos = [];
  for (const [i, p] of passos.entries()) {
    const r = await pedir({
      ...p,
      chave: `7e7e2360-0000-4000-8000-00000000c0${i}${i}`,
    });
    assert.ok(r.linhas, `roteiro passo ${i}: ${r.erro}`);
    const o = await lerPedido(r.linhas[0].id);
    const itens = (
      await C.query(
        "SELECT to_jsonb(i) - 'id' - 'order_id' AS i FROM public.marketplace_order_items i WHERE i.order_id = $1 ORDER BY i.product_id",
        [r.linhas[0].id],
      )
    ).rows.map((x) => x.i);
    pedidos.push({
      pedido: normalizar({ ...o, id: "<id>" }),
      itens: normalizar(itens),
    });
  }
  const cupons = (
    await C.query("SELECT code, usage_count FROM public.coupons ORDER BY code")
  ).rows;
  return { pedidos, estoque: await estoque(), cupons };
}

prova(
  "INTACTO: o MESMO roteiro de compras que passam (pelo app e na entrega, com e sem cupom, retirada, convidada) grava linhas identicas no estado ANTES e no DEPOIS — total, subtotal, frete, desconto, cupom, itens, estoque, uso do cupom",
  async () => {
    const antes = await emTransacao(roteiro, { estado: "antes" });
    const depois = await emTransacao(roteiro, { estado: "depois" });
    assert.equal(
      antes.estoque,
      1000 - 7,
      "o roteiro baixou o estoque (7 pedidos)",
    );
    assert.deepEqual(depois, antes);
  },
);

/** O que a migration nao pode tocar: ACL de TODA funcao e tabela de public, e o corpo de toda funcao. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  return { funcoes, tabelas };
}

prova(
  "SO O CORPO: aplicar a migration muda SO o corpo da v24 (nenhuma outra funcao — a v23 inclusive —, nenhuma tabela, nenhuma ACL); oid, ACL, atributos e assinatura ficam; o corpo novo e' o antigo mais o bloco 6-ter",
  () =>
    emTransacao(async () => {
      const antes = await retratoDoSchema();
      const v23Antes = await hashVivo(V23);
      const oid = await oidVivo(V24);
      const aclAntes = await aclBruto(V24);
      assert.equal(await aplicar(MIGRATION), null);
      const depois = await retratoDoSchema();
      assert.deepEqual(depois.tabelas, antes.tabelas, "ACL de tabela mudou");
      assert.equal(depois.funcoes.length, antes.funcoes.length);
      const mudou = depois.funcoes.filter(
        (f, i) => JSON.stringify(f) !== JSON.stringify(antes.funcoes[i]),
      );
      assert.deepEqual(
        mudou.map((f) => f.f.replace(/\(.*$/, "")),
        [V24],
        "so a v24 pode mudar",
      );
      const velho = antes.funcoes.find((x) => x.f === mudou[0].f);
      assert.deepEqual(
        { ...mudou[0], corpo: 0 },
        { ...velho, corpo: 0 },
        "so o corpo muda (oid, ACL, atributos)",
      );
      assert.equal(await oidVivo(V24), oid);
      assert.equal(await aclBruto(V24), aclAntes);
      assert.deepEqual(await acl(V24), ACL_DE_SEMPRE);
      assert.equal(await prosrcVivo(V24), NOVA.corpo);
      assert.equal(await hashVivo(V24), H_NOVO);
      assert.equal(await hashVivo(V23), v23Antes, "a v23 foi tocada");
    }),
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------

const COND = "IF p_payment_method = 'online' AND v_calculated_total <= 0 THEN";
if (!MUTADO) assert.equal(NOVA.corpo.split(COND).length - 1, 1);
const TROCAS = {
  "sem a recusa (o corpo antigo)": null,
  "a recusa vem DEPOIS de reservar estoque e gastar o cupom (so antes do RETURN)":
    (c) => {
      const sem = c.replace(BLOCO, "");
      assert.notEqual(sem, c);
      return sem.replace(
        "\n    RETURN v_order_id;\nEND;\n",
        () => `\n${BLOCO}    RETURN v_order_id;\nEND;\n`,
      );
    },
  "a recusa vale tambem para pagar na retirada/entrega (sem a checagem do meio)":
    (c) => c.replace(COND, "IF v_calculated_total <= 0 THEN"),
  "o limite sobe para R$ 0,01 (recusa a borda)": (c) =>
    c.replace(
      COND,
      "IF p_payment_method = 'online' AND v_calculated_total <= 0.01 THEN",
    ),
  "decide pelo total que o CLIENTE mandou, nao pelo calculado": (c) =>
    c.replace(
      COND,
      "IF p_payment_method = 'online' AND p_total_amount <= 0 THEN",
    ),
  "so recusa quem tem conta (a convidada passa)": (c) =>
    c.replace(
      COND,
      "IF p_payment_method = 'online' AND v_user_id IS NOT NULL AND v_calculated_total <= 0 THEN",
    ),
};
const NOMES_ESPERADOS_VERMELHOS = {
  "sem a recusa (o corpo antigo)": ["zeroPeloApp", "cupomUnicoNaoGasto"],
  "a recusa vem DEPOIS de reservar estoque e gastar o cupom (so antes do RETURN)":
    ["zeroPeloApp"],
  "a recusa vale tambem para pagar na retirada/entrega (sem a checagem do meio)":
    ["zeroNaEntrega"],
  "o limite sobe para R$ 0,01 (recusa a borda)": ["positivoPeloApp"],
  "decide pelo total que o CLIENTE mandou, nao pelo calculado": [
    "positivoPeloApp",
  ],
  "so recusa quem tem conta (a convidada passa)": ["zeroPeloApp"],
};

for (const [nome, troca] of Object.entries(TROCAS)) {
  prova(`MUTANTE vermelho — ${nome}`, async () => {
    const instalar = async () => {
      await C.query(ROLLBACK);
      if (troca === null) return;
      const mutado = troca(NOVA.corpo);
      assert.notEqual(mutado, NOVA.corpo, "a sabotagem nao mudou o corpo");
      await C.query(decl(NOVA, mutado));
    };
    const falhas = await todasAsVerificacoes(instalar);
    assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
    for (const alvo of NOMES_ESPERADOS_VERMELHOS[nome]) {
      assert.ok(
        falhas.some((x) => x.startsWith(alvo)),
        `o mutante "${nome}" devia reprovar a verificacao "${alvo}"; reprovou: ${falhas.join(" | ")}`,
      );
    }
    console.log(
      `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
    );
  });
}

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, pre-voo, conferencia, atomicidade
// ---------------------------------------------------------------------------

const retrato = async () => ({
  h: await hashVivo(V24),
  src: sha256(await prosrcVivo(V24)),
  oid: await oidVivo(V24),
  acl: await aclBruto(V24),
});

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL); o rollback devolve o prosrc IDENTICO (md5 e sha256 do corpo da 20261229) e a mesma ACL, rodado 2x; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      const original = await retrato();
      assert.equal(original.src, sha256(ANTIGA.corpo));
      assert.equal(await aplicar(MIGRATION), null);
      const um = await retrato();
      assert.equal(um.h, H_NOVO);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "reaplicar mudou o estado");
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      const crlf = await retrato();
      assert.equal(crlf.h, H_NOVO, "CRLF: o hash (sem CR) tem de ser o mesmo");
      assert.equal(crlf.oid, um.oid);
      assert.equal(crlf.acl, um.acl);
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(
        await retrato(),
        original,
        "o rollback nao devolveu o estado original byte a byte",
      );
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(await retrato(), original, "rollback 2x");
      // Em CRLF o texto gravado leva os CR (o hash sem CR e' o mesmo; o sha256 do texto cru nao e').
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null);
      assert.equal(await hashVivo(V24), H_ANTIGO, "rollback em CRLF");
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retrato(), um, "ida, volta e ida");
    }),
);

const ESTADOS_RUINS = {
  "corpo desconhecido (v24 com um comentario a mais)": async () => {
    await C.query(
      decl(ANTIGA, `${ANTIGA.corpo}\n-- redefinicao que ninguem revisou\n`),
    );
  },
  "a loja ainda esta no corpo da 20261174 (sem a 20261229)": async () => {
    await C.query(decl(ANTIGA_174, ANTIGA_174.corpo));
  },
  "atributo diferente (v24 STABLE)": async () => {
    await C.query(`ALTER FUNCTION ${FN[V24]} STABLE`);
  },
  "sobrecarga (outra create_marketplace_order_v24)": async () => {
    await C.query(
      "CREATE FUNCTION public.create_marketplace_order_v24(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
  },
  "funcao ausente (v24 apagada)": async () => {
    await C.query(`DROP FUNCTION ${FN[V24]}`);
  },
  "ACL aberta (PUBLIC executa a v24)": async () => {
    await C.query(`GRANT EXECUTE ON FUNCTION ${FN[V24]} TO PUBLIC`);
  },
  "anon sem EXECUTE: o checkout da convidada quebraria": async () => {
    await C.query(`REVOKE EXECUTE ON FUNCTION ${FN[V24]} FROM anon`);
  },
};

prova(
  "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; nenhum corpo muda) e o rollback-manual tambem",
  () =>
    emTransacao(async () => {
      for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
        await C.query("SAVEPOINT ruim");
        await ruim();
        const antes = await prosrcVivo(V24);
        const erro = await aplicar(MIGRATION);
        assert.ok(erro, `${nome}: a migration devia recusar`);
        assert.match(
          erro.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: ${erro.erro}`,
        );
        assert.equal(
          await prosrcVivo(V24),
          antes,
          `${nome}: o pre-voo escreveu`,
        );
        const rb = await aplicar(ROLLBACK);
        assert.ok(rb, `${nome}: o rollback-manual devia recusar`);
        assert.match(
          rb.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: rollback: ${rb.erro}`,
        );
        assert.equal(
          await prosrcVivo(V24),
          antes,
          `${nome}: o pre-voo do rollback escreveu`,
        );
        await C.query("ROLLBACK TO SAVEPOINT ruim");
      }
    }),
);

const bloco = (sql, nome) => {
  const ini = sql.indexOf(`DO $${nome}$`);
  const fim = sql.indexOf(`END $${nome}$;`) + `END $${nome}$;`.length;
  assert.ok(ini >= 0 && fim > ini, `bloco ${nome} nao achado`);
  return sql.slice(ini, fim);
};
const CONFERENCIA = bloco(MIGRATION, "conferencia_20261236");
const CONFERENCIA_ROLLBACK = bloco(ROLLBACK, "conferencia_rollback_20261236");

prova(
  "MIGRATION: a conferencia final passa no estado novo e RECUSA corpo antigo, atributo mudado, PUBLIC aberto e anon sem EXECUTE; a do rollback passa no estado antigo e recusa o corpo novo",
  () =>
    emTransacao(async () => {
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(
        await aplicar(CONFERENCIA),
        null,
        "a conferencia reprovou o estado bom",
      );
      for (const [nome, estrago, padrao] of [
        [
          "corpo antigo",
          () => C.query(decl(ANTIGA, ANTIGA.corpo)),
          /corpo vivo de create_marketplace_order_v24/,
        ],
        [
          "atributo (v24 STABLE)",
          () => C.query(`ALTER FUNCTION ${FN[V24]} STABLE`),
          /atributos de create_marketplace_order_v24/,
        ],
        [
          "PUBLIC aberto",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN[V24]} TO PUBLIC`),
          /alcançável por PUBLIC/,
        ],
        [
          "anon sem EXECUTE",
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN[V24]} FROM anon`),
          /perdeu EXECUTE/,
        ],
      ]) {
        await C.query("SAVEPOINT estrago");
        await estrago();
        const erro = await aplicar(CONFERENCIA);
        assert.ok(erro, `${nome}: a conferencia devia recusar`);
        assert.match(erro.erro, /conferencia 20261236/);
        assert.match(erro.erro, padrao, nome);
        await C.query("ROLLBACK TO SAVEPOINT estrago");
      }
      // A conferencia do rollback: passa no estado antigo e recusa o novo
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await aplicar(CONFERENCIA_ROLLBACK), null);
      assert.equal(await aplicar(MIGRATION), null);
      const erro = await aplicar(CONFERENCIA_ROLLBACK);
      assert.ok(erro, "a conferencia do rollback devia recusar o corpo novo");
      assert.match(erro.erro, /conferencia rollback 20261236/);
    }),
);

prova(
  "MIGRATION: a conferencia reprovando DESFAZ a troca — uma migration cujo corpo novo sai com 1 byte a mais aborta na conferencia e a v24 fica como estava (o arquivo vai como UMA mensagem, uma transacao implicita)",
  async () => {
    const sabotada = MIGRATION.replace(decl(NOVA, NOVA.corpo), () =>
      decl(NOVA, `${NOVA.corpo}\n-- um byte a mais\n`),
    );
    assert.notEqual(sabotada, MIGRATION);
    // Fora de BEGIN: e' o protocolo simples com varios comandos numa mensagem so (o que o `pg` e o psql -1 mandam).
    const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await solto.connect();
    try {
      await solto.query(ROLLBACK); // estado ANTES, de verdade (clone descartavel)
      const lido = async () =>
        (
          await solto.query(
            "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FN[V24]],
          )
        ).rows[0].h;
      assert.equal(await lido(), H_ANTIGO);
      let erro = null;
      try {
        await solto.query(sabotada);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a migration sabotada devia abortar na conferencia");
      assert.match(
        erro.message,
        /conferencia 20261236: corpo vivo de create_marketplace_order_v24/,
      );
      assert.equal(
        await lido(),
        H_ANTIGO,
        "o CREATE OR REPLACE ficou gravado apesar da conferencia reprovar",
      );
      // E o arquivo de verdade aplica de fora de BEGIN e grava de uma vez
      await solto.query(MIGRATION);
      assert.equal(await lido(), H_NOVO);
    } finally {
      await solto.end();
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  let ok = 0;
  const falhas = [];
  // No modo mutante de arquivo roda SO a prova de comportamento (ver MUTADO).
  const lista = MUTADO
    ? PROVAS.filter((p) => p.nome.startsWith("DEPOIS: zero + app recusa"))
    : PROVAS;
  try {
    for (const { nome, corpo } of lista) {
      try {
        await corpo();
        ok++;
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push({ nome, erro: e });
        console.log(
          `  FALHOU  ${nome}\n      ${String(e.message).split("\n").join("\n      ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end();
  }
  console.log(`\n${ok}/${lista.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
