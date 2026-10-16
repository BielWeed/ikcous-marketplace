"use strict";

/**
 * Prova VIVA da migration 20261229000000 (o endereço da compra fica no pedido: `create_marketplace_order_v23`
 * e `create_marketplace_order_v24` passam a COPIAR o endereço da conta para `customer_data.address` no instante
 * da compra; dado de cliente, caçada de 14/10/2026), num Postgres EFEMERO local, sem rede, com os papeis de
 * verdade (anon, authenticated, service_role).
 *
 * O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore pode ou nao ja ter a 20261229 (em
 * CI ela tem), TODO caso comeca pelo estado ANTES (o rollback-manual dela: CREATE OR REPLACE com os corpos
 * da 20261174, idempotente, conferido byte a byte contra o arquivo da 20261174) ou pelo estado DEPOIS (a
 * propria migration). Cada caso roda numa transacao que termina em ROLLBACK (o da concorrencia usa duas
 * conexoes reais, grava de verdade e fica no clone descartavel).
 *
 *  ANTES      controle: pelo caminho REAL do checkout (conta + `p_address_id`, `p_address_data` vazio ou so `{cpf}`)
 *             o pedido nasce SEM endereco dentro de `customer_data`; editar o endereco da conta muda o que o
 *             pedido mostra; apagar o endereco esvazia o pedido (o defeito).
 *  DEPOIS     v23 E v24: a cartao copia o endereco da conta (as 8 chaves, sem chave nula), com e sem CPF no
 *             `p_address_data`; editar o endereco da conta depois NAO muda o pedido; apagar NAO esvazia; o endereco
 *             de OUTRO usuario e' recusado antes de qualquer escrita; a CONVIDADA nunca dispara a copia (nem
 *             mandando o id do endereco de outra pessoa); a RETIRADA NA LOJA segue sem endereco e sem erro; o
 *             endereco digitado por quem tem conta NAO e' trocado; a retentativa com a mesma chave devolve o
 *             pedido que ja nasceu (a copia da primeira vez fica).
 *  INTACTO    total, subtotal, frete, desconto, cupom, estoque, itens: o MESMO roteiro, rodado no estado ANTES e no
 *             DEPOIS, devolve linhas identicas (so `customer_data.address` difere); o pedido que ja existia antes
 *             da migration continua byte a byte igual (sem backfill).
 *  SO O CORPO so o corpo das duas funcoes muda (nenhuma outra funcao, nenhuma tabela, nenhum dado, nenhuma
 *             ACL); o oid e a ACL ficam.
 *  MUTANTES   o mesmo comportamento esperado, rodado sobre corpos sabotados (sem a copia, sem a posse, a
 *             convidada copia, a copia sobrescreve o digitado, a retirada copia, chave nula entra, sem `reference`),
 *             FICA VERMELHO. A sabotagem "so o filtro de dono da copia (o passo 1 de pe)" e' EQUIVALENTE (o passo 1
 *             recusa antes) e sobrevive de proposito: e' defesa em profundidade.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback devolve o `prosrc` IDENTICO (mesmo md5 e sha256) e a
 *             mesma ACL; o pre-voo recusa SEM escrever (corpo desconhecido, atributo diferente, sobrecarga,
 *             funcao ausente, ACL aberta, anon sem EXECUTE, coluna ausente); as conferencias finais recusam estado
 *             ruim; as duas trocas caem juntas ou nao caem.
 *  CONCORRENCIA o checkout NAO fica preso numa edicao em voo do endereco da conta (a leitura e' sem trava) e a
 *             copia e' o que estava COMMITADO naquele instante.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/endereco-no-pedido-viva.cjs
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
const {
  desfazerEntregaNaCidadeNaTransacao,
} = require("./a-loja-escolhe-como-entrega-posterior.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ = "20261229000000_o_endereco_da_compra_fica_no_pedido.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const VIVA_174 = fs.readFileSync(
  path.join(MIGRATIONS, "20261174000000_formas_de_pagamento_por_loja.sql"),
  "utf8",
);
// A SUCESSORA da v24 (20261236000000: a recusa do total zero pelo app): so o rollback-manual dela entra aqui.
const ROLLBACK_DA_SUCESSORA = fs.readFileSync(
  path.join(
    MIGRATIONS,
    "rollback-manual-20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql",
  ),
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

// Os corpos ANTIGOS sao os da 20261174, LIDOS DO ARQUIVO, nunca copiados para ca.
const ANTIGA = {
  [V23]: funcaoDe(VIVA_174, V23),
  [V24]: funcaoDe(VIVA_174, V24),
};
const NOVA = {
  [V23]: funcaoDe(MIGRATION, V23),
  [V24]: funcaoDe(MIGRATION, V24),
};
const ROLL = { [V23]: funcaoDe(ROLLBACK, V23), [V24]: funcaoDe(ROLLBACK, V24) };
const H_ANTIGO = {
  [V23]: "59cbccc4aa8762a26cf98f2acf1c721a",
  [V24]: "8381691b7a03a9b232d21de8d756991d",
};
const H_NOVO = { [V23]: md5(NOVA[V23].corpo), [V24]: md5(NOVA[V24].corpo) };
for (const fn of [V23, V24]) {
  assert.equal(
    md5(ANTIGA[fn].corpo),
    H_ANTIGO[fn],
    `o corpo da 20261174 de ${fn} mudou`,
  );
  assert.equal(
    ROLL[fn].corpo,
    ANTIGA[fn].corpo,
    `o rollback de ${fn} nao e o corpo da 20261174 byte a byte`,
  );
  assert.equal(
    ROLL[fn].cabeca,
    ANTIGA[fn].cabeca,
    `a declaracao do rollback de ${fn} mudou`,
  );
  assert.equal(
    NOVA[fn].cabeca,
    ANTIGA[fn].cabeca,
    `a declaracao de ${fn} mudou (assinatura, atributos)`,
  );
}

// O corpo NOVO = o antigo + UM bloco, antes do passo 7, e mais nada.
const ANCORA = "    -- 7. Create Order Header\n    BEGIN\n";
const iniBloco = NOVA[V24].corpo.indexOf(
  "    -- 6-bis. O ENDEREÇO DA COMPRA FICA NO PEDIDO",
);
assert.ok(iniBloco > 0, "o bloco 6-bis nao esta no corpo novo");
const BLOCO = NOVA[V24].corpo.slice(iniBloco, NOVA[V24].corpo.indexOf(ANCORA));
for (const fn of [V23, V24]) {
  assert.equal(ANTIGA[fn].corpo.split(ANCORA).length - 1, 1);
  assert.equal(
    ANTIGA[fn].corpo.replace(ANCORA, BLOCO + ANCORA),
    NOVA[fn].corpo,
    `${fn}: o corpo novo nao e o antigo mais o bloco 6-bis, byte a byte`,
  );
}

const MSG_OUTRO = "Endereço inválido ou não pertence ao usuário.";
const ACL_DE_SEMPRE = [
  "anon=X/postgres",
  "authenticated=X/postgres",
  "postgres=X/postgres",
  "service_role=X/postgres",
];

const U = {
  dona: "7e7e2290-0000-4000-8000-0000000000d1",
  outra: "7e7e2290-0000-4000-8000-0000000000d2",
  admin: "7e7e2290-0000-4000-8000-0000000000a1",
};
const PROD = "7e7e2290-0000-4000-8000-0000000000f0";
const END = {
  casa: "7e7e2290-0000-4000-8000-0000000000e1", // da dona, completo
  minimo: "7e7e2290-0000-4000-8000-0000000000e2", // da dona, sem complemento nem referencia
  alheio: "7e7e2290-0000-4000-8000-0000000000e3", // da OUTRA
};
const CASA = {
  cep: "38500-100",
  street: "Rua Antiga",
  number: "10",
  complement: "Apto 1",
  neighborhood: "Centro",
  city: "Cidade Prova",
  state: "MG",
  reference: "Perto da praça",
};
const MINIMO = {
  cep: "38500-110",
  street: "Rua Simples",
  number: "20",
  neighborhood: "Bairro Dois",
  city: "Cidade Prova",
  state: "MG",
};
const CPF_VALIDO = "52998224725";

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
const hashes = async () => ({
  [V23]: await hashVivo(V23),
  [V24]: await hashVivo(V24),
});

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
      assert.deepEqual(await hashes(), H_ANTIGO, "o estado ANTES nao montou");
    } else if (estado === "depois") {
      await C.query(MIGRATION);
      assert.deepEqual(await hashes(), H_NOVO, "o estado DEPOIS nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o auth.uid() pedido; devolve as linhas (o erro sobe). */
