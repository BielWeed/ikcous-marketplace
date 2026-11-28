"use strict";

/**
 * Prova VIVA da migration 20261651000000 (a ordem dos banners muda numa trava so) num Postgres EFEMERO, com os papeis de
 * verdade. O clone (rodar-isolado.cjs) e' a arvore migrada: a 20261651000000 ja esta no ar. Os casos de uma conexao rodam
 * numa transacao que termina em ROLLBACK; a corrida usa DUAS conexoes reais com COMMIT (o clone e' descartavel) e ids proprios.
 *
 *  CORRIDA     duas arrumacoes da mesma pagina: a segunda ESPERA a primeira inteira (trava da pagina) e enxerga o banner que
 *              a primeira criou antes de confirmar; no fim, 1..n sem posicao repetida. MUTANTE_R1651=sem-trava (as duas
 *              linhas de trava tiradas das duas funcoes) fica VERMELHO: a segunda nao espera e sobra posicao repetida.
 *  ARRUMAR     ordem da tela (nula = 0), o banner recem-salvo antes (ou depois) no empate, id por fim; devolve quantas
 *              regravou e a segunda chamada devolve 0; pagina vazia devolve 0; outras paginas intactas.
 *  MOVER       com o vizinho MUDADO por outro aparelho, troca com o vizinho de agora (CONTROLE: a troca antiga com o id que a
 *              tela tinha leva o banner para o lado errado); na ponta devolve NULL; inexistente ou de outra pagina recusa com
 *              "Banner não encontrado." sem escrever nada; direcao e posicao invalidas recusam.
 *  PERMISSAO   cliente logado recusado ('Não autorizado'), anon sem EXECUTE (42501), service_role e admin passam.
 *  MIGRATION   reaplicar 2x e em CRLF = mesmo catalogo; so objeto novo (retrato do resto igual com e sem ela); rollback tira
 *              so as duas, a reorder_banners_atomic fica byte a byte, e e' idempotente; pre-voo recusa corpo estranho SEM
 *              escrever e o rollback tambem.
 *  CONSULTAS   207a POSITIVA depois e negativa so nas linhas das funcoes depois do rollback; 207b POSITIVA nos dois estados e
 *              negativa com corpo estranho.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-ordem-dos-banners-muda-numa-trava-so-viva.cjs
 */

const { Client } = require("pg");
const P = require("./prova-de-objeto-novo.cjs");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const { assert, prova } = P;

const ARQ = "20261651000000_a_ordem_dos_banners_muda_numa_trava_so.sql";
const MIGRATION = P.lerMigration(ARQ);
const ROLLBACK = P.lerMigration(`rollback-manual-${ARQ}`);
const C207A = "207a-conferir-a-ordem-dos-banners-numa-trava-so-aplicado";
const C207B = "207b-antes-a-ordem-dos-banners-numa-trava-so-base-vigente";
const SIG_NORM = "public.normalize_banners_atomic(text,uuid,boolean)";
const SIG_MOVE = "public.move_banner_atomic(text,uuid,text)";
const SIG_REORDER = "public.reorder_banners_atomic(text,uuid,uuid)";
const H_NORM = "c221e4ba453f3f659574f03fcd1341e3";
const H_MOVE = "2da1c33deaceb650951a795b9d720eb7";
const H_REORDER = "8530188cb2fd69a7d3bf24add96eb339";
const NOVAS = ["normalize_banners_atomic", "move_banner_atomic"];
const ITENS_DAS_FUNCOES = [
  "move_banner_atomic: corpo exato (md5), acha o vizinho dentro do banco sob a mesma trava",
  "normalize_banners_atomic e move_banner_atomic: uma so cada, plpgsql SECURITY DEFINER VOLATILE, search_path=public, EXECUTE so de authenticated e service_role",
  "normalize_banners_atomic: corpo exato (md5), arruma a pagina inteira sob a trava da pagina",
];

