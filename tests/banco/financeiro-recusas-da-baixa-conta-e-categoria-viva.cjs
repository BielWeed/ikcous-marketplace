"use strict";

/**
 * Quatro guardas dos corpos VIVOS da 20261199000000: categorias automáticas,
 * tipo da conta de sistema, data futura na BAIXA e conta inativa na BAIXA.
 * Não reaplica migrations: remove uma guarda só no clone, confere a entrada
 * e restaura em finally. Cada cenário roda VERDE -> VERMELHO -> VERDE.
 * Chamadas como authenticated/admin atual, fixtures fictícias e ROLLBACK.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/financeiro-recusas-da-baixa-conta-e-categoria-viva.cjs
 */
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const ADMIN = "7e7e990a-0000-4000-8000-0000000000a1";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const ALUGUEL = "f2000000-0000-4000-8000-000000000020";
const SIG_CATEGORIA = "public.fin_categoria_salvar(jsonb)";
const SIG_CONTA = "public.fin_conta_salvar(jsonb)";
const SIG_BAIXA = "public.fin_lancamento_baixar(uuid,date,uuid)";
const CLAIMS = JSON.stringify({
  sub: ADMIN,
  role: "authenticated",
  app_metadata: { role: "admin" },
});
let C;

async function definicao(sig) {
  return (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
}

async function semearAdmin() {
  await C.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'admin-ficticio@r99.invalid', '{"role":"admin"}'::jsonb)`,
    [ADMIN],
  );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role)
     VALUES ($1, 'Admin fictício R99', 'admin') ON CONFLICT (id) DO NOTHING`,
    [ADMIN],
  );
}

async function emTransacao(corpo) {
  await C.query("BEGIN");
  try {
    await corpo();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Sucesso fica visível; somente a exceção desfaz os efeitos da chamada. */
async function tentar(sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, CLAIMS],
    );
    await C.query("SET LOCAL ROLE authenticated");
    const ator = (
      await C.query(
        "SELECT current_user AS papel, public.is_admin() AS admin, public.rls_admin_atual() AS atual",
      )
    ).rows[0];
    assert.deepEqual(ator, {
      papel: "authenticated",
      admin: true,
      atual: true,
    });
    const r = await C.query(sql, params);
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { resposta: r.rows[0].r };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    // Falha no instrumento não pode se disfarçar de recusa da RPC.
    if (e instanceof assert.AssertionError) throw e;
    return { erro: e.message, codigo: e.code };
  }
}

async function aceita(sql, params = []) {
  const r = await tentar(sql, params);
  assert.equal(r.erro, undefined, `controle válido recusado: ${r.erro}`);
  return r.resposta;
}

function conta(p) {
  return aceita("SELECT public.fin_conta_salvar($1::jsonb) AS r", [
    JSON.stringify(p),
  ]);
}

async function previsto(contaId) {
  const r = await aceita(
    "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
    [
      JSON.stringify({
        tipo: "saida",
        status: "previsto",
        valor: 17.35,
        conta_id: contaId,
        categoria_id: ALUGUEL,
        descricao: "Despesa fictícia R99",
      }),
    ],
  );
  assert.equal(r.ids.length, 1);
  const linha = await lancamento(r.ids[0]);
  assert.equal(linha.status, "previsto");
  assert.equal(linha.data_realizacao, null);
  return r.ids[0];
}

async function lancamento(id) {
  return (
    await C.query(
      "SELECT to_jsonb(l) AS r FROM public.fin_lancamentos l WHERE id = $1",
      [id],
    )
  ).rows[0].r;
}

/** Linhas inteiras e movimentos derivados: recusa não deixa baixa nem efeito lateral. */
async function medir() {
  return (
    await C.query(`SELECT jsonb_build_object(
      'contas', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.fin_contas c),
      'categorias', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.fin_categorias c),
      'lancamentos', (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id), '[]'::jsonb) FROM public.fin_lancamentos l),
      'sessoes', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb) FROM public.fin_caixa_sessoes s),
      'movimentos', (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) FROM public.fin__movimentos(NULL, NULL) m)
    ) AS r`)
  ).rows[0].r;
}

async function recusa(sql, params, frase, marcador) {
  const antes = await medir();
  const r = await tentar(sql, params);
  assert.deepEqual(
    await medir(),
    antes,
    `${marcador}: recusa deixou escrita no banco`,
  );
  assert.equal(
    r.codigo,
    "22023",
    `${marcador}: faltou a exceção 22023 (${r.erro})`,
  );
  assert.equal(r.erro, frase, `${marcador}: recusou por outra guarda`);
}

async function baixaHoje(id, contaId, informarConta = false) {
  const antes = await lancamento(id);
  // O ajudante interno não tem EXECUTE para authenticated: data como parâmetro.
  const hoje = (await C.query("SELECT public.fin__hoje()::text AS d")).rows[0]
    .d;
  const r = await aceita(
    informarConta
      ? "SELECT public.fin_lancamento_baixar($1::uuid, $2::date, $3::uuid) AS r"
      : "SELECT public.fin_lancamento_baixar($1::uuid, $2::date) AS r",
    informarConta ? [id, hoje, contaId] : [id, hoje],
  );
  assert.deepEqual(r, { id, status: "realizado" });
  assert.deepEqual(await lancamento(id), {
    ...antes,
    status: "realizado",
    data_realizacao: hoje,
    conta_id: contaId,
  });
}

