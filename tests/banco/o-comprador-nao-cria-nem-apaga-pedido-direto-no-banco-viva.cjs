"use strict";

/**
 * Politicas de INSERT e DELETE de marketplace_orders (ultima definicao: 20261197000000_dinheiro_exige_admin_atual.sql, ALTER POLICY):
 * so o admin ATUAL grava ou apaga pedido direto na tabela. O comprador comum so le o proprio pedido.
 *
 * O que protegem: `authenticated` TEM o privilegio de tabela INSERT e DELETE (as politicas sao a unica trava; o PostgREST expoe a
 * tabela), entao sem elas um comprador logado fabricaria um pedido SEU ja entregue e pago por centavos (receita falsa, LTV falso,
 * selo de "compra verificada" indevido) ou apagaria o proprio pedido pago (o historico de cobranca e de estorno vai junto).
 * Ate hoje `admin-atual-viva.cjs` so tenta o INSERT para 4 contas rebaixadas e com user_id NULL (a clausula `auth.uid() = user_id`
 * daria NULL e recusaria de qualquer jeito) e o DELETE so de pedido ALHEIO; o comprador comum so entrava em SELECT.
 *
 * Cenarios (cada um e' uma prova, para o vermelho do mutante cair no nome certo). Quem chama e' o comprador comum U_CLIENTE
 * (SEM ser admin), como `authenticated` com JWT de role customer:
 *  1. INSERT com user_id = auth.uid(), total 0.01, status 'delivered', payment_status 'pago': 42501 (row-level security) e ZERO
 *     linha nova;
 *  2. o mesmo INSERT com user_id de OUTRA conta e com user_id NULL: recusado do mesmo jeito (42501) e zero linha;
 *  3. DELETE do proprio pedido PAGO (semeado pelo dono do clone): 0 linhas afetadas e o pedido continua la, igual byte a byte;
 *  4. DELETE de pedido ALHEIO: 0 linhas, o pedido continua la;
 *  5. controle positivo: o MESMO INSERT e o DELETE do mesmo pedido pelo admin ATUAL funcionam (descarta fixture invalida, CHECK,
 *     FK ou GRANT como causa das recusas acima);
 *  6. as politicas de INSERT/DELETE vivas sao exatamente `marketplace_orders_admin_insert_policy` e
 *     `marketplace_orders_admin_delete_policy`, e nenhuma outra (politicas permissivas se somam por OR: uma segunda abriria o que
 *     estas fecham).
 *
 * INSERT sem RETURNING: a recusa tem de vir do WITH CHECK da politica de escrita, nao da de leitura (o dono le o proprio pedido).
 * DELETE: a RLS nao erra, ela filtra; "0 linhas" e' a resposta certa, e o pedido conferido pela conexao dona do clone.
 *
 * So Postgres EFEMERO (rodar-isolado.cjs). Fixtures e mutantes ficam numa transacao sempre desfeita.
 *
 * MUTANTE_R111A (nome desconhecido = ERRO):
 *   insert-aceita-o-dono           ALTER POLICY ..._admin_insert_policy WITH CHECK (rls_admin_atual() OR auth.uid() = user_id) -> vermelho no 1
 *   delete-aceita-o-dono           ALTER POLICY ..._admin_delete_policy USING (rls_admin_atual() OR auth.uid() = user_id)      -> vermelho no 3
 *   insert-aceita-qualquer-logado  ALTER POLICY ..._admin_insert_policy WITH CHECK (true)                                      -> vermelho no 1 e no 2
 *   politica-extra-de-insert       CREATE POLICY ... FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)             -> vermelho no 6 e no 1
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-comprador-nao-cria-nem-apaga-pedido-direto-no-banco-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const U_CLIENTE = "b111a000-0000-4000-8000-0000000000a1";
const U_OUTRA = "b111a000-0000-4000-8000-0000000000b2";
const U_ADMIN = "b111a000-0000-4000-8000-0000000000c3";
const PEDIDO_DO_CLIENTE = "b111a000-0000-4000-8000-0000000000d1";
const PEDIDO_DA_OUTRA = "b111a000-0000-4000-8000-0000000000d2";
const FORJADO = "Pedido Forjado Fixture";

const POLITICA_INSERT = "marketplace_orders_admin_insert_policy";
const POLITICA_DELETE = "marketplace_orders_admin_delete_policy";
const MUTANTES_CONHECIDOS = [
  "insert-aceita-o-dono",
  "delete-aceita-o-dono",
  "insert-aceita-qualquer-logado",
  "politica-extra-de-insert",
];
const MUTANTE = process.env.MUTANTE_R111A;

const identidade = (uid, papel) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: papel },
  }),
});
const COMPRADOR = identidade(U_CLIENTE, "customer");
const ADMIN = identidade(U_ADMIN, "admin");

// Pedido que a loja registraria como ja pago e entregue: e' o que o comprador tentaria fabricar.
const INSERIR = `INSERT INTO public.marketplace_orders
   (user_id, customer_name, customer_data, total, subtotal, status, payment_status, paid_at)
 VALUES ($1::uuid, $2, '{}'::jsonb, 0.01, 0.01, 'delivered', 'pago', now())`;

async function semear() {
  const c = P.conexao();
  // Fabrica do Supabase que o provisionar.cjs nao emula (mesmo preparo de admin-atual-viva.cjs): authenticated usa os schemas
  // auth (auth.uid() dentro da politica) e extensions (gatilhos do pedido). Dentro da transacao desfeita: nada vaza.
  await c.query("GRANT USAGE ON SCHEMA auth TO anon, authenticated");
  await c.query("GRANT USAGE ON SCHEMA extensions TO anon, authenticated");
  for (const id of [U_CLIENTE, U_OUTRA, U_ADMIN]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $2, '{}'::jsonb)",
      [id, `${id}@pedido-direto.fixture.invalid`],
    );
  }
  // O papel nasce em profiles e o gatilho tr_sync_profile_role_to_auth o leva a auth.users: o caminho de producao.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Comprador Ficticio', 'customer'), ($2, 'Outra Ficticia', 'customer'), ($3, 'Admin Ficticio', 'admin')`,
    [U_CLIENTE, U_OUTRA, U_ADMIN],
  );
  for (const [id, dono] of [
    [PEDIDO_DO_CLIENTE, U_CLIENTE],
    [PEDIDO_DA_OUTRA, U_OUTRA],
  ]) {
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status, paid_at)
       VALUES ($1, $2, 'Cliente Ficticio', '{}'::jsonb, 100, 100, 'delivered', 'online', 'online', 'pago', now())`,
      [id, dono],
    );
  }
}

const politicas = async () =>
  (
    await P.conexao().query(
      `SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketplace_orders'
          AND cmd IN ('INSERT', 'DELETE', 'ALL') ORDER BY policyname`,
    )
  ).rows;

/** Sabota a politica VIVA dentro da transacao desfeita; confirma que o trecho existe 1 vez e que a sabotagem pegou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const antes = await politicas();
  assert.deepEqual(
    antes.map((p) => p.policyname),
    [POLITICA_DELETE, POLITICA_INSERT],
    "o mutante precisa partir das duas politicas vivas, e so elas",
  );
  const [delecao, insercao] = antes;
  const umaVez = (texto, trecho) => texto.split(trecho).length - 1;
  if (MUTANTE === "insert-aceita-o-dono") {
    assert.equal(
      umaVez(insercao.with_check, "rls_admin_atual()"),
      1,
      "a guarda do admin atual devia aparecer 1 vez no WITH CHECK vivo",
    );
    await c.query(
      `ALTER POLICY ${POLITICA_INSERT} ON public.marketplace_orders
         WITH CHECK (public.rls_admin_atual() OR auth.uid() = user_id)`,
    );
    const depois = (await politicas()).find(
      (p) => p.policyname === POLITICA_INSERT,
    );
    assert.match(
      depois.with_check,
      /user_id/,
      "o mutante devia abrir o INSERT ao dono",
    );
  } else if (MUTANTE === "delete-aceita-o-dono") {
    assert.equal(
      umaVez(delecao.qual, "rls_admin_atual()"),
      1,
      "a guarda do admin atual devia aparecer 1 vez no USING vivo",
    );
    await c.query(
      `ALTER POLICY ${POLITICA_DELETE} ON public.marketplace_orders
         USING (public.rls_admin_atual() OR auth.uid() = user_id)`,
    );
    const depois = (await politicas()).find(
      (p) => p.policyname === POLITICA_DELETE,
    );
    assert.match(
      depois.qual,
      /user_id/,
      "o mutante devia abrir o DELETE ao dono",
    );
  } else if (MUTANTE === "insert-aceita-qualquer-logado") {
    assert.equal(
      umaVez(insercao.with_check, "rls_admin_atual()"),
      1,
      "a guarda do admin atual devia aparecer 1 vez no WITH CHECK vivo",
    );
    await c.query(
      `ALTER POLICY ${POLITICA_INSERT} ON public.marketplace_orders WITH CHECK (true)`,
    );
    const depois = (await politicas()).find(
      (p) => p.policyname === POLITICA_INSERT,
    );
    assert.equal(depois.with_check, "true", "o mutante devia abrir o INSERT");
  } else if (MUTANTE === "politica-extra-de-insert") {
    // Politicas permissivas somam por OR: esta abre o INSERT ao dono sem tocar na do admin.
    await c.query(
      `CREATE POLICY marketplace_orders_mutante_insert ON public.marketplace_orders
         FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)`,
    );
    assert.equal(
      (await politicas()).length,
      3,
      "o mutante devia somar a politica",
    );
  }
}

const forjadas = async () =>
  (
    await P.conexao().query(
      "SELECT user_id, total::text AS total, status, payment_status FROM public.marketplace_orders WHERE customer_name = $1 ORDER BY user_id",
      [FORJADO],
    )
  ).rows;
const totalDePedidos = async () =>
  (
    await P.conexao().query(
      "SELECT count(*)::int AS n FROM public.marketplace_orders",
    )
  ).rows[0].n;
/** O pedido inteiro como texto, lido pela conexao dona do clone (nao passa por politica): detecta qualquer mudanca. */
const retratoDoPedido = async (id) =>
  (
    await P.conexao().query(
      "SELECT o::text AS linha FROM public.marketplace_orders o WHERE o.id = $1",
      [id],
    )
  ).rows[0]?.linha ?? null;