async function como(papel, sql, params = [], uid = "", conexao = C) {
  await conexao.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
  if (papel) await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await conexao.query(sql, params)).rows;
  } finally {
    await conexao.query("RESET ROLE").catch(() => {});
  }
}
/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], uid = "", conexao = C) {
  await conexao.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, uid, conexao);
    await conexao.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await conexao.query("ROLLBACK TO SAVEPOINT tentativa");
    await conexao.query("RESET ROLE");
    return { erro: e.message, codigo: e.code, detalhe: e.detail };
  }
}

const SQL_PEDIDO = (rpc) =>
  `SELECT public.${rpc}($1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid, $6::text,
     'Comprador Prova', '5534999990000', NULL::text, $7::jsonb, $8::text, $9::text, $10::uuid) AS id`;

/**
 * Faz o pedido pelo CAMINHO REAL do checkout (`useOrders.createOrder`): v24 quando o pagamento e' online, v23 na
 * entrega; quem tem conta manda `addressId` e `addressData` = `{cpf}` ou nada (CheckoutView ~3568-3582); a
 * convidada manda o endereco digitado.
 */
async function pedir({
  rpc,
  uid = U.dona,
  papel = "authenticated",
  enderecoId = null,
  dados = null,
  opcao = "local-delivery",
  cupom = null,
  chave = crypto.randomUUID(),
  cep = "38500-100",
  total = cupom ? 90 : 100,
}) {
  const metodo = rpc === V24 ? "online" : "cash";
  return tentar(
    papel,
    SQL_PEDIDO(rpc),
    [
      JSON.stringify([{ product_id: PROD, variant_id: null, quantity: 1 }]),
      total,
      0,
      metodo,
      enderecoId,
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
const enderecoDoPedido = async (id) =>
  (await lerPedido(id)).customer_data.address;
const contarPedidos = async (uid) =>
  Number(
    (
      await C.query(
        "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE user_id = $1",
        [uid],
      )
    ).rows[0].n,
  );
const estoque = async () =>
  Number(
    (await C.query("SELECT estoque FROM public.produtos WHERE id = $1", [PROD]))
      .rows[0].estoque,
  );

/** Pessoas, produto, loja e enderecos dentro da transacao do caso. */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@29.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Dona Prova', 'customer'), ($2, 'Outra Prova', 'customer'), ($3, 'Admin Prova', 'admin')`,
    [U.dona, U.outra, U.admin],
  );
  await C.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons,
        pagamento_online, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true,
        true, 'Rua da Loja, 100 - Centro', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons, pagamento_online = EXCLUDED.pagamento_online,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Azul 29', 100, 1000, true, 40, false)",
    [PROD],
  );
  const ins = (id, uid, nome, e, extra) =>
    C.query(
      `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, complement,
                                          neighborhood, city, state, reference, is_default)
       VALUES ($1, $2, $3, 'Dona Prova', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        uid,
        nome,
        e.cep,
        e.street,
        e.number,
        e.complement ?? null,
        e.neighborhood,
        e.city,
        e.state,
        e.reference ?? null,
        extra,
      ],
    );
  await ins(END.casa, U.dona, "Casa", CASA, true);
  await ins(END.minimo, U.dona, "Trabalho", MINIMO, false);
  await ins(
    END.alheio,
    U.outra,
    "Casa da outra",
    { ...CASA, street: "Rua da Outra Pessoa", number: "77" },
    true,
  );
}

async function novoCupom() {
  const codigo = "ENDERECOPROVA";
  await C.query(
    `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
     VALUES ($1, 'fixed', 10, true, 0, 5)`,
    [codigo],
  );
  return codigo;
}

/** Escreve (no estado em que estiver) o endereco da casa, como a cliente faria no perfil. */
const editarCasa = () =>
  C.query(
    `UPDATE public.user_addresses
        SET street = 'Rua Nova da Mudanca', number = '999', cep = '38500-200', complement = NULL, reference = NULL
      WHERE id = $1`,
    [END.casa],
  );
const apagarCasa = () =>
  C.query("DELETE FROM public.user_addresses WHERE id = $1", [END.casa]);

// ---------------------------------------------------------------------------
// O COMPORTAMENTO esperado — uma verificacao por chave; devolve a lista de falhas (vazia = passou). E' a
// MESMA que roda sobre o corpo certo (tem de dar vazio) e sobre cada mutante (tem de dar nao vazio).
// ---------------------------------------------------------------------------
const CHECKS = {
  /** conta + `p_address_id`, com e sem CPF/objeto vazio em `p_address_data`: a copia das 8 chaves, e so ela. */
  async copia(rpc) {
    const f = [];
    for (const [rotulo, dados] of [
      ["sem p_address_data", null],
      ["so {cpf}", { cpf: CPF_VALIDO }],
      ["objeto vazio", {}],
    ]) {
      const r = await pedir({ rpc, enderecoId: END.casa, dados });
      if (!r.linhas) {
        f.push(`copia(${rotulo}): o pedido foi recusado: ${r.erro}`);
        continue;
      }
      const cd = (await lerPedido(r.linhas[0].id)).customer_data;
      try {
        assert.deepEqual(cd.address, CASA);
      } catch {
        f.push(
          `copia(${rotulo}): customer_data.address = ${JSON.stringify(cd.address)}`,
        );
      }
      if (cd.address_id !== END.casa)
        f.push(`copia(${rotulo}): customer_data.address_id = ${cd.address_id}`);
      if (cd.address && "cpf" in cd.address)
        f.push(`copia(${rotulo}): o CPF entrou no endereco`);
    }
    return f;
  },
  /** editar e apagar o endereco da conta DEPOIS da compra nao mexe no que o pedido guardou. */
  async depois(rpc) {
    const f = [];
    const r = await pedir({ rpc, enderecoId: END.casa });
    if (!r.linhas) return [`depois: o pedido foi recusado: ${r.erro}`];
    const id = r.linhas[0].id;
    await editarCasa();
    const apos = await lerPedido(id);
    try {
      assert.deepEqual(apos.customer_data.address, CASA);
    } catch {
      f.push(
        `depois(editar): o pedido passou a mostrar ${JSON.stringify(apos.customer_data.address)}`,
      );
    }
    await apagarCasa();
    const fim = await lerPedido(id);
    if (fim.address_id !== null)
      f.push(
        "depois(apagar): a FK ON DELETE SET NULL nao zerou address_id (premissa da prova)",
      );
    try {
      assert.deepEqual(fim.customer_data.address, CASA);
    } catch {
      f.push(
        `depois(apagar): o pedido ficou com ${JSON.stringify(fim.customer_data.address)}`,
      );
    }
    if (fim.customer_data.address_id !== END.casa)
      f.push("depois(apagar): customer_data.address_id sumiu");
    return f;
  },
  /** sem complemento e sem referencia: nenhuma chave nula (a forma que a convidada recebe). */
  async nulos(rpc) {
    const r = await pedir({ rpc, enderecoId: END.minimo, cep: MINIMO.cep });
    if (!r.linhas) return [`nulos: o pedido foi recusado: ${r.erro}`];
    const end = await enderecoDoPedido(r.linhas[0].id);
    try {
      assert.deepEqual(end, MINIMO);
      return [];
    } catch {
      return [`nulos: customer_data.address = ${JSON.stringify(end)}`];
    }
  },
  /** endereco de OUTRO usuario: recusado antes de escrever, nada de pedido, nada de estoque, nada copiado. */
  async outroUsuario(rpc) {
    const antes = {
      pedidos: await contarPedidos(U.dona),
      estoque: await estoque(),
    };
    const r = await pedir({ rpc, enderecoId: END.alheio, cep: CASA.cep });
    const f = [];
    if (r.linhas) {
      const end = await enderecoDoPedido(r.linhas[0].id);
      f.push(
        `outroUsuario: o pedido com o endereco ALHEIO foi aceito (customer_data.address = ${JSON.stringify(end)})`,
      );
      return f;
    }
    if (r.erro !== MSG_OUTRO)
      f.push(`outroUsuario: mensagem inesperada: ${r.erro}`);
    if ((await contarPedidos(U.dona)) !== antes.pedidos)
      f.push("outroUsuario: nasceu pedido");
    if ((await estoque()) !== antes.estoque)
      f.push("outroUsuario: o estoque mexeu");
    return f;
  },
  /** a CONVIDADA nunca dispara a copia, nem mandando o id do endereco de outra pessoa. */
  async convidada(rpc) {
    const f = [];
    const digitado = {
      cep: "38500-120",
      street: "Rua Digitada",
      number: "5",
      neighborhood: "Centro",
      city: "Cidade Prova",
      state: "MG",
    };
    for (const [rotulo, dados, esperado] of [
      ["id alheio + endereco digitado", digitado, digitado],
      ["id alheio sem endereco digitado", null, null],
    ]) {
      const r = await pedir({
        rpc,
        uid: "",
        papel: "anon",
        enderecoId: END.casa,
        dados,
        cep: rotulo.includes("sem") ? CASA.cep : digitado.cep,
      });
      if (!r.linhas) {
        f.push(`convidada(${rotulo}): recusada: ${r.erro}`);
        continue;
      }
      const end = await enderecoDoPedido(r.linhas[0].id);
      try {
        assert.deepEqual(end, esperado);
      } catch {
        f.push(
          `convidada(${rotulo}): customer_data.address = ${JSON.stringify(end)}`,
        );
      }
      if (JSON.stringify(end ?? null).includes("Rua Antiga"))
        f.push(`convidada(${rotulo}): copiou o endereco de outra pessoa`);
    }
    return f;
  },
  /** retirada na loja: sem endereco de entrega, com o retrato do endereco da LOJA, sem erro (com ou sem id). */
  async retirada(rpc) {
    const f = [];
    for (const [rotulo, enderecoId] of [
      ["com id do endereco", END.casa],
      ["sem id", null],
    ]) {
      const r = await pedir({ rpc, enderecoId, opcao: "store-pickup" });
      if (!r.linhas) {
        f.push(`retirada(${rotulo}): recusada: ${r.erro}`);
        continue;
      }
      const cd = (await lerPedido(r.linhas[0].id)).customer_data;
      if (cd.address !== null && cd.address !== undefined)
        f.push(
          `retirada(${rotulo}): ganhou endereco ${JSON.stringify(cd.address)}`,
        );
      if (cd.pickup_address !== "Rua da Loja, 100 - Centro")
        f.push(`retirada(${rotulo}): pickup_address = ${cd.pickup_address}`);
    }
    return f;
  },
  /** quem tem conta e mandou um endereco digitado de verdade: o que ela mandou fica. */
  async digitado(rpc) {
    const digitado = {
      cep: "38500-100",
      street: "Rua Digitada Pela Dona",
      number: "5",
      neighborhood: "Centro",
      city: "Cidade Prova",
      state: "MG",
    };
    const r = await pedir({ rpc, enderecoId: END.casa, dados: digitado });
    if (!r.linhas) return [`digitado: recusado: ${r.erro}`];
    const end = await enderecoDoPedido(r.linhas[0].id);
    try {
      assert.deepEqual(end, digitado);
      return [];
    } catch {
      return [`digitado: customer_data.address = ${JSON.stringify(end)}`];
    }
  },
  /** a retentativa com a MESMA chave devolve o pedido que ja nasceu; a copia da primeira vez fica. */
  async idempotencia(rpc) {
    const f = [];
    const chave = crypto.randomUUID();
    const a = await pedir({ rpc, enderecoId: END.casa, chave });
    if (!a.linhas) return [`idempotencia: ${a.erro}`];
    await editarCasa();
    const b = await pedir({
      rpc,
      enderecoId: END.casa,
      chave,
      cep: "38500-200",
    });
    if (!b.linhas) return [`idempotencia(retentativa): ${b.erro}`];
    if (a.linhas[0].id !== b.linhas[0].id)
      f.push("idempotencia: a retentativa criou outro pedido");
    try {
      assert.deepEqual(await enderecoDoPedido(a.linhas[0].id), CASA);
    } catch {
      f.push("idempotencia: a copia da primeira vez nao ficou");
    }
    if ((await contarPedidos(U.dona)) !== 1)
      f.push("idempotencia: ha mais de um pedido");
    return f;
  },
};

/** Roda TODAS as verificacoes sobre o que estiver vivo, uma transacao por verificacao x rpc; devolve as falhas. */
async function todasAsVerificacoes(montarEstado) {
  const falhas = [];
  for (const [nome, check] of Object.entries(CHECKS)) {
    for (const rpc of [V23, V24]) {
      await C.query("BEGIN");
      try {
        await montarEstado();
        await semear();
        for (const f of await check(rpc))
          falhas.push(`[${rpc.slice(-3)}] ${f}`);
      } catch (e) {
        falhas.push(`[${rpc.slice(-3)}] ${nome}: EXCECAO ${e.message}`);
      } finally {
        await C.query("ROLLBACK");
      }
    }
  }
  return falhas;
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: com os corpos antigos (os da 20261174, byte a byte), pelo caminho real do checkout o pedido de quem tem conta nasce SEM endereco; editar o endereco da conta muda o que o pedido mostra; apagar esvazia (o defeito) — nas DUAS funcoes",
  () =>
    emTransacao(async () => {
      assert.equal(await prosrcVivo(V23), ANTIGA[V23].corpo);
      assert.equal(await prosrcVivo(V24), ANTIGA[V24].corpo);
      assert.deepEqual(await acl(V23), ACL_DE_SEMPRE);
      assert.deepEqual(await acl(V24), ACL_DE_SEMPRE);
      await semear();
      for (const rpc of [V23, V24]) {
        const r = await pedir({
          rpc,
          enderecoId: END.casa,
          dados: { cpf: CPF_VALIDO },
        });
        assert.ok(r.linhas, `${rpc}: ${r.erro}`);
        const id = r.linhas[0].id;
        assert.equal(
          (await lerPedido(id)).customer_data.address ?? null,
          null,
          `${rpc}: o defeito: o pedido nasce sem endereco dentro de customer_data`,
        );
        // O que a tela e o painel leem (useOrders: JOIN com user_addresses por address_id)
        const leitura = () =>
          C.query(
            "SELECT to_jsonb(a) AS a FROM public.user_addresses a WHERE a.id = (SELECT address_id FROM public.marketplace_orders WHERE id = $1)",
            [id],
          ).then((x) => x.rows[0]?.a ?? null);
        assert.equal((await leitura()).street, "Rua Antiga");
        await editarCasa();
        assert.equal(
          (await leitura()).street,
          "Rua Nova da Mudanca",
          `${rpc}: editar muda o pedido (o defeito)`,
        );
        await apagarCasa();
        assert.equal(
          await leitura(),
          null,
          `${rpc}: apagar esvazia o pedido (o defeito)`,
        );
        // a casa volta para a proxima funcao
        await C.query(
          `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, complement, neighborhood, city, state, reference, is_default)
           VALUES ($1, $2, 'Casa', 'Dona Prova', $3, $4, $5, $6, $7, $8, $9, $10, true)`,
          [
            END.casa,
            U.dona,
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
      }
    }),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS (v23 e v24): copia o endereco da conta (as 8 chaves) com e sem CPF no p_address_data; editar e apagar depois nao mexem no pedido; sem chave nula; endereco de OUTRO usuario recusado antes de escrever; convidada nunca dispara a copia; retirada sem endereco e sem erro; endereco digitado nao e trocado; retentativa devolve o mesmo pedido",
  async () => {
    const falhas = await todasAsVerificacoes(async () => {
      await C.query(MIGRATION);
    });
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

// ---------------------------------------------------------------------------
// INTACTO: dinheiro, estoque, cupom, itens; pedido antigo
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

/** O mesmo roteiro de compras (conta com e sem cupom, na entrega e online, retirada, convidada); devolve o que ficou gravado. */
async function roteiro() {
  await semear();
  const cupom = await novoCupom();
  const chaves = ["a", "b", "c", "d", "e", "f"].map(
    (l) =>
      `7e7e2290-0000-4000-8000-00000000c0${"abcdef".indexOf(l)}${"abcdef".indexOf(l)}`,
  );
  const ids = [];
  const passos = [
    {
      rpc: V24,
      enderecoId: END.casa,
      dados: { cpf: CPF_VALIDO },
      cupom,
      chave: chaves[0],
    },
    { rpc: V23, enderecoId: END.casa, chave: chaves[1] },
    { rpc: V23, enderecoId: END.minimo, cep: MINIMO.cep, chave: chaves[2] },
    { rpc: V24, enderecoId: END.casa, opcao: "store-pickup", chave: chaves[3] },
    { rpc: V23, enderecoId: null, chave: chaves[4] },
    {
      rpc: V23,
      uid: "",
      papel: "anon",
      dados: {
        cep: "38500-120",
        street: "Rua Digitada",
        number: "5",
        neighborhood: "Centro",
        city: "Cidade Prova",
        state: "MG",
      },
      cep: "38500-120",
      chave: chaves[5],
    },
  ];
  for (const p of passos) {
    const r = await pedir(p);
    assert.ok(r.linhas, `roteiro: ${r.erro}`);
    ids.push(r.linhas[0].id);
  }
  const pedidos = [];
  for (const id of ids) {
    const o = await lerPedido(id);
    const { address, ...demais } = o.customer_data;
    const itens = (
      await C.query(
        "SELECT to_jsonb(i) - 'id' - 'order_id' AS i FROM public.marketplace_order_items i WHERE i.order_id = $1 ORDER BY i.product_id",
        [id],
      )
    ).rows.map((x) => x.i);
    pedidos.push({
      pedido: normalizar({ ...o, id: "<id>", customer_data: demais }),
      itens: normalizar(itens),
      endereco: address ?? null,
    });
  }
  const cupons = (
    await C.query("SELECT usage_count FROM public.coupons WHERE code = $1", [
      cupom,
    ])
  ).rows;
  return { pedidos, estoque: await estoque(), cupons };
}

prova(
  "INTACTO: o MESMO roteiro de compras (v23 e v24, com e sem cupom, retirada, convidada) grava linhas identicas no estado ANTES e no DEPOIS — total, subtotal, frete, desconto, cupom, itens, estoque, uso do cupom; so customer_data.address difere, e so no pedido de quem tem conta com endereco de entrega",
  async () => {
    const antes = await emTransacao(roteiro, { estado: "antes" });
    const depois = await emTransacao(roteiro, { estado: "depois" });
    assert.equal(
      antes.estoque,
      1000 - 6,
      "o roteiro baixou o estoque (6 pedidos)",
    );
    assert.equal(depois.estoque, antes.estoque, "estoque");
    assert.deepEqual(depois.cupons, antes.cupons, "uso do cupom");
    assert.deepEqual(
      depois.pedidos.map((p) => p.pedido),
      antes.pedidos.map((p) => p.pedido),
      "linhas do pedido (total, subtotal, frete, desconto, cupom, status, pagamento, customer_data sem o endereco)",
    );
    assert.deepEqual(
      depois.pedidos.map((p) => p.itens),
      antes.pedidos.map((p) => p.itens),
      "itens",
    );
    // So o endereco difere: no ANTES nenhum pedido de conta tinha; no DEPOIS os dois de entrega ganham a copia
    assert.deepEqual(
      antes.pedidos.map((p) => p.endereco),
      [null, null, null, null, null, antes.pedidos[5].endereco],
    );
    assert.equal(
      antes.pedidos[5].endereco.street,
      "Rua Digitada",
      "a convidada tem o que digitou",
    );
    assert.deepEqual(
      depois.pedidos.map((p) => p.endereco),
      [
        CASA, // v24 online, conta, com {cpf}
        CASA, // v23 na entrega, conta
        MINIMO, // v23, endereco minimo
        null, // retirada: sem endereco
        null, // conta sem id de endereco
        antes.pedidos[5].endereco, // convidada: igual a antes
      ],
    );
  },
);

prova(
  "INTACTO: o pedido que JA EXISTIA antes da migration (sem copia) continua byte a byte igual depois de aplicar — sem backfill; o apply nao toca dado nenhum",
  () =>
    emTransacao(async () => {
      await semear();
      const r = await pedir({ rpc: V23, enderecoId: END.casa });
      assert.ok(r.linhas, r.erro);
      const id = r.linhas[0].id;
      const dados = () =>
        C.query(
          `SELECT (SELECT md5(string_agg(o::text, '|' ORDER BY o.id::text)) FROM public.marketplace_orders o) AS pedidos,
                  (SELECT md5(string_agg(a::text, '|' ORDER BY a.id::text)) FROM public.user_addresses a) AS enderecos,
                  (SELECT md5(string_agg(i::text, '|' ORDER BY i.id::text)) FROM public.marketplace_order_items i) AS itens,
                  (SELECT md5(string_agg(p::text, '|' ORDER BY p.id::text)) FROM public.produtos p) AS produtos,
                  (SELECT count(*)::int FROM public.marketplace_orders) AS n`,
        ).then((x) => x.rows[0]);
      const antes = await dados();
      const linhaAntes = await lerPedido(id);
      assert.equal(linhaAntes.customer_data.address ?? null, null);
      const erro = await aplicar(MIGRATION);
      assert.equal(erro, null, JSON.stringify(erro));
      assert.deepEqual(await dados(), antes, "o apply tocou dado");
      assert.deepEqual(
        await lerPedido(id),
        linhaAntes,
        "o pedido antigo mudou",
      );
      assert.equal(
        (await lerPedido(id)).customer_data.address ?? null,
        null,
        "backfill indevido",
      );
    }),
);

// ---------------------------------------------------------------------------
// SO O CORPO
// ---------------------------------------------------------------------------

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
  "SO O CORPO: aplicar a migration muda SO o corpo de v23 e v24 (nenhuma outra funcao, nenhuma tabela, nenhuma ACL); oid, ACL, atributos e assinatura das duas ficam; o corpo novo e o antigo mais o bloco 6-bis",
  () =>
    emTransacao(async () => {
      const antes = await retratoDoSchema();
      const oids = { [V23]: await oidVivo(V23), [V24]: await oidVivo(V24) };
      const acls = { [V23]: await aclBruto(V23), [V24]: await aclBruto(V24) };
      const erro = await aplicar(MIGRATION);
      assert.equal(erro, null, JSON.stringify(erro));
      const depois = await retratoDoSchema();
      assert.deepEqual(depois.tabelas, antes.tabelas, "ACL de tabela mudou");
      const nomesDasDuas = new Set(
        [V23, V24].map((fn) =>
          FN[fn].replace("public.", "").replace(/\(.*$/, ""),
        ),
      );
      const mudou = depois.funcoes.filter(
        (f, i) => JSON.stringify(f) !== JSON.stringify(antes.funcoes[i]),
      );
      assert.equal(
        depois.funcoes.length,
        antes.funcoes.length,
        "nasceu ou sumiu funcao",
      );
      assert.deepEqual(
        mudou.map((f) => f.f.replace(/\(.*$/, "")).sort(),
        [...nomesDasDuas].sort(),
        "so as duas funcoes podem mudar",
      );
      for (const f of mudou) {
        const velho = antes.funcoes.find((x) => x.f === f.f);
        assert.deepEqual(
          { ...f, corpo: 0 },
          { ...velho, corpo: 0 },
          `${f.f}: so o corpo muda (oid, ACL, atributos)`,
        );
        assert.notEqual(f.corpo, velho.corpo);
      }
      for (const fn of [V23, V24]) {
        assert.equal(await oidVivo(fn), oids[fn], `${fn}: oid`);
        assert.equal(await aclBruto(fn), acls[fn], `${fn}: ACL bruta`);
        assert.deepEqual(await acl(fn), ACL_DE_SEMPRE);
        assert.equal(await prosrcVivo(fn), NOVA[fn].corpo);
        assert.equal(await hashVivo(fn), H_NOVO[fn]);
      }
    }),
);

// ---------------------------------------------------------------------------
// MUTANTES
// ---------------------------------------------------------------------------

const TROCAS = {
  "sem a copia (o corpo antigo)": null,
  "copia sem checar o dono (passo 1 sem a trava e a leitura sem o filtro de dono)":
    (c) =>
      c
        .replace(
          "IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN",
          "IF false THEN",
        )
        .replace(
          "WHERE ua.id = p_address_id AND ua.user_id = v_user_id;",
          "WHERE ua.id = p_address_id;",
        ),
  "a convidada tambem copia (sem exigir conta e sem o filtro de dono)": (c) =>
    c
      .replace(
        "       AND v_user_id IS NOT NULL\n       AND p_address_id IS NOT NULL",
        "       AND p_address_id IS NOT NULL",
      )
      .replace(
        "WHERE ua.id = p_address_id AND ua.user_id = v_user_id;",
        "WHERE ua.id = p_address_id;",
      ),
  "a copia sobrescreve o endereco digitado": (c) =>
    c.replace(
      "    IF v_address_data_sem_cpf IS NULL\n       AND v_user_id IS NOT NULL\n",
      "    IF v_user_id IS NOT NULL\n",
    ),
  "a retirada na loja tambem copia": (c) =>
    c.replace(
      "\n       AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN",
      " THEN",
    ),
  "chave nula entra (sem jsonb_strip_nulls)": (c) =>
    c.replace("jsonb_strip_nulls(jsonb_build_object(", "(jsonb_build_object("),
  "a copia esquece a referencia": (c) =>
    c.replace(",\n                   'reference', ua.reference\n", "\n"),
};
const NOMES_ESPERADOS_VERMELHOS = {
  "sem a copia (o corpo antigo)": ["copia", "depois", "nulos"],
  "copia sem checar o dono (passo 1 sem a trava e a leitura sem o filtro de dono)":
    ["outroUsuario"],
  "a convidada tambem copia (sem exigir conta e sem o filtro de dono)": [
    "convidada",
  ],
  "a copia sobrescreve o endereco digitado": ["digitado"],
  "a retirada na loja tambem copia": ["retirada"],
  "chave nula entra (sem jsonb_strip_nulls)": ["nulos"],
  "a copia esquece a referencia": ["copia", "depois"],
};

for (const [nome, troca] of Object.entries(TROCAS)) {
  prova(`MUTANTE vermelho — ${nome}`, async () => {
    const instalar = async () => {
      await C.query(ROLLBACK);
      if (troca === null) return;
      for (const fn of [V23, V24]) {
        const mutado = troca(NOVA[fn].corpo);
        assert.notEqual(
          mutado,
          NOVA[fn].corpo,
          `a sabotagem nao mudou o corpo de ${fn}`,
        );
        await C.query(decl(NOVA[fn], mutado));
      }
    };
    const falhas = await todasAsVerificacoes(instalar);
    assert.ok(falhas.length > 0, `o mutante "${nome}" NAO ficou vermelho`);
    for (const alvo of NOMES_ESPERADOS_VERMELHOS[nome]) {
      assert.ok(
        falhas.some(
          (x) => x.startsWith(`[v23] ${alvo}`) || x.startsWith(`[v24] ${alvo}`),
        ),
        `o mutante "${nome}" devia reprovar a verificacao "${alvo}"; reprovou: ${falhas.join(" | ")}`,
      );
    }
    console.log(
      `    (vermelho em ${falhas.length} verificacoes; ex.: ${falhas[0]})`,
    );
  });
}

prova(
  "MUTANTE equivalente VIVO — so o filtro de dono da leitura da copia (o passo 1 de pe): nada muda, o passo 1 recusa antes (defesa em profundidade, documentada)",
  async () => {
    const falhas = await todasAsVerificacoes(async () => {
      await C.query(ROLLBACK);
      for (const fn of [V23, V24]) {
        const mutado = NOVA[fn].corpo.replace(
          "WHERE ua.id = p_address_id AND ua.user_id = v_user_id;",
          "WHERE ua.id = p_address_id;",
        );
        assert.notEqual(mutado, NOVA[fn].corpo);
        await C.query(decl(NOVA[fn], mutado));
      }
    });
    assert.deepEqual(falhas, [], falhas.join("\n"));
  },
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, pre-voo, conferencia, atomicidade
// ---------------------------------------------------------------------------

const retratoDasDuas = async () => ({
  h: await hashes(),
  src: {
    [V23]: sha256(await prosrcVivo(V23)),
    [V24]: sha256(await prosrcVivo(V24)),
  },
  oid: { [V23]: await oidVivo(V23), [V24]: await oidVivo(V24) },
  acl: { [V23]: await aclBruto(V23), [V24]: await aclBruto(V24) },
});

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmo estado (hash, oid, ACL); o rollback devolve o prosrc IDENTICO (md5 e sha256 dos corpos da 20261174) e a mesma ACL, rodado 2x; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      const original = await retratoDasDuas();
      assert.equal(original.src[V23], sha256(ANTIGA[V23].corpo));
      assert.equal(await aplicar(MIGRATION), null);
      const um = await retratoDasDuas();
      assert.deepEqual(um.h, H_NOVO);
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retratoDasDuas(), um, "reaplicar mudou o estado");
      assert.equal(await aplicar(emCRLF(MIGRATION)), null);
      const crlf = await retratoDasDuas();
      assert.deepEqual(
        crlf.h,
        H_NOVO,
        "CRLF: o hash (sem CR) tem de ser o mesmo",
      );
      assert.deepEqual(crlf.oid, um.oid);
      assert.deepEqual(crlf.acl, um.acl);
      assert.equal(await aplicar(ROLLBACK), null);
      const volta = await retratoDasDuas();
      assert.deepEqual(
        volta,
        original,
        "o rollback nao devolveu o estado original byte a byte",
      );
      assert.equal(await aplicar(ROLLBACK), null);
      assert.deepEqual(await retratoDasDuas(), original, "rollback 2x");
      assert.equal(await aplicar(MIGRATION), null);
      assert.deepEqual(await retratoDasDuas(), um, "ida, volta e ida");
    }),
);

const MIGRATION_SEM_V24 = (() => {
  const f = NOVA[V24];
  return MIGRATION.replace(
    decl(f, f.corpo),
    "-- (v24 removida de proposito pela prova)",
  );
})();
assert.notEqual(
  MIGRATION_SEM_V24,
  MIGRATION,
  "a prova nao conseguiu tirar a v24 da migration",
);

const ESTADOS_RUINS = {
  "corpo desconhecido (v24 com um comentario a mais)": async () => {
    await C.query(
      decl(
        ANTIGA[V24],
        `${ANTIGA[V24].corpo}\n-- redefinicao que ninguem revisou\n`,
      ),
    );
  },
  "atributo diferente (v23 STABLE)": async () => {
    await C.query(`ALTER FUNCTION ${FN[V23]} STABLE`);
  },
  "sobrecarga (outra create_marketplace_order_v24)": async () => {
    await C.query(
      "CREATE FUNCTION public.create_marketplace_order_v24(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
  },
  "funcao ausente (v23 apagada)": async () => {
    await C.query(`DROP FUNCTION ${FN[V23]}`);
  },
  "ACL aberta (PUBLIC executa a v24)": async () => {
    await C.query(`GRANT EXECUTE ON FUNCTION ${FN[V24]} TO PUBLIC`);
  },
  "anon sem EXECUTE (v23): o checkout da convidada quebraria": async () => {
    await C.query(`REVOKE EXECUTE ON FUNCTION ${FN[V23]} FROM anon`);
  },
  "coluna ausente (user_addresses.reference)": async () => {
    await C.query(
      "ALTER TABLE public.user_addresses RENAME COLUMN reference TO referencia",
    );
  },
};

prova(
  "MIGRATION: o pre-voo recusa SEM escrever em cada estado ruim (B1_BASELINE_DIVERGENT; nenhum corpo muda)",
  () =>
    emTransacao(async () => {
      for (const [nome, ruim] of Object.entries(ESTADOS_RUINS)) {
        await C.query("SAVEPOINT ruim");
        await ruim();
        const antes = {
          a: await prosrcVivo(V23),
          b: await prosrcVivo(V24),
        };
        const erro = await aplicar(MIGRATION);
        assert.ok(erro, `${nome}: a migration devia recusar`);
        assert.match(
          erro.erro,
          /B1_BASELINE_DIVERGENT/,
          `${nome}: ${erro.erro}`,
        );
        assert.equal(
          await prosrcVivo(V23),
          antes.a,
          `${nome}: o pre-voo escreveu na v23`,
        );
        assert.equal(
          await prosrcVivo(V24),
          antes.b,
          `${nome}: o pre-voo escreveu na v24`,
        );
        // O rollback-manual tambem recusa corpo desconhecido / sobrecarga / ausente / ACL (nao reescreve por cima)
        if (!nome.startsWith("coluna")) {
          const rb = await aplicar(ROLLBACK);
          assert.ok(rb, `${nome}: o rollback-manual devia recusar`);
          assert.match(
            rb.erro,
            /B1_BASELINE_DIVERGENT/,
            `${nome}: rollback: ${rb.erro}`,
          );
        }
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
const CONFERENCIA = bloco(MIGRATION, "conferencia_20261229");

prova(
  "MIGRATION: a conferencia final passa no estado novo e RECUSA corpo antigo, atributo mudado, PUBLIC aberto e anon sem EXECUTE (por isso as duas trocas caem juntas se uma falhar)",
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
          "corpo antigo na v24",
          () => C.query(decl(ANTIGA[V24], ANTIGA[V24].corpo)),
          /corpo vivo de create_marketplace_order_v24/,
        ],
        [
          "atributo (v24 STABLE)",
          () => C.query(`ALTER FUNCTION ${FN[V24]} STABLE`),
          /atributos de create_marketplace_order_v24/,
        ],
        [
          "PUBLIC aberto (v23)",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN[V23]} TO PUBLIC`),
          /alcançável por PUBLIC/,
        ],
        [
          "anon sem EXECUTE (v24)",
          () => C.query(`REVOKE EXECUTE ON FUNCTION ${FN[V24]} FROM anon`),
          /perdeu EXECUTE/,
        ],
      ]) {
        await C.query("SAVEPOINT estrago");
        await estrago();
        const erro = await aplicar(CONFERENCIA);
        assert.ok(erro, `${nome}: a conferencia devia recusar`);
        assert.match(erro.erro, /conferencia 20261229/);
        assert.match(erro.erro, padrao, nome);
        await C.query("ROLLBACK TO SAVEPOINT estrago");
      }
    }),
);

