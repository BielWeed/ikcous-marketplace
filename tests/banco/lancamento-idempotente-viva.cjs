"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- arquivos fixos do repositório. */
/**
 * PG17 EFÊMERO, clone exclusivo (rodar-isolado.cjs); nunca banco real.
 * Exercita a RPC como authenticated, com os gates reais, e duas conexões reais.
 * A concorrência só é considerada observada depois de pg_blocking_pids apontar A.
 * Mutantes rodam a MESMA prova que antes passou como controle, sem mocks de SQL.
 */
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const NOME = "20261246000000_o_lancamento_repetido_nao_duplica.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const extrair = (s) =>
  s.match(
    /CREATE OR REPLACE FUNCTION public\.fin_lancamento_salvar\(p jsonb\)[\s\S]*?\n\$\$;/,
  )[0];
const NOVA = extrair(MIGRATION);
const ANTIGA = extrair(
  ler("20261199000000_portas_do_painel_exigem_admin_atual.sql"),
);
const md5 = (s) =>
  createHash("md5").update(s.split("AS $$")[1].slice(0, -3)).digest("hex");
const H_ANTES = "559a13a9d69e02e5048623685cd07514";
const H_NOVO = md5(NOVA);
const ADMIN = "fa460000-0000-4000-8000-000000000001";
const CLIENTE = "fa460000-0000-4000-8000-000000000002";
const REBAIXADO_PERFIL = "fa460000-0000-4000-8000-000000000003";
const REBAIXADO_AUTH = "fa460000-0000-4000-8000-000000000004";
const CONTA = "f1000000-0000-4000-8000-000000000002";
const DESTINO = "f1000000-0000-4000-8000-000000000001";
const CATEGORIA = "f2000000-0000-4000-8000-000000000020";
let hoje;

