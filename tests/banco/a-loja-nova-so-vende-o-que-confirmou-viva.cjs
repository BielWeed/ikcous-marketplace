"use strict";

/**
 * Prova VIVA da migration 20261655000000 (a loja nova so vende o que a lojista confirmou) num Postgres EFEMERO, com os
 * papeis de verdade e as portas REAIS do pedido (`create_marketplace_order_v23`/`_v24`). O clone (rodar-isolado.cjs) e' a
 * arvore migrada: a 20261655000000 ja esta no ar. Cada caso roda numa transacao que termina em ROLLBACK.
 *
 *  PAGAR NA ENTREGA    pagamento_confirmado_em NULL: pix/card/cash recusam com a frase de sempre ('online' nao), sem
 *                      escrever nada; confirmar destrava a MESMA chamada; a entrega pendente nao mexe no pagamento.
 *  ENTREGA NA CIDADE   entrega_confirmada_em NULL: 'local-delivery' recusa P0001 com a frase e o DETAIL proprios, na v23
 *                      e na v24 (o pagamento pelo app nao libera a entrega pendente), sem escrever nada; a retirada passa;
 *                      confirmar destrava; o balcao (canal presencial) passa; o gemeo de idempotencia cai no indice unico.
 *  VITRINE             anon le os dois booleanos (false pendente, true confirmado) e nenhuma data.
 *  TRAVA DO APPLY      no estado ANTES (rollback aplicado): loja com pedido e qualquer confirmacao vazia recusa
 *                      TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO sem aplicar nada; loja confirmada com pedido e loja nova sem
 *                      pedido aplicam; reaplicar com a regra ja no ar nao trava.
 *  MIGRATION           reaplicar 2x e em CRLF = mesmo catalogo; rollback devolve o md5 da 1174, tira gatilho e funcao e
 *                      devolve a vitrine de 48 colunas com dono e ACL; repetido recusa; o pre-voo recusa SEM escrever.
 *  MUTANTES            sem a trava do pagamento, sem o gatilho, sem a trava do apply e com o booleano invertido: vermelho.
 *  CONSULTAS           211a positiva depois e negativa antes; 211b positiva nos dois; 60a, 60b, 47a e 40a positivas.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-nova-so-vende-o-que-confirmou-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const ARQ = "20261655000000_a_loja_nova_so_vende_o_que_confirmou.sql";
const MIGRATION = P.norm(P.lerMigration(ARQ));
const ROLLBACK = P.norm(P.lerMigration(`rollback-manual-${ARQ}`));
const ROLLBACK_1652 = P.norm(
  P.lerMigration(
    "rollback-manual-20261652000000_a_loja_nova_confirma_entrega_e_pagamento.sql",
  ),
);

const SIG_ACEITA = "public.forma_de_pagamento_aceita(text)";
const SIG_GATILHO = "public.a_loja_so_entrega_na_cidade_o_que_confirmou()";
const H_ANTES = "4f90cbc8b1c98be2fd1c6d862468376c";
const H_NOVO = "a38a13934096d55b10fcfdb1416a9c08";
const VISTA_ANTES = "b7ee2c31d91549a168a502de0ac4c5d2";
const VISTA_NOVA = "39fbabdd4cd002cb626ecaa7c5112cdb";

const U = "1655cafe-0000-4000-8000-0000000000c1";
const PRODUTO = "1655cafe-0000-4000-8000-000000000010";
const ESTOQUE = 10;
const FRASE_PAGAMENTO =
  "Esta forma de pagamento não está disponível nesta loja. Escolha outra.";
const FRASE_ENTREGA =
  "Esta loja ainda está se preparando para entregar. Escolha outra entrega ou fale com a loja.";
const DETAIL_ENTREGA = "entrega_local_nao_confirmada";
const TRAVA = /TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO/;

const hash = async (sig) =>
  (
    await P.conexao().query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;
const catalogo = async () =>
  (
    await P.conexao().query(
      `SELECT jsonb_build_object(
         'aceita', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure($1)),
         'vista', (SELECT jsonb_build_object('dono', c.relowner::regrole::text,
                     'acl', (SELECT array_agg(x ORDER BY x) FROM unnest(COALESCE(c.relacl, acldefault('r', c.relowner))::text[]) x),
                     'opcoes', c.reloptions)
                     FROM pg_class c WHERE c.oid = 'public.v_store_config'::regclass),
         'colunas', (SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) FROM pg_attribute a
                      WHERE a.attrelid = 'public.v_store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
         'gatilho', (SELECT count(*) FROM pg_trigger WHERE tgname = 'tr_a_loja_so_entrega_o_confirmado')
       )::text AS j`,
      [SIG_ACEITA],
    )
  ).rows[0].j;
const colunasDaVista = async () =>
  (
    await P.conexao().query(
      `SELECT md5(string_agg(a.attname, ',' ORDER BY a.attnum)) AS m FROM pg_attribute a
        WHERE a.attrelid = 'public.v_store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
    )
  ).rows[0].m;

/** A ficha da loja com as duas confirmacoes pedidas (true = data de agora, false = NULL). */
async function confirmar({ entrega, pagamento }) {
  await P.conexao().query(
    `UPDATE public.store_config
        SET entrega_confirmada_em = CASE WHEN $1 THEN now() END,
            pagamento_confirmado_em = CASE WHEN $2 THEN now() END
      WHERE id = 1`,
    [entrega, pagamento],
  );
}