const ADMIN = "1651ba00-0000-4000-8000-0000000000a1";
const CLIENTE = "1651ba00-0000-4000-8000-0000000000c1";
// A corrida grava de verdade: pessoa e banners com ids proprios, apagados no fim.
const ADMIN_CORRIDA = "1651ba00-0000-4000-8000-0000000000a2";
const id = (n) => `1651ba00-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessao = (uid) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: uid === CLIENTE ? "customer" : "admin" },
  }),
});

async function semearPessoas(c, pessoas) {
  for (const [pessoa, meta, papel] of pessoas) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@r1651.fixture.invalid', $2::jsonb)`,
      [pessoa, meta],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa ficticia R1651', $2)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [pessoa, papel],
    );
  }
}

/** Pessoas e banners [[n, pagina, ordem]] numa transacao (a fixture some no ROLLBACK). */
async function semear(banners) {
  const c = P.conexao();
  await semearPessoas(c, [
    [ADMIN, '{"role":"admin"}', "admin"],
    [CLIENTE, "{}", "customer"],
  ]);
  await c.query("DELETE FROM public.banners");
  for (const [n, pagina, ordem] of banners) {
    await c.query(
      `INSERT INTO public.banners (id, image_url, "position", "order")
       VALUES ($1, 'https://fixture.invalid/banner.png', $2, $3)`,
      [id(n), pagina, ordem],
    );
  }
}

const foto = async (c = P.conexao()) =>
  (
    await c.query(
      'SELECT id, "position", "order" FROM public.banners ORDER BY "position", "order" NULLS FIRST, id',
    )
  ).rows;
const ordemDaPagina = async (pagina, c = P.conexao()) =>
  (
    await c.query(
      'SELECT id, "order" FROM public.banners WHERE "position" = $1 ORDER BY "order", id',
      [pagina],
    )
  ).rows.map((b) => `${b.id.slice(-2)}:${b.order}`);
const hashVivo = async (sig) =>
  (
    await P.conexao().query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;
/** OID, dono, ACL e atributos (sem o corpo) das funcoes novas e a reorder_banners_atomic inteira. */
const catalogo = async () =>
  (
    await P.conexao().query(
      `SELECT p.proname, (to_jsonb(p) - CASE WHEN p.proname = 'reorder_banners_atomic' THEN '' ELSE 'prosrc' END)::text AS j
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('normalize_banners_atomic', 'move_banner_atomic', 'reorder_banners_atomic')
        ORDER BY 1`,
    )
  ).rows;

const normalizar = (pagina, prioritario = null, depois = false, uid = ADMIN) =>
  P.tentar(
    "authenticated",
    "SELECT public.normalize_banners_atomic($1, $2, $3) AS n",
    [pagina, prioritario, depois],
    sessao(uid),
  );
const mover = (pagina, banner, direcao, uid = ADMIN) =>
  P.tentar(
    "authenticated",
    "SELECT public.move_banner_atomic($1, $2, $3) AS vizinho",
    [pagina, banner, direcao],
    sessao(uid),
  );

// ---------------------------------------------------------------------------
// ARRUMAR
// ---------------------------------------------------------------------------
prova(
  "arrumar renumera 1..n na ordem da tela (nula = 0, id no empate) e devolve quantas regravou",
  () =>
    P.emTransacao(async () => {
      await semear([
        [1, "home_top", 5],
        [2, "home_top", null],
        [3, "home_top", 5],
        [4, "home_top", 9],
        [9, "home_middle", 40],
      ]);
      const r = await normalizar("home_top");
      assert.equal(r.erro, undefined, r.erro);
      assert.equal(r.linhas[0].n, 4, "as quatro mudaram de posicao");
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "02:1",
        "01:2",
        "03:3",
        "04:4",
      ]);
      assert.deepEqual(
        await ordemDaPagina("home_middle"),
        ["09:40"],
        "outra pagina intacta",
      );
      const de_novo = await normalizar("home_top");
      assert.equal(
        de_novo.linhas[0].n,
        0,
        "a segunda arrumacao nao regrava nada",
      );
      const vazia = await normalizar("home_bottom");
      assert.equal(vazia.linhas[0].n, 0, "pagina vazia");
    }),
);