prova(
  "MIGRATION: as duas trocas caem juntas — uma migration em que a v24 nao e trocada (a conferencia reprova) NAO deixa a v23 trocada (o arquivo vai como UMA mensagem, uma transacao implicita)",
  async () => {
    // Fora de BEGIN: e' o protocolo simples com varios comandos numa mensagem so (o que o `pg` e o psql -1 mandam).
    const solto = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await solto.connect();
    try {
      await solto.query(ROLLBACK); // estado ANTES, de verdade (clone descartavel)
      const lido = async (fn) =>
        (
          await solto.query(
            "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FN[fn]],
          )
        ).rows[0].h;
      assert.equal(await lido(V23), H_ANTIGO[V23]);
      let erro = null;
      try {
        await solto.query(MIGRATION_SEM_V24);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "a migration sem a v24 devia abortar na conferencia");
      assert.match(
        erro.message,
        /conferencia 20261229: corpo vivo de create_marketplace_order_v24/,
      );
      assert.equal(
        await lido(V23),
        H_ANTIGO[V23],
        "a v23 ficou trocada: as duas trocas NAO caem juntas",
      );
      assert.equal(await lido(V24), H_ANTIGO[V24]);
    } finally {
      await solto.end();
    }
  },
);

// ---------------------------------------------------------------------------
// CONCORRENCIA
// ---------------------------------------------------------------------------

