"use strict";

/**
 * O livro do estorno (`order_refunds`) e a devolucao (`devolucao_itens`, `devolucao_eventos`) so se LEEM pelo comprador logado.
 * Quem escreve e' o servidor (RPC SECURITY DEFINER e service_role). Origem: 2026110000000_o_estorno_nasce_no_ledger.sql:132-151 e
 * 20261175000000_a_devolucao_nasce_no_pedido.sql:270-296 (a policy de leitura do dono e do admin ATUAL ganhou `rls_admin_atual()`
 * em 20261197000000 e 20261202000000; nenhuma migration posterior mexeu nos privilegios nem criou policy de escrita).
 *
 * O que protegem: a fila do executor (edge estornar-pagamento e o cron) devolve DINHEIRO a quem tem linha `solicitado` no livro.
 * Se o comprador escrevesse ali, fabricaria um estorno no proprio pedido pago (dinheiro sem devolucao), mexeria no valor e no
 * status de uma linha existente ou apagaria o historico. Em devolucao_itens/devolucao_eventos ele reescreveria o que a loja
 * recebeu de volta (reestocar, condicao) e o rastro de quem fez o que.
 *
 * A trava tem DUAS camadas, e cada uma sozinha ja segura: (1) o REVOKE de escrita (o default do Supabase da ALL a authenticated);
 * (2) a ausencia de policy de escrita para o comprador. So o CONJUNTO quebrado (GRANT novo + policy nova, ex.: um futuro "cliente
 * pede estorno") abre a porta, e ate hoje nenhum teste de comportamento a pegava. Por isso os mutantes abaixo incluem os dois
 * isolados (vermelho so em "camadas", o comportamento continua recusando) e o conjunto (vermelho no comportamento).
 *
 * Cenarios (cada um e' uma prova). Quem chama e' a compradora A (SEM ser admin), como `authenticated` com JWT de role customer,
 * dona de um pedido pago com linha no livro; a conta B tem outro pedido pago, tambem com linha, devolucao, itens e eventos:
 *  1. INSERT em order_refunds no proprio pedido e no da B: 42501 e o livro fica igual (contagem e retrato de cada linha);
 *  2. UPDATE em order_refunds (valor e status 'solicitado' na linha propria e na da B, e em TODAS as linhas): 42501 ou 0 linhas,
 *     e o livro continua igual;
 *  3. DELETE em order_refunds (propria, da B e sem WHERE): 42501 ou 0 linhas e o livro continua igual;
 *  4. INSERT/UPDATE/DELETE em devolucao_itens e em devolucao_eventos, na devolucao propria e na da B: mesmo criterio, tabelas iguais;
 *  5. SELECT: A ve so a linha do livro do proprio pedido, e so os itens e eventos da propria devolucao (as recusas acima nao sao
 *     "tudo invisivel": a policy de leitura funciona);
 *  6. controle: os MESMOS INSERT/UPDATE/DELETE funcionam pela conexao dona do clone, que passa por cima da RLS como o service_role
 *     de verdade (o clone local nao emula o BYPASSRLS dele); descarta CHECK, FK ou fixture invalida como causa das recusas.
 *  6b. controle: o admin ATUAL le o livro inteiro, os itens e os eventos (as policies de leitura do admin valem). O admin NAO
 *     escreve direto no livro como authenticated (sem GRANT de escrita; ele pede estorno pela RPC solicitar_estorno): o brief
 *     previa "admin escreve" como controle, e a migration nao concede isso;
 *  7. camadas: nas tres tabelas authenticated so tem SELECT (nem por coluna), anon nao tem nada, a RLS esta ligada e as policies
 *     vivas sao exatamente as de leitura mais a `order_refunds_admin_all` (policies permissivas se somam por OR).
 *
 * UPDATE/DELETE sem GRANT erram 42501 (permission denied); com GRANT e sem policy filtram para 0 linhas: os dois sao recusa.
 * INSERT sem RETURNING: a recusa tem de vir do GRANT ou do WITH CHECK, nao da policy de leitura.
 *
 * So Postgres EFEMERO (rodar-isolado.cjs). Fixtures e mutantes ficam numa transacao sempre desfeita.
 *
 * MUTANTE_R134D (nome desconhecido = ERRO):
 *   grant-escrita-sozinho             GRANT INSERT, UPDATE, DELETE em order_refunds a authenticated (sem policy) -> vermelho SO no 7
 *   politica-do-dono-sozinha          CREATE POLICY FOR ALL do dono em order_refunds (sem GRANT)                  -> vermelho SO no 7
 *   insert-do-dono                    GRANT INSERT + policy FOR INSERT do dono em order_refunds                   -> vermelho no 1 e no 7
 *   update-do-dono                    GRANT UPDATE + policy FOR UPDATE do dono em order_refunds                   -> vermelho no 2 e no 7
 *   delete-do-dono                    GRANT DELETE + policy FOR DELETE do dono em order_refunds                   -> vermelho no 3 e no 7
 *   escrita-toda-do-dono              GRANT INSERT, UPDATE, DELETE + policy FOR ALL do dono em order_refunds      -> vermelho no 1, 2, 3 e 7
 *   devolucao-escrita-do-dono         GRANT + policy FOR ALL do dono em devolucao_itens e devolucao_eventos       -> vermelho no 4 e no 7
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-comprador-nao-escreve-no-ledger-de-estorno-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const U_A = "b134d000-0000-4000-8000-0000000000a1";
const U_B = "b134d000-0000-4000-8000-0000000000b2";
const U_ADMIN = "b134d000-0000-4000-8000-0000000000c3";
const PEDIDO_A = "b134d000-0000-4000-8000-0000000000d1";
const PEDIDO_B = "b134d000-0000-4000-8000-0000000000d2";
const ESTORNO_A = "b134d000-0000-4000-8000-0000000000e1";
const ESTORNO_B = "b134d000-0000-4000-8000-0000000000e2";
const DEV_A = "b134d000-0000-4000-8000-0000000000f1";
const DEV_B = "b134d000-0000-4000-8000-0000000000f2";
const ITEM_A = "b134d000-0000-4000-8000-000000000a01"; // item do pedido A que ja esta na devolucao
const ITEM_A2 = "b134d000-0000-4000-8000-000000000a02"; // item do pedido A livre (alvo de INSERT)
const ITEM_B = "b134d000-0000-4000-8000-000000000b01";
const ITEM_B2 = "b134d000-0000-4000-8000-000000000b02";
const DI_A = "b134d000-0000-4000-8000-000000000c01"; // devolucao_itens ja existentes
const DI_B = "b134d000-0000-4000-8000-000000000c02";

const MUTANTES_CONHECIDOS = [
  "grant-escrita-sozinho",
  "politica-do-dono-sozinha",
  "insert-do-dono",
  "update-do-dono",
  "delete-do-dono",
  "escrita-toda-do-dono",
  "devolucao-escrita-do-dono",
];
const MUTANTE = process.env.MUTANTE_R134D;

const identidade = (uid, papel) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: papel },
  }),
});
const COMPRADORA = identidade(U_A, "customer");
const ADMIN = identidade(U_ADMIN, "admin");

const TABELAS = ["order_refunds", "devolucao_itens", "devolucao_eventos"];
const POLITICAS_ESPERADAS = [
  [
    "devolucao_eventos",
    "devolucao_eventos_dono_ou_admin_select_policy",
    "SELECT",
  ],
  ["devolucao_itens", "devolucao_itens_dono_ou_admin_select_policy", "SELECT"],
  ["order_refunds", "order_refunds_admin_all", "ALL"],
  ["order_refunds", "order_refunds_cliente_le", "SELECT"],
];

async function semear() {
  const c = P.conexao();
  // Fabrica do Supabase que o provisionar.cjs nao emula (mesmo preparo de admin-atual-viva.cjs): authenticated usa os schemas
  // auth (auth.uid() dentro da policy) e extensions. Dentro da transacao desfeita: nada vaza.
  await c.query("GRANT USAGE ON SCHEMA auth TO anon, authenticated");
  await c.query("GRANT USAGE ON SCHEMA extensions TO anon, authenticated");
  for (const id of [U_A, U_B, U_ADMIN]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $2, '{}'::jsonb)",
      [id, `${id}@ledger-do-estorno.fixture.invalid`],
    );
  }
  // O papel nasce em profiles e o gatilho tr_sync_profile_role_to_auth o leva a auth.users: o caminho de producao.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Compradora A Ficticia', 'customer'), ($2, 'Compradora B Ficticia', 'customer'), ($3, 'Admin Ficticio', 'admin')`,
    [U_A, U_B, U_ADMIN],
  );
  for (const [id, dono] of [
    [PEDIDO_A, U_A],
    [PEDIDO_B, U_B],
  ]) {
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at,
          pagamento_recebido_em, gateway_payment_id, valor_estornado)
       VALUES ($1, $2, 'Cliente Ficticio', '{}'::jsonb, 100, 100, 'delivered', 'online', 'online', 'pago', now(), now(), $3, 0)`,
      [id, dono, `GW-${id}`],
    );
  }
  // Uma linha do livro em cada pedido. A da A esta 'recusado' (a fila do executor so pega solicitado/em_processamento).
  await c.query(
    `INSERT INTO public.order_refunds (id, order_id, amount, motivo, solicitado_por, status)
     VALUES ($1, $2, 10.00, 'motivo ficticio A', 'lojista', 'recusado'),
            ($3, $4, 20.00, 'motivo ficticio B', 'lojista', 'recusado')`,
    [ESTORNO_A, PEDIDO_A, ESTORNO_B, PEDIDO_B],
  );
  // Dois itens por pedido: um ja devolvido (existente) e um livre (alvo do INSERT, sem bater na UNIQUE).
  for (const [item, pedido] of [
    [ITEM_A, PEDIDO_A],
    [ITEM_A2, PEDIDO_A],
    [ITEM_B, PEDIDO_B],
    [ITEM_B2, PEDIDO_B],
  ]) {
    await c.query(
      `INSERT INTO public.marketplace_order_items (id, order_id, product_name, quantity, price)
       VALUES ($1, $2, 'Item Ficticio', 2, 50)`,
      [item, pedido],
    );
  }
  for (const [dev, pedido, dona, protocolo] of [
    [DEV_A, PEDIDO_A, U_A, "DEV134D-A"],
    [DEV_B, PEDIDO_B, U_B, "DEV134D-B"],
  ]) {
    await c.query(
      `INSERT INTO public.devolucoes
         (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno, status, valor_itens,
          valor_frete_ida, prazo_ate, politica)
       VALUES ($1, $2, $3, $4, 'arrependimento', 'outro', 'reembolso', 'nacional', 'envio_proprio', 'solicitada', 50, 0,
               current_date + 7, '{}')`,
      [dev, protocolo, pedido, dona],
    );
  }
  for (const [di, dev, item] of [
    [DI_A, DEV_A, ITEM_A],
    [DI_B, DEV_B, ITEM_B],
  ]) {
    await c.query(
      `INSERT INTO public.devolucao_itens (id, devolucao_id, order_item_id, product_name, quantidade, valor_unitario)
       VALUES ($1, $2, $3, 'Item Ficticio', 1, 50)`,
      [di, dev, item],
    );
  }
  // Pelo menos um evento por devolucao (o gatilho da devolucao ja pode ter deixado algum; o retrato abaixo mede o conjunto).
  for (const dev of [DEV_A, DEV_B]) {
    await c.query(
      `INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota)
       VALUES ($1, NULL, 'solicitada', 'sistema', 'evento ficticio')`,
      [dev],
    );
  }
}

const q = async (sql, params = []) =>
  (await P.conexao().query(sql, params)).rows;

/** A tabela inteira como texto (contagem + hash de cada linha), lida pela conexao dona do clone (nao passa por RLS). */
const retrato = async (tabela) =>
  (
    await q(
      `SELECT count(*)::int AS n,
              coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h
         FROM public.${tabela} t`,
    )
  )[0];
