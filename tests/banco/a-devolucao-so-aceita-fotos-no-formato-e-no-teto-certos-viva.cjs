"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) das guardas das
 * FOTOS em public.solicitar_devolucao, corpo vigente desde
 * 20261175000000_a_devolucao_nasce_no_pedido.sql (nenhuma migration posterior
 * redefine a função: 20261199/20261216/20261237/20261243/20261391 só citam),
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * A guarda, no corpo vivo:
 *   IF cardinality(v_fotos) > 6 THEN  'Envie no máximo 6 fotos.'
 *   por foto: NULL | pasta <> auth.uid() | fora de ^uuid/[A-Za-z0-9._/-]{1,200}$
 *             | contém '..'            ->  'Foto inválida. Envie as fotos de novo.'
 * (A tabela devolucoes tem ainda CHECK cardinality(fotos) <= 6: uma 2ª camada
 * que também barra o 7º caminho, mas com OUTRA mensagem e outro código — a
 * prova exige a mensagem da função, então apagar só a guarda da função fica
 * vermelho.)
 *
 * Como o cliente DONO de um pedido entregue (papel `authenticated`, auth.uid()
 * emulado pelo GUC app.rpc.user_id, como o provisionar.cjs), cada tentativa
 * num SAVEPOINT próprio, com FOTO das tabelas antes/depois (devolucoes e
 * devolucao_itens: total e as linhas do pedido):
 *   C1  7 caminhos VÁLIDOS da própria pasta -> 22023 'Envie no máximo 6 fotos'
 *   C2  `${eu}/../${outro}/foto.jpg` (passa na pasta e no regex; só o '..' o
 *       barra) -> 22023 'Foto inválida'
 *   C3  nome com espaço, '?', '#' e '%' na própria pasta -> 'Foto inválida'
 *   C4  201 caracteres depois da pasta -> 'Foto inválida'
 *   C5  pasta de OUTRA conta (o vizinho devolucoes-viva.cjs já cobre; repetido
 *       uma vez aqui para o mutante da pasta própria) -> 'Foto inválida'
 *   C6  CONTROLE: exatamente 6 caminhos válidos passam e gravam 6 em
 *       devolucoes.fotos (valores exatos, na ordem)
 *   C7  CONTROLE de borda: exatamente 200 caracteres depois da pasta passa
 * Toda recusa deixa as duas tabelas exatamente como estavam.
 *
 * MUTANTES: MUTANTE_R113C=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os casos; a
 * execução TEM de ficar vermelha, e vermelha no caso que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R113C a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-devolucao-so-aceita-fotos-no-formato-e-no-teto-certos-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: a devolução só aceita fotos no formato e no teto certos (rpc-ci)";
const FUNCAO =
  "public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[])";

const U_CLIENTE = "c1130000-0000-4000-8000-0000000000a1";
const U_OUTRO = "c1130000-0000-4000-8000-0000000000a2";
const P_CAMISA = "c1130000-0000-4000-8000-0000000000b1";
const O_LOCAL = "c1130000-0000-4000-8000-0000000000c1";
const I_LOCAL = "c1130000-0000-4000-8000-0000000000d1";

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = caso(s) onde a prova TEM de ficar vermelha.
const REGEX_VIVO = "v_foto !~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]{1,200}$'";

const MUTANTES = {
  "fotos-sem-teto-de-6": {
    espera: ["C1"],
    de: "IF cardinality(v_fotos) > 6 THEN",
    para: "IF cardinality(v_fotos) > 600 THEN",
  },
  "fotos-sem-regex-do-caminho": {
    espera: ["C3", "C4"],
    de: REGEX_VIVO,
    para: "false",
  },
  "fotos-sem-recusa-de-ponto-ponto": {
    espera: ["C2"],
    de: "v_foto LIKE '%..%'",
    para: "false",
  },
  "fotos-sem-teto-de-200-caracteres": {
    espera: ["C4"],
    de: "{1,200}",
    para: "{1,250}", // o regex do Postgres só aceita repetição até 255
  },
  "fotos-sem-pasta-propria": {
    espera: ["C5"],
    de: "split_part(v_foto, '/', 1) <> v_uid::text",
    para: "false",
  },
};

// ------------------------------------------------------------------ semente

