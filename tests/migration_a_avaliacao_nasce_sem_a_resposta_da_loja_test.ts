// @ts-nocheck
// A AVALIACAO NASCE SEM A RESPOSTA DA LOJA — prova offline do par 20261224000000 + rollback
// (permissao / dado publico; achado da cacada Opus de 14/10/2026). O COMPORTAMENTO (a forjada entra limpa, a
// normal e o selo seguem, admin/servico/sessao direta gravam como vieram, mutantes, pre-voo, conferencia,
// rollback, concorrencia e a consulta 27m rodada de verdade) e' provado em
// tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs, com Postgres real. Aqui fica o que se prova so lendo
// o texto.
//
// Riscos: a migration tem de ser ADITIVA (so objeto novo: nada de DROP, DELETE, UPDATE, TRUNCATE nem ALTER), sem
// BEGIN/COMMIT (o aplicador abre a transacao), com o pre-voo ANTES de qualquer escrita e a conferencia DEPOIS, a
// funcao nova FECHADA a PUBLIC/anon/authenticated/service_role (a lista L8 nao ganha entrada), o gatilho BEFORE
// INSERT por linha, o criterio de admin o MESMO das portas do painel (rls_admin_atual) e o md5 do corpo igual nos
// quatro lugares que o citam (migration x2, rollback e consulta 27m).
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
const NOME = "20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql";
const ler = (caminho) =>
  Deno.readTextFileSync(new URL(caminho, DIR)).replace(/\r\n/g, "\n");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const consulta27m = ler(
  "scripts/publicacao/consultas/27m-medir-avaliacao-forjada.sql",
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

Deno.test("ADITIVA: so cria a funcao e o gatilho; nenhum DROP, DELETE, UPDATE, TRUNCATE, ALTER nem INSERT na migration", () => {
  const m = limpo(migration);
  assert.ok(
    !/\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE)\b/i.test(
      m.replace(/BEFORE INSERT ON/g, ""),
    ),
    "a migration escreve em objeto existente",
  );
  assert.equal((m.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
  assert.equal((m.match(/CREATE OR REPLACE TRIGGER/g) || []).length, 1);
  assert.equal(
    (m.match(/CREATE (?!OR REPLACE (FUNCTION|TRIGGER))/g) || []).length,
    0,
    "criou outra coisa",
  );
  // GRANT nenhum: a funcao nasce fechada, nao aberta
  assert.ok(!/\bGRANT\b/i.test(m));
  // o rollback apaga SO os dois objetos novos
  const r = limpo(rollback);
  const drops = [...r.matchAll(/DROP (TRIGGER|FUNCTION)[^;]*;/g)].map(
    (x) => x[0],
  );
  assert.deepEqual(drops, [
    "DROP TRIGGER IF EXISTS tr_avaliacao_nasce_sem_a_resposta_da_loja ON public.reviews;",
    "DROP FUNCTION IF EXISTS public.avaliacao_nasce_sem_a_resposta_da_loja();",
  ]);
  assert.ok(
    !/\b(DELETE|TRUNCATE|ALTER|UPDATE)\b/i.test(
      r.replace(/RAISE EXCEPTION '[^']*'/g, ""),
    ),
  );
});

Deno.test("ORDEM: pre-voo ANTES de qualquer escrita, conferencia DEPOIS; a ACL fecha a funcao ANTES do gatilho existir", () => {
  const iPre = migration.indexOf("DO $preflight_20261224$");
  const iFn = migration.search(/^CREATE OR REPLACE FUNCTION/m);
  const iRevoke = migration.search(/^REVOKE ALL ON FUNCTION/m);
  const iGatilho = migration.search(/^CREATE OR REPLACE TRIGGER/m);
  const iConf = migration.indexOf("DO $conferencia_20261224$");
  assert.ok(iPre > 0 && iPre < iFn, "pre-voo depois da escrita");
  assert.ok(iFn < iRevoke && iRevoke < iGatilho && iGatilho < iConf);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.avaliacao_nasce_sem_a_resposta_da_loja\(\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  const iPreRb = rollback.indexOf("DO $preflight_rollback_20261224$");
  assert.ok(iPreRb > 0 && iPreRb < rollback.indexOf("DROP TRIGGER"));
});

Deno.test("GATILHO: BEFORE INSERT, por linha, em public.reviews, chamando a funcao nova; sem WHEN nem UPDATE OF", () => {
  const m = limpo(migration);
  assert.match(
    m,
    /CREATE OR REPLACE TRIGGER tr_avaliacao_nasce_sem_a_resposta_da_loja BEFORE INSERT ON public\.reviews FOR EACH ROW EXECUTE FUNCTION public\.avaliacao_nasce_sem_a_resposta_da_loja\(\);/,
  );
});

Deno.test("CORPO: SECURITY DEFINER com search_path fixo, limpa as QUATRO colunas, so fora das excecoes (sessao direta e administrador de agora), e devolve NEW", () => {
  const m = migration;
  assert.match(
    m,
    /RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS \$function\$/,
  );
  // o corpo sem comentarios (`--`) e com o espaco colapsado (o `limpo` tambem apaga as aspas, e aqui elas importam)
  const c = CORPO.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  assert.match(
    c,
    /IF COALESCE\(NULLIF\(current_setting\('role', true\), ''\), 'none'\) <> 'none' AND NOT public\.rls_admin_atual\(\) THEN NEW\.merchant_reply := NULL; NEW\.merchant_reply_at := NULL; NEW\.helpful := 0; NEW\.created_at := now\(\); END IF; RETURN NEW;/,
  );
  // nao recusa: nenhuma excecao no corpo
  assert.ok(!/RAISE/i.test(c));
  // as colunas que o gatilho NAO pode tocar (a policy e o gatilho AFTER cuidam delas): so estas quatro sao atribuidas
  const atribuidas = [...c.matchAll(/NEW\.(\w+) :=/g)].map((x) => x[1]).sort();
  assert.deepEqual(atribuidas, [
    "created_at",
    "helpful",
    "merchant_reply",
    "merchant_reply_at",
  ]);
});

Deno.test("MD5 do corpo: o mesmo na migration (pre-voo e conferencia), no rollback e na consulta 27m", () => {
  assert.equal(
    migration.split(H).length - 1,
    2,
    "migration: pre-voo + conferencia",
  );
  assert.equal(rollback.split(H).length - 1, 1, "rollback: pre-voo");
  assert.ok(consulta27m.includes(H), "a 27m nao cita o md5 do corpo");
  // o hash de quem le o arquivo e o hash do banco (replace do CR) coincidem: o arquivo nao tem CR
  assert.ok(!CORPO.includes("\r"));
});

Deno.test("PRE-VOO cobre o que o gatilho usa: as 4 colunas e seus tipos, rls_admin_atual, o gatilho irmao do selo, corpo/sobrecarga e o gatilho de mesmo nome", () => {
  const pre = migration.slice(
    migration.indexOf("DO $preflight_20261224$"),
    migration.indexOf("END $preflight_20261224$;"),
  );
  for (const trecho of [
    "'merchant_reply'    AND a.atttypid = 'text'::regtype",
    "'merchant_reply_at' AND a.atttypid = 'timestamptz'::regtype",
    "'helpful'           AND a.atttypid = 'integer'::regtype",
    "'created_at'        AND a.atttypid = 'timestamptz'::regtype",
    "to_regprocedure('public.rls_admin_atual()') IS NULL",
    "t.tgname = 'tr_avaliacao_nasce_verificada'",
    "B1_BASELINE_DIVERGENT",
    "t.tgtype <> 7",
  ])
    assert.ok(
      pre.includes(trecho) || migration.includes(trecho),
      `pre-voo sem: ${trecho}`,
    );
  assert.match(pre, /sobrecarga/);
  assert.match(pre, /corpo desconhecido/);
});

Deno.test("db-apply: VERIFICACOES tem a entrada da migration, com as cinco marcas contadas UMA vez no corpo", () => {
  const i = dbApply.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES (a migration sairia PULADA)");
  const bloco = dbApply.slice(i, dbApply.indexOf("\n  ],\n", i));
  assert.match(bloco, /funcao: "avaliacao_nasce_sem_a_resposta_da_loja"/);
  const marcas = [...bloco.matchAll(/texto: "([^"]+)", vezes: (\d+)/g)];
  assert.equal(marcas.length, 5);
  for (const [, texto, vezes] of marcas)
    assert.equal(
      CORPO.split(texto).length - 1,
      Number(vezes),
      `a marca "${texto}" nao aparece ${vezes}x no corpo`,
    );
});

Deno.test("nenhuma edge function grava em reviews (so as rotinas de servico que o gatilho deixa passar importariam)", () => {
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
});

Deno.test("a funcao NAO e chamada pelo app, e o app so insere as 5 colunas de sempre (quem quebra: ninguem)", () => {
  // o app so insere pela tabela (addReview) e o RPC de resposta e' UPDATE
  const hook = ler("src/hooks/useReviews.ts");
  assert.ok(!hook.includes("avaliacao_nasce_sem_a_resposta_da_loja"));
  assert.match(
    hook,
    /\.from\("reviews" as any\)\s*\.insert\(\{\s*product_id: review\.productId,\s*user_id: user\.id,\s*rating: review\.rating,\s*comment: review\.comment,/,
  );
  assert.ok(
    !/merchant_reply|helpful:|created_at:/.test(
      hook.slice(
        hook.indexOf(".insert({"),
        hook.indexOf(".select()", hook.indexOf(".insert({")),
      ),
    ),
    "o app passou a mandar uma coluna que o gatilho limpa",
  );
});