const retratos = async () => {
  const r = {};
  for (const t of TABELAS) Object.assign(r, { [t]: await retrato(t) });
  return r;
};

const politicas = async () =>
  q(
    `SELECT tablename, policyname, cmd, roles::text AS roles, permissive
       FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY ($1::text[])
      ORDER BY tablename, policyname`,
    [TABELAS],
  );

const DONO_DO_PEDIDO =
  "order_id IN (SELECT id FROM public.marketplace_orders WHERE user_id = auth.uid())";
const DONO_DA_DEVOLUCAO =
  "devolucao_id IN (SELECT d.id FROM public.devolucoes d WHERE d.user_id = auth.uid())";
const privilegios = async (papel) =>
  (
    await q(
      `SELECT t AS tabela,
              has_table_privilege($1, 'public.' || t, 'SELECT') AS le,
              has_any_column_privilege($1, 'public.' || t, 'INSERT') AS insere,
              has_any_column_privilege($1, 'public.' || t, 'UPDATE') AS atualiza,
              has_table_privilege($1, 'public.' || t, 'DELETE') AS apaga,
              has_table_privilege($1, 'public.' || t, 'TRUNCATE') AS trunca
         FROM unnest($2::text[]) AS t ORDER BY t`,
      [papel, TABELAS],
    )
  ).map((l) => l);

