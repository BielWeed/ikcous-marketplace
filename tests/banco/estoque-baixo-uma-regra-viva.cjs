"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (P, PRODUTOS) ou
 * do catálogo do Postgres efêmero; nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA das migrations 20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql
 * e 20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * A REGRA (ÚNICA): produto ativo e não apagado está com estoque baixo quando
 * o ESTOQUE EFETIVO (soma de `stock_increment` das variações ATIVAS se houver
 * alguma; senão `produtos.estoque`) <= COALESCE(estoque_minimo, 5).
 *
 * O QUE SE PROVA (tudo por DELTA: o clone pode já ter produto):
 *   (1) nove produtos — A sem variação, 4, mínimo NULL (baixo); B 5, NULL
 *       (baixo, borda); C 6, NULL (não); D 8, mínimo 10 (baixo); E 1, mínimo
 *       0 (não: zero é "não me avise"); F variações ativas 0 e 10 (NÃO: soma
 *       10 — a regra antiga contava pela variação 0); G ativas 2+2 e uma
 *       inativa 50 (baixo: soma 4); H inativo com 0 (não); I apagado (não).
 *       `painel_inicio()->'pendencias'->>'estoque_baixo'` =
 *       `get_admin_analytics_v2(90)->>'inventoryAlerts'` = a conta do front
 *       (cópia de `precisaDeReposicao` e da régua de `mapProductFromDB`) =
 *       `get_admin_products_paged('', 'all', 'active', 'low', 0, 100)->>
 *       'total_count'` = +4; e o filtro 'low' devolve exatamente A, B, D e G.
 *   (2) CONTROLE: com o corpo antigo (o rollback-manual aplicado dentro de
 *       transação desfeita) o Início dá outro número (+3: D, F, G) e o filtro
 *       'low' devolve outros produtos (A, B, E, F: `p.estoque <= 5` cru) — é a
 *       migration, e não outra coisa, que alinha.
 *   (3) a porta: cliente comum recusado com 42501; o corpo vivo é o que o
 *       preflight declara.
 *   (4) reaplicar a migration 2x deixa a impressão digital igual.
 *   (5) preflight sobre corpo divergente recusa (B1_BASELINE_DIVERGENT) sem
 *       escrever nada.
 *   (6) rollback-manual: volta ao md5 da 20261199000000; `prosecdef`,
 *       `proconfig`, `proacl`, volatilidade e dono iguais antes/depois; o
 *       segundo rollback recusa sem escrever; reaplicar volta ao corpo desta.
 *   (7) 20261213000000: `p_stock = 'all'` e a busca (com e sem acento)
 *       devolvem exatamente o mesmo que o corpo da baseline; reaplicar 2x não
 *       muda a impressão digital; corpo divergente recusa sem escrever; o
 *       rollback volta ao md5 da baseline com SECURITY DEFINER, search_path,
 *       ACL e dono iguais, e o segundo rollback recusa.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/estoque-baixo-uma-regra-viva.cjs
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

const RAIZ = path.join(__dirname, "..", "..");
const DIR_MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");

const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const NOME_12 =
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql";
const NOME_13 =
  "20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql";
const M12 = ler(NOME_12);
const RB12 = ler(`rollback-manual-${NOME_12}`);
const M13 = ler(NOME_13);
const RB13 = ler(`rollback-manual-${NOME_13}`);

// Os hashes (md5 de prosrc sem \r) de antes e de depois, lidos do PREFLIGHT
// da própria migration — a prova de texto amarra cada um ao md5 real do corpo.
function hashesDoPreflight(sql, assinatura) {
  const ini = sql.indexOf(`('${assinatura}', '`);
  const m =
    ini < 0
      ? null
      : /^\('[^']*', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/.exec(sql.slice(ini));
  assert.ok(m, `o preflight não cita os dois hashes de ${assinatura}`);
  return { vigente: m[1], desta: m[2] };
}
const PAINEL = "public.painel_inicio()";
const H12 = hashesDoPreflight(M12, PAINEL);
// O corpo que a 20261199000000 deixa (o "desta" dela) é o vigente da 12.
const H99 = hashesDoPreflight(ler(NOME_99), PAINEL);
const FILTRO =
  "public.get_admin_products_paged(text,text,text,text,integer,integer)";