/** Monta o clone (fixtures + mutante), garante que parte do estado conhecido e roda o cenario. */
const cenario = (fn) =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    assert.deepEqual(await forjadas(), [], "devia comecar sem pedido forjado");
    assert.equal(await totalDePedidos(), 2, "devia comecar com 2 pedidos");
    await fn();
  });

const APAGAR =
  "DELETE FROM public.marketplace_orders WHERE id = $1 RETURNING id";

prova(
  "1. o comprador nao cria pedido seu ja pago por centavos: 42501 e zero linhas",
  () =>
    cenario(async () => {
      const t = await P.tentar(
        "authenticated",
        INSERIR,
        [U_CLIENTE, FORJADO],
        COMPRADOR,
      );
      assert.equal(
        t.codigo,
        "42501",
        `o INSERT do comprador devia ser recusado (veio: ${t.erro ?? "gravou"})`,
      );
      // row-level security, e nao "permission denied for table": a recusa tem de vir da POLITICA, com o privilegio de tabela intacto.
      assert.match(t.erro, /new row violates row-level security policy/);
      assert.deepEqual(
        await forjadas(),
        [],
        "o comprador deixou um pedido pago gravado em seu nome",
      );
      assert.equal(await totalDePedidos(), 2);
    }),
);

prova(
  "2. o comprador nao cria pedido em nome de OUTRA conta nem sem dono: 42501 e zero linhas",
  () =>
    cenario(async () => {
      for (const [rotulo, dono] of [
        ["conta alheia", U_OUTRA],
        ["user_id NULL", null],
      ]) {
        const t = await P.tentar(
          "authenticated",
          INSERIR,
          [dono, FORJADO],
          COMPRADOR,
        );
        assert.equal(
          t.codigo,
          "42501",
          `INSERT com ${rotulo} devia ser recusado pela RLS (veio: ${t.erro ?? "gravou"})`,
        );
        assert.match(t.erro, /new row violates row-level security policy/);
      }
      assert.deepEqual(
        await forjadas(),
        [],
        "o comprador deixou pedido forjado gravado",
      );
      assert.equal(await totalDePedidos(), 2);
    }),
);

