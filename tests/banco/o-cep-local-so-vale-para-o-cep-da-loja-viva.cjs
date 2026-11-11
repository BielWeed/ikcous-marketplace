"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) de
 * public.is_local_cep(origem, destino, faixa) -- o portão de "entrega local"
 * (corpo vigente: baseline 20260806000000, nenhuma migration posterior a
 * redefine) -- contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 * Por que é dinheiro: a função decide (1) se um CONVIDADO pode comprar (só
 * entrega na cidade), (2) se uma loja com cobertura "só a cidade" aceita o
 * pedido, (3) o 'local-delivery' (taxa baixa ou grátis) e (4) o 'store-pickup'.
 * Devolver true demais deixa gente de outro estado comprar com entrega local e
 * a loja paga o envio; false demais recusa o cliente honesto no último clique.
 * Hoje só o espelho do front (cep-local-espelha-o-banco.test.ts) e vizinhos
 * que passam por um CEP local e um de fora guardam isso; nenhum derruba a
 * função valor por valor, nem na borda.
 *
 * CENÁRIOS (função direta, valores exatos; origem da loja 38500-000):
 *   A  sem faixa (NULL, '' ou só espaços): vale o prefixo automático de 5
 *      dígitos; com e sem máscara, em origem e destino
 *   B  CEP vazio/NULL/lixo/curto: nunca local, e a resposta é false (nunca NULL
 *      nem erro), com e sem faixa configurada
 *   C  faixa de 8+8 dígitos: bordas exatas inferior e superior, e um acima/abaixo
 *   D  faixa de 6+6 dígitos: o começo completa com 0 e o fim com 9
 *   E  faixa invertida (fim antes do começo) ainda vale
 *   F  par do placeholder do admin ("38500-000, 38500-999"): bordas e invertido
 *   G  CEP único, prefixo curto e lista de prefixos; lixo não casa nada
 * ponta a ponta (a RPC de pedido contra a loja SEM faixa, prefixo automático):
 *   H  v23 (convidado): CEP da loja nasce com frete R$ 20; CEP de outro estado e
 *      de outra cidade do mesmo estado são recusados, sem pedido nem baixa de estoque
 *   I  v24 (conta logada) com cobertura "só a cidade": CEP da loja nasce; CEP de
 *      outro estado e de outra cidade do mesmo estado são recusados, sem pedido
 *
 * Tudo numa transação DESFEITA, cada cenário num SAVEPOINT.
 *
 * MUTANTES: MUTANTE_R112D=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita); a execução TEM de ficar
 * vermelha, e vermelha no cenário que o nome promete. Nome desconhecido é ERRO.
 * Sem MUTANTE_R112D a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-cep-local-so-vale-para-o-cep-da-loja-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO = "Prova viva: CEP local só vale para o CEP da loja (rpc-ci)";
const FUNCAO = "public.is_local_cep(text,text,text)";
const ORIGEM = "38500-000";

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const ENTRADA_VAZIA =
  "IF v_origem = '' OR v_destino = '' THEN RETURN false; END IF;";
const PREFIXO_AUTOMATICO = "RETURN left(v_origem, 5) = left(v_destino, 5);";
const FAIXA_ACHOU = "IF v_destino_num BETWEEN v_inicio AND v_fim THEN";
const PAR_DO_PLACEHOLDER =
  "RETURN v_destino_num BETWEEN LEAST(v_a, v_b) AND GREATEST(v_a, v_b);";