prova(
  "arrumar: o banner recem-salvo entra antes no empate, ou depois quando desceu",
  () =>
    P.emTransacao(async () => {
      await semear([
        [1, "home_top", 1],
        [2, "home_top", 2],
        [3, "home_top", 2],
      ]);
      await P.conexao().query("SAVEPOINT empate");
      assert.equal((await normalizar("home_top", id(3))).erro, undefined);
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "01:1",
        "03:2",
        "02:3",
      ]);
      await P.conexao().query("ROLLBACK TO SAVEPOINT empate");
      assert.equal((await normalizar("home_top", id(2), true)).erro, undefined);
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "01:1",
        "03:2",
        "02:3",
      ]);
      await P.conexao().query("ROLLBACK TO SAVEPOINT empate");
      assert.equal((await normalizar("home_top", id(3), true)).erro, undefined);
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "01:1",
        "02:2",
        "03:3",
      ]);
    }),
);

// ---------------------------------------------------------------------------
// MOVER
// ---------------------------------------------------------------------------
prova(
  "mover com o vizinho mudado por outro aparelho troca com o vizinho de AGORA (controle: a troca antiga erra)",
  () =>
    P.emTransacao(async () => {
      // A tela viu [01, 02, 03]; outro aparelho desceu o 02: no banco ja e [01, 03, 02].
      await semear([
        [1, "home_top", 1],
        [3, "home_top", 2],
        [2, "home_top", 3],
      ]);
      await P.conexao().query("SAVEPOINT controle");
      // CONTROLE: o caminho antigo manda o vizinho que a tela tinha (02) e o 03 DESCE em vez de subir.
      const antigo = await P.tentar(
        "authenticated",
        "SELECT public.reorder_banners_atomic('home_top', $1, $2)",
        [id(3), id(2)],
        sessao(ADMIN),
      );
      assert.equal(antigo.erro, undefined, antigo.erro);
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "01:1",
        "02:2",
        "03:3",
      ]);
      await P.conexao().query("ROLLBACK TO SAVEPOINT controle");
      // DEPOIS: subir o 03 troca com quem esta acima dele no banco (o 01).
      const r = await mover("home_top", id(3), "cima");
      assert.equal(r.erro, undefined, r.erro);
      assert.equal(
        r.linhas[0].vizinho,
        id(1),
        "devolve o vizinho com quem trocou",
      );
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "03:1",
        "01:2",
        "02:3",
      ]);
      const desce = await mover("home_top", id(3), "baixo");
      assert.equal(desce.linhas[0].vizinho, id(1));
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "01:1",
        "03:2",
        "02:3",
      ]);
    }),
);

prova(
  "mover arruma a pagina antes (ordens repetidas ou com buraco) e, na ponta, devolve NULL sem trocar",
  () =>
    P.emTransacao(async () => {
      await semear([
        [1, "home_top", 7],
        [2, "home_top", 7],
        [3, "home_top", 30],
      ]);
      const r = await mover("home_top", id(2), "cima");
      assert.equal(r.linhas[0].vizinho, id(1));
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "02:1",
        "01:2",
        "03:3",
      ]);
      const topo = await mover("home_top", id(2), "cima");
      assert.equal(topo.erro, undefined, topo.erro);
      assert.equal(topo.linhas[0].vizinho, null, "ja no topo");
      const fundo = await mover("home_top", id(3), "baixo");
      assert.equal(fundo.linhas[0].vizinho, null, "ja no fim");
      assert.deepEqual(await ordemDaPagina("home_top"), [
        "02:1",
        "01:2",
        "03:3",
      ]);
    }),
);