prova(
  "3. o comprador nao apaga o proprio pedido PAGO: 0 linhas e o pedido continua igual",
  () =>
    cenario(async () => {
      const antes = await retratoDoPedido(PEDIDO_DO_CLIENTE);
      assert.ok(antes, "o pedido semeado devia existir");
      const t = await P.tentar(
        "authenticated",
        APAGAR,
        [PEDIDO_DO_CLIENTE],
        COMPRADOR,
      );
      // A RLS de DELETE filtra, nao erra: o erro aqui seria outra coisa (GRANT, FK), e esconderia a prova.
      assert.equal(t.erro, undefined, `o DELETE nao devia errar: ${t.erro}`);
      assert.deepEqual(
        t.linhas,
        [],
        "o comprador apagou o proprio pedido pago",
      );
      assert.equal(
        await retratoDoPedido(PEDIDO_DO_CLIENTE),
        antes,
        "o pedido pago mudou ou sumiu",
      );
      assert.equal(await totalDePedidos(), 2);
    }),
);

prova(
  "4. o comprador nao apaga pedido ALHEIO: 0 linhas e o pedido continua",
  () =>
    cenario(async () => {
      const antes = await retratoDoPedido(PEDIDO_DA_OUTRA);
      assert.ok(antes, "o pedido alheio semeado devia existir");
      const t = await P.tentar(
        "authenticated",
        APAGAR,
        [PEDIDO_DA_OUTRA],
        COMPRADOR,
      );
      assert.equal(t.erro, undefined, `o DELETE nao devia errar: ${t.erro}`);
      assert.deepEqual(
        t.linhas,
        [],
        "o comprador apagou pedido de outra conta",
      );
      assert.equal(await retratoDoPedido(PEDIDO_DA_OUTRA), antes);
      assert.equal(await totalDePedidos(), 2);
    }),
);

