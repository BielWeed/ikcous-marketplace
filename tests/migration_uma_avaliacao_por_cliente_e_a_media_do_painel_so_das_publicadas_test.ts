// UMA AVALIACAO POR CLIENTE E PRODUTO, E A MEDIA DO PAINEL SO DAS PUBLICADAS: prova offline do par 20261641000000 + rollback.
// O COMPORTAMENTO (repetida recusada, repetida antiga preservada, corrida de duas conexoes, papeis, media sem pendentes,
// rollback e reaplicar) e' provado em tests/banco/uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-viva.cjs, que so
// roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const nome =
  "20261641000000_uma_avaliacao_por_cliente_e_a_media_do_painel_so_das_publicadas.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const sql3996 = ler(
  "supabase/migrations/20261399996000_o_painel_de_avaliacoes_filtra_o_que_esta_sem_resposta.sql",
);
const sql381 = ler(
  "supabase/migrations/20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ");

/** A definicao inteira (cabecalho + corpo) da funcao `nome` no arquivo. */
function definicao(arquivo: string, funcao: string): string {
  const abre = `CREATE OR REPLACE FUNCTION public.${funcao}(`;
  const i = arquivo.indexOf(abre);
  assert.ok(i >= 0, `sem ${funcao}`);
  const fim = arquivo.indexOf("$function$;", i);
  return arquivo.slice(i, fim + "$function$;".length);
}
const corpo = (arquivo: string, funcao: string) =>
  definicao(arquivo, funcao)
    .split("AS $function$")[1]
    .slice(0, -"$function$;".length);
const cabeca = (arquivo: string, funcao: string) =>
  definicao(arquivo, funcao).split("AS $function$")[0];

const H_PAGED_ANTES = "75f5c48de4eb4005a2516e54b3d33135";
const H_PAGED_NOVO = "21ba271d66edd776cab2443d32800db7";
const H_METRICS_ANTES = "71a40c86c6c1b23fbf991d653c746091";
const H_METRICS_NOVO = "971268999fce410628356d65b99fbca5";
const H_GATILHO = "a84f4bc295a088c75ad926f43e16c39d";

Deno.test("3641: fase 0 do db-prove-rollback aceita o par (nada de BEGIN/COMMIT de nivel superior)", () => {
  const r = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: rb,
    temRollback: true,
  });
  assert.equal(r.recusado, false, JSON.stringify(r));
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(rb)).achados, []);
});

Deno.test("3641: os corpos de ANTES sao os vivos da 3996 e da 381, e o rollback os devolve byte a byte", () => {
  assert.equal(md5(corpo(sql3996, "get_admin_reviews_paged")), H_PAGED_ANTES);
  assert.equal(md5(corpo(sql381, "get_reviews_metrics")), H_METRICS_ANTES);
  assert.equal(
    corpo(rb, "get_admin_reviews_paged"),
    corpo(sql3996, "get_admin_reviews_paged"),
  );
  assert.equal(
    corpo(rb, "get_reviews_metrics"),
    corpo(sql381, "get_reviews_metrics"),
  );
  // MESMA assinatura e atributos: o cabecalho de cada funcao e' o de antes, nos dois arquivos.
  for (const arq of [sql, rb]) {
    assert.equal(
      cabeca(arq, "get_admin_reviews_paged"),
      cabeca(sql3996, "get_admin_reviews_paged"),
    );
    assert.equal(
      cabeca(arq, "get_reviews_metrics"),
      cabeca(sql381, "get_reviews_metrics"),
    );
  }
});

Deno.test("3641: get_admin_reviews_paged so muda o bloco GLOBAL (publicadas); lista e paginador seguem com todas", () => {
  const novo = corpo(sql, "get_admin_reviews_paged");
  const antes = corpo(sql3996, "get_admin_reviews_paged");
  assert.equal(md5(novo), H_PAGED_NOVO);
  assert.ok(
    novo.includes(
      "        v_global_total_replied\n    FROM public.reviews r\n    WHERE r.status = 'publicada';\n",
    ),
    "o bloco global le so as publicadas",
  );
  // Desfaz as duas edicoes: sobra o corpo da 3996, byte a byte.
  const desfeito = novo
    .replace(
      "    -- So as PUBLICADAS (20261641000000): a media, o total e as taxas do topo do painel contam o mesmo que a vitrine\n" +
        "    -- mostra. As pendentes (a fila) o painel conta a parte. A lista e o total_count (o paginador) seguem com todas.\n",
      "",
    )
    .replace(
      "    FROM public.reviews r\n    WHERE r.status = 'publicada';\n",
      "    FROM public.reviews r;\n",
    );
  assert.equal(desfeito, antes);
  // O status so aparece no filtro de moderacao (2x, como antes) e no global (1x).
  assert.equal(novo.split("r.status = 'publicada'").length - 1, 1);
  assert.equal(
    novo.split("AND (NOT v_so_pendentes OR r.status = 'pendente')").length - 1,
    2,
  );
});

