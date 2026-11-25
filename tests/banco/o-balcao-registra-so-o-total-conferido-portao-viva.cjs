"use strict";
/* eslint-disable security/detect-object-injection --
 * `k` percorre as chaves constantes do objeto `i` desta prova; so PG efemero. */
/**
 * Prova VIVA das consultas 58a/58b (o balcao registra so o total conferido: registrar_venda_presencial passa de 8 para 9
 * argumentos, com a nota interna do pedido ao lado), com a migration 20261280000000 real. Mesmo molde do portao 56
 * (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores; a 58b (antes) fica POSITIVA nas 11
 * linhas e a 58a reprova SO as 4 linhas da funcao (sobrecargas, corpo, atributos, EXECUTE: a de 9 argumentos nao existe);
 * aplica a 20261280000000 e a 58a fica POSITIVA, enquanto a 58b reprova as mesmas 4.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`, nos DOIS estados:
 *  - a funcao (8 argumentos no antes, 9 no depois): corpo com outro texto, sobrecarga, SECURITY INVOKER, STABLE/IMMUTABLE, STRICT,
 *    search_path trocado/sem fixo/com configuracao a mais, DONO trocado (esta consulta o ve: compara com o dono de
 *    marketplace_orders), EXECUTE indevido (anon, PUBLIC, service_role, herdado, com GRANT OPTION, para um papel qualquer) ou
 *    perdido, funcao apagada;
 *  - o indice unico da chave de idempotencia: apagado, recriado sem UNIQUE, marcado invalido;
 *  - a tabela da nota interna: coluna a mais, NOT NULL, CHECK, UNIQUE, DEFAULT, gatilho desligado ou apagado, indice a mais, tipo
 *    trocado; RLS desligada/forcada, policy apagada/duplicada/aberta/com outro papel/com outro nome; ACL (anon, PUBLIC,
 *    service_role, DELETE perdido, TRUNCATE a mais, GRANT OPTION); dono trocado, entrada no realtime, GRANT de coluna;
 *  - as dependencias: is_admin_atual e rls_admin_atual apagadas ou abertas, e a funcao do carimbo (corpo, dono, SECURITY DEFINER).
 *
 * Dado que ja existia: um pedido e a nota interna dele, gravados antes da migration, ficam byte a byte depois dela. A migration
 * DROPA a assinatura de 8 argumentos e cria a de 9 (o app antigo, que chama com 8 argumentos, segue resolvendo porque 7 dos 9 tem DEFAULT:
 * a prova mede que a de 8 some, a de 9 existe e a chamada de 8 ainda chega ao corpo). Reaplicar a migration e' idempotente (a 58a segue
 * POSITIVA).
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento do total conferido e' da prova
 * propria da migration; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-balcao-registra-so-o-total-conferido-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "58a-conferir-total-do-balcao-aplicado";
const B = "58b-antes-total-do-balcao-base-vigente";
const ARQUIVO = "20261280000000_o_balcao_registra_so_o_total_conferido.sql";
const FN9 =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)";
const FN8 =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)";
const N = "public.marketplace_order_internal_notes";
const U_CLI = "d0580000-0000-4000-8000-000000000001";
const PEDIDO = "d0580000-0000-4000-8000-000000000002";
const NOTA = "nota interna INVENTADA da prova 58";

const { rodarProva } = criarBancada({
  prefixo: "p58",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do total conferido do balcao (58a/58b)",
});

rodarProva(async (H) => {
  const {
    MIGRATION,
    usar,
    criar,
    montarBase,
    emTransacao,
    consulta,
    item,
    sabotar,
    trocarCorpo,
    tentar,
    marcar,
  } = H;
  const R = "registrar_venda_presencial: ";
  const i = {
    sobre: item(A, `${R}sobrecargas`),
    corpoA: item(A, `${R}corpo da 20261280000000`),
    corpoB: item(B, `${R}corpo da 20261249000000`),
    attrs: item(A, `${R}atributos de sempre`),
    acl: item(A, `${R}EXECUTE so authenticated`),
    idx: item(A, "marketplace_orders: indice unico valido"),
    forma: item(A, "marketplace_order_internal_notes: forma conhecida"),
    rls: item(A, "marketplace_order_internal_notes: RLS ligada"),
    aclT: item(A, "marketplace_order_internal_notes: ACL so authenticated"),
    dono: item(A, "marketplace_order_internal_notes: dono certo"),
    dep: item(A, "dependencias: marketplace_orders"),
  };
  // As duas consultas tem o mesmo rol, salvo o texto da linha do corpo.
  for (const k of [
    "sobre",
    "attrs",
    "acl",
    "idx",
    "forma",
    "rls",
    "aclT",
    "dono",
    "dep",
  ]) {
    assert.equal(
      item(B, i[k].slice(0, 40)),
      i[k],
      `${k}: a 58b tem o mesmo rol`,
    );
  }
  const DA_FUNCAO = [i.sobre, i.corpoA, i.attrs, i.acl];
  const DA_FUNCAO_B = [i.sobre, i.corpoB, i.attrs, i.acl];

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um pedido e a nota interna dele, gravados ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao58.teste', '{}'::jsonb)",
      [U_CLI],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Prova', 'customer')",
      [U_CLI],
    );
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,payment_method,payment_status,paid_at,
          pagamento_recebido_em,gateway_payment_id,valor_estornado)
       VALUES ($1,$2,'Fixture 58','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD58',0)`,
      [PEDIDO, U_CLI],
    );
    await c.query(`INSERT INTO ${N} (order_id, note) VALUES ($1, $2)`, [
      PEDIDO,
      NOTA,
    ]);
  });
  const dados = async (c) => ({
    pedido: (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows,
    nota: (await c.query(`SELECT * FROM ${N} WHERE order_id = $1`, [PEDIDO]))
      .rows,
  });

  /** A funcao: o helper-padrao, com a sobrecarga lida na linha propria e o dono VISTO (atributos). */
  function daFuncao(fn, corpo, papel) {
    const lista = estragosDeFuncao({
      fn,
      nome: "registrar_venda_presencial",
      volatilidade: "v",
      trocarCorpo,
      corpo: [corpo],
      estrutura: [i.attrs],
      drop: [i.sobre, corpo, i.attrs, i.acl],
      anon: [i.acl],
      publico: [i.acl],
      authSem: [i.acl],
      authCom: null,
      servicoCom: [i.acl],
      dono: [i.attrs],
      prefixoPapel: papel,
    });
    for (const par of lista) {
      if (par[0].endsWith("repetida (sobrecarga)")) par[2] = [i.sobre];
      // Herdar o authenticated tambem abre rls_admin_atual() para o anon: a linha das dependencias reprova junto.
      if (par[0].startsWith("anon herda o authenticated"))
        par[2] = [i.acl, i.dep];
    }
    lista.push(
      [
        "authenticated ganha GRANT OPTION no EXECUTE",
        `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated WITH GRANT OPTION`,
        [i.acl],
      ],
      [
        "um papel qualquer ganha EXECUTE",
        [
          `CREATE ROLE ${papel}_qualquer NOLOGIN`,
          `GRANT EXECUTE ON FUNCTION ${fn} TO ${papel}_qualquer`,
        ],
        [i.acl],
      ],
    );
    return lista;
  }

  // O que vale na tabela da nota, na funcao do carimbo e no indice, nos dois estados (mesmas linhas nas duas consultas).
  const daTabela = [
    [
      "indice da chave apagado",
      "DROP INDEX public.marketplace_orders_chave_da_compra_unica",
      [i.idx],
    ],
    [
      "indice da chave recriado sem UNIQUE",
      [
        "DROP INDEX public.marketplace_orders_chave_da_compra_unica",
        "CREATE INDEX marketplace_orders_chave_da_compra_unica ON public.marketplace_orders (id)",
      ],
      [i.idx],
    ],
    [
      "indice da chave marcado invalido",
      "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.marketplace_orders_chave_da_compra_unica'::regclass",
      [i.idx],
    ],
    [
      "nota: coluna a mais",
      `ALTER TABLE ${N} ADD COLUMN p58_extra integer`,
      [i.forma],
    ],
    [
      "nota: note sem NOT NULL",
      `ALTER TABLE ${N} ALTER COLUMN note DROP NOT NULL`,
      [i.forma],
    ],
    [
      "nota: CHECK da nota apagado",
      `ALTER TABLE ${N} DROP CONSTRAINT marketplace_order_internal_notes_note_check`,
      [i.forma],
    ],
    [
      "nota: UNIQUE a mais",
      `ALTER TABLE ${N} ADD CONSTRAINT p58_unico UNIQUE (note)`,
      [i.forma],
    ],
    [
      "nota: updated_at sem DEFAULT",
      `ALTER TABLE ${N} ALTER COLUMN updated_at DROP DEFAULT`,
      [i.forma],
    ],
    [
      "nota: gatilho do carimbo desligado",
      `ALTER TABLE ${N} DISABLE TRIGGER nota_interna_carimba_quem_e_quando`,
      [i.forma],
    ],
    [
      "nota: gatilho do carimbo apagado",
      `DROP TRIGGER nota_interna_carimba_quem_e_quando ON ${N}`,
      [i.forma],
    ],
    [
      "nota: indice a mais",
      `CREATE INDEX p58_idx ON ${N} (updated_at)`,
      [i.forma],
    ],
    [
      "nota: note com outro tipo (varchar)",
      `ALTER TABLE ${N} ALTER COLUMN note TYPE varchar(2000)`,
      [i.forma],
    ],
    [
      "nota: RLS desligada",
      `ALTER TABLE ${N} DISABLE ROW LEVEL SECURITY`,
      [i.rls, i.dono],
    ],
    [
      "nota: RLS forcada (FORCE)",
      `ALTER TABLE ${N} FORCE ROW LEVEL SECURITY`,
      [i.rls, i.dono],
    ],
    [
      "nota: policy apagada",
      `DROP POLICY nota_interna_so_admin_atual ON ${N}`,
      [i.rls],
    ],
    [
      "nota: segunda policy, aberta para anon",
      `CREATE POLICY p58_aberta ON ${N} FOR SELECT TO anon USING (true)`,
      [i.rls],
    ],
    [
      "nota: policy com USING (true)",
      `ALTER POLICY nota_interna_so_admin_atual ON ${N} USING (true)`,
      [i.rls],
    ],
    [
      "nota: policy para anon em vez de authenticated",
      `ALTER POLICY nota_interna_so_admin_atual ON ${N} TO anon`,
      [i.rls],
    ],
    [
      "nota: policy com outro nome",
      `ALTER POLICY nota_interna_so_admin_atual ON ${N} RENAME TO p58_outro_nome`,
      [i.rls],
    ],
    ["nota: anon ganha SELECT", `GRANT SELECT ON ${N} TO anon`, [i.aclT]],
    ["nota: PUBLIC ganha SELECT", `GRANT SELECT ON ${N} TO PUBLIC`, [i.aclT]],
    [
      "nota: service_role ganha SELECT",
      `GRANT SELECT ON ${N} TO service_role`,
      [i.aclT],
    ],
    [
      "nota: authenticated perde o DELETE",
      `REVOKE DELETE ON ${N} FROM authenticated`,
      [i.aclT],
    ],
    [
      "nota: authenticated ganha TRUNCATE",
      `GRANT TRUNCATE ON ${N} TO authenticated`,
      [i.aclT],
    ],
    [
      "nota: authenticated ganha GRANT OPTION",
      `GRANT SELECT ON ${N} TO authenticated WITH GRANT OPTION`,
      [i.aclT],
    ],
    [
      "nota: dono trocado",
      [
        "CREATE ROLE p58_dono_nota NOLOGIN",
        `ALTER TABLE ${N} OWNER TO p58_dono_nota`,
      ],
      [i.dono],
    ],
    [
      "nota: entra no realtime",
      `ALTER PUBLICATION supabase_realtime ADD TABLE ${N}`,
      [i.dono],
    ],
    [
      "nota: GRANT de coluna para anon",
      `GRANT SELECT (note) ON ${N} TO anon`,
      [i.dono],
    ],
    [
      "is_admin_atual() apagada",
      "DROP FUNCTION public.is_admin_atual()",
      [i.dep],
    ],
    [
      "rls_admin_atual() ganha EXECUTE para anon",
      "GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO anon",
      [i.dep],
    ],
    [
      "rls_admin_atual() perde EXECUTE para authenticated",
      "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
      [i.dep],
    ],
    [
      "carimbo: corpo com outro texto",
      (c) => trocarCorpo(c, "public.carimba_nota_interna_do_pedido()"),
      [i.dep],
    ],
    [
      "carimbo: SECURITY DEFINER",
      "ALTER FUNCTION public.carimba_nota_interna_do_pedido() SECURITY DEFINER",
      [i.dep],
    ],
    [
      "carimbo: dono trocado",
      [
        "CREATE ROLE p58_dono_carimbo NOLOGIN",
        "ALTER FUNCTION public.carimba_nota_interna_do_pedido() OWNER TO p58_dono_carimbo",
      ],
      [i.dep],
    ],
    [
      "carimbo: authenticated ganha EXECUTE",
      "GRANT EXECUTE ON FUNCTION public.carimba_nota_interna_do_pedido() TO authenticated",
      [i.dep],
    ],
  ];

  // ---------- ANTES: 58b positiva; 58a reprova as 4 linhas da funcao ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, DA_FUNCAO);
      assert.notEqual(
        (await c.query("SELECT to_regprocedure($1) AS f", [FN8])).rows[0].f,
        null,
        "a de 8 argumentos existe antes",
      );
      assert.equal(
        (await c.query("SELECT to_regprocedure($1) AS f", [FN9])).rows[0].f,
        null,
        "a de 9 argumentos ainda nao existe",
      );
      for (const [rotulo, sql, itens] of daFuncao(FN8, i.corpoB, "p58a")) {
        await sabotar(c, rotulo, B, sql, itens);
      }
      for (const [rotulo, sql, itens] of daTabela) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "58b positiva (11 linhas) e 58a reprova SO as 4 linhas da funcao na base criada com as migrations anteriores a 20261280000000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await dados(c);
      assert.equal(antesDaMigration.pedido.length, 1, "o pedido ja existia");
      assert.equal(antesDaMigration.nota.length, 1, "a nota ja existia");
      assert.equal(antesDaMigration.nota[0].note, NOTA);
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, DA_FUNCAO_B);
      marcar(
        "58a: as 11 linhas ok=true apos aplicar a 20261280000000; 58b reprova SO as 4 linhas da funcao",
      );
      assert.deepEqual(await dados(c), antesDaMigration);
      assert.equal(
        (await c.query("SELECT to_regprocedure($1) AS f", [FN8])).rows[0].f,
        null,
        "a de 8 argumentos some",
      );
      assert.notEqual(
        (await c.query("SELECT to_regprocedure($1) AS f", [FN9])).rows[0].f,
        null,
      );
      // O app ANTIGO (que chama com 8 argumentos) continua resolvendo: a de 9 tem 7 com DEFAULT, entao a chamada de 8 casa com ela
      // e chega ate a guarda do corpo (42501, nao e admin), nao em "funcao inexistente" (42883).
      assert.equal(
        await tentar(
          c,
          "authenticated",
          "SELECT public.registrar_venda_presencial('[]'::jsonb,'dinheiro',NULL,NULL,NULL,NULL,NULL,NULL)",
        ),
        "42501",
      );
      marcar(
        "dado que ja existia: o pedido e a nota interna ficam byte a byte; a assinatura de 8 argumentos some, a de 9 existe e a chamada de 8 do app antigo ainda resolve (chega a guarda do corpo, 42501)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "reaplicar a 20261280000000 deixa a 58a positiva e os dados intactos (idempotente)",
      );
      for (const [rotulo, sql, itens] of daFuncao(FN9, i.corpoA, "p58b")) {
        await sabotar(c, rotulo, A, sql, itens);
      }
      for (const [rotulo, sql, itens] of daTabela) {
        await sabotar(c, rotulo, A, sql, itens);
      }
    }),
  );
});