const H13 = hashesDoPreflight(M13, FILTRO);

const U_ADMIN = "e5bb0000-0000-4000-8000-000000000001";
const U_CLIENTE = "e5bb0000-0000-4000-8000-000000000002";
const P = {
  A: "e5ba0000-0000-4000-8000-00000000000a",
  B: "e5ba0000-0000-4000-8000-00000000000b",
  C: "e5ba0000-0000-4000-8000-00000000000c",
  D: "e5ba0000-0000-4000-8000-00000000000d",
  E: "e5ba0000-0000-4000-8000-00000000000e",
  F: "e5ba0000-0000-4000-8000-00000000000f",
  G: "e5ba0000-0000-4000-8000-000000000010",
  H: "e5ba0000-0000-4000-8000-000000000011",
  I: "e5ba0000-0000-4000-8000-000000000012",
};
// `variacoes`: [stock_increment, active]. `baixo`: a regra da loja.
const PRODUTOS = [
  { id: P.A, nome: "A sem variação", estoque: 4, minimo: null, baixo: true },
  { id: P.B, nome: "B na borda", estoque: 5, minimo: null, baixo: true },
  { id: P.C, nome: "C acima", estoque: 6, minimo: null, baixo: false },
  { id: P.D, nome: "D mínimo próprio", estoque: 8, minimo: 10, baixo: true },
  { id: P.E, nome: "E não me avise", estoque: 1, minimo: 0, baixo: false },
  {
    id: P.F,
    nome: "F soma 10",
    estoque: 0,
    minimo: null,
    variacoes: [
      [0, true],
      [10, true],
    ],
    baixo: false,
  },
  {
    id: P.G,
    nome: "G soma 4",
    estoque: 50,
    minimo: null,
    variacoes: [
      [2, true],
      [2, true],
      [50, false],
    ],
    baixo: true,
  },
  {
    id: P.H,
    nome: "H inativo",
    estoque: 0,
    minimo: null,
    ativo: false,
    baixo: false,
  },
  {
    id: P.I,
    nome: "I apagado",
    estoque: 0,
    minimo: null,
    apagado: true,
    baixo: false,
  },
];
const ESPERADO = PRODUTOS.filter((p) => p.baixo).length; // 4

// ── A conta do front, copiada ──
// src/utils/avisos-do-lojista.ts:70-75 (precisaDeReposicao) e a régua de
// estoque de src/lib/mappers.ts (mapProductFromDB). A prova (1) confere que o
// texto de origem ainda é este.
const LIMIAR_PADRAO_DE_ESTOQUE = 5;
const precisaDeReposicao = (estoque, estoqueMinimo) =>
  estoque <= (estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE);
function estoqueEfetivo(row) {
  const stock = Number(row.estoque ?? row.stock ?? 0);
  return Array.isArray(row.product_variants) &&
    row.product_variants.some((v) => v.active)
    ? row.product_variants.reduce(
        (acc, v) => acc + (v.active ? Number(v.stock_increment) || 0 : 0),
        0,
      )
    : stock;
}

async function logar(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [uid]);
}

/** Os três números do painel, como o admin os lê. */
async function painel(c) {
  await logar(c, U_ADMIN);
  const r = await c.query(
    `SELECT (public.painel_inicio() -> 'pendencias' ->> 'estoque_baixo')::int AS inicio,
            (public.get_admin_analytics_v2(90) ->> 'inventoryAlerts')::int AS analytics,
            (public.get_admin_products_paged('', 'all', 'active', 'low', 0, 100) ->> 'total_count')::int AS filtro`,
  );
  return r.rows[0];
}

/**
 * A página do catálogo do admin (o JSON inteiro), como o admin a lê — com os
 * itens em ordem de id (empate de `data_cadastro` não vira diferença).
 */