/** Cliente, produto e a loja em "Entrego e retiro", com Pix pelo app e as tres formas na entrega. */
async function semear({ entrega = true, pagamento = true } = {}) {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'cliente@1655.fixture.invalid', '{}'::jsonb) ON CONFLICT (id) DO NOTHING",
    [U],
  );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente ficticio 1655', 'customer') ON CONFLICT (id) DO NOTHING",
    [U],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage,
        pagamento_online, formas_pagamento_entrega, store_address, enabled_shipping_methods)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national',
        true, ARRAY['pix', 'card', 'cash'], 'Rua Ficticia da Loja, 100', ARRAY['local-delivery', 'store-pickup'])
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep, local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min, shipping_coverage = EXCLUDED.shipping_coverage,
           pagamento_online = EXCLUDED.pagamento_online,
           formas_pagamento_entrega = EXCLUDED.formas_pagamento_entrega,
           store_address = EXCLUDED.store_address, enabled_shipping_methods = EXCLUDED.enabled_shipping_methods,
           local_delivery_enabled = true`,
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Produto ficticio 1655', 100, $2, true, 40, false)",
    [PRODUTO, ESTOQUE],
  );
  await confirmar({ entrega, pagamento });
}

/** Tudo o que uma compra escreve: se algo mudar, a recusa nao foi limpa. */
async function fotografar() {
  return (
    await P.conexao().query(`SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.produtos p) AS produtos,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.marketplace_orders o) AS pedidos,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.marketplace_order_items i) AS itens`)
  ).rows[0];
}

let sequencia = 0;
const chave = () =>
  `1655cafe-0000-4000-9000-${String(++sequencia).padStart(12, "0")}`;
const ITENS = JSON.stringify([
  { product_id: PRODUTO, variant_id: null, quantity: 1 },
]);
/** A porta real: v23 (pagar na entrega) ou v24 (pelo app), uma unidade de R$ 100, frete gratis da loja, CEP da cidade. */
const comprar = (versao, meio, opcao, k = chave()) =>
  P.tentar(
    "authenticated",
    `SELECT public.create_marketplace_order_${versao}(
       $1::jsonb, 100::numeric, 0::numeric, $2::text, NULL::uuid, NULL::text,
       'Comprador ficticio 1655', '5534999990000', NULL::text, NULL::jsonb, '38500-100', $3::text, $4::uuid) AS id`,
    [ITENS, meio, opcao, k],
    { uid: U, claims: JSON.stringify({ sub: U, role: "authenticated" }) },
  );
const aceita = async (meio) =>
  (
    await P.conexao().query(
      "SELECT public.forma_de_pagamento_aceita($1) AS ok",
      [meio],
    )
  ).rows[0].ok;

/** Um pedido qualquer na historia da loja (a trava do apply so olha se existe). */
async function umPedidoNaHistoria() {
  await P.conexao().query(
    `INSERT INTO public.marketplace_orders (user_id, total, subtotal, shipping, payment_method, status, canal, customer_name, customer_data)
     VALUES (NULL, 50, 50, 0, 'cash', 'delivered', 'presencial', 'Balcao ficticio 1655', '{}'::jsonb)`,
  );
}

// ---------------------------------------------------------------------------
// Os comportamentos (recebem nada; os mutantes os reusam sobre o corpo mutado)
// ---------------------------------------------------------------------------

async function pagarNaEntregaPendenteRecusa() {
  await semear({ entrega: true, pagamento: false });
  for (const meio of ["pix", "card", "cash"])
    assert.equal(await aceita(meio), false, `${meio} aceito sem confirmacao`);
  assert.equal(await aceita("online"), true, "o pagamento pelo app travou");
  const antes = await fotografar();
  const r = await comprar("v23", "cash", "store-pickup");
  assert.equal(r.codigo, "P0001", JSON.stringify(r));
  assert.equal(r.erro, FRASE_PAGAMENTO);
  assert.deepEqual(await fotografar(), antes, "a recusa escreveu algo");
  // Controle: so a confirmacao muda.
  await confirmar({ entrega: true, pagamento: true });
  const ok = await comprar("v23", "cash", "store-pickup");
  assert.equal(ok.erro, undefined, ok.erro);
}

async function entregaPendenteRecusa() {
  await semear({ entrega: false, pagamento: true });
  const antes = await fotografar();
  for (const [versao, meio] of [
    ["v23", "cash"],
    ["v24", "online"],
  ]) {
    const r = await comprar(versao, meio, "local-delivery");
    assert.equal(r.codigo, "P0001", `${versao}: ${JSON.stringify(r)}`);
    assert.equal(r.erro, FRASE_ENTREGA, versao);
    assert.equal(r.detalhe, DETAIL_ENTREGA, versao);
  }
  assert.deepEqual(await fotografar(), antes, "a recusa escreveu algo");
  // A retirada e o pagamento na entrega seguem livres com a entrega pendente.
  assert.equal(await aceita("cash"), true);
  const retirada = await comprar("v23", "cash", "store-pickup");
  assert.equal(retirada.erro, undefined, retirada.erro);
  await confirmar({ entrega: true, pagamento: true });
  const ok = await comprar("v23", "cash", "local-delivery");
  assert.equal(ok.erro, undefined, ok.erro);
}

async function vitrineLeOsBooleanos() {
  await semear({ entrega: false, pagamento: false });
  const ler = async () =>
    (
      await P.tentar(
        "anon",
        "SELECT entrega_local_liberada AS e, pagamento_na_entrega_liberado AS p FROM public.v_store_config",
      )
    ).linhas;
  assert.deepEqual(await ler(), [{ e: false, p: false }]);
  await confirmar({ entrega: true, pagamento: false });
  assert.deepEqual(await ler(), [{ e: true, p: false }]);
  await confirmar({ entrega: false, pagamento: true });
  assert.deepEqual(await ler(), [{ e: false, p: true }]);
  const datas = (
    await P.conexao().query(
      `SELECT count(*)::int AS n FROM pg_attribute a WHERE a.attrelid = 'public.v_store_config'::regclass
          AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em') AND NOT a.attisdropped`,
    )
  ).rows[0].n;
  assert.equal(datas, 0, "a vitrine expoe a data");
}