for (const [rotulo, banner] of [
  ["inexistente", id(99)],
  ["de outra pagina", id(9)],
  ["nulo", null],
]) {
  prova(
    `mover banner ${rotulo} recusa com "Banner não encontrado." e nao escreve nada (nem a arrumacao)`,
    () =>
      P.emTransacao(async () => {
        await semear([
          [1, "home_top", 10],
          [2, "home_top", 30],
          [9, "home_middle", 50],
        ]);
        const antes = await foto();
        const r = await mover("home_top", banner, "cima");
        assert.equal(r.codigo, "P0001", `banner ${rotulo} foi aceito`);
        assert.equal(r.erro, "Banner não encontrado.");
        assert.deepEqual(await foto(), antes, "a recusa escreveu");
      }),
  );
}

prova("direcao e pagina invalidas recusam sem escrever", () =>
  P.emTransacao(async () => {
    await semear([
      [1, "home_top", 10],
      [2, "home_top", 30],
    ]);
    const antes = await foto();
    for (const direcao of ["lado", null, "CIMA"]) {
      const r = await mover("home_top", id(1), direcao);
      assert.equal(r.erro, "Direção inválida.", String(direcao));
    }
    for (const pagina of ["vitrine", null]) {
      assert.equal(
        (await mover(pagina, id(1), "baixo")).erro,
        "Posição inválida.",
      );
      assert.equal((await normalizar(pagina)).erro, "Posição inválida.");
    }
    assert.deepEqual(await foto(), antes);
  }),
);

// ---------------------------------------------------------------------------
// PERMISSAO
// ---------------------------------------------------------------------------
prova(
  "cliente logado recusado, anon sem EXECUTE; service_role e admin passam",
  () =>
    P.emTransacao(async () => {
      await semear([
        [1, "home_top", 10],
        [2, "home_top", 30],
      ]);
      const antes = await foto();
      assert.equal(
        (await normalizar("home_top", null, false, CLIENTE)).erro,
        "Não autorizado",
      );
      assert.equal(
        (await mover("home_top", id(2), "cima", CLIENTE)).erro,
        "Não autorizado",
      );
      for (const sql of [
        "SELECT public.normalize_banners_atomic('home_top')",
        `SELECT public.move_banner_atomic('home_top', '${id(2)}', 'cima')`,
      ]) {
        const r = await P.tentar("anon", sql);
        assert.equal(r.codigo, "42501", `anon executou: ${sql}`);
      }
      assert.deepEqual(await foto(), antes, "as recusas escreveram");
      const servico = await P.tentar(
        "service_role",
        "SELECT public.normalize_banners_atomic('home_top') AS n",
        [],
        { claims: JSON.stringify({ role: "service_role" }) },
      );
      assert.equal(servico.erro, undefined, servico.erro);
      assert.equal(servico.linhas[0].n, 2);
    }),
);

// ---------------------------------------------------------------------------
// CORRIDA: duas conexoes reais
// ---------------------------------------------------------------------------
async function abrirComoAdmin(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("BEGIN");
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [ADMIN_CORRIDA, sessao(ADMIN_CORRIDA).claims],
  );
  await c.query("SET LOCAL ROLE authenticated");
  return c;
}

