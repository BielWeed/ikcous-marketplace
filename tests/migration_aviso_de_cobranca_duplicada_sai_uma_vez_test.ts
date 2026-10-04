// @ts-nocheck
// O AVISO DE COBRANÇA DUPLICADA SAI UMA VEZ, E QUEM CHEGA JUNTO ESPERA O
// RESULTADO DA OUTRA ENTREGA — prova offline do par 20261191000000 + rollback
// (aviso de dinheiro ao admin, 02/10/2026). A entrega do aviso não é
// garantida: os limites estão no cabeçalho da migration.
// O COMPORTAMENTO (3 entregas -> 1 push com o webhook REAL; push que não chega
// libera a reserva e a próxima entrega avisa; reserva morta volta passado o
// prazo; reserva que falha avisa mesmo assim; outra order avisa de novo; ramo
// S5; aplicar->desfazer->aplicar; ACL; duas reservas simultâneas) foi provado
// executando o SQL destes arquivos em Postgres real (PGlite e PG 17) à parte —
// o repositório não tem PGlite; aqui fica o que se prova só lendo o texto, no
// `npm run test:unit`.
//
// Riscos amarrados: hash de preflight que não é o md5 real recusa a migration
// num banco CORRETO; o nome das RPCs ou do argumento divergindo entre a edge e
// o SQL (a reserva falharia em toda entrega — avisa sempre, calada); a chave
// perdendo o id da order (a segunda cobrança aprovada não avisaria); a falha
// da reserva calando o push; o push que não chegou gastando a vez (aviso
// perdido); o prazo sumindo do SQL (reserva morta nunca mais avisa, ou duas
// entregas avisam juntas).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261191000000_aviso_de_cobranca_duplicada_sai_uma_vez.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const webhook = lerArquivo("supabase/functions/webhook-mercadopago/index.ts");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const FUNCOES = [
  ["reservar_aviso_ao_lojista", "$reservar$", "text"],
  ["confirmar_aviso_ao_lojista", "$confirmar$", "boolean"],
  ["liberar_aviso_ao_lojista", "$liberar$", "boolean"],
];
function funcao(nome, tag) {
  const cabeca = `CREATE OR REPLACE FUNCTION public.${nome}(p_chave text)`;
  const i = migration.indexOf(cabeca);
  assert(i >= 0, `${nome} não encontrada`);
  assertEquals(migration.indexOf(cabeca, i + 1), -1, `${nome} aparece 2x`);
  const r = migration.slice(i);
  const a = r.indexOf(`AS ${tag}`) + `AS ${tag}`.length;
  const b = r.indexOf(`${tag};`, a);
  return { texto: r.slice(0, b + tag.length + 1), corpo: r.slice(a, b) };
}
const corpo = new Map(FUNCOES.map(([n, t]) => [n, funcao(n, t)]));

Deno.test("avaliarFase0 não recusa o par; nenhum dos dois abre ou fecha transação de nível superior", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("ponto de partida: a tabela e as três RPCs nascem aqui (nenhuma outra migration as cita)", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name) && e.name !== NOME)
    .map((e) => e.name);
  assertEquals(
    nomes.filter((n) => /avisos_ao_lojista|_aviso_ao_lojista/.test(ler(n))),
    [],
  );
});

Deno.test("o preflight é o PRIMEIRO comando, recusa com RAISE EXCEPTION (nunca só aviso) e confere a forma da tabela e das três RPCs", () => {
  const codigo = semComentarios(migration);
  const primeiro = codigo.search(
    /\b(DO|CREATE|ALTER|REVOKE|GRANT|COMMENT|DROP|INSERT|UPDATE)\b/,
  );
  assertEquals(
    codigo.slice(primeiro, primeiro + "DO $preflight_20261191$".length),
    "DO $preflight_20261191$",
  );
  const ini = migration.indexOf("DO $preflight_20261191$\nDECLARE");
  const fim = migration.indexOf("END $preflight_20261191$;", ini);
  const bloco = migration.slice(ini, fim);
  assert(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(bloco));
  for (const t of [
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.avisos_ao_lojista já existe com outra forma",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.% já existe com outra forma",
    "'chave text NOT NULL, reservado_em timestamp with time zone NOT NULL, enviado boolean NOT NULL'",
    "OR v_defaults IS DISTINCT FROM 'reservado_em=now(), enviado=false'",
    "OR v_constraints <> 1 OR NOT v_pk",
    "IS DISTINCT FROM v_retorno",
    "FOR v_nome, v_hash, v_retorno IN",
  ])
    assertStringIncludes(bloco, t);
  assertEquals(
    detectarTransacaoExplicita(
      removerRuido(`${bloco}END $preflight_20261191$;`),
    ).achados,
    [],
  );
});