const MUTANTES = {
  "cep-invalido-vira-local": {
    espera: ["B"],
    de: ENTRADA_VAZIA,
    para: "IF v_origem = '' OR v_destino = '' THEN RETURN true; END IF;",
  },
  "prefixo-curto-aceita-tudo": {
    espera: ["A", "H", "I"],
    de: PREFIXO_AUTOMATICO,
    para: "RETURN true;",
  },
  "prefixo-do-estado-vale-como-cidade": {
    espera: ["A", "H", "I"],
    de: PREFIXO_AUTOMATICO,
    para: "RETURN left(v_origem, 2) = left(v_destino, 2);",
  },
  "faixa-so-espacos-vira-faixa": {
    espera: ["A"],
    de: "IF p_local_cep_range IS NULL OR btrim(p_local_cep_range) = '' THEN",
    para: "IF p_local_cep_range IS NULL THEN",
  },
  "destino-com-mascara-nao-limpa": {
    espera: ["A"],
    de: "v_destino text := regexp_replace(COALESCE(p_dest_cep, ''), '\\D', '', 'g');",
    para: "v_destino text := COALESCE(p_dest_cep, '');",
  },
  "faixa-sem-borda-superior": {
    espera: ["C"],
    de: FAIXA_ACHOU,
    para: "IF v_destino_num >= v_inicio AND v_destino_num < v_fim THEN",
  },
  "faixa-sem-borda-inferior": {
    espera: ["C"],
    de: FAIXA_ACHOU,
    para: "IF v_destino_num > v_inicio AND v_destino_num <= v_fim THEN",
  },
  "fim-da-faixa-curta-completa-com-zero": {
    espera: ["D"],
    de: "v_b := rpad(v_partes[2], 8, '9')::numeric;",
    para: "v_b := rpad(v_partes[2], 8, '0')::numeric;",
  },
  "faixa-invertida-nao-ordena": {
    espera: ["E"],
    de: "v_inicio := LEAST(v_a, v_b);\n            v_fim := GREATEST(v_a, v_b);",
    para: "v_inicio := v_a;\n            v_fim := v_b;",
  },
  "par-sem-borda-superior": {
    espera: ["F"],
    de: PAR_DO_PLACEHOLDER,
    para: "RETURN v_destino_num >= LEAST(v_a, v_b) AND v_destino_num < GREATEST(v_a, v_b);",
  },
  "par-sem-borda-inferior": {
    espera: ["F"],
    de: PAR_DO_PLACEHOLDER,
    para: "RETURN v_destino_num > LEAST(v_a, v_b) AND v_destino_num <= GREATEST(v_a, v_b);",
  },
  "par-nao-ordena": {
    espera: ["F"],
    de: PAR_DO_PLACEHOLDER,
    para: "RETURN v_destino_num BETWEEN v_a AND v_b;",
  },
  "cep-unico-casa-so-o-prefixo": {
    espera: ["G"],
    de: "IF v_destino = v_token THEN RETURN true; END IF;",
    para: "IF left(v_destino, 5) = left(v_token, 5) THEN RETURN true; END IF;",
  },
  "prefixo-da-lista-aceita-tudo": {
    espera: ["G"],
    de: "ELSIF v_destino LIKE v_token || '%' THEN",
    para: "ELSIF v_destino LIKE '%' THEN",
  },
};

// ------------------------------------------------------------------ função

/** Chama a função; erro de SQL vira texto (a asserção o pega, o mutante não derruba o teste). */
async function cep(c, origem, destino, faixa) {
  await c.query("SAVEPOINT chamada");
  try {
    const r = await c.query(
      "SELECT public.is_local_cep($1::text, $2::text, $3::text) AS r",
      [origem, destino, faixa],
    );
    await c.query("RELEASE SAVEPOINT chamada");
    return r.rows[0].r;
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT chamada");
    await c.query("RELEASE SAVEPOINT chamada");
    return `ERRO SQL: ${erro.message}`;
  }
}

/** Cada caso: [origem, destino, faixa, esperado]. Para no primeiro que divergir, dizendo qual. */
async function confere(c, rotulo, casos) {
  for (const [origem, destino, faixa, esperado] of casos) {
    const visto = await cep(c, origem, destino, faixa);
    assert.strictEqual(
      visto,
      esperado,
      `[${rotulo}] is_local_cep(${JSON.stringify(origem)}, ${JSON.stringify(destino)}, ${JSON.stringify(faixa)})`,
    );
  }
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "A",
  nome: "A: sem faixa (NULL, '' ou espaços) vale o prefixo de 5 dígitos, com e sem máscara",
  corpo: async (c) => {
    for (const faixa of [null, "", "   "]) {
      const f = JSON.stringify(faixa);
      await confere(c, `A faixa ${f}`, [
        [ORIGEM, "38500-000", faixa, true],
        [ORIGEM, "38500-100", faixa, true],
        [ORIGEM, "38500-999", faixa, true],
        [ORIGEM, "38500100", faixa, true],
        [ORIGEM, "38.500-100", faixa, true],
        ["38500000", "38500-100", faixa, true],
        ["38.500-000", "38500-100", faixa, true],
        // outro estado, outra região, outra cidade do mesmo estado, e o vizinho
        // que só difere no 5º dígito (a fronteira do prefixo)
        [ORIGEM, "01310-100", faixa, false],
        [ORIGEM, "38400-100", faixa, false],
        [ORIGEM, "38510-000", faixa, false],
        [ORIGEM, "38501-000", faixa, false],
        [ORIGEM, "38499-999", faixa, false],
        [ORIGEM, "38180-000", faixa, false],
      ]);
    }
  },
});

