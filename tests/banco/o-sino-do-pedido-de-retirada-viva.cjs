"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste ou do catálogo do
 * Postgres efêmero; nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA da migration 20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql
 * (public.notifica_cliente_de_mudanca_de_status, a trigger tr_pedido_avisa_o_cliente) contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero (rpc-ci). O sino da cliente a cada mudança de status:
 *
 *   (1) pedido de RETIRADA NA LOJA (customer_data->>'shipping_option_id' = 'store-pickup'): em shipping o
 *       sino diz "Pedido pronto para retirar" e em delivered "Pedido retirado" (antes: "a caminho" e
 *       "entregue", que mandavam a cliente esperar em casa o que ela precisa buscar).
 *   (2) tudo o mais fica BYTE A BYTE como era: o pedido de entrega, o do balcão, o sem a chave, o com id
 *       parecido ("store-pickup " com espaço, "store-pickup-x", outra opção), o cancelamento nos dois fluxos,
 *       o preparo; convidado segue sem aviso; reaplicar o mesmo status não duplica o aviso; falha de inserir
 *       o aviso nunca derruba o pedido.
 *   (3) BORDAS do dado: customer_data que não é objeto (null, lista, texto), a chave nula, o id dentro de
 *       lista/objeto, só o endereço da loja sem o id; UPDATE de várias linhas (cada uma com o seu texto);
 *       status e customer_data mudando JUNTOS (vale o NEW); a linha de sino que JÁ existia antes da migration
 *       fica como está.
 *   (4) CONTROLE e MUTANTES: o corpo antigo (o rollback-manual aplicado numa transação desfeita) REPROVA a
 *       prova da retirada e IGUALA o novo em tudo o que não é retirada; cada guarda tirada do corpo novo deixa
 *       a prova correspondente vermelha.
 *   (5) a migration: pré-voo recusa sem escrever (corpo divergente, ACL, atributo, trigger fora do lugar,
 *       coluna ausente, sobrecarga); aplicar 2x = 1x; aplicar-desfazer-aplicar volta idêntico; o segundo
 *       rollback é no-op; ACL, atributos e dono iguais antes e depois; nenhuma linha de pedido nem de
 *       notificação muda ao aplicar; uma troca interrompida no meio não deixa nada; leitura concorrente nunca
 *       vê estado misto.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim.
 * SINO_SO=comportamento roda só os itens (0) e (1x) — usado para ver o VERMELHO do corpo vivo antes da
 * migration existir no banco; SINO_TODAS=1 não para na primeira que falhar.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-sino-do-pedido-de-retirada-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const NOME = "20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql";
const SO_COMPORTAMENTO = process.env.SINO_SO === "comportamento";
const FN = "public.notifica_cliente_de_mudanca_de_status()";

const U_CLIENTE = "e1e10000-0000-4000-8000-000000000001";
const U_OUTRA = "e1e10000-0000-4000-8000-000000000002";

// Os textos, escritos por extenso: o teste NUNCA os lê do arquivo da migration (senão um erro de
// digitação na migration passaria pela prova).
const PREPARO = [
  "info",
  "Pedido em preparo",
  "Seu pedido já está em preparo pela loja.",
];
const A_CAMINHO = ["info", "Pedido a caminho", "Seu pedido saiu para entrega!"];
const ENTREGUE = [
  "success",
  "Pedido entregue",
  "Seu pedido foi entregue. Obrigado por comprar com a gente!",
];
const PRONTO = [
  "info",
  "Pedido pronto para retirar",
  "Seu pedido está pronto! Venha retirar na loja.",
];
const RETIRADO = [
  "success",
  "Pedido retirado",
  "Seu pedido foi retirado na loja. Obrigado por comprar com a gente!",
];
const CANCELADO = [
  "warning",
  "Pedido cancelado",
  "Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.",
];
const FLUXO = ["processing", "shipping", "delivered"];

// O customer_data como a RPC create_marketplace_order_v24 o grava.
const DADOS_ENTREGA = {
  whatsapp: "(34) 99999-1234",
  address: { street: "Rua A", number: "1" },
  shipping_option_id: "local-delivery",
  destination_cep: "38400000",
};
const DADOS_RETIRADA = {
  whatsapp: "(34) 99999-1234",
  address: { street: "Rua A", number: "1" },
  shipping_option_id: "store-pickup",
  destination_cep: "38400000",
  pickup_address: "Rua da Loja, 100 - Centro",
};