async function semear(c) {
  for (const [id, email] of [
    [U_CLIENTE, "cliente@fotos113c.fixture.invalid"],
    [U_OUTRO, "outro@fotos113c.fixture.invalid"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, $2, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
      [id, email],
    );
  }
  // A política é uma linha só e o clone pode trazê-la mexida por outra prova:
  // fixa o que esta prova usa (desfeito no ROLLBACK final).
  await c.query(
    `UPDATE public.politica_devolucao
        SET prazo_arrependimento_dias = 7, aceita_troca = true, aceita_vale = true,
            exige_fotos_vicio = true,
            metodos_locais = ARRAY['entrega_na_loja', 'coleta']
      WHERE id = 1`,
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, categoria)
     VALUES ($1, 'Camisa Fotos 113c', 40.00, 10, true, 'Camisas')`,
    [P_CAMISA],
  );
  // Entrega local, paga pelo app, entregue há 2 dias (arrependimento): o
  // mesmo molde do pedido O_LOCAL do vizinho devolucoes-viva.cjs.
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
        payment_method, payment_status, paid_at, gateway_payment_id)
     VALUES ($1, $2, 'Cliente Fotos 113c',
             '{"whatsapp":"5534999990000","shipping_option_id":"local-delivery"}'::jsonb,
             100, 80, 20, 'delivered', 'online', 'online', 'pago', now(), 'ORD-FOTOS-113C')`,
    [O_LOCAL, U_CLIENTE],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items
       (id, order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, $3, 'Camisa Fotos 113c', 2, 40)`,
    [I_LOCAL, O_LOCAL, P_CAMISA],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
     VALUES ($1, 'shipping', 'delivered', now() - interval '2 days')`,
    [O_LOCAL],
  );
}

// ------------------------------------------------------------------ helpers

/** FOTO das tabelas: total global e as linhas do pedido (fotos incluídas). */
async function foto(c) {
  const r = await c.query(
    `SELECT (SELECT count(*)::int FROM public.devolucoes) AS devolucoes,
            (SELECT count(*)::int FROM public.devolucao_itens) AS itens,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'fotos', d.fotos)
                                       ORDER BY d.id), '[]'::jsonb)
               FROM public.devolucoes d WHERE d.order_id = $1) AS do_pedido`,
    [O_LOCAL],
  );
  return r.rows[0];
}

/**
 * Chama solicitar_devolucao como a conta `uid` (papel authenticated) num
 * SAVEPOINT próprio, com a FOTO das tabelas antes e depois. Sempre desfaz:
 * nenhuma tentativa vaza para a seguinte. Devolve {ok, resultado|erro, antes, depois}.
 */
async function tentar(c, uid, fotos) {
  await c.query("SAVEPOINT tentativa113c");
  const antes = await foto(c);
  let saida;
  try {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(
      "SELECT public.solicitar_devolucao($1::uuid, $2::jsonb, 'tamanho_grande', NULL, 'reembolso', 'entrega_na_loja', $3::text[]) AS r",
      [
        O_LOCAL,
        JSON.stringify([{ order_item_id: I_LOCAL, quantidade: 1 }]),
        fotos,
      ],
    );
    await c.query("RESET ROLE");
    saida = { ok: true, resultado: r.rows[0].r };
    saida.antes = antes;
    saida.depois = await foto(c);
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa113c");
    await c.query("RESET ROLE");
    saida = { ok: false, erro, antes, depois: await foto(c) };
  } finally {
    // No caminho de sucesso o SAVEPOINT ainda existe: desfaz o que a chamada gravou.
    await c.query("ROLLBACK TO SAVEPOINT tentativa113c");
    await c.query("RELEASE SAVEPOINT tentativa113c");
  }
  return saida;
}

/** A tentativa TEM de ser recusada pela função (22023 + a mensagem dela) e não deixar rastro. */
function recusada(rotulo, t, padrao) {
  assert.strictEqual(
    t.ok,
    false,
    `${rotulo}: a chamada devia ser RECUSADA, mas gravou — devolucoes ${t.antes.devolucoes} -> ${t.depois.devolucoes}, itens ${t.antes.itens} -> ${t.depois.itens}, do pedido ${JSON.stringify(t.depois.do_pedido)}`,
  );
  assert.match(
    t.erro.message,
    padrao,
    `${rotulo}: recusou, mas NÃO pela guarda da função (${t.erro.code}: ${t.erro.message})`,
  );
  assert.strictEqual(t.erro.code, "22023", `${rotulo}: código da recusa`);
  assert.deepStrictEqual(
    t.depois,
    t.antes,
    `${rotulo}: a recusa deixou rastro nas tabelas`,
  );
}

const pasta = (uid) => `${uid}/${O_LOCAL}`;

// ------------------------------------------------------------------- casos

const CASOS = [];

CASOS.push({
  id: "C1",
  nome: "C1: 7 caminhos válidos da própria pasta -> 'Envie no máximo 6 fotos'",
  corpo: async (c) => {
    const sete = Array.from(
      { length: 7 },
      (_, i) => `${pasta(U_CLIENTE)}/f${i + 1}.jpg`,
    );
    recusada(
      "[C1] 7 fotos",
      await tentar(c, U_CLIENTE, sete),
      /Envie no máximo 6 fotos/,
    );
  },
});

CASOS.push({
  id: "C2",
  nome: "C2: `<minha-pasta>/../<pasta-de-outra-conta>/foto.jpg` -> 'Foto inválida' (só o '..' barra)",
  corpo: async (c) => {
    recusada(
      "[C2] ponto-ponto",
      await tentar(c, U_CLIENTE, [`${U_CLIENTE}/../${U_OUTRO}/foto.jpg`]),
      /Foto inválida/,
    );
    // Um '..' no meio do nome (sem barra) também é recusado: a regra é o par de pontos.
    recusada(
      "[C2] ponto-ponto no nome",
      await tentar(c, U_CLIENTE, [`${pasta(U_CLIENTE)}/a..b.jpg`]),
      /Foto inválida/,
    );
  },
});