CENARIOS.push({
  id: "B",
  nome: "B: CEP vazio, NULL, lixo ou curto demais nunca é local, e a resposta é false (nunca NULL nem erro)",
  corpo: async (c) => {
    for (const faixa of [null, "", "38500000-38505000", "38500"]) {
      const f = JSON.stringify(faixa);
      await confere(c, `B faixa ${f}`, [
        [ORIGEM, null, faixa, false],
        [ORIGEM, "", faixa, false],
        [ORIGEM, "   ", faixa, false],
        [ORIGEM, "abc", faixa, false],
        [ORIGEM, "---", faixa, false],
        [null, "38500-100", faixa, false],
        ["", "38500-100", faixa, false],
        ["  ", "38500-100", faixa, false],
        ["abc", "38500-100", faixa, false],
        [null, null, faixa, false],
        ["", "", faixa, false],
      ]);
    }
    // 4 dígitos nunca completam o prefixo de 5 da loja
    await confere(c, "B curto", [[ORIGEM, "3850", null, false]]);
  },
});

CENARIOS.push({
  id: "C",
  nome: "C: faixa 38500000-38505000: bordas exatas e um passo para fora de cada lado",
  corpo: async (c) => {
    const faixa = "38500000-38505000";
    await confere(c, "C", [
      [ORIGEM, "38500-000", faixa, true], // borda inferior
      [ORIGEM, "38499-999", faixa, false], // um antes
      [ORIGEM, "38505-000", faixa, true], // borda superior
      [ORIGEM, "38505-001", faixa, false], // um depois
      [ORIGEM, "38502-500", faixa, true],
      [ORIGEM, "38500000", faixa, true], // sem máscara
      [ORIGEM, "38505000", faixa, true],
      [ORIGEM, "38.502-500", faixa, true], // máscara com ponto
      [ORIGEM, "01310-100", faixa, false],
      // faixa + CEP único na mesma lista: os dois contam
      [ORIGEM, "38502-500", "38500000-38505000, 01000-000", true],
      [ORIGEM, "01000-000", "38500000-38505000, 01000-000", true],
      [ORIGEM, "01000-001", "38500000-38505000, 01000-000", false],
    ]);
  },
});

CENARIOS.push({
  id: "D",
  nome: "D: faixa 385000-385059: o começo completa com 0 (38500000) e o fim com 9 (38505999)",
  corpo: async (c) => {
    const faixa = "385000-385059";
    await confere(c, "D", [
      [ORIGEM, "38500-000", faixa, true],
      [ORIGEM, "38499-999", faixa, false],
      [ORIGEM, "38505-999", faixa, true], // o último CEP do 385059
      [ORIGEM, "38505-000", faixa, true],
      [ORIGEM, "38506-000", faixa, false],
    ]);
  },
});

CENARIOS.push({
  id: "E",
  nome: "E: faixa invertida 38505000-38500000 vale como a faixa certa",
  corpo: async (c) => {
    const faixa = "38505000-38500000";
    await confere(c, "E", [
      [ORIGEM, "38500-000", faixa, true],
      [ORIGEM, "38502-000", faixa, true],
      [ORIGEM, "38505-000", faixa, true],
      [ORIGEM, "38499-999", faixa, false],
      [ORIGEM, "38505-001", faixa, false],
    ]);
  },
});

CENARIOS.push({
  id: "F",
  nome: "F: par do placeholder '38500-000, 38500-999': bordas exatas, um fora de cada lado e o par invertido",
  corpo: async (c) => {
    const par = "38500-000, 38500-999";
    await confere(c, "F", [
      [ORIGEM, "38500-000", par, true], // borda inferior
      [ORIGEM, "38500-500", par, true],
      [ORIGEM, "38500-999", par, true], // borda superior
      [ORIGEM, "38501-000", par, false], // um depois
      [ORIGEM, "38499-999", par, false], // um antes
      [ORIGEM, "01310-100", par, false],
    ]);
    const invertido = "38500-999, 38500-000";
    await confere(c, "F invertido", [
      [ORIGEM, "38500-500", invertido, true],
      [ORIGEM, "38500-000", invertido, true],
      [ORIGEM, "38500-999", invertido, true],
      [ORIGEM, "38501-000", invertido, false],
    ]);
  },
});