Deno.test("3641: get_reviews_metrics so conta as publicadas e mantem a guarda de admin", () => {
  const novo = corpo(sql, "get_reviews_metrics");
  const antes = corpo(sql381, "get_reviews_metrics");
  assert.equal(md5(novo), H_METRICS_NOVO);
  assert.ok(
    novo.includes(
      "  WHERE \n    r.status = 'publicada'\n    AND (p_rating IS NULL OR r.rating = p_rating)\n",
    ),
  );
  assert.ok(
    novo.includes(
      "  IF NOT public.is_admin_atual() THEN\n    RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';",
    ),
  );
  const desfeito = novo
    .replace(
      "  -- Só o administrador lê a média e as contagens. Mesma guarda da irmã get_admin_reviews_paged.\n" +
        "  -- So as PUBLICADAS entram na conta (20261641000000), o mesmo que a vitrine mostra.\n",
      "  -- Só o administrador lê a média e as contagens de TODAS as avaliações (as pendentes\n  -- entram na conta). Mesma guarda da irmã get_admin_reviews_paged.\n",
    )
    .replace("    r.status = 'publicada'\n    AND (p_rating", "    (p_rating");
  assert.equal(desfeito, antes);
});

Deno.test("3641: o gatilho recusa a repetida com 23505, trava por conta+produto e nao tem porta aberta", () => {
  const fn = definicao(sql, "avaliacao_uma_por_cliente_e_produto");
  const src = corpo(sql, "avaliacao_uma_por_cliente_e_produto");
  assert.equal(md5(src), H_GATILHO);
  const n = norm(fn);
  assert.ok(
    n.includes(
      "RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'",
    ),
  );
  // A trava ANTES da contagem (sem ela, dois aparelhos passam juntos).
  const trava = src.indexOf("pg_advisory_xact_lock(hashtextextended(");
  const conta = src.indexOf(
    "IF EXISTS (SELECT 1 FROM public.reviews r WHERE r.user_id = NEW.user_id AND r.product_id = NEW.product_id)",
  );
  assert.ok(trava > 0 && conta > trava, "trava antes da contagem");
  assert.ok(
    norm(src).includes(
      "RAISE EXCEPTION 'Você já avaliou este produto.' USING ERRCODE = '23505', DETAIL = 'avaliacao_repetida';",
    ),
  );
  // Excecoes: so a sessao direta e o cliente gravando em nome de outra conta (a RLS recusa depois).
  assert.ok(
    norm(src).includes(
      "IF v_papel = 'none' OR NEW.user_id IS NULL OR NEW.product_id IS NULL THEN RETURN NEW;",
    ),
  );
  assert.ok(
    norm(src).includes(
      "IF v_papel IN ('anon', 'authenticated') AND NEW.user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW;",
    ),
  );
  // Nao consulta papel de administrador: a trava vale para todo papel de API (e fica fora de POSTERIORES_A_97).
  assert.ok(!src.includes("admin"));
  // Nenhum DELETE/UPDATE de linha existente em nenhum dos dois arquivos.
  for (const arq of [sql, rb]) {
    const semRuido = removerRuido(arq);
    assert.ok(!/\bDELETE\s+FROM\b/i.test(semRuido));
    assert.ok(!/\bUPDATE\s+public\.reviews\b/i.test(semRuido));
    assert.ok(!/\bTRUNCATE\b/i.test(semRuido));
  }
  assert.ok(
    norm(sql).includes(
      "REVOKE ALL ON FUNCTION public.avaliacao_uma_por_cliente_e_produto() FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.ok(
    norm(sql).includes(
      "CREATE OR REPLACE TRIGGER tr_avaliacao_uma_por_cliente_e_produto BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.avaliacao_uma_por_cliente_e_produto();",
    ),
  );
  // Sem DROP na migration (aditiva); o rollback tira so os dois objetos novos.
  assert.ok(!/\bDROP\b/.test(removerRuido(sql)));
  assert.equal(removerRuido(rb).match(/\bDROP\b/g)?.length, 2);
  assert.ok(
    norm(rb).includes(
      "DROP TRIGGER IF EXISTS tr_avaliacao_uma_por_cliente_e_produto ON public.reviews;",
    ),
  );
  assert.ok(
    norm(rb).includes(
      "DROP FUNCTION IF EXISTS public.avaliacao_uma_por_cliente_e_produto();",
    ),
  );
});

Deno.test("3641: pre-voo e conferencia declaram os mesmos md5 que os corpos tem", () => {
  for (const h of [
    H_PAGED_ANTES,
    H_PAGED_NOVO,
    H_METRICS_ANTES,
    H_METRICS_NOVO,
    H_GATILHO,
  ]) {
    assert.ok(sql.includes(`'${h}'`), `migration sem ${h}`);
    assert.ok(rb.includes(`'${h}'`), `rollback sem ${h}`);
  }
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(rb.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(sql.includes("DO $preflight_20261641000000$"));
  assert.ok(sql.includes("DO $conferencia_20261641000000$"));
  assert.ok(rb.includes("DO $preflight_rollback_20261641000000$"));
  assert.ok(rb.includes("DO $conferencia_rollback_20261641000000$"));
});