prova(
  "5. controle: o admin ATUAL cria e apaga pedido direto (as recusas acima sao da politica, nao do dado)",
  () =>
    cenario(async () => {
      // O MESMO INSERT do cenario 1, pela mesma via (authenticated + JWT), so que o chamador e' o admin atual.
      const ins = await P.tentar(
        "authenticated",
        INSERIR,
        [U_CLIENTE, FORJADO],
        ADMIN,
      );
      assert.equal(ins.erro, undefined, `o admin devia inserir: ${ins.erro}`);
      assert.deepEqual(await forjadas(), [
        {
          user_id: U_CLIENTE,
          total: "0.01",
          status: "delivered",
          payment_status: "pago",
        },
      ]);
      // DELETE do mesmo pedido que o cenario 3 deixou de pé, e de pedido alheio ao admin.
      for (const id of [PEDIDO_DO_CLIENTE, PEDIDO_DA_OUTRA]) {
        const del = await P.tentar("authenticated", APAGAR, [id], ADMIN);
        assert.equal(del.erro, undefined, `o admin devia apagar: ${del.erro}`);
        assert.deepEqual(del.linhas, [{ id }]);
        assert.equal(await retratoDoPedido(id), null, "o pedido devia sumir");
      }
    }),
);

prova(
  "6. so existem as politicas admin de INSERT e de DELETE em marketplace_orders, para authenticated",
  () =>
    cenario(async () => {
      const lista = await politicas();
      const nomes = lista.map((p) => `${p.policyname} (${p.cmd})`);
      assert.deepEqual(
        lista.map((p) => [p.policyname, p.cmd, p.roles, p.permissive]),
        [
          [POLITICA_DELETE, "DELETE", "{authenticated}", "PERMISSIVE"],
          [POLITICA_INSERT, "INSERT", "{authenticated}", "PERMISSIVE"],
        ],
        `politicas permissivas de escrita se somam por OR: ${JSON.stringify(nomes)}`,
      );
      // A RLS precisa estar LIGADA: sem ela as politicas nao valem nada e o privilegio de tabela do comprador abre tudo.
      const rls = (
        await P.conexao().query(
          "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.marketplace_orders'::regclass",
        )
      ).rows[0];
      assert.equal(
        rls.relrowsecurity,
        true,
        "RLS desligada em marketplace_orders",
      );
    }),
);

async function main() {
  if (MUTANTE && !MUTANTES_CONHECIDOS.includes(MUTANTE))
    P.falhar(
      "ERRO",
      `MUTANTE_R111A desconhecido: ${MUTANTE} (validos: ${MUTANTES_CONHECIDOS.join(", ")})`,
    );
  await P.conectar();
  try {
    await P.executar("o comprador nao cria nem apaga pedido direto no banco");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
