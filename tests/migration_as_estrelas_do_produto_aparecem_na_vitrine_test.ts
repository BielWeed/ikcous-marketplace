// @ts-nocheck
// AS ESTRELAS DO PRODUTO APARECEM NA VITRINE — prova offline do par 20261399500000 + rollback (gatilho em
// `reviews` que recalcula `produtos.rating` e `produtos.review_count` so das avaliacoes publicadas). O COMPORTAMENTO
// (cada evento, produto trocado, pendente fora, falha sem perder a avaliacao, corrida em duas conexoes, mutantes,
// pre-voo, conferencia, rollback e as fichas 121a/121b rodadas de verdade) e' provado em
// tests/banco/as-estrelas-do-produto-aparecem-na-vitrine-viva.cjs, com Postgres real. Aqui fica o que se prova so
// lendo o texto.
//
// Riscos: a migration tem de ser ADITIVA (so objeto novo, NENHUM backfill: nada de escrita em `produtos` fora do
// corpo da funcao), sem BEGIN/COMMIT (o aplicador abre a transacao), com o pre-voo ANTES de qualquer escrita e a
// conferencia DEPOIS, a funcao FECHADA a PUBLIC/anon/authenticated/service_role (a lista L8 nao ganha entrada),
// SECURITY DEFINER com search_path fixo, trava da linha do produto ANTES de ler as avaliacoes (corrida), lock_timeout
// menor que o deadlock_timeout (a compra nunca e a vitima), melhor esforco (a nota nunca desfaz a avaliacao), e o
// md5 do corpo igual nos quatro lugares que o citam. O backfill do dono fica FORA de supabase/migrations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261399500000_as_estrelas_do_produto_aparecem_na_vitrine.sql";
const STEM_A =
  "121a-conferir-as-estrelas-do-produto-aparecem-na-vitrine-aplicado";
const STEM_B = "121b-antes-as-estrelas-do-produto-aparecem-na-vitrine-ausente";
// Leitura por chave sem indexar objeto (a catraca de lint conta cada colchete como alerta).
const doMapa = (mapa, chave) =>
  Object.entries(mapa).find(([k]) => k === chave)?.[1];
const ler = (caminho) =>
  Deno.readTextFileSync(new URL(caminho, DIR)).replace(/\r\n/g, "\n");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const fichaA = ler(`scripts/publicacao/consultas/${STEM_A}.sql`);
const fichaB = ler(`scripts/publicacao/consultas/${STEM_B}.sql`);
const backfill = ler(
  "scripts/publicacao/pendente-as-estrelas-do-produto-backfill.sql.pendente",
);
const dbApply = ler("scripts/db-apply.cjs");
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO = corpoDe(migration);
const H = md5(CORPO);
/** O corpo sem comentarios (`--`) e com o espaco colapsado. */
const codigo = CORPO.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
/** A migration sem o corpo da funcao e sem comentarios. */
const foraDoCorpo = limpo(migration.replace(CORPO, ""));