/** No estado ANTES: loja com pedido e confirmacao vazia recusa o apply sem aplicar nada. */
async function travaRecusaLojaQueJaVendeu(texto) {
  await umPedidoNaHistoria();
  for (const estado of [
    { entrega: false, pagamento: true },
    { entrega: true, pagamento: false },
    { entrega: false, pagamento: false },
  ]) {
    await confirmar(estado);
    const cat = await catalogo();
    const r = await P.aplicar(texto);
    assert.ok(r, `${JSON.stringify(estado)}: o apply devia recusar`);
    assert.match(r.erro, TRAVA, JSON.stringify(estado));
    assert.equal(await hash(SIG_ACEITA), H_ANTES, "a recusa trocou o corpo");
    assert.equal(await catalogo(), cat, "a recusa mexeu no catalogo");
  }
}

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------

const noEstado = (estado) => async () => {
  await P.conexao().query(
    "INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  assert.equal(
    await hash(SIG_ACEITA),
    H_NOVO,
    "o clone tem de estar com a 20261655000000 no ar",
  );
  if (estado === "antes") {
    assert.equal(await P.aplicar(ROLLBACK), null, "o rollback nao aplicou");
    assert.equal(await hash(SIG_ACEITA), H_ANTES);
  }
};
const depois = noEstado("depois");
const antes = noEstado("antes");