/** Sabota a trava VIVA dentro da transacao desfeita; confirma o ponto de partida e que a sabotagem pegou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const antes = await politicas();
  assert.deepEqual(
    antes.map((p) => [p.tablename, p.policyname, p.cmd]),
    POLITICAS_ESPERADAS,
    "o mutante precisa partir das quatro policies vivas, e so elas",
  );
  for (const papel of ["authenticated"]) {
    for (const l of await privilegios(papel)) {
      assert.equal(
        [l.insere, l.atualiza, l.apaga, l.trunca].some(Boolean),
        false,
        `o mutante precisa partir de ${l.tabela} sem escrita para ${papel}`,
      );
    }
  }
  const abrir = async (tabela, verbos, policy) => {
    if (verbos.length > 0)
      await c.query(
        `GRANT ${verbos.join(", ")} ON public.${tabela} TO authenticated`,
      );
    if (policy) {
      const dono =
        tabela === "order_refunds" ? DONO_DO_PEDIDO : DONO_DA_DEVOLUCAO;
      const { cmd, nome } = policy;
      const clausula =
        cmd === "INSERT"
          ? `WITH CHECK (${dono})`
          : cmd === "UPDATE" || cmd === "ALL"
            ? `USING (${dono}) WITH CHECK (${dono})`
            : `USING (${dono})`;
      await c.query(
        `CREATE POLICY ${nome} ON public.${tabela} FOR ${cmd} TO authenticated ${clausula}`,
      );
    }
  };
  if (MUTANTE === "grant-escrita-sozinho") {
    await abrir("order_refunds", ["INSERT", "UPDATE", "DELETE"], null);
  } else if (MUTANTE === "politica-do-dono-sozinha") {
    await abrir("order_refunds", [], { cmd: "ALL", nome: "mutante_dono_all" });
  } else if (MUTANTE === "insert-do-dono") {
    await abrir("order_refunds", ["INSERT"], {
      cmd: "INSERT",
      nome: "mutante_dono_insert",
    });
  } else if (MUTANTE === "update-do-dono") {
    await abrir("order_refunds", ["UPDATE"], {
      cmd: "UPDATE",
      nome: "mutante_dono_update",
    });
  } else if (MUTANTE === "delete-do-dono") {
    await abrir("order_refunds", ["DELETE"], {
      cmd: "DELETE",
      nome: "mutante_dono_delete",
    });
  } else if (MUTANTE === "escrita-toda-do-dono") {
    await abrir("order_refunds", ["INSERT", "UPDATE", "DELETE"], {
      cmd: "ALL",
      nome: "mutante_dono_all",
    });
  } else if (MUTANTE === "devolucao-escrita-do-dono") {
    for (const t of ["devolucao_itens", "devolucao_eventos"])
      await abrir(t, ["INSERT", "UPDATE", "DELETE"], {
        cmd: "ALL",
        nome: `mutante_${t}_dono_all`,
      });
  }
  const depois = await politicas();
  const mudouPolitica = depois.length - antes.length;
  const privDepois = (await privilegios("authenticated")).filter(
    (l) => l.insere || l.atualiza || l.apaga,
  );
  const esperado = new Map([
    ["grant-escrita-sozinho", [0, 1]],
    ["politica-do-dono-sozinha", [1, 0]],
    ["insert-do-dono", [1, 1]],
    ["update-do-dono", [1, 1]],
    ["delete-do-dono", [1, 1]],
    ["escrita-toda-do-dono", [1, 1]],
    ["devolucao-escrita-do-dono", [2, 2]],
  ]).get(MUTANTE);
  assert.deepEqual(
    [mudouPolitica, privDepois.length],
    esperado,
    `o mutante ${MUTANTE} devia somar ${esperado[0]} policy(ies) e abrir escrita em ${esperado[1]} tabela(s)`,
  );
}

/** Monta o clone (fixtures + mutante), garante que parte do estado conhecido e roda o cenario. */
const cenario = (fn) =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    const base = await retratos();
    assert.equal(
      base.order_refunds.n,
      2,
      "devia comecar com 2 linhas no livro",
    );
    assert.equal(
      base.devolucao_itens.n,
      2,
      "devia comecar com 2 itens de devolucao",
    );
    assert.ok(
      base.devolucao_eventos.n >= 2,
      "devia comecar com eventos das duas devolucoes",
    );
    await fn(base);
  });