CASOS.push({
  id: "C3",
  nome: "C3: nome com espaço, '?', '#' ou '%' na própria pasta -> 'Foto inválida'",
  corpo: async (c) => {
    for (const nome of ["a b.jpg", "a?.jpg", "a#.jpg", "a%20b.jpg"]) {
      recusada(
        `[C3] ${JSON.stringify(nome)}`,
        await tentar(c, U_CLIENTE, [`${pasta(U_CLIENTE)}/${nome}`]),
        /Foto inválida/,
      );
    }
  },
});

CASOS.push({
  id: "C4",
  nome: "C4: 201 caracteres depois da pasta -> 'Foto inválida'",
  corpo: async (c) => {
    const longo = "a".repeat(201);
    recusada(
      "[C4] 201 caracteres",
      await tentar(c, U_CLIENTE, [`${U_CLIENTE}/${longo}`]),
      /Foto inválida/,
    );
  },
});

CASOS.push({
  id: "C5",
  nome: "C5: pasta de outra conta -> 'Foto inválida'",
  corpo: async (c) => {
    recusada(
      "[C5] pasta alheia",
      await tentar(c, U_CLIENTE, [`${pasta(U_OUTRO)}/foto.jpg`]),
      /Foto inválida/,
    );
  },
});

CASOS.push({
  id: "C6",
  nome: "C6 (controle): exatamente 6 caminhos válidos passam e gravam 6 em devolucoes.fotos",
  corpo: async (c) => {
    const seis = Array.from(
      { length: 6 },
      (_, i) => `${pasta(U_CLIENTE)}/f${i + 1}.jpg`,
    );
    const t = await tentar(c, U_CLIENTE, seis);
    assert.strictEqual(
      t.ok,
      true,
      `[C6] o controle devia PASSAR e foi recusado: ${t.erro?.code}: ${t.erro?.message}`,
    );
    assert.strictEqual(
      t.depois.devolucoes,
      t.antes.devolucoes + 1,
      "[C6] exatamente 1 devolução nova",
    );
    assert.strictEqual(
      t.depois.itens,
      t.antes.itens + 1,
      "[C6] exatamente 1 item novo",
    );
    assert.strictEqual(t.depois.do_pedido.length, 1, "[C6] 1 do pedido");
    assert.deepStrictEqual(
      t.depois.do_pedido[0].fotos,
      seis,
      "[C6] devolucoes.fotos grava os 6 caminhos, exatos e na ordem",
    );
    assert.strictEqual(t.depois.do_pedido[0].fotos.length, 6, "[C6] 6 fotos");
  },
});

CASOS.push({
  id: "C7",
  nome: "C7 (controle de borda): exatamente 200 caracteres depois da pasta passa",
  corpo: async (c) => {
    const exato = `${U_CLIENTE}/${"a".repeat(200)}`;
    const t = await tentar(c, U_CLIENTE, [exato]);
    assert.strictEqual(
      t.ok,
      true,
      `[C7] 200 caracteres devia PASSAR e foi recusado: ${t.erro?.code}: ${t.erro?.message}`,
    );
    assert.deepStrictEqual(
      t.depois.do_pedido.map((d) => d.fotos),
      [[exato]],
      "[C7] gravou o caminho exato de 200 caracteres",
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R113C='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const def = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FUNCAO])
  ).rows[0].d.replace(/\r/g, "");
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FUNCAO])
  ).rows[0].d.replace(/\r/g, "");
  assert.strictEqual(
    depois,
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), semente, e cada caso num
 * SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro que não
 * é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await semear(c);
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CASOS) {
      await c.query("SAVEPOINT caso113c");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT caso113c");
        await c.query("RELEASE SAVEPOINT caso113c");
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
  const nomeMutante = process.env.MUTANTE_R113C || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R113C='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
          `o mutante ${nomeMutante} deixou TODOS os casos verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (id) => !r.falhou.some((f) => f.id === id),
      );
      const demais = r.falhou
        .map((f) => f.id)
        .filter((id) => !r.mutante.espera.includes(id));
      if (faltou.length > 0 || demais.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho em [${r.falhou.map((f) => f.id).join(", ")}], esperado exatamente [${r.mutante.espera.join(", ")}] (faltou [${faltou.join(", ")}], a mais [${demais.join(", ")}])`,
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
        "A guarda das fotos da devolução divergiu — ver acima qual caso.",
      );
    }
    console.log(
      `\n[a-devolucao-so-aceita-fotos] ${CASOS.length}/${CASOS.length} casos passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CASOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CASOS.length}/${CASOS.length} casos** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