prova(
  "PAGAR NA ENTREGA: pendente recusa pix/card/cash (online livre) sem escrever; confirmar destrava a mesma compra",
  () => P.emTransacao(pagarNaEntregaPendenteRecusa, depois),
);

prova(
  "ENTREGA NA CIDADE: pendente recusa local-delivery na v23 e na v24 com frase e DETAIL proprios; retirada livre; confirmar destrava",
  () => P.emTransacao(entregaPendenteRecusa, depois),
);

prova(
  "GATILHO NA TABELA: insert direto online recusa; balcao (presencial) passa; gemeo de idempotencia cai no indice unico",
  () =>
    P.emTransacao(async () => {
      await semear({ entrega: false, pagamento: false });
      const inserir = (canal, k) =>
        P.tentar(
          null,
          `INSERT INTO public.marketplace_orders (user_id, total, subtotal, shipping, payment_method, status, canal, customer_name, customer_data, idempotency_key)
           VALUES (NULL, 100, 100, 0, 'cash', 'pending', $1, 'Pedido ficticio 1655', '{"shipping_option_id": " local-delivery "}'::jsonb, $2::uuid) RETURNING id`,
          [canal, k],
        );
      const online = await inserir("online", chave());
      assert.equal(online.detalhe, DETAIL_ENTREGA, JSON.stringify(online));
      const balcao = await inserir("presencial", chave());
      assert.equal(balcao.erro, undefined, balcao.erro);
      // Gemeo: o pedido com a chave K nasceu com a entrega confirmada; depois a confirmacao some. O reenvio com K
      // nao e pedido novo: passa pelo gatilho e o indice unico responde (23505), nunca a frase da entrega.
      await confirmar({ entrega: true, pagamento: true });
      const k = chave();
      assert.equal((await inserir("online", k)).erro, undefined);
      await confirmar({ entrega: false, pagamento: true });
      const gemeo = await inserir("online", k);
      assert.equal(gemeo.codigo, "23505", JSON.stringify(gemeo));
    }, depois),
);

prova(
  "VITRINE: anon le entrega_local_liberada e pagamento_na_entrega_liberado (cada parte sozinha) e nenhuma data",
  () => P.emTransacao(vitrineLeOsBooleanos, depois),
);

prova(
  "TRAVA DO APPLY: loja com pedido e qualquer confirmacao vazia recusa sem aplicar; confirmada com pedido e nova sem pedido aplicam; reaplicar nao trava",
  async () => {
    await P.emTransacao(() => travaRecusaLojaQueJaVendeu(MIGRATION), antes);
    await P.emTransacao(async () => {
      await umPedidoNaHistoria();
      await confirmar({ entrega: true, pagamento: true });
      assert.equal(await P.aplicar(MIGRATION), null, "loja confirmada recusou");
      assert.equal(await hash(SIG_ACEITA), H_NOVO);
    }, antes);
    await P.emTransacao(async () => {
      // Loja nova: nenhum pedido na historia (o clone pode trazer pedidos de outra prova; tudo volta no ROLLBACK).
      await P.conexao().query("TRUNCATE public.marketplace_orders CASCADE");
      await confirmar({ entrega: false, pagamento: false });
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "loja nova sem pedido recusou",
      );
      assert.equal(await hash(SIG_ACEITA), H_NOVO);
    }, antes);
    await P.emTransacao(async () => {
      await umPedidoNaHistoria();
      await confirmar({ entrega: false, pagamento: false });
      assert.equal(await P.aplicar(MIGRATION), null, "reaplicar travou");
    }, depois);
  },
);