/**
 * Tenta como a compradora A: recusa = 42501 (INSERT sempre; UPDATE/DELETE sem GRANT) OU, quando a tabela tem privilegio mas nao
 * tem policy, ZERO linhas. Qualquer outra coisa (erro de CHECK/FK, linha afetada) e' fixture ruim ou trava aberta.
 */
async function recusada(rotulo, sql, params, { insercao = false } = {}) {
  const t = await P.tentar("authenticated", sql, params, COMPRADORA);
  if (t.erro !== undefined) {
    assert.equal(
      t.codigo,
      "42501",
      `${rotulo}: devia ser recusado por permissao/RLS (42501), veio ${t.codigo}: ${t.erro}`,
    );
    return t.erro;
  }
  assert.equal(
    insercao,
    false,
    `${rotulo}: o INSERT da compradora GRAVOU (devia dar 42501)`,
  );
  assert.deepEqual(
    t.linhas,
    [],
    `${rotulo}: a compradora alterou ${t.linhas.length} linha(s)`,
  );
  return "0 linhas";
}

const INS_ESTORNO = `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status) VALUES ($1, 99.00, 'cliente', 'solicitado')`;
const UPD_ESTORNO = `UPDATE public.order_refunds SET amount = 99.00, status = 'solicitado', mp_refund_id = NULL WHERE id = $1 RETURNING id`;
const UPD_ESTORNO_TODOS = `UPDATE public.order_refunds SET amount = 99.00, status = 'solicitado' RETURNING id`;
const DEL_ESTORNO =
  "DELETE FROM public.order_refunds WHERE id = $1 RETURNING id";