async function inserirPedido(c, usuario, customerData, status = "pending") {
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method)
     VALUES ($1, 'Cliente Sino', $2::jsonb, 100, 100, $3, 'online', 'online')
     RETURNING id`,
    [usuario, JSON.stringify(customerData), status],
  );
  return r.rows[0].id;
}

async function mudar(c, id, status) {
  await c.query(
    "UPDATE public.marketplace_orders SET status = $2 WHERE id = $1",
    [id, status],
  );
}

/**
 * As linhas do sino do pedido, em ordem de nascimento: [tipo, titulo, mensagem]. Dentro de uma transação
 * o created_at é o mesmo para todas (now() é o da transação), então o desempate é a ORDEM DO FLUXO
 * (preparo, caminho/pronto, entregue/retirado, cancelado) — os fluxos desta prova só andam para a frente.
 */
async function sino(c, id) {
  const r = await c.query(
    `SELECT tipo, titulo, mensagem FROM public.notificacoes
      WHERE dados->>'order_id' = $1
      ORDER BY created_at,
               CASE titulo WHEN 'Pedido em preparo' THEN 1
                           WHEN 'Pedido a caminho' THEN 2 WHEN 'Pedido pronto para retirar' THEN 2
                           WHEN 'Pedido entregue' THEN 3 WHEN 'Pedido retirado' THEN 3
                           WHEN 'Pedido cancelado' THEN 4 ELSE 5 END, id`,
    [id],
  );
  return r.rows.map((l) => [l.tipo, l.titulo, l.mensagem]);
}

/** Cria o pedido, anda pelos status e devolve o sino. `customerData` é o objeto JS (ou o JSON cru, em string). */
async function fluxo(c, customerData, estados = FLUXO, usuario = U_CLIENTE) {
  const id = await inserirPedido(
    c,
    usuario,
    typeof customerData === "string" ? JSON.parse(customerData) : customerData,
  );
  for (const s of estados) await mudar(c, id, s);
  return { id, linhas: await sino(c, id) };
}

async function catalogo(c, assinatura = FN) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, prosecdef,
            coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

const PROVAS = [];
const fx = {};

// ---- as provas do comportamento, reexecutáveis (corpo novo, antigo e mutantes) ----------------------
const prova1a = async (c) => {
  const { linhas } = await fluxo(c, DADOS_ENTREGA);
  assert.deepStrictEqual(linhas, [PREPARO, A_CAMINHO, ENTREGUE]);
};
const prova1b = async (c) => {
  const { linhas } = await fluxo(c, DADOS_RETIRADA);
  assert.deepStrictEqual(linhas, [PREPARO, PRONTO, RETIRADO]);
};
const prova1c = async (c) => {
  // cancelar vale igual nos dois fluxos e em qualquer ponto
  for (const dados of [DADOS_ENTREGA, DADOS_RETIRADA]) {
    const rotulo = dados.shipping_option_id;
    assert.deepStrictEqual(
      (await fluxo(c, dados, ["cancelled"])).linhas,
      [CANCELADO],
      `${rotulo}: cancelado direto`,
    );
    assert.deepStrictEqual(
      (await fluxo(c, dados, ["processing", "cancelled"])).linhas,
      [PREPARO, CANCELADO],
      `${rotulo}: cancelado no preparo`,
    );
    const t = (await fluxo(c, dados, ["processing", "shipping", "cancelled"]))
      .linhas;
    assert.deepStrictEqual(
      t[0],
      PREPARO,
      `${rotulo}: o preparo antes do cancelamento`,
    );
    assert.deepStrictEqual(t[2], CANCELADO, `${rotulo}: cancelado no caminho`);
    // status sem frase (pending de volta) não inventa aviso
    const volta = await fluxo(c, dados, ["processing", "pending"]);
    assert.deepStrictEqual(volta.linhas, [PREPARO], `${rotulo}: pending`);
  }
};
// customer_data que NÃO é retirada, nas formas que existem no mundo real e nas que só a borda inventa
const NAO_RETIRADA = [
  ["objeto vazio", "{}"],
  ["json null", "null"],
  ["lista vazia", "[]"],
  ["texto solto", '"store-pickup"'],
  [
    "balcão (presencial, sem opção)",
    '{"whatsapp":"(34) 98888-0000","canal":"presencial"}',
  ],
  ["chave nula", '{"shipping_option_id":null}'],
  ["chave vazia", '{"shipping_option_id":""}'],
  ["id com espaço antes", '{"shipping_option_id":" store-pickup"}'],
  ["id com espaço depois", '{"shipping_option_id":"store-pickup "}'],
  ["id em outra caixa", '{"shipping_option_id":"Store-Pickup"}'],
  ["id com sufixo", '{"shipping_option_id":"store-pickup-x"}'],
  ["id com prefixo", '{"shipping_option_id":"x-store-pickup"}'],
  ["entrega local", '{"shipping_option_id":"local-delivery"}'],
  ["transportadora", '{"shipping_option_id":"sedex"}'],
  ["id numa lista", '{"shipping_option_id":["store-pickup"]}'],
  ["id num objeto", '{"shipping_option_id":{"id":"store-pickup"}}'],
  ["id num número", '{"shipping_option_id":1}'],
  ["só o endereço da loja, sem o id", '{"pickup_address":"Rua da Loja, 100"}'],
  ["o id na chave errada", '{"shippingOptionId":"store-pickup"}'],
];
const prova1d = async (c) => {
  for (const [rotulo, json] of NAO_RETIRADA) {
    const { linhas } = await fluxo(c, json);
    assert.deepStrictEqual(
      linhas,
      [PREPARO, A_CAMINHO, ENTREGUE],
      `"${rotulo}" não é retirada: o texto é o da entrega`,
    );
  }
};
const prova1d2 = async (c) => {
  // o contrato é o id: exato, sem o endereço junto (a RPC grava os dois, mas o id é o que manda)
  const { linhas } = await fluxo(c, '{"shipping_option_id":"store-pickup"}');
  assert.deepStrictEqual(linhas, [PREPARO, PRONTO, RETIRADO]);
};
const idempotencia = async (c, dados, esperado) => {
  {
    const id = await inserirPedido(c, U_CLIENTE, dados);
    await mudar(c, id, "processing");
    await mudar(c, id, "shipping");
    // o MESMO status de novo, de quatro jeitos: nenhum aviso a mais
    await mudar(c, id, "shipping");
    await c.query(
      "UPDATE public.marketplace_orders SET status = status WHERE id = $1",
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'shipping', notes = 'x' WHERE id = $1",
      [id],
    );
    await c.query(
      "UPDATE public.marketplace_orders SET notes = 'so a nota' WHERE id = $1",
      [id],
    );
    await c.query(
      `UPDATE public.marketplace_orders SET customer_data = customer_data || '{"obs":1}'::jsonb WHERE id = $1`,
      [id],
    );
    assert.deepStrictEqual(
      await sino(c, id),
      esperado,
      `${dados.shipping_option_id}: o aviso não pode duplicar`,
    );
  }
};
const prova1eEntrega = (c) =>
  idempotencia(c, DADOS_ENTREGA, [PREPARO, A_CAMINHO]);
const prova1eRetirada = (c) =>
  idempotencia(c, DADOS_RETIRADA, [PREPARO, PRONTO]);
const prova1e = async (c) => {
  await prova1eRetirada(c);
  await prova1eEntrega(c);
};
const prova1f = async (c) => {
  // convidado (sem conta): sem sino, sem erro, e o pedido anda
  for (const dados of [DADOS_RETIRADA, DADOS_ENTREGA]) {
    const id = await inserirPedido(c, null, dados);
    for (const s of FLUXO) await mudar(c, id, s);
    const r = await c.query(
      "SELECT status FROM public.marketplace_orders WHERE id = $1",
      [id],
    );
    assert.equal(r.rows[0].status, "delivered");
    assert.deepStrictEqual(await sino(c, id), []);
  }
};
const prova1g = async (c) => {
  // UPDATE de várias linhas de uma vez: cada linha com o SEU texto (o marcador é por linha, não por comando)
  const a = await inserirPedido(c, U_CLIENTE, DADOS_RETIRADA);
  const b = await inserirPedido(c, U_CLIENTE, DADOS_ENTREGA);
  const d = await inserirPedido(c, U_OUTRA, DADOS_RETIRADA);
  await c.query(
    "UPDATE public.marketplace_orders SET status = 'shipping' WHERE id = ANY($1::uuid[])",
    [[a, b, d]],
  );
  assert.deepStrictEqual(await sino(c, a), [PRONTO]);
  assert.deepStrictEqual(await sino(c, b), [A_CAMINHO]);
  assert.deepStrictEqual(await sino(c, d), [PRONTO]);
  await c.query(
    "UPDATE public.marketplace_orders SET status = 'delivered' WHERE id = ANY($1::uuid[])",
    [[a, b, d]],
  );
  assert.deepStrictEqual(await sino(c, a), [PRONTO, RETIRADO]);
  assert.deepStrictEqual(await sino(c, b), [A_CAMINHO, ENTREGUE]);
  assert.deepStrictEqual(await sino(c, d), [PRONTO, RETIRADO]);
};
const prova1h = async (c) => {
  // status E customer_data mudando JUNTOS: vale o NEW (o que o pedido É depois do update)
  const a = await inserirPedido(c, U_CLIENTE, DADOS_ENTREGA);
  await c.query(
    `UPDATE public.marketplace_orders
        SET status = 'shipping', customer_data = customer_data || '{"shipping_option_id":"store-pickup"}'::jsonb
      WHERE id = $1`,
    [a],
  );
  assert.deepStrictEqual(await sino(c, a), [PRONTO]);
  const b = await inserirPedido(c, U_CLIENTE, DADOS_RETIRADA);
  await c.query(
    `UPDATE public.marketplace_orders SET status = 'shipping', customer_data = '{}'::jsonb WHERE id = $1`,
    [b],
  );
  assert.deepStrictEqual(await sino(c, b), [A_CAMINHO]);
  // mudar SÓ o customer_data (sem status) não acende o sino
  const d = await inserirPedido(c, U_CLIENTE, DADOS_ENTREGA);
  await c.query(
    `UPDATE public.marketplace_orders SET customer_data = '{"shipping_option_id":"store-pickup"}'::jsonb WHERE id = $1`,
    [d],
  );
  assert.deepStrictEqual(await sino(c, d), []);
};
const prova1i = async (c) => {
  // o aviso é DESTA cliente e deste pedido, com o mesmo formato de dados de sempre
  const a = await inserirPedido(c, U_CLIENTE, DADOS_RETIRADA);
  await mudar(c, a, "shipping");
  const r = await c.query(
    "SELECT usuario_id, dados, lida FROM public.notificacoes WHERE dados->>'order_id' = $1",
    [a],
  );
  assert.equal(r.rowCount, 1);
  assert.equal(r.rows[0].usuario_id, U_CLIENTE);
  assert.deepStrictEqual(r.rows[0].dados, { order_id: a });
  assert.equal(r.rows[0].lida, false);
  const outra = await c.query(
    "SELECT count(*)::int AS n FROM public.notificacoes WHERE usuario_id = $1 AND dados->>'order_id' = $2",
    [U_OUTRA, a],
  );
  assert.equal(outra.rows[0].n, 0, "a outra cliente não recebe o aviso");
};
/** Roda `fn` e DESFAZ tudo: com SAVEPOINT quando já há transação aberta (as provas rodam dentro de numaTransacao), com BEGIN/ROLLBACK quando não. */
async function desfeito(c, fn) {
  if (c.dentroDeTransacao) {
    await c.query("SAVEPOINT desfeito_sino");
    try {
      return await fn();
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT desfeito_sino");
      await c.query("RELEASE SAVEPOINT desfeito_sino");
    }
  }
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
const prova1j = async (c) => {
  // best-effort: se o aviso NÃO consegue nascer, o pedido anda do mesmo jeito (e a falha só vira WARNING)
  await desfeito(c, async () => {
    await c.query(
      "ALTER TABLE public.notificacoes ADD CONSTRAINT sino_quebrado_de_proposito CHECK (false) NOT VALID",
    );
    const id = await inserirPedido(c, U_CLIENTE, DADOS_RETIRADA);
    try {
      await mudar(c, id, "shipping");
    } catch (erro) {
      assert.fail(`a falha do aviso derrubou o pedido: ${erro.message}`);
    }
    const r = await c.query(
      "SELECT status FROM public.marketplace_orders WHERE id = $1",
      [id],
    );
    assert.equal(r.rows[0].status, "shipping", "o pedido tem de andar");
    assert.deepStrictEqual(await sino(c, id), []);
  });
};
const PROVAS_DA_RETIRADA = [prova1b, prova1d2, prova1g, prova1h];

PROVAS.push({
  nome: "(0) fixtures: duas clientes com conta",
  corpo: async (c) => {
    for (const [id, email] of [
      [U_CLIENTE, "cliente@sino.teste"],
      [U_OUTRA, "outra@sino.teste"],
    ])
      await c.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
        [id, email],
      );
  },
});
PROVAS.push({
  nome: "(1a) entrega: preparo, a caminho e entregue com os textos de sempre (byte a byte)",
  corpo: prova1a,
});
PROVAS.push({
  nome: "(1b) RETIRADA: preparo, pronto para retirar e retirado — o sino fala de retirada",
  corpo: prova1b,
});
PROVAS.push({
  nome: "(1c) cancelar vale igual nos dois fluxos, em qualquer ponto; status sem frase não inventa aviso",
  corpo: prova1c,
});
PROVAS.push({
  nome: "(1d) BORDA: 19 formas de customer_data que NÃO são retirada (id com espaço, sufixo, caixa, lista, objeto, null, só o endereço...) seguem com o texto da entrega",
  corpo: prova1d,
});
PROVAS.push({
  nome: "(1d2) BORDA: o contrato é o id exato — 'store-pickup' sem o endereço junto ainda é retirada",
  corpo: prova1d2,
});
PROVAS.push({
  nome: "(1e) IDEMPOTÊNCIA: o mesmo status de novo (de quatro jeitos), nota e customer_data não duplicam o aviso — nos dois fluxos",
  corpo: prova1e,
});
PROVAS.push({
  nome: "(1f) convidado (sem conta) não recebe aviso e o pedido anda, nos dois fluxos",
  corpo: prova1f,
});
PROVAS.push({
  nome: "(1g) BORDA: UPDATE de várias linhas de uma vez — cada pedido com o SEU texto",
  corpo: prova1g,
});
PROVAS.push({
  nome: "(1h) BORDA: status e customer_data mudando juntos valem pelo NEW; só customer_data não avisa",
  corpo: prova1h,
});
PROVAS.push({
  nome: "(1i) o aviso é da cliente certa, do pedido certo, no formato de sempre (dados.order_id, não lida)",
  corpo: prova1i,
});
PROVAS.push({
  nome: "(1j) BEST-EFFORT: se o aviso não consegue nascer o pedido anda do mesmo jeito",
  corpo: prova1j,
});

async function montarCorpos() {
  if (fx.pronto) return;
  const mig = ler(NOME);
  const rb = ler(`rollback-manual-${NOME}`);
  const pares = (sql) => {
    const m = [
      ...sql.matchAll(
        /\('(public\.[a-z_0-9]+\(\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
      ),
    ];
    assert.equal(m.length, 1, "o preflight tem de citar UM par de hashes");
    assert.equal(m[0][1], FN, "o par de hashes e de outra funcao");
    return { vigente: m[0][2], desta: m[0][3] };
  };
  fx.mig = mig;
  fx.rb = rb;
  fx.h = pares(mig);
  const ini = mig.indexOf("CREATE OR REPLACE FUNCTION");
  fx.stmt = mig.slice(ini, mig.indexOf("\n$$;", ini) + "\n$$;".length);
  fx.pronto = true;
}

/** Roda `fn` com o `sql` aplicado numa transação que SEMPRE é desfeita. */
async function numaTransacao(c, sqls, fn) {
  await c.query("BEGIN");
  c.dentroDeTransacao = true;
  try {
    for (const sql of sqls) await c.query(sql);
    return await fn();
  } finally {
    c.dentroDeTransacao = false;
    await c.query("ROLLBACK");
  }
}

/** A prova `prova` PRECISA falhar com o corpo mutado: senão, o mutante sobreviveu. */
async function mataMutante(c, nome, sqls, prova) {
  let passou = false;
  try {
    await numaTransacao(c, sqls, prova);
    passou = true;
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      console.log(`    mutante morto: ${nome}`);
      return;
    }
    throw e;
  }
  assert.ok(!passou, `MUTANTE SOBREVIVEU: ${nome}`);
}

function mutar(stmt, de, para) {
  const n = stmt.split(de).length - 1;
  assert.equal(
    n,
    1,
    `o trecho do mutante tem de aparecer 1x (achei ${n}): ${de.slice(0, 50)}`,
  );
  return stmt.replace(de, () => para);
}

/** Tudo o que NÃO é retirada, numa foto só: o corpo antigo e o novo têm de dar a MESMA. */
async function fotoDoQueNaoMuda(c) {
  const foto = [];
  foto.push((await fluxo(c, DADOS_ENTREGA)).linhas);
  for (const [, json] of NAO_RETIRADA) foto.push((await fluxo(c, json)).linhas);
  for (const dados of [DADOS_ENTREGA, DADOS_RETIRADA]) {
    foto.push((await fluxo(c, dados, ["cancelled"])).linhas);
    foto.push((await fluxo(c, dados, ["processing", "cancelled"])).linhas);
    // passar por shipping é justamente o que a retirada muda; o resto do fluxo dela é igual
    if (dados === DADOS_ENTREGA)
      foto.push(
        (await fluxo(c, dados, ["processing", "shipping", "cancelled"])).linhas,
      );
    foto.push((await fluxo(c, dados, ["processing", "pending"])).linhas);
    foto.push((await fluxo(c, dados, ["processing"])).linhas);
  }
  return foto;
}

PROVAS.push({
  nome: "(2) O QUE JÁ EXISTIA NÃO MUDA: a linha de sino que nasceu antes da migration fica como está; só a mudança de status DEPOIS usa o texto novo",
  corpo: async (c) => {
    await montarCorpos();
    await numaTransacao(c, [fx.rb], async () => {
      // estado de ANTES da migration
      assert.equal((await catalogo(c)).hash, fx.h.vigente);
      const id = await inserirPedido(c, U_CLIENTE, DADOS_RETIRADA);
      await mudar(c, id, "shipping");
      assert.deepStrictEqual(
        await sino(c, id),
        [A_CAMINHO],
        "o defeito de antes",
      );
      const antes = await c.query(
        "SELECT md5(string_agg(n::text, '|' ORDER BY n.id)) AS h, count(*)::int AS n FROM public.notificacoes n",
      );
      // a migration entra
      await c.query(fx.mig);
      assert.equal((await catalogo(c)).hash, fx.h.desta);
      const depois = await c.query(
        "SELECT md5(string_agg(n::text, '|' ORDER BY n.id)) AS h, count(*)::int AS n FROM public.notificacoes n",
      );
      assert.deepStrictEqual(
        depois.rows[0],
        antes.rows[0],
        "aplicar a migration não pode tocar nenhuma notificação",
      );
      assert.deepStrictEqual(
        await sino(c, id),
        [A_CAMINHO],
        "o aviso antigo fica",
      );
      await mudar(c, id, "delivered");
      assert.deepStrictEqual(
        await sino(c, id),
        [A_CAMINHO, RETIRADO],
        "o aviso de depois usa o texto novo",
      );
    });
  },
});

PROVAS.push({
  nome: "(3) CONTROLE: o corpo ANTIGO (rollback-manual numa transacao desfeita) REPROVA as provas da retirada e IGUALA o novo em tudo o que nao e retirada; o corpo vivo volta a ser o novo depois",
  corpo: async (c) => {
    await montarCorpos();
    const novo = await fotoDoQueNaoMuda(c);
    const antigo = await numaTransacao(c, [fx.rb], async () => {
      assert.equal((await catalogo(c)).hash, fx.h.vigente);
      for (const [nome, prova] of [
        ["1b (retirada)", prova1b],
        ["1d2 (id sem endereço)", prova1d2],
        ["1g (várias linhas)", prova1g],
        ["1h (status e dados juntos)", prova1h],
        ["1e (idempotência da retirada)", prova1eRetirada],
      ])
        await assert.rejects(
          () => prova(c),
          (e) => e instanceof assert.AssertionError,
          `o corpo ANTIGO tinha de reprovar a prova ${nome}`,
        );
      // e o que o corpo antigo já fazia continua verdadeiro (a migration só troca a retirada)
      for (const p of [
        prova1a,
        prova1c,
        prova1d,
        prova1eEntrega,
        prova1f,
        prova1i,
        prova1j,
      ])
        await p(c);
      return fotoDoQueNaoMuda(c);
    });
    assert.deepStrictEqual(
      novo,
      antigo,
      "o sino do que não é retirada tem de ser igual ao do corpo antigo, byte a byte",
    );
    assert.equal((await catalogo(c)).hash, fx.h.desta);
    for (const p of [
      ...PROVAS_DA_RETIRADA,
      prova1a,
      prova1c,
      prova1d,
      prova1e,
      prova1f,
    ])
      await p(c);
  },
});

PROVAS.push({
  nome: "(3b) MUTANTES do corpo novo: cada guarda tirada deixa a prova correspondente vermelha",
  corpo: async (c) => {
    await montarCorpos();
    const s = fx.stmt;
    const m = (nome, de, para, prova) =>
      mataMutante(c, nome, [mutar(s, de, para)], () => prova(c));
    await m(
      "retirada nunca (volta o defeito do 'a caminho')",
      "v_retirada := COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup';",
      "v_retirada := false;",
      prova1b,
    );
    await m(
      "todo pedido vira retirada (a entrega leria 'pronto para retirar')",
      "v_retirada := COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup';",
      "v_retirada := true;",
      prova1a,
    );
    await m(
      "comparacao por prefixo em vez de exata ('store-pickup-x' viraria retirada)",
      "= 'store-pickup';",
      "LIKE 'store-pickup%';",
      prova1d,
    );
    await m(
      "comparacao sem a caixa exata ('Store-Pickup' viraria retirada)",
      "COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup'",
      "lower(COALESCE(NEW.customer_data ->> 'shipping_option_id', '')) = 'store-pickup'",
      prova1d,
    );
    await m(
      "comparacao com trim ('store-pickup ' com espaco viraria retirada)",
      "COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup'",
      "btrim(COALESCE(NEW.customer_data ->> 'shipping_option_id', '')) = 'store-pickup'",
      prova1d,
    );
    await m(
      "le o endereco da loja em vez do id (so o endereco bastaria)",
      "COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup'",
      "COALESCE(NEW.customer_data ->> 'pickup_address', '') <> ''",
      prova1d,
    );
    await m(
      "le o customer_data ANTIGO (OLD) em vez do novo",
      "COALESCE(NEW.customer_data ->> 'shipping_option_id', '')",
      "COALESCE(OLD.customer_data ->> 'shipping_option_id', '')",
      prova1h,
    );
    await m(
      "'retirado' so no pronto: o texto da entrega volta no delivered da retirada",
      "'Pedido retirado'",
      "'Pedido entregue'",
      prova1b,
    );
    await m(
      "texto do pronto trocado pelo da entrega",
      "'Pedido pronto para retirar'",
      "'Pedido a caminho'",
      prova1b,
    );
    await m(
      "sem a guarda de mudanca real (o mesmo status duplica o aviso)",
      "IF OLD.status IS NOT DISTINCT FROM NEW.status THEN",
      "IF false THEN",
      prova1e,
    );
    await m(
      "sem a guarda do convidado (user_id nulo tenta inserir e o sino quebra)",
      "IF NEW.user_id IS NULL THEN",
      "IF false THEN",
      prova1f,
    );
    await m(
      "sem o bloco protegido (a falha do aviso derruba o pedido)",
      "EXCEPTION WHEN OTHERS THEN",
      "EXCEPTION WHEN no_data_found THEN",
      prova1j,
    );
  },
});

// ---- a migration e as portas -------------------------------------------------------------------------
async function snapshotDosDados(c) {
  const r = await c.query(
    `SELECT (SELECT md5(coalesce(string_agg(o::text, '|' ORDER BY o.id), '')) FROM public.marketplace_orders o) AS pedidos,
            (SELECT md5(coalesce(string_agg(n::text, '|' ORDER BY n.id), '')) FROM public.notificacoes n) AS sino`,
  );
  return r.rows[0];
}

PROVAS.push({
  nome: "(4a) a migration e idempotente e reversivel: aplicar 2x = 1x, aplicar-desfazer-aplicar volta identico, o 2o rollback e no-op; ACL, atributos e dono iguais; nenhuma linha de pedido nem de sino muda",
  corpo: async (c) => {
    await montarCorpos();
    // fixtures que ja existem ANTES de aplicar: um pedido de retirada com sino do texto antigo
    const dadosAntes = await snapshotDosDados(c);
    const novo = await catalogo(c);
    assert.equal(novo.hash, fx.h.desta);
    await numaTransacao(c, [fx.rb], async () => {
      const antigo = await catalogo(c);
      assert.equal(antigo.hash, fx.h.vigente);
      // atributos, ACL e dono iguais nos dois corpos
      for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"])
        assert.deepStrictEqual(
          antigo[k],
          novo[k],
          `${k} mudou entre o corpo antigo e o novo`,
        );
      await c.query(fx.rb); // 2o rollback: no-op
      assert.equal((await catalogo(c)).hash, fx.h.vigente);
      const dadosDoAntigo = await snapshotDosDados(c);
      assert.deepStrictEqual(
        dadosDoAntigo,
        dadosAntes,
        "o rollback nao toca dado",
      );
      await c.query(fx.mig);
      await c.query(fx.mig); // aplicar 2x = 1x
      const depois = await catalogo(c);
      assert.deepStrictEqual(
        depois,
        novo,
        "aplicar-desfazer-aplicar nao volta ao mesmo catalogo",
      );
      assert.deepStrictEqual(
        await snapshotDosDados(c),
        dadosAntes,
        "aplicar a migration nao toca nenhuma linha",
      );
    });
    assert.deepStrictEqual(await catalogo(c), novo);
  },
});

PROVAS.push({
  nome: "(4b) o PRE-VOO recusa sem escrever: corpo divergente, ACL sem PUBLIC, atributo trocado, trigger fora do lugar, coluna ausente, sobrecarga; o rollback tambem",
  corpo: async (c) => {
    await montarCorpos();
    const recusa = async (
      rotulo,
      preparo,
      padrao,
      { rollbackTambem = false } = {},
    ) => {
      await c.query("BEGIN");
      try {
        await preparo();
        const antes = await catalogo(c);
        await c.query("SAVEPOINT b");
        await assert.rejects(c.query(fx.mig), padrao, `${rotulo}: migration`);
        await c.query("ROLLBACK TO SAVEPOINT b");
        assert.deepStrictEqual(
          await catalogo(c),
          antes,
          `${rotulo}: a migration escreveu`,
        );
        if (rollbackTambem) {
          await assert.rejects(
            c.query(fx.rb),
            /B1_BASELINE_DIVERGENT/,
            `${rotulo}: rollback`,
          );
          await c.query("ROLLBACK TO SAVEPOINT b");
          assert.deepStrictEqual(
            await catalogo(c),
            antes,
            `${rotulo}: o rollback escreveu`,
          );
        }
      } finally {
        await c.query("ROLLBACK");
      }
    };
    // 1. corpo divergente (um comentario a mais): nem a migration nem o rollback sobrescrevem
    await recusa(
      "corpo divergente",
      async () => {
        const corpo = (
          await c.query(
            "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
            [FN],
          )
        ).rows[0].prosrc;
        await c.query(
          `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$${corpo}\n-- a mais\n$f$`,
        );
      },
      /B1_BASELINE_DIVERGENT: corpo vivo de/,
      { rollbackTambem: true },
    );
    // 2. ACL sem PUBLIC
    await recusa(
      "ACL sem PUBLIC",
      () => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC`),
      /B1_BASELINE_DIVERGENT: ACL de/,
      { rollbackTambem: true },
    );
    // 3. atributo trocado
    await recusa(
      "SECURITY INVOKER",
      () => c.query(`ALTER FUNCTION ${FN} SECURITY INVOKER`),
      /B1_BASELINE_DIVERGENT: atributos de/,
      { rollbackTambem: true },
    );
    await recusa(
      "STABLE",
      () => c.query(`ALTER FUNCTION ${FN} STABLE`),
      /B1_BASELINE_DIVERGENT: atributos de/,
    );
    await recusa(
      "search_path trocado",
      () => c.query(`ALTER FUNCTION ${FN} SET search_path = public, pg_temp`),
      /B1_BASELINE_DIVERGENT: atributos de/,
    );
    // 4. a trigger fora do lugar: sem ela, ou em todas as colunas (nao so em status)
    await recusa(
      "trigger ausente",
      () =>
        c.query(
          "DROP TRIGGER tr_pedido_avisa_o_cliente ON public.marketplace_orders",
        ),
      /B1_BASELINE_DIVERGENT: a trigger tr_pedido_avisa_o_cliente/,
    );
    await recusa(
      "trigger em todas as colunas",
      async () => {
        await c.query(
          "DROP TRIGGER tr_pedido_avisa_o_cliente ON public.marketplace_orders",
        );
        await c.query(
          `CREATE TRIGGER tr_pedido_avisa_o_cliente AFTER UPDATE ON public.marketplace_orders
             FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        );
      },
      /B1_BASELINE_DIVERGENT: a trigger tr_pedido_avisa_o_cliente/,
    );
    // 5. coluna que o corpo grava ausente
    await recusa(
      "coluna ausente",
      () =>
        c.query(
          "ALTER TABLE public.notificacoes RENAME COLUMN mensagem TO mensagem_x",
        ),
      /B1_BASELINE_DIVERGENT: colunas que o corpo lê ou grava/,
    );
    // 6. sobrecarga
    await recusa(
      "sobrecarga",
      () =>
        c.query(
          "CREATE FUNCTION public.notifica_cliente_de_mudanca_de_status(p_x integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
        ),
      /B1_BASELINE_DIVERGENT: notifica_cliente_de_mudanca_de_status tem sobrecarga/,
      { rollbackTambem: true },
    );
    // 7. funcao ausente
    await recusa(
      "funcao ausente",
      async () => {
        await c.query(
          "DROP TRIGGER tr_pedido_avisa_o_cliente ON public.marketplace_orders",
        );
        await c.query(`DROP FUNCTION ${FN}`);
      },
      /B1_BASELINE_DIVERGENT: public\.notifica_cliente_de_mudanca_de_status\(\) não existe/,
    );
  },
});

PROVAS.push({
  nome: "(4c) uma troca interrompida no meio (erro depois do CREATE) nao deixa nada: o corpo antigo continua inteiro",
  corpo: async (c) => {
    await montarCorpos();
    await c.query("BEGIN");
    try {
      await c.query(fx.rb); // estado de antes
      assert.equal((await catalogo(c)).hash, fx.h.vigente);
      await c.query("SAVEPOINT meio");
      await assert.rejects(
        c.query(
          `${fx.mig}\nDO $$ BEGIN RAISE EXCEPTION 'falha no meio da troca'; END $$;`,
        ),
        /falha no meio da troca/,
      );
      await c.query("ROLLBACK TO SAVEPOINT meio");
      assert.equal(
        (await catalogo(c)).hash,
        fx.h.vigente,
        "a troca interrompida deixou o corpo novo",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal((await catalogo(c)).hash, fx.h.desta);
  },
});

PROVAS.push({
  nome: "(4d) CONCORRENCIA: enquanto outra sessao desfaz a troca numa transacao ABERTA, o UPDATE de status enxerga o corpo NOVO inteiro (nunca estado misto); depois do COMMIT, o antigo inteiro",
  corpo: async (c) => {
    await montarCorpos();
    const url = lerDatabaseUrlEfemera();
    const outra = new Client({ connectionString: url });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query(fx.rb);
      // a sessao `outra` ainda NAO commitou: aqui o corpo e o NOVO inteiro
      assert.equal((await catalogo(c)).hash, fx.h.desta);
      assert.deepStrictEqual((await fluxo(c, DADOS_RETIRADA)).linhas, [
        PREPARO,
        PRONTO,
        RETIRADO,
      ]);
      await outra.query("ROLLBACK");
      await outra.query("BEGIN");
      await outra.query(fx.rb);
      await outra.query("COMMIT");
      // depois do commit: o ANTIGO inteiro
      assert.equal((await catalogo(c)).hash, fx.h.vigente);
      assert.deepStrictEqual((await fluxo(c, DADOS_RETIRADA)).linhas, [
        PREPARO,
        A_CAMINHO,
        ENTREGUE,
      ]);
      // e a migration volta (a ordem do deploy: aplicar de novo)
      await outra.query("BEGIN");
      await outra.query(fx.mig);
      await outra.query("COMMIT");
      assert.equal((await catalogo(c)).hash, fx.h.desta);
      assert.deepStrictEqual((await fluxo(c, DADOS_RETIRADA)).linhas, [
        PREPARO,
        PRONTO,
        RETIRADO,
      ]);
    } finally {
      await outra.query("ROLLBACK").catch(() => {});
      await outra.end().catch(() => {});
    }
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  let falhas = 0;
  const provas = SO_COMPORTAMENTO
    ? PROVAS.filter((p) => /^\((0|1[a-j]\d?)\)/.test(p.nome))
    : PROVAS;
  try {
    for (const { nome, corpo } of provas) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        if (process.env.SINO_TODAS === "1") {
          falhas += 1;
          continue;
        }
        anexarAoSummary(
          "Prova viva do sino do pedido de retirada (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "O sino do pedido de retirada deixou de falar de retirada, ou o do resto mudou — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  if (falhas > 0)
    falhar("FALHOU", `${falhas} prova(s) falharam (SINO_TODAS=1).`);
  console.log(
    `\n[o-sino-do-pedido-de-retirada] ${provas.length}/${provas.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do sino do pedido de retirada (rpc-ci)",
    `${linhas.join("\n")}\n\n**${provas.length}/${provas.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