prova(
  "MIGRATION: reaplicar 2x e CRLF = mesmo catalogo; rollback devolve a 1174 e a vitrine de 48 com dono e ACL; repetido recusa",
  () =>
    P.emTransacao(async () => {
      const cat = await catalogo();
      for (const texto of [MIGRATION, MIGRATION, P.emCRLF(MIGRATION)]) {
        assert.equal(await P.aplicar(texto), null);
        assert.equal(await hash(SIG_ACEITA), H_NOVO);
        assert.equal(await catalogo(), cat, "reaplicar mudou o catalogo");
      }
      const vistaAntes = JSON.parse(cat).vista;
      assert.equal(await P.aplicar(P.emCRLF(ROLLBACK)), null);
      assert.equal(await hash(SIG_ACEITA), H_ANTES);
      assert.equal(await hash(SIG_GATILHO), null, "a funcao do gatilho ficou");
      assert.equal(await colunasDaVista(), VISTA_ANTES);
      const depoisDoRb = JSON.parse(await catalogo());
      assert.deepEqual(
        depoisDoRb.vista,
        vistaAntes,
        "dono, ACL ou opcoes da vitrine mudaram",
      );
      assert.deepEqual(
        depoisDoRb.aceita,
        JSON.parse(cat).aceita,
        "o catalogo da funcao mudou",
      );
      assert.equal(depoisDoRb.gatilho, 0);
      await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
      // Sem a regra, a loja pendente volta a aceitar pagar na entrega (o comportamento de antes).
      await semear({ entrega: false, pagamento: false });
      assert.equal(await aceita("cash"), true);
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "ida de novo depois do rollback",
      );
      assert.equal(await catalogo(), cat);
    }, depois),
);

prova(
  "PRE-VOO: corpo estranho, colunas da 1652 ausentes e vitrine com outra lista recusam SEM escrever",
  async () => {
    const casos = [
      [
        "corpo estranho",
        async () => {
          const def = (
            await P.conexao().query(
              "SELECT pg_get_functiondef(to_regprocedure($1)) AS d",
              [SIG_ACEITA],
            )
          ).rows[0].d;
          const fim = def.lastIndexOf("$function$");
          await P.conexao().query(
            `${def.slice(0, fim)}-- +1\n${def.slice(fim)}`,
          );
        },
      ],
      ["colunas da 1652 ausentes", () => P.conexao().query(ROLLBACK_1652)],
      [
        "vitrine com outra lista",
        // As 48 colunas do rollback + uma intrusa no fim (OR REPLACE aceita acrescentar).
        () =>
          P.conexao().query(
            comando(
              ROLLBACK,
              "CREATE VIEW public.v_store_config",
              "WHERE id = 1;",
            )
              .replace("CREATE VIEW", "CREATE OR REPLACE VIEW")
              .replace(
                "free_shipping_card_style\n   FROM",
                "free_shipping_card_style,\n    1 AS intrusa\n   FROM",
              ),
          ),
      ],
    ];
    for (const [nome, estragar] of casos) {
      await P.emTransacao(async () => {
        await estragar();
        const cat = await catalogo();
        const h = await hash(SIG_ACEITA);
        await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
        assert.equal(await hash(SIG_ACEITA), h, `${nome}: trocou o corpo`);
        assert.equal(await catalogo(), cat, `${nome}: mexeu no catalogo`);
      }, antes);
    }
  },
);

/** O comportamento rodado sobre um texto mutado tem de ficar VERMELHO. */
async function vermelho(nome, fn) {
  let passou = false;
  await P.conexao().query("SAVEPOINT mutante");
  try {
    await fn();
    passou = true;
  } catch (e) {
    // vermelho: o esperado. MOSTRAR_VERMELHO=1 imprime o motivo (o vermelho tem de cair na guarda CERTA).
    if (process.env.MOSTRAR_VERMELHO === "1")
      console.log(`    vermelho ${nome}: ${String(e.message).split("\n")[0]}`);
  } finally {
    await P.conexao().query("ROLLBACK TO SAVEPOINT mutante");
  }
  assert.equal(passou, false, `MUTANTE ${nome}: a prova continuou verde`);
}
const mutar = (de, para) => {
  assert.equal(
    MIGRATION.split(de).length - 1,
    1,
    `mutante: trecho ausente ou repetido ${de}`,
  );
  return MIGRATION.replace(de, () => para);
};
/** So o comando `marca` ... `fim` do texto (sem pre-voo nem conferencia, que recusariam o corpo mutado). */
const comando = (texto, marca, fim) => {
  // No comeco de linha: o cabecalho cita os mesmos comandos entre crases.
  const i =
    texto.indexOf(`
${marca}`) + 1;
  assert.ok(i > 0, `comando ausente: ${marca}`);
  return texto.slice(i, texto.indexOf(fim, i) + fim.length);
};