Deno.test("avaliarFase0 nao recusa o par migration+rollback e nenhum dos dois abre transacao", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("ADITIVA E SEM BACKFILL: so cria a funcao e o gatilho; fora do corpo nenhum DROP, DELETE, UPDATE, TRUNCATE, ALTER nem INSERT", () => {
  const m = foraDoCorpo;
  assert.ok(
    !/\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE)\b/i.test(
      m.replace(/AFTER INSERT OR DELETE OR UPDATE OF/g, ""),
    ),
    "a migration escreve em objeto existente fora do corpo da funcao",
  );
  assert.equal((m.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.equal((m.match(/CREATE OR REPLACE TRIGGER/g) || []).length, 1);
  assert.equal(
    (m.match(/CREATE (?!OR REPLACE (FUNCTION|TRIGGER))/g) || []).length,
    0,
    "criou outra coisa",
  );
  assert.ok(!/\bGRANT\b/i.test(m), "a funcao nao pode ganhar GRANT");
  // o rollback apaga SO os dois objetos novos
  const r = limpo(rollback);
  const drops = [...r.matchAll(/DROP (TRIGGER|FUNCTION)[^;]*;/g)].map(
    (x) => x[0],
  );
  assert.deepEqual(drops, [
    "DROP TRIGGER IF EXISTS tr_avaliacao_atualiza_a_nota_do_produto ON public.reviews;",
    "DROP FUNCTION IF EXISTS public.avaliacao_atualiza_a_nota_do_produto();",
  ]);
  assert.ok(
    !/\b(DELETE|TRUNCATE|ALTER|UPDATE)\b/i.test(
      r.replace(/RAISE EXCEPTION '[^']*'/g, ""),
    ),
  );
});

Deno.test("O backfill do dono fica FORA de supabase/migrations, com extensao que ninguem executa, e so toca produto com contagem 0/NULL e avaliacao publicada", () => {
  const dentro = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => /pendente|backfill/i.test(n));
  assert.deepEqual(dentro, [], "backfill escondido entre as migrations");
  assert.match(backfill, /PENDENTE — NAO E MIGRATION/);
  assert.match(backfill, /depende de aprovacao do dono/i);
  const sql = backfill
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n");
  // as unicas escritas: o UPDATE de produtos filtrado por contagem 0/NULL (e o SET LOCAL de trava)
  assert.equal((sql.match(/\bUPDATE\b/g) || []).length, 1);
  assert.doesNotMatch(sql, /\b(DELETE|INSERT|TRUNCATE|DROP|ALTER)\b/);
  assert.match(sql, /UPDATE public\.produtos p/);
  assert.equal(
    (sql.match(/COALESCE\(p\.review_count, 0\) = 0/g) || []).length,
    3,
    "o filtro 0/NULL tem de estar no passo 1, na leitura do laco e no UPDATE",
  );
  assert.ok(sql.includes("r.status = 'publicada'"));
  assert.ok(sql.includes("ORDER BY r.product_id"), "ordem global por id");
  assert.ok(sql.includes("SET LOCAL lock_timeout"));
});

Deno.test("ORDEM: pre-voo ANTES de qualquer escrita, conferencia DEPOIS; a ACL fecha a funcao ANTES do gatilho existir", () => {
  const iPre = migration.indexOf("DO $preflight_20261399500000$");
  const iFn = migration.search(/^CREATE OR REPLACE FUNCTION/m);
  const iRevoke = migration.search(/^REVOKE ALL ON FUNCTION/m);
  const iGatilho = migration.search(/^CREATE OR REPLACE TRIGGER/m);
  const iConf = migration.indexOf("DO $conferencia_20261399500000$");
  assert.ok(iPre > 0 && iPre < iFn, "pre-voo depois da escrita");
  assert.ok(iFn < iRevoke && iRevoke < iGatilho && iGatilho < iConf);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.avaliacao_atualiza_a_nota_do_produto\(\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  const iPreRb = rollback.indexOf("DO $preflight_rollback_20261399500000$");
  assert.ok(iPreRb > 0 && iPreRb < rollback.indexOf("DROP TRIGGER"));
  assert.match(migration, /^SET LOCAL lock_timeout = '5s';$/m);
});

Deno.test("GATILHO: AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id, por linha, em public.reviews; sem WHEN; as colunas alheias (verified, helpful, resposta) ficam de fora", () => {
  const m = limpo(migration);
  assert.match(
    m,
    /CREATE OR REPLACE TRIGGER tr_avaliacao_atualiza_a_nota_do_produto AFTER INSERT OR DELETE OR UPDATE OF status, rating, product_id ON public\.reviews FOR EACH ROW EXECUTE FUNCTION public\.avaliacao_atualiza_a_nota_do_produto\(\);/,
  );
  assert.ok(!/WHEN \(/.test(m));
  const lista = migration.match(/UPDATE OF ([a-z_, ]+) ON public\.reviews/)[1];
  for (const alheia of ["verified", "helpful", "merchant_reply"])
    assert.ok(!lista.includes(alheia), `${alheia} nao pode disparar o gatilho`);
});

Deno.test("CORPO: SECURITY DEFINER, search_path fixo, lock_timeout MENOR que o deadlock_timeout, melhor esforco (EXCEPTION), nunca recusa", () => {
  assert.match(
    migration,
    /RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\n SET lock_timeout TO '500ms'\nAS \$function\$/,
  );
  assert.ok(!/RAISE EXCEPTION/i.test(codigo), "o corpo nao pode recusar");
  assert.equal((codigo.match(/EXCEPTION WHEN OTHERS THEN/g) || []).length, 1);
  assert.match(codigo, /RAISE WARNING/);
  assert.match(codigo, /RETURN NULL; END;\s*$/, "AFTER trigger devolve NULL");
  // o gatilho e' o ultimo comando do corpo: nada escreve depois do bloco de melhor esforco
  assert.ok(
    codigo.indexOf("EXCEPTION WHEN OTHERS") >
      codigo.indexOf("UPDATE public.produtos"),
  );
});

Deno.test("CORPO: so a avaliacao PUBLICADA conta (INSERT, DELETE e UPDATE), e o UPDATE so recalcula se status, nota ou produto mudaram", () => {
  assert.match(
    codigo,
    /IF TG_OP = 'INSERT' THEN IF NEW\.status = 'publicada' THEN v_produtos := ARRAY\[NEW\.product_id\]; END IF; ELSIF TG_OP = 'DELETE' THEN IF OLD\.status = 'publicada' THEN v_produtos := ARRAY\[OLD\.product_id\]; END IF; ELSIF \(OLD\.status = 'publicada' OR NEW\.status = 'publicada'\) AND \(OLD\.status IS DISTINCT FROM NEW\.status OR OLD\.rating IS DISTINCT FROM NEW\.rating OR OLD\.product_id IS DISTINCT FROM NEW\.product_id\) THEN v_produtos := ARRAY\[OLD\.product_id, NEW\.product_id\]; END IF;/,
  );
  // a leitura que alimenta a nota: so publicada
  assert.match(
    codigo,
    /FROM public\.reviews r WHERE r\.product_id = v_produto AND r\.status = 'publicada';/,
  );
});

Deno.test("CORPO: a linha do produto e' TRANCADA (ordem global por id, FOR NO KEY UPDATE) ANTES de ler as avaliacoes, e a leitura e' instrucao separada do UPDATE", () => {
  const iTrava = codigo.indexOf("FOR NO KEY UPDATE;");
  const iLeitura = codigo.indexOf("FROM public.reviews r");
  const iGrava = codigo.indexOf("UPDATE public.produtos p");
  assert.ok(iTrava > 0 && iTrava < iLeitura && iLeitura < iGrava);
  assert.match(
    codigo,
    /PERFORM 1 FROM public\.produtos p WHERE p\.id = ANY \(v_produtos\) ORDER BY p\.id FOR NO KEY UPDATE;/,
  );
  // uma unica trava, uma unica leitura, uma unica escrita
  assert.equal((codigo.match(/FOR NO KEY UPDATE/g) || []).length, 1);
  assert.equal((codigo.match(/FROM public\.reviews r/g) || []).length, 1);
  assert.equal((codigo.match(/UPDATE public\.produtos p/g) || []).length, 1);
  // escreve SO produtos.rating e produtos.review_count; nenhuma outra tabela
  assert.match(
    codigo,
    /UPDATE public\.produtos p SET rating = v_nota, review_count = v_total WHERE p\.id = v_produto AND \(p\.rating IS DISTINCT FROM v_nota OR p\.review_count IS DISTINCT FROM v_total\);/,
  );
  assert.doesNotMatch(codigo, /\b(INSERT INTO|DELETE FROM)\b/);
  assert.equal((codigo.match(/\bUPDATE public\./g) || []).length, 1);
  // a media com 1 casa e o piso 5 de quem nao tem avaliacao publicada
  assert.match(codigo, /COALESCE\(round\(avg\(r\.rating\), 1\), 5\)/);
});

Deno.test("MD5 do corpo: o mesmo na migration (pre-voo e conferencia), no rollback e na consulta 121a", () => {
  assert.equal(
    migration.split(H).length - 1,
    2,
    "migration: pre-voo + conferencia",
  );
  assert.equal(rollback.split(H).length - 1, 1, "rollback: pre-voo");
  assert.equal(fichaA.split(H).length - 1, 1, "a 121a nao cita o md5 do corpo");
  assert.ok(!CORPO.includes("\r"));
  assert.ok(!migration.includes("__HASH"), "sobrou o marcador de hash");
});

Deno.test("PRE-VOO cobre o que o gatilho usa: colunas e tipos de reviews e produtos, reviews_status_check, corpo/sobrecarga e o gatilho de mesmo nome", () => {
  const fim = "END $preflight_20261399500000$;";
  const pre = migration.slice(
    migration.indexOf("DO $preflight_20261399500000$"),
    migration.indexOf(fim) + fim.length,
  );
  for (const trecho of [
    "a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype",
    "a.attname = 'rating'     AND a.atttypid = 'integer'::regtype",
    "a.attname = 'status'     AND a.atttypid = 'text'::regtype",
    "a.attname = 'id'           AND a.atttypid = 'uuid'::regtype",
    "a.attname = 'rating'       AND a.atttypid = 'numeric'::regtype",
    "a.attname = 'review_count' AND a.atttypid = 'integer'::regtype",
    "c.conname = 'reviews_status_check'",
    "LIKE '%publicada%'",
    "B1_BASELINE_DIVERGENT",
    "v_gat.tgtype <> 29",
  ])
    assert.ok(pre.includes(trecho), `pre-voo sem: ${trecho}`);
  assert.match(pre, /sobrecarga/);
  assert.match(pre, /corpo desconhecido/);
  // o pre-voo vem antes de qualquer comando que escreve, e nao escreve
  assert.doesNotMatch(
    removerRuido(pre),
    /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/,
  );
});

Deno.test("db-apply: VERIFICACOES tem a entrada da migration, com as marcas contadas no corpo", () => {
  const mapa = require("../scripts/db-apply.cjs");
  const entrada = doMapa(mapa.VERIFICACOES, NOME);
  assert.ok(entrada, "sem entrada em VERIFICACOES (a migration sairia PULADA)");
  assert.equal(entrada.funcao, "avaliacao_atualiza_a_nota_do_produto");
  assert.equal(entrada.esperado.length, 5);
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(
      CORPO.split(texto).length - 1,
      vezes,
      `a marca "${texto}" nao aparece ${vezes}x no corpo`,
    );
  assert.ok(dbApply.includes(NOME));
});

Deno.test("as fichas 121a/121b: rol fechado de 6 linhas cada, so catalogo, nenhuma le avaliacao nem produto, e cada item esta na consulta", () => {
  const conf = require("../scripts/publicacao/conferir-banco.cjs");
  for (const [stem, ficha] of [
    [STEM_A, fichaA],
    [STEM_B, fichaB],
  ]) {
    const rol = doMapa(conf.ROL_FECHADO_POR_CONSULTA, stem);
    assert.equal(rol.length, 6, stem);
    assert.equal(new Set(rol).size, 6, stem);
    const sql = ficha
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n");
    // os textos entre aspas descrevem o gatilho ("AFTER INSERT OR DELETE...") e nao sao comando
    assert.doesNotMatch(
      sql.replace(/'(?:[^']|'')*'/g, "''"),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i,
      "a ficha so le",
    );
    assert.ok(
      !/FROM\s+(public\.)?(reviews|produtos|notificacoes|profiles)\b/i.test(
        sql,
      ),
      "a ficha le dado de cliente",
    );
    assert.equal((sql.match(/\bSELECT item, esperado, vivo/g) || []).length, 1);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
  }
  assert.ok(fichaA.includes(`'${H}'`), "a 121a espera outro corpo");
  assert.ok(
    fichaA.includes("lock_timeout=500ms") && fichaA.includes("tgtype = 29"),
  );
  assert.ok(fichaB.includes("reviews_status_check"));
  assert.ok(!fichaB.includes(H), "a 121b nao espera o corpo novo");
});

Deno.test("o lote 121 esta registrado em exatamente um lugar de cada registro (canais, rol fechado da release, menus dos workflows, mapa do aplicador, passo do CI)", () => {
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((x) =>
    x.versoes.includes("20261399500000"),
  );
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].consulta, STEM_A);
  assert.equal(lotes[0].ausenciaConfirmadaPor, STEM_B);
  assert.deepEqual(lotes[0].versoes, ["20261399500000"]);
  assert.ok(lotes[0]._comentario.includes("ROLLBACK:"));
  assert.ok(lotes[0]._comentario.includes("SEM BACKFILL"));
  assert.ok(
    lotes[0]._comentario.includes(
      "pendente-as-estrelas-do-produto-backfill.sql.pendente",
    ),
  );
  assert.ok(!("backfillLedger" in lotes[0]) && !("nuncaAplicar" in lotes[0]));
  const release = ler("scripts/frota/publicar-release.mjs");
  const rpc = ler(".github/workflows/rpc-ci.yml");
  for (const stem of [STEM_A, STEM_B]) {
    assert.equal(release.split(`"${stem}"`).length - 1, 1, stem);
    assert.equal(
      ler(".github/workflows/conferir-banco-da-loja.yml").split(`- ${stem}\n`)
        .length - 1,
      1,
      stem,
    );
    assert.equal(
      rpc.split(`"scripts/publicacao/consultas/${stem}.sql"`).length - 1,
      2,
      `${stem}: as duas listas de caminhos do rpc-ci`,
    );
  }
  assert.equal(
    rpc.split(
      "node tests/banco/rodar-isolado.cjs tests/banco/as-estrelas-do-produto-aparecem-na-vitrine-viva.cjs",
    ).length - 1,
    1,
  );
});