prova(
  "CONCORRENCIA: com uma edicao do endereco da conta EM VOO (outra conexao, linha travada, nao commitada) o checkout nao fica preso (sem espera por trava) e a copia e' o que estava COMMITADO; depois do commit da edicao o pedido segue com a copia",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    try {
      await C.query(MIGRATION); // commitado: e' o estado DEPOIS, no clone descartavel
      // fixtures COMMITADAS e com ids proprios (a prova nao reaproveita as das outras)
      const u = "7e7e2290-0000-4000-8000-0000000000c1";
      const e = "7e7e2290-0000-4000-8000-0000000000c2";
      await C.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@29c.teste', '{}'::jsonb)",
        [u],
      );
      await C.query(
        "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Concorrente', 'customer')",
        [u],
      );
      await C.query(
        `INSERT INTO public.store_config (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, pagamento_online, enabled_shipping_methods)
         VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true, ARRAY['local-delivery'])
         ON CONFLICT (id) DO UPDATE SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           pagamento_online = true, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods`,
      );
      await C.query(
        "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Camiseta Concorrente', 100, 50, true, 40, false) ON CONFLICT (id) DO NOTHING",
        [PROD],
      );
      await C.query(
        `INSERT INTO public.user_addresses (id, user_id, name, recipient_name, cep, street, number, neighborhood, city, state, is_default)
         VALUES ($1, $2, 'Casa', 'Concorrente', '38500-100', 'Rua Commitada', '1', 'Centro', 'Cidade Prova', 'MG', true)`,
        [e, u],
      );
      await B.query("BEGIN");
      await B.query(
        "UPDATE public.user_addresses SET street = 'Rua Em Edicao', number = '2' WHERE id = $1",
        [e],
      );
      // A: o checkout, com teto de espera por trava de 3 s — se a copia travasse na linha editada, estouraria.
      await C.query("BEGIN");
      let pedido;
      try {
        await C.query("SET LOCAL lock_timeout = '3s'");
        pedido = await pedir({
          rpc: V24,
          uid: u,
          enderecoId: e,
          cep: "38500-100",
        });
        assert.ok(
          pedido.linhas,
          `o checkout travou ou falhou com a edicao em voo: ${pedido.erro}`,
        );
        await C.query("COMMIT");
      } catch (erro) {
        await C.query("ROLLBACK").catch(() => {});
        throw erro;
      }
      const id = pedido.linhas[0].id;
      const copia = await enderecoDoPedido(id);
      assert.equal(
        copia.street,
        "Rua Commitada",
        "a copia tem de ser o COMMITADO, nao a edicao em voo",
      );
      assert.equal(copia.number, "1");
      await B.query("COMMIT");
      assert.equal(
        (await enderecoDoPedido(id)).street,
        "Rua Commitada",
        "depois do commit da edicao o pedido segue com a copia",
      );
      assert.equal(
        (
          await C.query(
            "SELECT street FROM public.user_addresses WHERE id = $1",
            [e],
          )
        ).rows[0].street,
        "Rua Em Edicao",
      );
    } finally {
      await B.query("ROLLBACK").catch(() => {});
      await B.end();
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  let ok = 0;
  const falhas = [];
  try {
    // SUCESSORA: a 20261236000000 redefine a v24 em cima do corpo da 20261229. Esta prova mede a 20261229
    // isolada, entao desfaz a sucessora (pelo rollback-manual dela, que so reescreve o corpo e aceita os dois
    // corpos) no clone descartavel antes da primeira prova.
    // SUCESSORA: a 20261244000000 (a loja escolhe como entrega na cidade) redefine a v23 e a v24 em cima do corpo
    // desta migration. Esta prova mede a migration dela ISOLADA, entao desfaz a sucessora (pelo rollback-manual dela, que
    // so reescreve corpos, apaga a trigger e refaz a view) no clone descartavel antes da primeira prova.
    await desfazerEntregaNaCidadeNaTransacao(C);
    await C.query(ROLLBACK_DA_SUCESSORA);
    for (const { nome, corpo } of PROVAS) {
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
  console.log(`\n${ok}/${PROVAS.length} provas passaram.`);
  if (falhas.length) falhar("FALHOU", `${falhas.length} prova(s) reprovadas.`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