prova(
  "MUTANTES: sem a trava do pagamento, sem o gatilho, sem a trava do apply e com o booleano invertido, a prova fica vermelha",
  async () => {
    const semPagamento = mutar(
      "IF p_metodo IN ('pix', 'card', 'cash') AND v_config.pagamento_confirmado_em IS NULL THEN",
      "IF false THEN",
    );
    await P.emTransacao(async () => {
      await P.conexao().query(
        comando(
          semPagamento,
          "CREATE OR REPLACE FUNCTION public.forma_de_pagamento_aceita(",
          "$function$;",
        ),
      );
      await vermelho("sem a trava do pagamento", pagarNaEntregaPendenteRecusa);
    }, depois);
    const semGatilho = mutar(
      "WHERE s.id = 1 AND s.entrega_confirmada_em IS NULL) THEN",
      "WHERE s.id = 1 AND s.entrega_confirmada_em IS NULL AND false) THEN",
    );
    await P.emTransacao(async () => {
      await P.conexao().query(
        comando(
          semGatilho,
          "CREATE OR REPLACE FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou(",
          "$function$;",
        ),
      );
      await vermelho("sem o gatilho", entregaPendenteRecusa);
    }, depois);
    const semTrava = mutar(
      "     AND EXISTS (SELECT 1 FROM public.marketplace_orders) THEN",
      "     AND false THEN",
    );
    await P.emTransacao(
      () =>
        vermelho("sem a trava do apply", () =>
          travaRecusaLojaQueJaVendeu(semTrava),
        ),
      antes,
    );
    const invertido = mutar(
      "(entrega_confirmada_em IS NOT NULL) AS entrega_local_liberada",
      "(entrega_confirmada_em IS NULL) AS entrega_local_liberada",
    );
    await P.emTransacao(async () => {
      await P.conexao().query(
        comando(
          invertido,
          "CREATE OR REPLACE VIEW public.v_store_config",
          "WHERE id = 1;",
        ),
      );
      await vermelho("booleano invertido", vitrineLeOsBooleanos);
    }, depois);
  },
);

const ANTECESSORAS = [
  "60a-conferir-estilo-card-frete-aplicado",
  "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
  "40a-conferir-identidade-legal-da-loja-aplicado",
];
const C211A = "211a-conferir-a-loja-nova-so-vende-o-que-confirmou-aplicado";
const C211B = "211b-antes-a-loja-nova-so-vende-o-que-confirmou-base-vigente";
const reprovadas = async (nome) => {
  await P.conexao().query("SAVEPOINT consulta");
  try {
    await P.conexao().query("SET LOCAL transaction_read_only = on");
    return (await P.conexao().query(P.lerConsulta(nome))).rows
      .filter((r) => r.ok !== true)
      .map((r) => r.item)
      .sort();
  } finally {
    await P.conexao().query("ROLLBACK TO SAVEPOINT consulta");
  }
};

prova(
  "CONSULTAS: 211a positiva depois e negativa antes; 211b positiva nos dois; 60a, 60b, 47a e 40a positivas com esta no ar",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await reprovadas(C211A), []);
      assert.deepEqual(await reprovadas(C211B), []);
      for (const n of ANTECESSORAS)
        assert.deepEqual(await reprovadas(n), [], `${n} com a 1655 no ar`);
      // A 60b e o ANTES da 1310: o corpo do upsert ja e de sucessora desde a 1643. So a linha da vitrine importa aqui.
      assert.deepEqual(
        await reprovadas("60b-antes-estilo-card-frete-base-vigente"),
        ["upsert_store_config: corpo exato (md5)"],
      );
    }, depois);
    await P.emTransacao(async () => {
      assert.deepEqual(await reprovadas(C211B), []);
      assert.deepEqual(await reprovadas(C211A), [
        "a_loja_so_entrega_na_cidade_o_que_confirmou: corpo exato (md5), SECURITY DEFINER, EXECUTE so do dono",
        "forma_de_pagamento_aceita: corpo exato (md5), pagar na entrega so com a confirmacao, atributos de sempre",
        "tr_a_loja_so_entrega_o_confirmado: ligado em marketplace_orders com a definicao exata",
        "v_store_config: as 50 colunas (os dois booleanos no fim), security_invoker e leitura publica",
      ]);
      assert.equal(await colunasDaVista(), VISTA_ANTES);
    }, antes);
    await P.emTransacao(async () => {
      assert.equal(await colunasDaVista(), VISTA_NOVA);
    }, depois);
  },
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("a loja nova so vende o que confirmou");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