const CATEGORIAS = [
  {
    id: "f2000000-0000-4000-8000-000000000001",
    nome: "Vendas",
    natureza: "despesa",
  },
  {
    id: "f2000000-0000-4000-8000-000000000010",
    nome: "Devoluções e estornos",
    natureza: "receita",
  },
];

function categoriaProtegida(cat, campo) {
  return () =>
    emTransacao(async () => {
      const original = (
        await C.query(
          "SELECT to_jsonb(c) AS r FROM public.fin_categorias c WHERE id = $1",
          [cat.id],
        )
      ).rows[0].r;
      assert.equal(original.nome, cat.nome);
      assert.equal(original.ativa, true);
      const valor =
        campo === "natureza"
          ? cat.natureza
          : campo === "grupo_dre"
            ? "fora_dre"
            : false;
      await recusa(
        "SELECT public.fin_categoria_salvar($1::jsonb) AS r",
        [JSON.stringify({ id: cat.id, [campo]: valor })],
        "Esta categoria recebe as vendas e os estornos automaticamente: só o nome pode mudar.",
        "CATEGORIA_AUTOMATICA",
      );
      // Mesma linha: só renomear continua permitido, sem mudar seus outros campos.
      const r = await aceita(
        "SELECT public.fin_categoria_salvar($1::jsonb) AS r",
        [JSON.stringify({ id: cat.id, nome: "Categoria renomeada R99" })],
      );
      assert.deepEqual(r, { id: cat.id });
      const depois = (
        await C.query(
          "SELECT to_jsonb(c) AS r FROM public.fin_categorias c WHERE id = $1",
          [cat.id],
        )
      ).rows[0].r;
      assert.deepEqual(depois, {
        ...original,
        nome: "Categoria renomeada R99",
      });
    });
}

async function tipoDaConta() {
  await emTransacao(async () => {
    const original = (
      await C.query(
        "SELECT to_jsonb(c) AS r FROM public.fin_contas c WHERE id = $1",
        [CAIXA],
      )
    ).rows[0].r;
    assert.equal(original.sistema, true);
    assert.equal(original.tipo, "caixa");
    await recusa(
      "SELECT public.fin_conta_salvar($1::jsonb) AS r",
      [JSON.stringify({ id: CAIXA, tipo: "banco" })],
      "As contas da loja não mudam de tipo.",
      "CONTA_DE_SISTEMA",
    );
    // Controle: uma conta manual pode trocar de tipo pelo mesmo caminho.
    const manual = await conta({ nome: "Conta fictícia R99", tipo: "outro" });
    await conta({ id: manual.id, tipo: "banco" });
    const tipo = (
      await C.query("SELECT tipo FROM public.fin_contas WHERE id = $1", [
        manual.id,
      ])
    ).rows[0].tipo;
    assert.equal(tipo, "banco");
  });
}

async function baixaFutura() {
  await emTransacao(async () => {
    const id = await previsto(BANCO);
    const amanha = (await C.query("SELECT (public.fin__hoje() + 1)::text AS d"))
      .rows[0].d;
    await recusa(
      "SELECT public.fin_lancamento_baixar($1::uuid, $2::date, $3::uuid) AS r",
      [id, amanha, BANCO],
      "A baixa não pode ter data no futuro.",
      "BAIXA_FUTURA",
    );
    await baixaHoje(id, BANCO, true);
  });
}

function baixaInativa(substituta) {
  return () =>
    emTransacao(async () => {
      const manual = await conta({
        nome: "Conta manual fictícia R99",
        tipo: "banco",
      });
      // No segundo cenário o lançamento nasce ATIVO nesta conta, depois desativada.
      const id = await previsto(substituta ? BANCO : manual.id);
      await conta({ id: manual.id, ativa: false });
      assert.equal(
        (
          await C.query("SELECT ativa FROM public.fin_contas WHERE id = $1", [
            manual.id,
          ])
        ).rows[0].ativa,
        false,
      );
      const hoje = (await C.query("SELECT public.fin__hoje()::text AS d"))
        .rows[0].d;
      await recusa(
        substituta
          ? "SELECT public.fin_lancamento_baixar($1::uuid, $2::date, $3::uuid) AS r"
          : "SELECT public.fin_lancamento_baixar($1::uuid, $2::date) AS r",
        substituta ? [id, hoje, manual.id] : [id, hoje],
        "Escolha uma conta ativa.",
        "BAIXA_CONTA_INATIVA",
      );
      if (substituta) {
        await conta({ id: manual.id, ativa: true });
        await baixaHoje(id, manual.id, true);
      } else {
        // Uma substituta ATIVA resolve mesmo com a conta original ainda desligada.
        await baixaHoje(id, BANCO, true);
      }
    });
}