const DEL_ESTORNO_TODOS = "DELETE FROM public.order_refunds RETURNING id";

prova(
  "1. a compradora nao cria estorno no proprio pedido pago nem no da B: 42501 e o livro igual",
  () =>
    cenario(async (base) => {
      for (const [rotulo, pedido] of [
        ["pedido proprio", PEDIDO_A],
        ["pedido da B", PEDIDO_B],
      ])
        await recusada(
          `INSERT em order_refunds no ${rotulo}`,
          INS_ESTORNO,
          [pedido],
          {
            insercao: true,
          },
        );
      assert.deepEqual(
        await retrato("order_refunds"),
        base.order_refunds,
        "o livro do estorno mudou",
      );
      assert.deepEqual(
        await q(
          `SELECT id FROM public.order_refunds WHERE status IN ('solicitado','em_processamento')`,
        ),
        [],
        "ficou linha na fila do executor: o estorno sairia do caixa da loja",
      );
    }),
);

prova(
  "2. a compradora nao altera valor nem status de linha do livro (propria, da B ou todas): recusado e o livro igual",
  () =>
    cenario(async (base) => {
      await recusada("UPDATE da linha propria", UPD_ESTORNO, [ESTORNO_A]);
      await recusada("UPDATE da linha da B", UPD_ESTORNO, [ESTORNO_B]);
      await recusada("UPDATE sem WHERE", UPD_ESTORNO_TODOS, []);
      assert.deepEqual(
        await retrato("order_refunds"),
        base.order_refunds,
        "o livro do estorno mudou",
      );
    }),
);

