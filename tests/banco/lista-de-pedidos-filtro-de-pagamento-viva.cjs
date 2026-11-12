"use strict";

// Somente o clone descartavel de rodar-isolado.cjs, nunca banco de loja.
// Retirar o filtro da contagem infla total_count; retira-lo da pagina mistura
// pagamentos. MUTANTE_R100 sabota um desses alvos por vez, dentro do ROLLBACK.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const ADMIN = "b102d000-0000-4000-8000-000000000001";
const CLIENTE = "b102d000-0000-4000-8000-000000000002";
const FN =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";
const id = (n) => `b102d000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSAO = {
  uid: ADMIN,
  claims: JSON.stringify({
    sub: ADMIN,
    role: "authenticated",
    app_metadata: { role: "admin" },
  }),
};
const PREDICADO = `      AND (
        p_payment_status = 'all'
        OR (p_payment_status = 'sem_cobranca' AND o.payment_status IS NULL)
        OR o.payment_status = p_payment_status
      )
`;
// Datas exclusivas da fixture; outras provas do banco base nao entram na conta.
// Em ordem de criacao: pago, aguardando, NULL, cinco vezes (15 pedidos).
const PEDIDOS = [
  [11, "pago"],
  [12, "aguardando"],
  [13, null],
  [14, "pago"],
  [15, "aguardando"],
  [16, null],
  [17, "pago"],
  [18, "aguardando"],
  [19, null],
  [20, "pago"],
  [21, "aguardando"],
  [22, null],
  [23, "pago"],
  [24, "aguardando"],
  [25, null],
];

async function mutar() {
  const nome = process.env.MUTANTE_R100;
  if (!nome) return;
  assert.ok(
    nome === "pagamento-sem-filtro-na-contagem" ||
      nome === "pagamento-sem-filtro-na-pagina",
    `mutante desconhecido: ${nome}`,
  );
  const c = P.conexao();
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [FN])
    ).rows[0].d.replace(/\r/g, "");
  const original = await ler();
  // Marcador unico separa a contagem da subconsulta que monta a pagina.
  const divisor = "    -- Fetch paginated data";
  assert.equal(original.split(divisor).length - 1, 1, "divisor deve ser unico");
  const [contagem, pagina] = original.split(divisor);
  assert.equal(
    contagem.split(PREDICADO).length - 1,
    1,
    "alvo unico na contagem",
  );
  assert.equal(pagina.split(PREDICADO).length - 1, 1, "alvo unico na pagina");
  const alterado =
    nome === "pagamento-sem-filtro-na-contagem"
      ? contagem.replace(PREDICADO, "") + divisor + pagina
      : contagem + divisor + pagina.replace(PREDICADO, "");
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  assert.equal(
    alterado.split(PREDICADO).length - 1,
    1,
    "o outro filtro deve ficar",
  );
  await c.query(alterado);
  assert.equal(
    await ler(),
    alterado,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function buscar(pagamento, pagina) {
  const [linha] = await P.como(
    "authenticated",
    "SELECT public.get_admin_orders_paged($1,$2,$3,$4,$5,$6,$7,$8) AS r",
    [
      "",
      "all",
      "2002-04-01T00:00:00Z",
      "2002-04-30T23:59:59Z",
      pagina,
      2,
      pagamento,
      "all",
    ],
    SESSAO,
  );
  return {
    ids: linha.r.data.map((o) => o.id),
    total: Number(linha.r.total_count),
  };
}

async function conferir(pagamento, paginas, total) {
  for (const [pagina, numeros] of paginas.entries()) {
    const r = await buscar(pagamento, pagina);
    assert.equal(
      r.total,
      total,
      `CONTAGEM: filtro ${pagamento}, pagina ${pagina} deve contar exatamente ${total}`,
    );
    assert.deepEqual(
      r.ids,
      numeros.map(id),
      `PAGINA: filtro ${pagamento}, pagina ${pagina} misturou pagamento, ordem ou limite`,
    );
  }
  assert.deepEqual(
    await buscar(pagamento, paginas.length),
    { ids: [], total },
    `ULTIMA PAGINA: filtro ${pagamento} deve terminar sem perder a contagem`,
  );
}

prova(
  "pagamento escolhido restringe contagem e todas as paginas; NULL e sem_cobranca",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await c.query(
        `INSERT INTO auth.users (id,email,raw_app_meta_data)
         VALUES ($1,'admin@r102d.fixture.invalid','{"role":"admin"}'),
                ($2,'cliente@r102d.fixture.invalid','{}')`,
        [ADMIN, CLIENTE],
      );
      await c.query(
        `INSERT INTO public.profiles (id,full_name,role)
         VALUES ($1,'Admin Ficticio','admin'),($2,'Cliente Ficticio','customer')`,
        [ADMIN, CLIENTE],
      );
      for (const [numero, pagamento] of PEDIDOS) {
        const criado = `2002-04-${String(numero).padStart(2, "0")}T12:00:00Z`;
        await c.query(
          `INSERT INTO public.marketplace_orders
           (id,user_id,customer_name,customer_data,total,subtotal,status,canal,
            payment_method,payment_status,created_at,updated_at)
           VALUES ($1,$2,'Cliente Ficticio','{}',100,100,'pending','online','pix',$3,$4,$4)`,
          [id(numero), CLIENTE, pagamento, criado],
        );
      }
      const sessao = await P.como(
        "authenticated",
        "SELECT current_user AS papel, auth.uid() AS uid",
        [],
        SESSAO,
      );
      assert.deepEqual(sessao, [{ papel: "authenticated", uid: ADMIN }]);
      // Controle sem filtro ANTES de sabotar: prova que os 15 pedidos existem,
      // intercalados, e que nem a contagem nem a pagina os perdem.
      const todas = [
        [25, 24],
        [23, 22],
        [21, 20],
        [19, 18],
        [17, 16],
        [15, 14],
        [13, 12],
        [11],
      ];
      await conferir("all", todas, 15);
      await mutar();
      await conferir("pago", [[23, 20], [17, 14], [11]], 5);
      await conferir("aguardando", [[24, 21], [18, 15], [12]], 5);
      await conferir("sem_cobranca", [[25, 22], [19, 16], [13]], 5);
      await conferir("all", todas, 15);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar(
      "lista de pedidos filtra pagamento na contagem e na pagina",
    );
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