const simples = (extra = {}) => ({
  tipo: "saida",
  valor: 100,
  conta_id: CONTA,
  categoria_id: CATEGORIA,
  descricao: "Aluguel da prova",
  data_competencia: hoje,
  status: "previsto",
  data_vencimento: hoje,
  ...extra,
});
const cenarios = () => [
  simples(),
  simples({ parcelas: 3, valor: 100.01 }),
  {
    tipo: "transferencia",
    valor: 15,
    conta_id: CONTA,
    conta_destino_id: DESTINO,
    descricao: "Transferência da prova",
    data_competencia: hoje,
    data_realizacao: hoje,
    status: "realizado",
  },
];
async function transacao(c, fn) {
  await c.query("BEGIN");
  try {
    const r = await fn();
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
async function entrar(
  c,
  uid = ADMIN,
  papelJwt = "admin",
  papel = "authenticated",
) {
  assert(["authenticated", "anon", "service_role"].includes(papel));
  await c.query(`SET LOCAL ROLE ${papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [
      uid,
      JSON.stringify({
        sub: uid,
        role: papel,
        app_metadata: { role: papelJwt },
      }),
    ],
  );
}
const chamar = async (c, p) =>
  (
    await c.query("SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
      JSON.stringify(p),
    ])
  ).rows[0].r;
const salvar = (c, p, uid = ADMIN, jwt = "admin") =>
  transacao(c, async () => {
    await entrar(c, uid, jwt);
    return chamar(c, p);
  });
const total = async (c) =>
  (await c.query("SELECT count(*)::int AS n FROM public.fin_lancamentos"))
    .rows[0].n;
const tentativas = async (c) =>
  (
    await c.query(
      "SELECT coalesce(jsonb_agg(t ORDER BY chave), '[]') AS r FROM public.fin_lancamento_tentativas t",
    )
  ).rows[0].r;
const hashVivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = 'public.fin_lancamento_salvar(jsonb)'::regprocedure",
    )
  ).rows[0].h;
const erro = (code, texto) => (e) =>
  e.code === code && (!texto || e.message.includes(texto));

async function semente(c) {
  for (const [id, role] of [
    [ADMIN, "admin"],
    [CLIENTE, "customer"],
    [REBAIXADO_PERFIL, "admin"],
    [REBAIXADO_AUTH, "admin"],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, ($1::uuid)::text || '@tentativa.teste', jsonb_build_object('role', $2::text))",
      [id, role],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Prova tentativa', $2) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role",
      [id, role],
    );
  }
  // O gatilho sincroniza profiles -> auth; recria divergência nas DUAS direções.
  // O rebaixamento pelo app é feito por um admin ATUAL (tr_prevent_role_change exige is_admin() e is_admin_atual()).
  await c.query("BEGIN");
  await c.query(
    "SELECT set_config('request.jwt.claims', $1, true), set_config('app.rpc.user_id', $2, true)",
    [
      JSON.stringify({
        sub: ADMIN,
        role: "authenticated",
        app_metadata: { role: "admin" },
      }),
      ADMIN,
    ],
  );
  await c.query("UPDATE public.profiles SET role = 'customer' WHERE id = $1", [
    REBAIXADO_PERFIL,
  ]);
  await c.query("COMMIT");
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\' WHERE id = $1',
    [REBAIXADO_PERFIL],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"customer"}\' WHERE id = $1',
    [REBAIXADO_AUTH],
  );
  hoje = (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0].d;
}

async function repeticao(c, base = simples()) {
  const p = { ...base, chave_idempotencia: randomUUID() };
  const n = await total(c);
  const a = await salvar(c, p);
  // Reordena também o objeto: jsonb, não a serialização do JavaScript, decide igualdade.
  const b = await salvar(c, Object.fromEntries(Object.entries(p).reverse()));
  assert.deepEqual(b, a, "mesma tentativa deve devolver os MESMOS ids");
  assert.equal(a.ids.length, p.parcelas ?? 1);
  assert.equal(
    await total(c),
    n + a.ids.length,
    "repetir gravou outro lançamento/parcela",
  );
  const guardado = (
    await c.query(
      "SELECT ids, conteudo_hash FROM public.fin_lancamento_tentativas WHERE chave = $1",
      [p.chave_idempotencia],
    )
  ).rows[0];
  assert.deepEqual(guardado.ids, a.ids);
  assert.equal(
    guardado.conteudo_hash,
    (
      await c.query(
        "SELECT md5(($1::jsonb - 'chave_idempotencia')::text) AS h",
        [JSON.stringify(p)],
      )
    ).rows[0].h,
  );
}
async function divergente(c) {
  const p = simples({ chave_idempotencia: randomUUID() });
  await salvar(c, p);
  const n = await total(c);
  const antes = await tentativas(c);
  await assert.rejects(
    salvar(c, { ...p, valor: 101 }),
    erro("22023", "Esta tentativa já foi usada para outro lançamento"),
  );
  assert.equal(await total(c), n);
  assert.deepEqual(await tentativas(c), antes);
}

/** Não basta dormir: espera o Postgres mostrar B bloqueado especificamente por A. */
async function observarEspera(c, pidA, pidB) {
  for (let i = 0; i < 150; i++) {
    const r = await c.query(
      "SELECT wait_event_type, pg_blocking_pids(pid) AS bloqueadores FROM pg_stat_activity WHERE pid = $1",
      [pidB],
    );
    if (
      r.rows[0]?.wait_event_type === "Lock" &&
      r.rows[0].bloqueadores.includes(pidA)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("B não foi observado esperando A no Postgres");
}
async function corrida(c, url, abortar = false) {
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  let pendente;
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    await a.query("SET LOCAL statement_timeout = '8s'");
    await b.query("SET LOCAL statement_timeout = '8s'");
    const pidA = (await a.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await entrar(a);
    await entrar(b);
    const p = simples({ parcelas: 3, chave_idempotencia: randomUUID() });
    const n = await total(c);
    const rA = await chamar(a, p);
    pendente = chamar(b, p).then(
      (r) => ({ r }),
      (e) => ({ e }),
    );
    await observarEspera(c, pidA, pidB);
    await a.query(abortar ? "ROLLBACK" : "COMMIT");
    const rB = await pendente;
    if (rB.e) throw rB.e;
    await b.query("COMMIT");
    if (abortar)
      assert.notDeepEqual(rB.r.ids, rA.ids, "B deve criar depois que A aborta");
    else
      assert.deepEqual(rB.r, rA, "duas conexões precisam obter os mesmos ids");
    assert.equal(await total(c), n + 3, "a corrida gravou parcelas em dobro");
    assert.deepEqual(
      (
        await c.query(
          "SELECT ids FROM public.fin_lancamento_tentativas WHERE chave = $1",
          [p.chave_idempotencia],
        )
      ).rows[0].ids,
      rB.r.ids,
    );
  } finally {
    // Libera A antes de aguardar B inclusive na falha de uma asserção.
    await a.query("ROLLBACK").catch(() => {});
    if (pendente) await pendente;
    await b.query("ROLLBACK").catch(() => {});
    await a.end();
    await b.end();
  }
}

async function atomicidade(c) {
  const chave = randomUUID();
  const n = await total(c);
  // Falha na SEGUNDA parcela: comprova que reserva e primeira parcela existiam antes do erro.
  await c.query(`CREATE FUNCTION public.prova_246_abortar() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.descricao = 'ABORTAR (2/3)' THEN
        IF NOT EXISTS (SELECT 1 FROM public.fin_lancamento_tentativas WHERE chave = '${chave}')
           OR NOT EXISTS (SELECT 1 FROM public.fin_lancamentos WHERE descricao = 'ABORTAR (1/3)') THEN
          RAISE EXCEPTION 'fixture não chegou depois da reserva e primeira parcela' USING ERRCODE = 'P0047';
        END IF;
        RAISE EXCEPTION 'aborto depois da reserva' USING ERRCODE = 'P0046';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER prova_246_abortar BEFORE INSERT ON public.fin_lancamentos
    FOR EACH ROW EXECUTE FUNCTION public.prova_246_abortar()`);
  try {
    await assert.rejects(
      salvar(
        c,
        simples({
          descricao: "ABORTAR",
          parcelas: 3,
          chave_idempotencia: chave,
        }),
      ),
      erro("P0046"),
    );
    assert.equal(await total(c), n);
    assert.equal(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM public.fin_lancamento_tentativas WHERE chave = $1",
          [chave],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await c.query(
      "DROP TRIGGER prova_246_abortar ON public.fin_lancamentos; DROP FUNCTION public.prova_246_abortar()",
    );
  }
  assert.equal(
    (
      await salvar(
        c,
        simples({
          descricao: "ABORTAR",
          parcelas: 3,
          chave_idempotencia: chave,
        }),
      )
    ).ids.length,
    3,
  );
}

async function portas(c, url) {
  for (const papel of ["anon", "authenticated", "service_role"]) {
    for (const privilegio of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ]) {
      assert.equal(
        (
          await c.query(
            "SELECT has_table_privilege($1, 'public.fin_lancamento_tentativas', $2) AS sim",
            [papel, privilegio],
          )
        ).rows[0].sim,
        false,
        `${papel} tem ${privilegio}`,
      );
    }
    for (const sql of [
      "SELECT * FROM public.fin_lancamento_tentativas",
      "INSERT INTO public.fin_lancamento_tentativas VALUES (gen_random_uuid(), 'x', '{}', now())",
      "UPDATE public.fin_lancamento_tentativas SET ids = '{}'",
      "DELETE FROM public.fin_lancamento_tentativas",
    ]) {
      await assert.rejects(
        transacao(c, async () => {
          await entrar(c, ADMIN, "admin", papel);
          await c.query(sql);
        }),
        erro("42501"),
      );
    }
  }
  assert.equal(
    (
      await c.query(
        "SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.fin_lancamento_tentativas'::regclass",
      )
    ).rows[0].rls,
    true,
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM pg_policy WHERE polrelid = 'public.fin_lancamento_tentativas'::regclass",
      )
    ).rows[0].n,
    0,
  );
  const trava = new Client({ connectionString: url });
  await trava.connect();
  const foto = await tentativas(c);
  try {
    await trava.query(
      "BEGIN; LOCK TABLE public.fin_lancamento_tentativas IN ACCESS EXCLUSIVE MODE",
    );
    for (const [uid, jwt] of [
      [CLIENTE, "customer"],
      [REBAIXADO_PERFIL, "admin"],
      [REBAIXADO_AUTH, "admin"],
    ]) {
      await assert.rejects(
        transacao(c, async () => {
          await c.query("SET LOCAL statement_timeout = '1s'");
          await entrar(c, uid, jwt);
          await chamar(c, simples({ chave_idempotencia: randomUUID() }));
        }),
        erro("42501", "Acesso negado"),
      );
    }
    // Se o gate tocasse a tabela, a trava acima faria timeout em vez de 42501.
  } finally {
    await trava.query("ROLLBACK");
    await trava.end();
  }
  assert.deepEqual(await tentativas(c), foto);
}

/** Compara as DUAS funções no MESMO banco, inclusive as linhas e o JSON, com IDs normalizados. */
async function executarIsolado(c, def, p, editar = false) {
  await c.query("BEGIN");
  try {
    await c.query(def);
    await entrar(c);
    let resposta = await chamar(c, p);
    if (editar)
      resposta = await chamar(c, {
        ...p,
        id: resposta.ids[0],
        valor: 77,
        descricao: "Editado",
        chave_idempotencia: "ignorada-na-edicao",
      });
    await c.query("RESET ROLE");
    const linhas = (
      await c.query(
        `SELECT to_jsonb(l) - 'id' - 'grupo_parcelas' AS r,
       grupo_parcelas AS grupo FROM public.fin_lancamentos l
       WHERE id = ANY($1::uuid[]) ORDER BY parcela NULLS FIRST`,
        [resposta.ids],
      )
    ).rows;
    // now() varia entre as duas transações, mas os demais dados devem ser idênticos.
    const grupos = new Map();
    for (const l of linhas) {
      l.r.created_at = undefined;
      l.r.updated_at = undefined;
      if (l.grupo !== null) {
        if (!grupos.has(l.grupo)) grupos.set(l.grupo, grupos.size);
        l.grupo = grupos.get(l.grupo);
      }
    }
    assert.deepEqual(Object.keys(resposta), ["ids"]);
    assert.equal(linhas.length, resposta.ids.length);
    assert.equal(new Set(resposta.ids).size, resposta.ids.length);
    return { resposta: { ids: resposta.ids.map((_, i) => i) }, linhas };
  } finally {
    await c.query("ROLLBACK");
  }
}
async function compatibilidade(c) {
  for (const p of [
    ...cenarios(),
    simples({ status: "realizado", data_realizacao: hoje }),
  ]) {
    assert.deepEqual(
      await executarIsolado(c, NOVA, p),
      await executarIsolado(c, ANTIGA, p),
      "sem chave mudou o resultado ou as linhas",
    );
  }
  assert.deepEqual(
    await executarIsolado(c, NOVA, simples(), true),
    await executarIsolado(c, ANTIGA, simples(), true),
    "edição mudou",
  );
  const n = await total(c);
  const a = await salvar(c, simples());
  const b = await salvar(c, simples());
  assert.notDeepEqual(a.ids, b.ids);
  assert.equal(
    await total(c),
    n + 2,
    "front antigo sem chave deve continuar criando",
  );
  const antes = await tentativas(c);
  await assert.rejects(
    salvar(c, simples({ chave_idempotencia: "invalida" })),
    erro("22023", "Chave de tentativa inválida."),
  );
  assert.deepEqual(await tentativas(c), antes);
  // Vazio é ausência; edição ignora até mesmo chave inválida (comportamento anterior).
  await salvar(c, simples({ chave_idempotencia: "" }));
}

async function catalogo(c) {
  return (
    await c.query(`SELECT pg_get_functiondef(oid) AS def, proacl::text AS acl, proconfig, proowner
    FROM pg_proc WHERE oid = 'public.fin_lancamento_salvar(jsonb)'::regprocedure`)
  ).rows[0];
}
async function aplicacao(c) {
  const foto = await catalogo(c);
  const linhas = await tentativas(c);
  const n = await total(c);
  await transacao(c, () => c.query(MIGRATION));
  await transacao(c, () => c.query(MIGRATION));
  assert.deepEqual(await catalogo(c), foto, "aplicar 2x alterou função/ACL");
  assert.deepEqual(await tentativas(c), linhas);
  assert.equal(await total(c), n);
  await transacao(c, () => c.query(ROLLBACK));
  assert.equal(await hashVivo(c), H_ANTES);
  assert.deepEqual(await tentativas(c), linhas, "rollback apagou tentativas");
  await transacao(c, () => c.query(ROLLBACK));
  assert.equal(await hashVivo(c), H_ANTES);
  await transacao(c, () => c.query(MIGRATION));
  assert.deepEqual(await catalogo(c), foto);
  assert.deepEqual(await tentativas(c), linhas);

  await c.query("BEGIN");
  try {
    await c.query(
      ANTIGA.replace("\nEND;\n$$;", () => "\n-- corpo estranho\nEND;\n$$;"),
    );
    await c.query("DROP TABLE public.fin_lancamento_tentativas");
    const estranho = await catalogo(c);
    await c.query("SAVEPOINT prova_preflight");
    await assert.rejects(
      c.query(MIGRATION),
      erro("P0001", "B1_BASELINE_DIVERGENT"),
    );
    await c.query("ROLLBACK TO SAVEPOINT prova_preflight");
    assert.deepEqual(await catalogo(c), estranho);
    assert.equal(
      (
        await c.query(
          "SELECT to_regclass('public.fin_lancamento_tentativas') AS t",
        )
      ).rows[0].t,
      null,
      "pré-voo escreveu antes de recusar",
    );
  } finally {
    await c.query("ROLLBACK");
  }
  for (const sql of [
    "ALTER FUNCTION public.fin_lancamento_salvar(jsonb) SET search_path = pg_catalog",
    "GRANT EXECUTE ON FUNCTION public.fin_lancamento_salvar(jsonb) TO anon",
    "CREATE FUNCTION public.fin_lancamento_salvar(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
    "ALTER TABLE public.fin_lancamento_tentativas DISABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.fin_lancamento_tentativas DROP CONSTRAINT fin_lancamento_tentativas_pkey",
  ]) {
    await c.query("BEGIN");
    try {
      await c.query(sql);
      const antesDaRecusa = await catalogo(c);
      await c.query("SAVEPOINT preflight_atributos");
      await assert.rejects(
        c.query(MIGRATION),
        erro("P0001", "B1_BASELINE_DIVERGENT"),
      );
      await c.query("ROLLBACK TO SAVEPOINT preflight_atributos");
      assert.deepEqual(
        await catalogo(c),
        antesDaRecusa,
        "pré-voo sobrescreveu atributo/ACL divergente",
      );
      assert.deepEqual(await tentativas(c), linhas);
    } finally {
      await c.query("ROLLBACK");
    }
  }
  // Forma errada da tabela também é recusada, sem "consertar" silenciosamente.
  await c.query("BEGIN");
  try {
    await c.query(
      "ALTER TABLE public.fin_lancamento_tentativas ADD COLUMN estranha text",
    );
    await c.query("SAVEPOINT forma");
    await assert.rejects(
      c.query(MIGRATION),
      erro("P0001", "B1_BASELINE_DIVERGENT"),
    );
    await c.query("ROLLBACK TO SAVEPOINT forma");
    assert.deepEqual(await catalogo(c), foto);
  } finally {
    await c.query("ROLLBACK");
  }

  await assert.rejects(
    transacao(c, () => c.query(DESTRUTIVO)),
    erro("P0001", "SO_COM_O_DONO"),
  );
  await assert.rejects(
    transacao(c, async () => {
      await c.query(
        "SET LOCAL app.confirmo_apagar_tentativas_financeiras = 'APAGAR'",
      );
      await c.query(DESTRUTIVO);
    }),
    erro("P0001", "ROLLBACK_COMUM_PRIMEIRO"),
  );
  await c.query("BEGIN");
  try {
    await c.query(ROLLBACK);
    await c.query(
      "SET LOCAL app.confirmo_apagar_tentativas_financeiras = 'APAGAR'",
    );
    await c.query(DESTRUTIVO);
    assert.equal(
      (
        await c.query(
          "SELECT to_regclass('public.fin_lancamento_tentativas') AS t",
        )
      ).rows[0].t,
      null,
    );
    await c.query(DESTRUTIVO); // destrutivo idempotente
    await c.query(MIGRATION); // aplica também com tabela ausente
    assert.deepEqual(await tentativas(c), []);
    assert.equal(await total(c), n);
  } finally {
    await c.query("ROLLBACK");
  }
}

async function portao(c) {
  const A = "49a-conferir-lancamento-idempotente-aplicado";
  const B = "49b-antes-lancamento-idempotente-base-vigente";
  const consulta = async (nome) => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../scripts/publicacao/consultas", `${nome}.sql`),
      "utf8",
    );
    assert.equal(CONF.contarStatements(sql), 1);
    // Só catálogo: executa como papel de API, nunca como dono para mascarar visibilidade.
    await c.query("SAVEPOINT leitura_catalogo");
    try {
      await c.query("SET LOCAL ROLE authenticated");
      const rows = (await c.query(sql)).rows;
      const rol = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA)).get(
        nome,
      );
      assert.equal(CONF.estruturaDoRolFechado(rows, rol), null);
      return rows;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
    }
  };
  const positivas = (rows) => rows.every((r) => r.ok === true);
  await c.query("BEGIN");
  try {
    assert(positivas(await consulta(A)));
    assert(!positivas(await consulta(B)));
    const mutacoes = [
      [
        "corpo conhecido",
        NOVA.replace("\nEND;\n$$;", () => "\n-- estranho\nEND;\n$$;"),
      ],
      [
        "atributos",
        "ALTER FUNCTION public.fin_lancamento_salvar(jsonb) SET search_path = pg_catalog",
      ],
      [
        "EXECUTE",
        "GRANT EXECUTE ON FUNCTION public.fin_lancamento_salvar(jsonb) TO anon",
      ],
      [
        "forma conhecida",
        "ALTER TABLE public.fin_lancamento_tentativas ADD COLUMN estranha text",
      ],
      [
        "so servidor",
        "GRANT SELECT ON public.fin_lancamento_tentativas TO service_role",
      ],
    ];
    for (const [item, sql] of mutacoes) {
      await c.query("SAVEPOINT mutacao_portao");
      await c.query(sql);
      const ruins = (await consulta(A)).filter((r) => r.ok !== true);
      assert.equal(ruins.length, 1, `49a deve reprovar somente ${item}`);
      assert(
        ruins.some((r) => r.item.includes(item)),
        `49a não reprovou ${item}`,
      );
      await c.query("ROLLBACK TO SAVEPOINT mutacao_portao");
    }
    await c.query(ROLLBACK);
    assert(
      positivas(await consulta(B)),
      "49b aceita a tabela preservada pelo rollback",
    );
    assert(!positivas(await consulta(A)));
    await c.query(
      "SET LOCAL app.confirmo_apagar_tentativas_financeiras = 'APAGAR'",
    );
    await c.query(DESTRUTIVO);
    assert(positivas(await consulta(B)), "49b aceita a tabela ausente");
    assert(!positivas(await consulta(A)));
  } finally {
    await c.query("ROLLBACK");
  }
}

async function mutante(c, nome, alterada, prova) {
  assert.notEqual(alterada, NOVA, `mutante ${nome} não mudou o corpo`);
  await prova(); // controle obrigatoriamente verde
  let motivo;
  await c.query(alterada);
  try {
    await prova();
  } catch (e) {
    motivo = e;
  } finally {
    await c.query(NOVA);
  }
  assert(motivo, `MUTANTE SOBREVIVEU: ${nome}`);
  assert(
    motivo.code === "23505" || motivo.code === "ERR_ASSERTION",
    `mutante morreu por erro inesperado: ${motivo.message}`,
  );
  console.log(`    mutante morto: ${nome}: ${motivo.message}`);
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(md5(ANTIGA), H_ANTES);
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
  };
  try {
    assert.equal(
      await hashVivo(c),
      H_NOVO,
      "clone deve estar com a migration nova",
    );
    await semente(c);
    await provar("replay: despesa, três parcelas e transferência", async () => {
      for (const p of cenarios()) await repeticao(c, p);
    });
    await provar("mesma chave com conteúdo diferente recusa sem gravar", () =>
      divergente(c),
    );
    await provar(
      "corrida real: B espera o commit de A, mesmos ids, só três parcelas",
      () => corrida(c, url),
    );
    await provar("corrida real: A aborta, B cria uma única vez", () =>
      corrida(c, url, true),
    );
    await provar(
      "erro depois da reserva e da primeira parcela desfaz tudo",
      () => atomicidade(c),
    );
    await provar("ACL/RLS e gates antes de qualquer acesso à tabela", () =>
      portas(c, url),
    );
    await provar(
      "corpos antigo/novo no mesmo banco: sem chave e edição idênticos",
      () => compatibilidade(c),
    );
    await provar("apply 2x, rollback, pré-voo e destrutivo protegido", () =>
      aplicacao(c),
    );
    await provar(
      "portão 49a/49b: catálogo real, rollback e negativos por objeto",
      () => portao(c),
    );
    await provar("mutantes: conflito, hash e reserva tardia", async () => {
      await mutante(
        c,
        "sem ON CONFLICT",
        NOVA.replace("    ON CONFLICT (chave) DO NOTHING;", "    ;"),
        () => repeticao(c),
      );
      await mutante(
        c,
        "sem comparação do hash",
        NOVA.replace(
          "IF v_hash_gravado IS DISTINCT FROM v_conteudo_hash THEN",
          "IF false THEN",
        ),
        () => divergente(c),
      );
      const ini = NOVA.indexOf("  -- Reserva a tentativa ANTES");
      const fim =
        NOVA.indexOf("  -- Fim da reserva da tentativa.\n\n") +
        "  -- Fim da reserva da tentativa.\n\n".length;
      const bloco = NOVA.slice(ini, fim);
      const tardia = NOVA.replace(bloco, "").replace(
        "  -- Guarda o resultado na MESMA transação",
        `${bloco}  -- Guarda o resultado na MESMA transação`,
      );
      await mutante(c, "reserva só depois das parcelas", tardia, () =>
        corrida(c, url),
      );
    });
    console.log(
      `\nlancamento-idempotente-viva: ${provas} ok; 3 mutantes mortos`,
    );
    anexarAoSummary(
      "Lançamento idempotente (PG17)",
      `${provas} provas, duas conexões com bloqueio observado, 3 mutantes mortos.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("LANCAMENTO_IDEMPOTENTE", e.message));