const GUARDAS = [
  {
    nome: "categoria automática",
    sig: SIG_CATEGORIA,
    marcador: /^CATEGORIA_AUTOMATICA:/,
    de: `  IF v_atual.id IN ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000010')
     AND (p ? 'natureza' OR p ? 'grupo_dre' OR (p ? 'ativa' AND NOT (p ->> 'ativa')::boolean)) THEN
    RAISE EXCEPTION 'Esta categoria recebe as vendas e os estornos automaticamente: só o nome pode mudar.'
      USING ERRCODE = '22023';
  END IF;`,
    casos: CATEGORIAS.flatMap((cat) =>
      ["natureza", "grupo_dre", "ativa"].map((campo) => ({
        nome: `${cat.nome}: recusa ${campo}; renomear passa`,
        testar: categoriaProtegida(cat, campo),
      })),
    ),
  },
  {
    nome: "tipo da conta de sistema",
    sig: SIG_CONTA,
    marcador: /^CONTA_DE_SISTEMA:/,
    de: `  IF v_atual.sistema AND p ? 'tipo' AND p ->> 'tipo' IS DISTINCT FROM v_atual.tipo THEN
    RAISE EXCEPTION 'As contas da loja não mudam de tipo.' USING ERRCODE = '22023';
  END IF;`,
    casos: [
      { nome: "Caixa não vira banco; conta manual pode", testar: tipoDaConta },
    ],
  },
  {
    nome: "data futura na baixa",
    sig: SIG_BAIXA,
    marcador: /^BAIXA_FUTURA:/,
    de: `  IF v_data > public.fin__hoje() THEN
    RAISE EXCEPTION 'A baixa não pode ter data no futuro.' USING ERRCODE = '22023';
  END IF;`,
    casos: [
      {
        nome: "amanhã recusa; hoje baixa o mesmo previsto",
        testar: baixaFutura,
      },
    ],
  },
  {
    nome: "conta inativa na baixa",
    sig: SIG_BAIXA,
    marcador: /^BAIXA_CONTA_INATIVA:/,
    de: `  IF NOT EXISTS (SELECT 1 FROM public.fin_contas c WHERE c.id = v_conta AND c.ativa) THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;`,
    casos: [
      {
        nome: "substituta inativa recusa; reativada passa",
        testar: baixaInativa(true),
      },
      {
        nome: "original inativa sem substituta recusa; substituta ativa passa",
        testar: baixaInativa(false),
      },
    ],
  },
];

async function provarGuarda(g, original) {
  for (const caso of g.casos) {
    await caso.testar();
    console.log(`  VERDE    ${caso.nome}`);
  }
  const normalizada = original.replace(/\r\n/g, "\n");
  assert.equal(
    normalizada.split(g.de).length - 1,
    1,
    `âncora não é única: ${g.nome}`,
  );
  const mutante = normalizada.replace(g.de, "");
  assert.notEqual(mutante, normalizada);
  const falhas = [];
  try {
    await C.query(mutante);
    assert.equal(
      await definicao(g.sig),
      mutante,
      "mutante não entrou no banco",
    );
    for (const caso of g.casos) {
      let pego;
      try {
        await caso.testar();
      } catch (e) {
        pego = e;
      }
      falhas.push({ caso, pego });
    }
  } finally {
    await C.query(original);
    assert.equal(
      await definicao(g.sig),
      original,
      "corpo vivo não foi restaurado",
    );
  }
  for (const { caso, pego } of falhas) {
    assert.ok(
      pego instanceof assert.AssertionError,
      `MUTANTE SOBREVIVEU ou erro SQL: ${pego?.stack}`,
    );
    assert.match(pego.message, g.marcador, "mutante caiu pelo motivo errado");
    console.log(`  VERMELHO ${caso.nome}: ${pego.message.split("\n")[0]}`);
  }
  for (const caso of g.casos) {
    await caso.testar();
    console.log(`  VERDE    restaurado: ${caso.nome}`);
  }
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url, statement_timeout: 10000 });
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: não mutar banco base",
    );
    const originais = new Map();
    for (const sig of [SIG_CATEGORIA, SIG_CONTA, SIG_BAIXA]) {
      originais.set(sig, await definicao(sig));
      const hash = await C.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      );
      console.log(`Corpo VIVO ${sig}: ${hash.rows[0].h}`);
    }
    await semearAdmin();
    const antes = await medir();
    for (const g of GUARDAS) await provarGuarda(g, originais.get(g.sig));
    assert.deepEqual(await medir(), antes, "a bateria deixou dados no clone");
    for (const [sig, original] of originais) {
      assert.equal(
        await definicao(sig),
        original,
        "bateria deixou corpo alterado",
      );
    }
    console.log(
      "\nfinanceiro-recusas-da-baixa-conta-e-categoria-viva: 4/4 guardas; 10/10 cenários verde/vermelho/verde; dados e corpos intactos",
    );
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) =>
  falhar("FINANCEIRO-RECUSAS", erro.stack ?? String(erro)),
);