CENARIOS.push({
  id: "G",
  nome: "G: CEP único casa exato; prefixo curto (e lista de prefixos) casa o começo; lixo não casa nada",
  corpo: async (c) => {
    await confere(c, "G cep unico", [
      [ORIGEM, "38500-100", "38500-100", true],
      [ORIGEM, "38500-101", "38500-100", false],
      [ORIGEM, "38500-099", "38500-100", false],
      [ORIGEM, "38501-100", "38500-100", false],
    ]);
    await confere(c, "G prefixo de 5", [
      [ORIGEM, "38500-000", "38500", true],
      [ORIGEM, "38500-999", "38500", true],
      [ORIGEM, "38501-000", "38500", false],
      [ORIGEM, "38499-999", "38500", false],
      [ORIGEM, "01310-100", "38500", false],
    ]);
    await confere(c, "G prefixo de 3", [
      [ORIGEM, "38510-000", "385", true],
      [ORIGEM, "38400-100", "385", false],
    ]);
    await confere(c, "G lista de prefixos", [
      [ORIGEM, "38510-100", "38500, 38510", true],
      [ORIGEM, "38500-100", "38500, 38510", true],
      [ORIGEM, "38520-000", "38500, 38510", false],
    ]);
    await confere(c, "G lixo", [
      [ORIGEM, "38500-100", "abc", false],
      [ORIGEM, "38500-100", ",", false],
      [ORIGEM, "38500-100", "01000-000", false],
    ]);
  },
});

// ------------------------------------------------------------ ponta a ponta

const U_CLIENTE = "c112d000-0000-4000-8000-000000000001";
const PRODUTO = "c112d000-0000-4000-8000-000000000002";
const CHAVE_V23 = "c112d000-0000-4000-8000-0000000000a3";
const CHAVE_V24 = "c112d000-0000-4000-8000-0000000000a4";
const NOME_COMPRADOR = "Pessoa ficticia R112D";
const LOCAL = "38500-100";
// outro estado, e outra cidade do MESMO estado (só difere no 5º dígito do prefixo)
const FORAS = ["01310-100", "38510-000"];

/** Loja SEM faixa (local_cep_range NULL): o caminho real de uma loja nova. */
async function semearLoja(c, cobertura) {
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'cliente@r112d.fixture.invalid', '{}')",
    [U_CLIENTE],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $2, 'customer')",
    [U_CLIENTE, NOME_COMPRADOR],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, local_delivery_fee,
        local_delivery_enabled, shipping_coverage, enable_coupons, pagamento_online,
        formas_pagamento_entrega, enabled_shipping_methods, store_address)
     VALUES (1, '38500-000', NULL, 0, 20, true, $1, true, true,
             ARRAY['pix','card','cash'], ARRAY['local-delivery','store-pickup'], 'Rua Ficticia, 1')
     ON CONFLICT (id) DO UPDATE SET
       origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
       free_shipping_min = EXCLUDED.free_shipping_min, local_delivery_fee = EXCLUDED.local_delivery_fee,
       local_delivery_enabled = EXCLUDED.local_delivery_enabled,
       shipping_coverage = EXCLUDED.shipping_coverage, enable_coupons = EXCLUDED.enable_coupons,
       pagamento_online = EXCLUDED.pagamento_online, formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
       enabled_shipping_methods = EXCLUDED.enabled_shipping_methods, store_address = EXCLUDED.store_address`,
    [cobertura],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto ficticio R112D', 100, 50, true, 40, false)`,
    [PRODUTO],
  );
}

/** Roda `sql` como `papel` com o uid pedido; erro vira {erro, codigo} sem derrubar a transação. */
async function tentar(c, papel, uid, sql, params) {
  await c.query("SAVEPOINT tentativa");
  try {
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', '', true)",
      [uid],
    );
    await c.query(`SET LOCAL ROLE ${papel}`);
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT tentativa");
    return { erro: erro.message, codigo: erro.code };
  }
}