Deno.test("o hash de cada RPC nos dois preflights é o md5 REAL do corpo dela", () => {
  const pre = migration.slice(
    0,
    migration.indexOf("END $preflight_20261191$;"),
  );
  const preR = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261191$;"),
  );
  for (const [nome, , retorno] of FUNCOES) {
    const h = md5(corpo.get(nome).corpo);
    assertStringIncludes(pre, `('${nome}', '${h}', '${retorno}')`);
    assertStringIncludes(preR, `('${nome}', '${h}')`);
  }
  for (const s of [pre, preR])
    assertStringIncludes(s, "md5(replace(prosrc, E'\\r', ''))");
});

Deno.test("as RPCs: reserva com PRAZO de 2 min só para quem não foi enviado, com 3 estados (reservado/em_envio/enviado); confirmar marca enviado; liberar nunca apaga enviado; chave vazia 22023", () => {
  const c = (n) => norm(semComentarios(corpo.get(n).corpo));
  assertStringIncludes(
    c("reservar_aviso_ao_lojista"),
    "INSERT INTO public.avisos_ao_lojista AS a (chave, reservado_em, enviado) VALUES (p_chave, now(), false) ON CONFLICT (chave) DO UPDATE SET reservado_em = EXCLUDED.reservado_em WHERE a.enviado = false AND a.reservado_em < now() - interval '2 minutes'; IF FOUND THEN RETURN 'reservado'; END IF;",
  );
  assertStringIncludes(
    c("reservar_aviso_ao_lojista"),
    "SELECT a.enviado INTO v_enviado FROM public.avisos_ao_lojista a WHERE a.chave = p_chave; IF v_enviado THEN RETURN 'enviado'; END IF; RETURN 'em_envio';",
  );
  assertStringIncludes(
    c("reservar_aviso_ao_lojista"),
    "IF p_chave IS NULL OR btrim(p_chave) = '' THEN RAISE EXCEPTION 'reservar_aviso_ao_lojista: chave vazia' USING ERRCODE = '22023';",
  );
  assertStringIncludes(
    c("confirmar_aviso_ao_lojista"),
    "UPDATE public.avisos_ao_lojista SET enviado = true WHERE chave = p_chave; RETURN FOUND;",
  );
  assertStringIncludes(
    c("liberar_aviso_ao_lojista"),
    "DELETE FROM public.avisos_ao_lojista WHERE chave = p_chave AND enviado = false; RETURN FOUND;",
  );
});

Deno.test("objetos novos e ACL: tabela com RLS e sem anon/authenticated; as três RPCs SECURITY DEFINER só para service_role", () => {
  const c = norm(semComentarios(migration));
  assertStringIncludes(
    c,
    "CREATE TABLE IF NOT EXISTS public.avisos_ao_lojista ( chave text PRIMARY KEY, reservado_em timestamptz NOT NULL DEFAULT now(), enviado boolean NOT NULL DEFAULT false );",
  );
  assertStringIncludes(
    c,
    "ALTER TABLE public.avisos_ao_lojista ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    c,
    "REVOKE ALL ON TABLE public.avisos_ao_lojista FROM PUBLIC, anon, authenticated;",
  );
  for (const [nome, tag, retorno] of FUNCOES) {
    assertStringIncludes(
      c,
      `CREATE OR REPLACE FUNCTION public.${nome}(p_chave text) RETURNS ${retorno} LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS ${tag}`,
    );
    assertStringIncludes(
      c,
      `REVOKE ALL ON FUNCTION public.${nome}(text) FROM PUBLIC, anon, authenticated;`,
    );
    assertStringIncludes(
      c,
      `GRANT EXECUTE ON FUNCTION public.${nome}(text) TO service_role;`,
    );
  }
  assert(!/CREATE POLICY/i.test(c), "nenhuma policy: só as RPCs escrevem");
});