prova(
  "3. a compradora nao apaga linha do livro (propria, da B ou todas): recusado e o livro igual",
  () =>
    cenario(async (base) => {
      await recusada("DELETE da linha propria", DEL_ESTORNO, [ESTORNO_A]);
      await recusada("DELETE da linha da B", DEL_ESTORNO, [ESTORNO_B]);
      await recusada("DELETE sem WHERE", DEL_ESTORNO_TODOS, []);
      assert.deepEqual(
        await retrato("order_refunds"),
        base.order_refunds,
        "o livro do estorno mudou",
      );
    }),
);

prova(
  "4. a compradora nao escreve em devolucao_itens nem em devolucao_eventos (propria ou da B): recusado e as tabelas iguais",
  () =>
    cenario(async (base) => {
      const casos = [
        [
          "INSERT item na devolucao propria",
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_name, quantidade, valor_unitario) VALUES ($1, $2, 'Item Ficticio', 1, 50)`,
          [DEV_A, ITEM_A2],
          true,
        ],
        [
          "INSERT item na devolucao da B",
          `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_name, quantidade, valor_unitario) VALUES ($1, $2, 'Item Ficticio', 1, 50)`,
          [DEV_B, ITEM_B2],
          true,
        ],
        [
          "UPDATE item proprio (reestocar/condicao)",
          `UPDATE public.devolucao_itens SET reestocar = true, condicao = 'nova', quantidade = 2 WHERE id = $1 RETURNING id`,
          [DI_A],
          false,
        ],
        [
          "UPDATE item da B",
          `UPDATE public.devolucao_itens SET reestocar = true, condicao = 'nova', quantidade = 2 WHERE id = $1 RETURNING id`,
          [DI_B],
          false,
        ],
        [
          "UPDATE de todos os itens",
          "UPDATE public.devolucao_itens SET reestocar = true RETURNING id",
          [],
          false,
        ],
        [
          "DELETE item proprio",
          "DELETE FROM public.devolucao_itens WHERE id = $1 RETURNING id",
          [DI_A],
          false,
        ],
        [
          "DELETE item da B",
          "DELETE FROM public.devolucao_itens WHERE id = $1 RETURNING id",
          [DI_B],
          false,
        ],
        [
          "DELETE de todos os itens",
          "DELETE FROM public.devolucao_itens RETURNING id",
          [],
          false,
        ],
        [
          "INSERT evento na devolucao propria",
          `INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota) VALUES ($1, 'solicitada', 'concluida', 'loja', 'forjado')`,
          [DEV_A],
          true,
        ],
        [
          "INSERT evento na devolucao da B",
          `INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota) VALUES ($1, 'solicitada', 'concluida', 'loja', 'forjado')`,
          [DEV_B],
          true,
        ],
        [
          "UPDATE de todos os eventos",
          `UPDATE public.devolucao_eventos SET nota = 'reescrito', para_status = 'concluida' RETURNING id`,
          [],
          false,
        ],
        [
          "UPDATE dos eventos da propria devolucao",
          `UPDATE public.devolucao_eventos SET nota = 'reescrito' WHERE devolucao_id = $1 RETURNING id`,
          [DEV_A],
          false,
        ],
        [
          "DELETE dos eventos da propria devolucao",
          "DELETE FROM public.devolucao_eventos WHERE devolucao_id = $1 RETURNING id",
          [DEV_A],
          false,
        ],
        [
          "DELETE dos eventos da devolucao da B",
          "DELETE FROM public.devolucao_eventos WHERE devolucao_id = $1 RETURNING id",
          [DEV_B],
          false,
        ],
        [
          "DELETE de todos os eventos",
          "DELETE FROM public.devolucao_eventos RETURNING id",
          [],
          false,
        ],
      ];
      for (const [rotulo, sql, params, insercao] of casos)
        await recusada(rotulo, sql, params, { insercao });
      const depois = await retratos();
      assert.deepEqual(
        depois.devolucao_itens,
        base.devolucao_itens,
        "devolucao_itens mudou",
      );
      assert.deepEqual(
        depois.devolucao_eventos,
        base.devolucao_eventos,
        "devolucao_eventos mudou",
      );
      assert.deepEqual(depois.order_refunds, base.order_refunds);
    }),
);

prova(
  "5. a compradora le so o que e' dela: a linha do livro do proprio pedido, os itens e os eventos da propria devolucao",
  () =>
    cenario(async () => {
      const como = async (sql, params = []) => {
        const t = await P.tentar("authenticated", sql, params, COMPRADORA);
        assert.equal(
          t.erro,
          undefined,
          `o SELECT da compradora errou: ${t.erro}`,
        );
        return t.linhas;
      };
      assert.deepEqual(
        (
          await como(
            "SELECT id, order_id FROM public.order_refunds ORDER BY id",
          )
        ).map((l) => [l.id, l.order_id]),
        [[ESTORNO_A, PEDIDO_A]],
        "a compradora devia ver SO a linha do livro do proprio pedido",
      );
      assert.deepEqual(
        (
          await como(
            "SELECT id, devolucao_id FROM public.devolucao_itens ORDER BY id",
          )
        ).map((l) => [l.id, l.devolucao_id]),
        [[DI_A, DEV_A]],
        "a compradora devia ver SO os itens da propria devolucao",
      );
      const eventos = await como(
        "SELECT DISTINCT devolucao_id FROM public.devolucao_eventos",
      );
      assert.deepEqual(
        eventos.map((l) => l.devolucao_id),
        [DEV_A],
        "a compradora devia ver SO os eventos da propria devolucao",
      );
      assert.ok(
        (await como("SELECT 1 FROM public.devolucao_eventos")).length >= 1,
        "a compradora devia ver pelo menos o evento semeado",
      );
    }),
);

prova(
  "6. controle: o dono do clone (que passa por cima da RLS, como o servidor) faz o MESMO INSERT/UPDATE/DELETE: as recusas nao sao da fixture",
  () =>
    cenario(async () => {
      // O servidor de verdade (service_role) passa por cima da RLS; o clone local nao emula esse BYPASSRLS, entao o controle e' a
      // conexao DONA do clone, que e' superusuaria: escreve o que a compradora nao escreve, com os MESMOS comandos.
      const servico = async (sql, params = []) =>
        (await P.conexao().query(sql, params)).rows;
      // os mesmos comandos dos cenarios 1, 2 e 3 (INSERT no pedido da A, UPDATE e DELETE da linha propria)
      await servico(INS_ESTORNO, [PEDIDO_A]);
      assert.equal(
        (await retrato("order_refunds")).n,
        3,
        "o INSERT do servidor devia gravar",
      );
      assert.deepEqual(
        (await servico(UPD_ESTORNO, [ESTORNO_A])).map((l) => l.id),
        [ESTORNO_A],
      );
      assert.deepEqual(
        (await servico(DEL_ESTORNO, [ESTORNO_B])).map((l) => l.id),
        [ESTORNO_B],
      );
      assert.equal((await retrato("order_refunds")).n, 2);
      // devolucao: um INSERT e um UPDATE validos dos cenarios 4
      await servico(
        `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_name, quantidade, valor_unitario) VALUES ($1, $2, 'Item Ficticio', 1, 50)`,
        [DEV_A, ITEM_A2],
      );
      assert.equal((await retrato("devolucao_itens")).n, 3);
      await servico(
        `INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota) VALUES ($1, 'solicitada', 'aprovada', 'loja', 'ok')`,
        [DEV_A],
      );
    }),
);

prova(
  "6b. controle: o admin ATUAL le todas as linhas do livro, os itens e os eventos (a policy de leitura do admin vale)",
  () =>
    cenario(async () => {
      const como = async (sql) => {
        const t = await P.tentar("authenticated", sql, [], ADMIN);
        assert.equal(t.erro, undefined, `o SELECT do admin errou: ${t.erro}`);
        return t.linhas;
      };
      assert.deepEqual(
        (await como("SELECT id FROM public.order_refunds ORDER BY id")).map(
          (l) => l.id,
        ),
        [ESTORNO_A, ESTORNO_B],
      );
      assert.deepEqual(
        (await como("SELECT id FROM public.devolucao_itens ORDER BY id")).map(
          (l) => l.id,
        ),
        [DI_A, DI_B],
      );
      const dev = (
        await como(
          "SELECT DISTINCT devolucao_id FROM public.devolucao_eventos ORDER BY 1",
        )
      ).map((l) => l.devolucao_id);
      assert.deepEqual(dev, [DEV_A, DEV_B]);
    }),
);

prova(
  "7. camadas: authenticated so tem SELECT nas tres tabelas, anon nada, a RLS esta ligada e so existem as policies de leitura e a do admin",
  () =>
    cenario(async () => {
      for (const l of await privilegios("authenticated")) {
        assert.deepEqual(
          [l.le, l.insere, l.atualiza, l.apaga, l.trunca],
          [true, false, false, false, false],
          `${l.tabela}: authenticated devia ter so SELECT (le, insere, atualiza, apaga, trunca)`,
        );
      }
      for (const l of await privilegios("anon")) {
        assert.deepEqual(
          [l.le, l.insere, l.atualiza, l.apaga, l.trunca],
          [false, false, false, false, false],
          `${l.tabela}: anon nao devia ter privilegio nenhum`,
        );
      }
      const rls = await q(
        "SELECT relname, relrowsecurity FROM pg_class WHERE oid = ANY (ARRAY['public.order_refunds'::regclass, 'public.devolucao_itens'::regclass, 'public.devolucao_eventos'::regclass]) ORDER BY relname",
      );
      assert.deepEqual(
        rls.map((l) => [l.relname, l.relrowsecurity]),
        TABELAS.slice()
          .sort()
          .map((t) => [t, true]),
        "RLS desligada",
      );
      const lista = await politicas();
      assert.deepEqual(
        lista.map((p) => [
          p.tablename,
          p.policyname,
          p.cmd,
          p.roles,
          p.permissive,
        ]),
        POLITICAS_ESPERADAS.map(([t, n, cmd]) => [
          t,
          n,
          cmd,
          "{authenticated}",
          "PERMISSIVE",
        ]),
        `policies permissivas se somam por OR: ${JSON.stringify(lista.map((p) => `${p.policyname} (${p.cmd})`))}`,
      );
    }),
);

async function main() {
  if (MUTANTE && !MUTANTES_CONHECIDOS.includes(MUTANTE))
    P.falhar(
      "ERRO",
      `MUTANTE_R134D desconhecido: ${MUTANTE} (validos: ${MUTANTES_CONHECIDOS.join(", ")})`,
    );
  await P.conectar();
  try {
    await P.executar(
      "o comprador nao escreve no livro do estorno nem na devolucao",
    );
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