Deno.test("nenhuma edge function grava em reviews, e o app so le a nota (mappers/ProductCard) e nunca chama a funcao do gatilho", () => {
  const achados = [];
  const andar = (dir) => {
    for (const e of Deno.readDirSync(new URL(dir, DIR))) {
      if (e.isDirectory) andar(`${dir}${e.name}/`);
      else if (/\.(ts|js|mjs)$/.test(e.name)) {
        const t = Deno.readTextFileSync(new URL(`${dir}${e.name}`, DIR));
        if (
          /from\(\s*["'`]reviews["'`]\s*\)/.test(t) ||
          /INTO\s+(public\.)?reviews\b/i.test(t)
        )
          achados.push(`${dir}${e.name}`);
      }
    }
  };
  andar("supabase/functions/");
  assert.deepEqual(achados, []);
  // o front le as duas colunas pela vitrine (select *), o cartao so mostra estrela com avaliacao, e ninguem chama a funcao
  const mappers = ler("src/lib/mappers.ts");
  assert.match(mappers, /row\.review_count/);
  assert.match(mappers, /row\.rating/);
  const cartao = ler("src/components/ui/custom/ProductCard.tsx");
  assert.match(cartao, /showRating && \(product\.reviewCount \?\? 0\) > 0/);
  const produtos = ler("src/hooks/useProducts.ts");
  assert.match(produtos, /\.from\("vw_produtos_public"\)\s*\.select\("\*"\)/);
  for (const f of [
    "src/hooks/useReviews.ts",
    "src/hooks/useProducts.ts",
    "src/lib/mappers.ts",
  ])
    assert.ok(!ler(f).includes("avaliacao_atualiza_a_nota_do_produto"), f);
});