/** Espera `pid` ficar parado numa trava (true) ou a consulta dele terminar (false), no maximo 5 s. */
async function ficouEsperando(pid, terminou) {
  const limite = Date.now() + 5000;
  while (Date.now() < limite) {
    if (terminou()) return false;
    const { rows } = await P.conexao().query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

prova(
  "duas arrumacoes concorrentes: a segunda espera a primeira inteira e o fim e 1..n sem posicao repetida",
  async () => {
    const url = lerDatabaseUrlEfemera();
    const c = P.conexao();
    const pagina = "home_bottom";
    const corrida = [61, 62, 63].map(id);
    await semearPessoas(c, [[ADMIN_CORRIDA, '{"role":"admin"}', "admin"]]);
    await c.query('DELETE FROM public.banners WHERE "position" = $1', [pagina]);
    for (const [i, banner] of corrida.entries()) {
      await c.query(
        `INSERT INTO public.banners (id, image_url, "position", "order")
       VALUES ($1, 'https://fixture.invalid/banner.png', $2, $3)`,
        [banner, pagina, i + 1],
      );
    }
    const a = await abrirComoAdmin(url);
    const b = await abrirComoAdmin(url);
    try {
      // A (um aparelho) arruma a pagina e, antes de confirmar, cria um banner novo na posicao 1 (o "criar" do painel).
      await a.query("SELECT public.normalize_banners_atomic($1)", [pagina]);
      const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
      let terminouB = false;
      const segunda = b
        .query("SELECT public.normalize_banners_atomic($1) AS n", [pagina])
        .then(
          (r) => {
            terminouB = true;
            return r.rows[0].n;
          },
          (e) => {
            terminouB = true;
            return e;
          },
        );
      const esperou = await ficouEsperando(pidB, () => terminouB);
      await a.query("RESET ROLE");
      await a.query(
        `INSERT INTO public.banners (id, image_url, "position", "order")
       VALUES ($1, 'https://fixture.invalid/banner.png', $2, 1)`,
        [id(64), pagina],
      );
      await a.query("COMMIT");
      const regravados = await segunda;
      assert.ok(!(regravados instanceof Error), String(regravados?.message));
      await b.query("COMMIT");
      const final = await ordemDaPagina(pagina, c);
      const ordens = final.map((x) => Number(x.split(":")[1]));
      assert.deepEqual(
        [...ordens].sort((x, y) => x - y),
        [1, 2, 3, 4],
        `posicao repetida ou buraco: ${final.join(",")}`,
      );
      assert.ok(esperou, "a segunda arrumacao nao esperou a trava da pagina");
      // A segunda enxergou o banner que a primeira criou na posicao 1: empate com o 61 (id menor fica antes), e 64, 62 e 63 descem.
      assert.equal(
        regravados,
        3,
        "a segunda nao enxergou o banner que a primeira criou",
      );
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await c.query('DELETE FROM public.banners WHERE "position" = $1', [
        pagina,
      ]);
      await c.query("DELETE FROM public.profiles WHERE id = $1", [
        ADMIN_CORRIDA,
      ]);
      await c.query("DELETE FROM auth.users WHERE id = $1", [ADMIN_CORRIDA]);
    }
  },
);

// ---------------------------------------------------------------------------
// MIGRATION e CONSULTAS
// ---------------------------------------------------------------------------
prova(
  "no ar: os md5 desta, 207a e 207b POSITIVAS, reorder_banners_atomic da 1381",
  () =>
    P.emTransacao(async () => {
      assert.equal(await hashVivo(SIG_NORM), H_NORM);
      assert.equal(await hashVivo(SIG_MOVE), H_MOVE);
      assert.equal(await hashVivo(SIG_REORDER), H_REORDER);
      assert.deepEqual(await P.consulta(C207A), []);
      assert.deepEqual(await P.consulta(C207B), []);
    }),
);

prova(
  "reaplicar 2x e em CRLF deixa o mesmo catalogo; a migration so cria objeto novo",
  () =>
    P.emTransacao(async () => {
      const antes = await catalogo();
      const resto = await P.retrato({ funcoes: NOVAS });
      for (const texto of [MIGRATION, MIGRATION, P.emCRLF(MIGRATION)]) {
        assert.equal(await P.aplicar(texto), null, "reaplicar falhou");
        assert.deepEqual(await catalogo(), antes, "reaplicar mudou o catalogo");
      }
      assert.deepEqual(await P.retrato({ funcoes: NOVAS }), resto);
      // Sem ela (rollback), o resto do banco e' o mesmo: ela nao tocou nada alem das duas funcoes.
      assert.equal(await P.aplicar(ROLLBACK), null, "o rollback nao aplicou");
      assert.deepEqual(
        await P.retrato({ funcoes: NOVAS }),
        resto,
        "a migration mexeu em algo alem das funcoes novas",
      );
    }),
);

prova(
  "rollback tira SO as duas, e' idempotente, a reorder_banners_atomic fica; 207a negativa so nelas, 207b positiva; ida e volta",
  () =>
    P.emTransacao(async () => {
      const reorderAntes = (await catalogo()).find(
        (r) => r.proname === "reorder_banners_atomic",
      );
      for (const texto of [ROLLBACK, ROLLBACK, P.emCRLF(ROLLBACK)]) {
        assert.equal(await P.aplicar(texto), null, "o rollback nao aplicou");
        assert.equal(await hashVivo(SIG_NORM), null);
        assert.equal(await hashVivo(SIG_MOVE), null);
        assert.deepEqual(
          (await catalogo()).find(
            (r) => r.proname === "reorder_banners_atomic",
          ),
          reorderAntes,
          "o rollback mexeu na reorder_banners_atomic",
        );
      }
      assert.deepEqual(await P.consulta(C207A), [...ITENS_DAS_FUNCOES].sort());
      assert.deepEqual(await P.consulta(C207B), []);
      // O app em cache segue trocando pela antiga.
      await semear([
        [1, "home_top", 1],
        [2, "home_top", 2],
      ]);
      const antiga = await P.tentar(
        "authenticated",
        "SELECT public.reorder_banners_atomic('home_top', $1, $2)",
        [id(1), id(2)],
        sessao(ADMIN),
      );
      assert.equal(antiga.erro, undefined, antiga.erro);
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "reaplicar depois do rollback falhou",
      );
      assert.deepEqual(await P.consulta(C207A), []);
    }),
);

prova(
  "pre-voo recusa corpo estranho SEM escrever (migration e rollback); 207b negativa com ele",
  () =>
    P.emTransacao(async () => {
      const estranho = MIGRATION.slice(
        MIGRATION.indexOf(
          "CREATE OR REPLACE FUNCTION public.normalize_banners_atomic(",
        ),
        MIGRATION.indexOf(
          "REVOKE EXECUTE ON FUNCTION public.normalize_banners_atomic",
        ),
      ).replace("RETURN v_regravados;", "RETURN v_regravados + 0;");
      assert.equal(
        await P.aplicar(estranho),
        null,
        "o corpo estranho nao instalou",
      );
      const h = await hashVivo(SIG_NORM);
      assert.notEqual(h, H_NORM);
      await P.recusa(
        MIGRATION,
        /B1_BASELINE_DIVERGENT: normalize_banners_atomic ja existe/,
      );
      assert.equal(await hashVivo(SIG_NORM), h, "o pre-voo deixou escrita");
      await P.recusa(
        ROLLBACK,
        /B1_BASELINE_DIVERGENT: normalize_banners_atomic no ar/,
      );
      assert.equal(await hashVivo(SIG_NORM), h);
      assert.equal(
        await hashVivo(SIG_MOVE),
        H_MOVE,
        "o rollback recusado tirou a move_banner_atomic",
      );
      assert.deepEqual(await P.consulta(C207B), [
        "normalize_banners_atomic: corpo exato (md5), arruma a pagina inteira sob a trava da pagina",
      ]);
    }),
);

// ---------------------------------------------------------------------------
// MUTANTE (so quando pedido): as duas linhas de trava saem das duas funcoes, de verdade no clone.
// ---------------------------------------------------------------------------
async function mutar() {
  const nome = "sem-trava";
  if (process.env.MUTANTE_R1651 !== nome) return;
  const c = P.conexao();
  const travas =
    "  PERFORM pg_advisory_xact_lock(hashtextextended('ikcous.banners.ordem:' || p_position, 0));\n" +
    '  PERFORM 1 FROM public.banners WHERE "position" = p_position ORDER BY id FOR UPDATE;\n';
  for (const sig of [SIG_NORM, SIG_MOVE]) {
    const ler = async () =>
      (
        await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [sig])
      ).rows[0].d.replace(/\r/g, "");
    const original = await ler();
    assert.equal(
      original.split(travas).length - 1,
      1,
      `alvo unico do mutante em ${sig}`,
    );
    await c.query(original.replace(travas, ""));
    assert.notEqual(await ler(), original, "sabotagem nao aplicada");
  }
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await mutar();
    await P.executar("a ordem dos banners muda numa trava so");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