async function pagina(c, busca, status, estoque) {
  await logar(c, U_ADMIN);
  const r = await c.query(
    "SELECT public.get_admin_products_paged($1, 'all', $2, $3, 0, 100) AS r",
    [busca, status, estoque],
  );
  const { data, total_count } = r.rows[0].r;
  return {
    total_count,
    data: [...data].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** Os ids da semente que o filtro 'low' devolve (a busca isola a semente). */
async function baixosDoFiltro(c) {
  const r = await pagina(c, "Estoque baixo", "active", "low");
  return r.data
    .map((p) => p.id)
    .filter((id) => Object.values(P).includes(id))
    .sort();
}

/** Os produtos como a tela os recebe (com as variações), e a conta do front. */
async function front(c) {
  const r = await c.query(
    `SELECT p.id::text AS id, p.estoque, p.estoque_minimo, p.ativo, p.deleted_at,
            COALESCE((SELECT json_agg(json_build_object('active', v.active, 'stock_increment', v.stock_increment))
                        FROM public.product_variants v WHERE v.product_id = p.id), '[]'::json) AS product_variants
       FROM public.produtos p`,
  );
  const vivos = r.rows.filter((p) => p.deleted_at === null && p.ativo === true);
  const baixos = vivos.filter((p) =>
    precisaDeReposicao(estoqueEfetivo(p), p.estoque_minimo),
  );
  return { total: baixos.length, ids: new Set(baixos.map((p) => p.id)) };
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, pg_get_functiondef(oid) AS def,
            prosecdef, coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de
// tabela/coluna — deparseadas com search_path = pg_catalog.
async function digital(c) {
  await c.query("SET search_path = pg_catalog");
  try {
    const r = await c.query(`
      SELECT 'fn ' || p.oid::regprocedure::text AS k,
             concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                       p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                       p.provolatile::text, p.proowner::regrole::text,
                       pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS v
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'tg ' || c.oid::regclass::text || '.' || t.tgname,
             concat_ws(' | ', pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgtype::text)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'pol ' || pol.polrelid::regclass::text || '.' || pol.polname,
             concat_ws(' | ', coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'),
                       pol.polroles::regrole[]::text, pol.polcmd::text, pol.polpermissive::text)
        FROM pg_policy pol
      UNION ALL
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      UNION ALL
      SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname, a.attacl::text
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

const PROVAS = [];
const fx = {};

PROVAS.push({
  nome: "(0) fixtures: admin atual, cliente comum e os nove produtos (A–I); números de ANTES guardados",
  corpo: async (c) => {
    // A cópia da conta do front ainda é a do código (senão o +4 do front
    // mediria uma regra que a tela já não usa).
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
    const avisos = fs.readFileSync(
      path.join(RAIZ, "src", "utils", "avisos-do-lojista.ts"),
      "utf8",
    );
    assert.ok(avisos.includes("export const LIMIAR_PADRAO_DE_ESTOQUE = 5;"));
    assert.ok(
      avisos.includes(
        "return estoque <= (estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE);",
      ),
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
    const mappers = fs.readFileSync(
      path.join(RAIZ, "src", "lib", "mappers.ts"),
      "utf8",
    );
    assert.ok(
      mappers.includes(
        "acc + (v.active ? Number(v.stock_increment) || 0 : 0),",
      ),
    );

    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@estoque-baixo.teste', '{"role":"admin"}'::jsonb),
         ($2, 'cliente@estoque-baixo.teste', '{}'::jsonb)`,
      [U_ADMIN, U_CLIENTE],
    );
    // 20261199000000 (admin ATUAL): o Início exige o papel admin AGORA em
    // auth.users E em profiles — o admin da prova tem os dois.
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Estoque', 'admin'), ($2, 'Cliente Estoque', 'customer')`,
      [U_ADMIN, U_CLIENTE],
    );

    fx.antes = await painel(c);
    fx.frontAntes = await front(c);
    assert.equal(
      fx.antes.inicio,
      fx.antes.analytics,
      "antes da semente o Início e o analytics já divergiam — o delta não mede a regra",
    );

    for (const p of PRODUTOS) {
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, estoque_minimo, ativo, deleted_at)
         VALUES ($1, $2, 10, 4, $3, $4, $5, CASE WHEN $6::boolean THEN now() END)`,
        [
          p.id,
          `Estoque baixo ${p.nome}`,
          p.estoque,
          p.minimo,
          p.ativo !== false,
          p.apagado === true,
        ],
      );
      for (const [i, [quantidade, ativa]] of (p.variacoes || []).entries()) {
        await c.query(
          `INSERT INTO public.product_variants (product_id, name, value, stock_increment, active)
           VALUES ($1, 'Tamanho', $2, $3, $4)`,
          [p.id, `V${i + 1}`, quantidade, ativa],
        );
      }
    }
  },
});

PROVAS.push({
  nome: `(1) Início = analytics = front = +${ESPERADO} (A, B, D, G); F (variação 0, soma 10), C, E, H e I não contam`,
  corpo: async (c) => {
    const depois = await painel(c);
    const frontDepois = await front(c);
    const delta = {
      inicio: depois.inicio - fx.antes.inicio,
      analytics: depois.analytics - fx.antes.analytics,
      filtro: depois.filtro - fx.antes.filtro,
      front: frontDepois.total - fx.frontAntes.total,
    };
    console.log(`    deltas: ${JSON.stringify(delta)}`);
    assert.deepEqual(
      delta,
      {
        inicio: ESPERADO,
        analytics: ESPERADO,
        filtro: ESPERADO,
        front: ESPERADO,
      },
      "os quatro números não são a mesma régua",
    );
    assert.deepEqual(
      await baixosDoFiltro(c),
      PRODUTOS.filter((p) => p.baixo)
        .map((p) => p.id)
        .sort(),
      "o filtro 'low' não devolveu A, B, D e G",
    );
    for (const p of PRODUTOS) {
      assert.equal(
        frontDepois.ids.has(p.id),
        p.baixo,
        `${p.nome}: o front ${frontDepois.ids.has(p.id) ? "contou" : "não contou"}`,
      );
    }
  },
});

PROVAS.push({
  nome: "(2) CONTROLE: com os corpos antigos (rollback-manual na transação) o Início dá outro número (+3: D, F, G), o filtro 'low' devolve A, B, E, F e o analytics não muda",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(RB12);
      await c.query(RB13);
      assert.equal((await catalogo(c, PAINEL)).hash, H12.vigente);
      assert.equal((await catalogo(c, FILTRO)).hash, H13.vigente);
      const antigo = await painel(c);
      const delta = antigo.inicio - fx.antes.inicio;
      console.log(`    corpo antigo: delta do Início = ${delta}`);
      assert.notEqual(
        delta,
        ESPERADO,
        "CONTROLE FALHOU: o corpo antigo dá o mesmo número — a prova não mede a migration",
      );
      assert.equal(delta, 3, "a régua antiga conta D, F e G");
      assert.equal(antigo.analytics - fx.antes.analytics, ESPERADO);
      // O filtro antigo (`p.estoque <= 5` sobre a coluna crua) conta 4 também
      // — mas OUTROS quatro: o controle do filtro é por produto.
      assert.deepEqual(
        await baixosDoFiltro(c),
        [P.A, P.B, P.E, P.F].sort(),
        "CONTROLE FALHOU: o filtro antigo devolve os mesmos produtos",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal((await catalogo(c, PAINEL)).hash, H12.desta);
    assert.equal((await catalogo(c, FILTRO)).hash, H13.desta);
  },
});

PROVAS.push({
  nome: "(3) a porta: cliente comum recusado com 42501; o corpo vivo é o que o preflight declara",
  corpo: async (c) => {
    assert.equal((await catalogo(c, PAINEL)).hash, H12.desta);
    assert.equal(H12.vigente, H99.desta, "o vigente da 12 é o que a 99 deixa");
    await logar(c, U_CLIENTE);
    await assert.rejects(
      c.query("SELECT public.painel_inicio()"),
      (e) => e.code === "42501" && /Acesso negado/.test(e.message),
    );
  },
});

PROVAS.push({
  nome: "(4) reaplicar a migration por cima de si mesma (2x) não muda a impressão digital",
  corpo: async (c) => {
    const antes = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(M12);
      await c.query(M12);
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(5) preflight: corpo vivo divergente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      const def = (await catalogo(c, PAINEL)).def;
      const divergente = def.replace(
        "-- Mesmos dias do mês anterior",
        "-- Mesmos dias do mês anterior (divergente)",
      );
      assert.notEqual(divergente, def);
      await c.query(divergente);
      const antes = await digital(c);
      await c.query("SAVEPOINT aplicar");
      await assert.rejects(
        c.query(M12),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.painel_inicio\(\)/,
      );
      await c.query("ROLLBACK TO SAVEPOINT aplicar");
      assert.deepEqual(await digital(c), antes, "a recusa escreveu algo");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(6) rollback-manual: volta ao md5 da 20261199000000 com SECURITY DEFINER, search_path, ACL, volatilidade e dono iguais; 2o rollback recusa sem escrever; reaplicar volta ao corpo desta",
  corpo: async (c) => {
    const com = await catalogo(c, PAINEL);
    assert.equal(com.hash, H12.desta);
    await c.query("BEGIN");
    try {
      await c.query(RB12);
      const sem = await catalogo(c, PAINEL);
      assert.equal(
        sem.hash,
        H99.desta,
        "não voltou ao corpo da 20261199000000",
      );
      for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"]) {
        assert.equal(sem[k], com[k], `${k} mudou no rollback`);
      }
      const semDigital = await digital(c);
      await c.query("SAVEPOINT segundo");
      await assert.rejects(c.query(RB12), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT segundo");
      assert.deepEqual(
        await digital(c),
        semDigital,
        "o 2o rollback escreveu algo",
      );
      await c.query(M12);
      assert.equal((await catalogo(c, PAINEL)).hash, H12.desta);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(7) 20261213: 'all' e a busca (com e sem acento) iguais ao corpo da baseline; reaplicar 2x igual; corpo divergente recusa sem escrever; rollback volta ao md5 da baseline com SECURITY DEFINER, search_path, ACL e dono iguais; 2o rollback recusa",
  corpo: async (c) => {
    const com = await catalogo(c, FILTRO);
    assert.equal(com.hash, H13.desta);
    // O que não é 'low' não muda: as mesmas páginas, byte a byte, com o corpo
    // desta e com o da baseline (na mesma transação, então o mesmo dado).
    const consultas = [
      ["", "all", "all"],
      ["", "active", "all"],
      ["variacao", "all", "all"],
      ["Variação", "all", "all"],
      ["ESTOQUE BAIXO", "inactive", "all"],
    ];
    const novas = [];
    for (const [busca, status, estoque] of consultas)
      novas.push(await pagina(c, busca, status, estoque));
    assert.ok(
      novas[2].data.some((p) => p.id === P.A) &&
        novas[3].data.some((p) => p.id === P.A),
      "a busca (com e sem acento) não achou 'A sem variação'",
    );
    assert.ok(novas[4].data.some((p) => p.id === P.H));
    await c.query("BEGIN");
    try {
      await c.query(RB13);
      const sem = await catalogo(c, FILTRO);
      assert.equal(sem.hash, H13.vigente, "não voltou ao corpo da baseline");
      for (const k of ["prosecdef", "proconfig", "proacl", "volatil", "dono"]) {
        assert.equal(sem[k], com[k], `${k} mudou no rollback`);
      }
      for (const [i, [busca, status, estoque]] of consultas.entries()) {
        assert.deepEqual(
          await pagina(c, busca, status, estoque),
          novas[i],
          `'${busca}'/${status}/${estoque} mudou entre a baseline e a 20261213`,
        );
      }
      const semDigital = await digital(c);
      await c.query("SAVEPOINT segundo");
      await assert.rejects(c.query(RB13), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT segundo");
      assert.deepEqual(
        await digital(c),
        semDigital,
        "o 2o rollback escreveu algo",
      );
      await c.query(M13);
      assert.equal((await catalogo(c, FILTRO)).hash, H13.desta);
    } finally {
      await c.query("ROLLBACK");
    }
    // Reaplicar por cima de si mesma (2x): a impressão digital não muda.
    const antes = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(M13);
      await c.query(M13);
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    } finally {
      await c.query("ROLLBACK");
    }
    // Corpo vivo divergente: recusa sem escrever.
    await c.query("BEGIN");
    try {
      const divergente = com.def.replace(
        "-- Authorization check",
        "-- Authorization check (divergente)",
      );
      assert.notEqual(divergente, com.def);
      await c.query(divergente);
      const antesDaRecusa = await digital(c);
      await c.query("SAVEPOINT aplicar");
      await assert.rejects(
        c.query(M13),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.get_admin_products_paged/,
      );
      await c.query("ROLLBACK TO SAVEPOINT aplicar");
      assert.deepEqual(
        await digital(c),
        antesDaRecusa,
        "a recusa escreveu algo",
      );
    } finally {
      await c.query("ROLLBACK");
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
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva do estoque baixo numa régua só (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "O estoque baixo do Início saiu da régua da loja — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[estoque-baixo-uma-regra] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do estoque baixo numa régua só (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