Deno.test("o rollback só apaga o que esta migration criou, RPCs antes da tabela, sem GRANT/REVOKE", () => {
  const c = semComentarios(rollback);
  const iT = c.indexOf("DROP TABLE public.avisos_ao_lojista;");
  for (const [nome] of FUNCOES) {
    const iF = c.indexOf(`DROP FUNCTION public.${nome}(text);`);
    assert(iF > 0 && iT > iF, nome);
  }
  assertEquals(c.split("DROP ").length - 1, 4, "só os quatro DROP");
  assert(!/(GRANT|REVOKE)/i.test(c));
});

Deno.test("contrato com a edge: mesmas RPCs, argumento e ESTADOS do SQL, chave com pedido E order, 'em_envio' espera (3 reconsultas, 8 s de pausas somadas) e só então 503, confirma só se ENTREGOU, libera se não, falha aberta sem mexer em vaga alheia; os dois ramos passam pelo helper", () => {
  const c = norm(webhook);
  for (const t of [
    'supabase.rpc("reservar_aviso_ao_lojista", { p_chave: chave });',
    "const chave = `cartao_divergente:${orderId}:${idOrder}`;",
    'if (data === "reservado" || data === "em_envio" || data === "enviado") return data;',
    "const PAUSAS_DO_AVISO_EM_ENVIO_MS = [1000, 2500, 4500];",
    'for (const pausa of PAUSAS_DO_AVISO_EM_ENVIO_MS) { if (estado !== "em_envio") break; await dormir(pausa); estado = await reservar(); }',
    'if (estado === "em_envio") {',
    'return "pendente";',
    'const reservaDestaChamada = estado === "reservado";',
    '"webhook-mercadopago: reservar_aviso_ao_lojista falhou — avisa mesmo assim (falha aberta)", { orderId, idOrder, erro }, ); return null;',
    "entregues = await enviarPushContado({ supabase, aviso });",
    "if (!reservaDestaChamada) return;",
    'const rpc = entregues > 0 ? "confirmar_aviso_ao_lojista" : "liberar_aviso_ao_lojista";',
    "const { error } = await supabase.rpc(rpc, { p_chave: chave });",
    "await comTempoLimite(desfecho, 5000);",
  ])
    assertStringIncludes(c, t);
  assertEquals(
    webhook.split("await avisarCobrancaDuplicadaUmaVez({").length - 1,
    2,
    "S5 e cartao_divergente",
  );
  // os dois ramos devolvem 503 SÓ quando o helper diz "pendente"
  assertEquals(webhook.split('=== "pendente") {').length - 1, 2);
  assertEquals(
    c.split(
      'return json( { error: "Aviso de cobrança duplicada em envio por outra entrega — reentregue." }, 503, );',
    ).length - 1,
    2,
  );
  assertEquals(
    webhook.split("dormir: deps.dormir ?? dormirDeVerdade,").length - 1,
    2,
  );
  // Os DOIS ramos do aviso de cobrança duplicada recebem o push contado E a
  // pausa injetáveis, juntos e nessa ordem. Contar só o `enviarPushContado` no
  // arquivo inteiro deixou de medir isso quando a contestação (lote A, aviso
  // ao admin por `avisarAdminUmaVez`) passou a usar a mesma dependência.
  assertEquals(
    c.split(
      "await avisarCobrancaDuplicadaUmaVez({ supabase, enviarPushContado: deps.enviarPushContado ?? disparoPushContadoReal, dormir: deps.dormir ?? dormirDeVerdade,",
    ).length - 1,
    2,
  );
  assertEquals(
    webhook.split('title: "Cobrança de cartão duplicada?"').length - 1,
    2,
  );
  // o push contado devolve o número de inscrições que receberam
  assertStringIncludes(c, "return resumo.enviados;");
});