function comprar(c, porta, destino) {
  const online = porta === "v24";
  return tentar(
    c,
    online ? "authenticated" : "anon",
    online ? U_CLIENTE : "",
    `SELECT public.create_marketplace_order_${porta}(
       $1::jsonb, 120::numeric, 20::numeric, $2::text, NULL::uuid, NULL::text,
       $3::text, '5534000000000', NULL::text, $4::jsonb,
       $5::text, 'local-delivery', $6::uuid) AS id`,
    [
      JSON.stringify([{ product_id: PRODUTO, variant_id: null, quantity: 1 }]),
      online ? "online" : "cash",
      NOME_COMPRADOR,
      online
        ? null
        : JSON.stringify({
            cep: destino,
            street: "Rua Ficticia",
            number: "1",
            neighborhood: "Centro",
            city: "Cidade Prova",
            state: "MG",
          }),
      destino,
      online ? CHAVE_V24 : CHAVE_V23,
    ],
  );
}

async function estado(c) {
  const r = await c.query(
    `SELECT (SELECT count(*)::int FROM public.marketplace_orders WHERE customer_name = $1) AS pedidos,
            (SELECT estoque FROM public.produtos WHERE id = $2) AS estoque`,
    [NOME_COMPRADOR, PRODUTO],
  );
  return r.rows[0];
}

async function pedidoNasceuLocal(c, porta, rotulo) {
  const r = await comprar(c, porta, LOCAL);
  assert.strictEqual(
    r.erro,
    undefined,
    `[${rotulo}] ${porta}: CEP da loja (${LOCAL}) recusado: ${r.erro}`,
  );
  const id = r.linhas[0].id;
  assert.ok(id, `[${rotulo}] ${porta}: sem id de pedido`);
  const linha = (
    await c.query(
      `SELECT subtotal::text, shipping::text, total::text, subtotal + shipping = total AS fecha
         FROM public.marketplace_orders WHERE id = $1`,
      [id],
    )
  ).rows[0];
  assert.deepStrictEqual(
    linha,
    { subtotal: "100.00", shipping: "20.00", total: "120.00", fecha: true },
    `[${rotulo}] ${porta}: pedido local com taxa R$ 20 e total R$ 120`,
  );
  assert.deepStrictEqual(
    await estado(c),
    { pedidos: 1, estoque: 49 },
    `[${rotulo}] ${porta}: o pedido local baixou 1 unidade`,
  );
}

async function pedidoDeForaRecusado(c, porta, rotulo, mensagem, fora) {
  const antes = await estado(c);
  const r = await comprar(c, porta, fora);
  assert.strictEqual(
    r.codigo,
    "P0001",
    `[${rotulo}] ${porta}: CEP de fora (${fora}) foi aceito como entrega local${r.erro ? ` (erro: ${r.erro})` : ""}`,
  );
  assert.match(r.erro, mensagem, `[${rotulo}] ${porta}: motivo da recusa`);
  assert.deepStrictEqual(
    await estado(c),
    antes,
    `[${rotulo}] ${porta}: a recusa deixou pedido ou mexeu no estoque`,
  );
}

CENARIOS.push({
  id: "H",
  nome: "H: v23 (convidado), loja sem faixa: CEP da loja nasce com frete R$ 20; CEP de outro estado é recusado sem deixar pedido",
  corpo: async (c) => {
    await semearLoja(c, "national");
    for (const fora of FORAS) {
      await pedidoDeForaRecusado(
        c,
        "v23",
        "H",
        /Compra sem conta é só com entrega na cidade da loja/,
        fora,
      );
    }
    await pedidoNasceuLocal(c, "v23", "H");
  },
});

CENARIOS.push({
  id: "I",
  nome: "I: v24 (conta logada), cobertura 'só a cidade', loja sem faixa: CEP da loja nasce; CEP de outro estado é recusado sem deixar pedido",
  corpo: async (c) => {
    await semearLoja(c, "local");
    for (const fora of FORAS) {
      await pedidoDeForaRecusado(
        c,
        "v24",
        "I",
        /Esta loja só faz entrega na cidade dela/,
        fora,
      );
    }
    await pedidoNasceuLocal(c, "v24", "I");
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        FUNCAO,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.strictEqual(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), e cada cenário num SAVEPOINT.
 * Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro que não é de asserção
 * (SQL de fixture, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    // `anon`/`authenticated` precisam enxergar o schema auth nas RPCs de pedido
    // (desfeito no ROLLBACK, como o resto).
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R112D || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R112D='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (id) => !r.falhou.some((f) => f.id === id),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "O CEP local divergiu do contrato da loja — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[o-cep-local] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
