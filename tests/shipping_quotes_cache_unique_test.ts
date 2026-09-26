// @ts-nocheck
// O CACHE DE COTAÇÃO NÃO GUARDA REPETIÇÃO — prova offline do par
// 20261166000000 + rollback (fila do bastão 19/09, item 4, parte B.2).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem UNIQUE em (origin_cep, destination_cep,
// cart_hash), a gravação concorrente do edge empilhava duplicatas (bug
// index-880) e o `.upsert` do supabase-js não tinha alvo de conflito real.
// Cada asserção está amarrada a essa ameaça: sabotar qualquer uma (tirar a
// UNIQUE, esquecer o dedup antes dela, gatilho que não limpa, entrada
// VERIFICACOES que nunca reprova) reabre o furo.
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
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261166000000_o_cache_de_cotacao_nao_guarda_repeticao.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("dedup ANTES da UNIQUE, com desempate deterministico (sabotagem: sem ele, a constraint falha na instalacao de loja com duplicata)", () => {
  const iDedup = migrationN.indexOf(
    "DELETE FROM public.shipping_quotes_cache a",
  );
  const iUnique = migrationN.indexOf(
    "ADD CONSTRAINT shipping_quotes_cache_chave_unica",
  );
  assert(iDedup !== -1 && iUnique !== -1, "dedup ou UNIQUE ausentes");
  assert(
    iDedup < iUnique,
    "o dedup tem de rodar ANTES da ADD CONSTRAINT — duplicata viva estoura a constraint",
  );
  assertStringIncludes(
    migrationN,
    norm("(a.created_at, a.id) < (b.created_at, b.id)"),
  );
});

Deno.test("a UNIQUE e exatamente as tres colunas da chave", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "ADD CONSTRAINT shipping_quotes_cache_chave_unica UNIQUE (origin_cep, destination_cep, cart_hash)",
    ),
  );
});

Deno.test("indice de created_at para a limpeza varrer por data", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE INDEX shipping_quotes_cache_created_at_idx ON public.shipping_quotes_cache (created_at)",
    ),
  );
});

Deno.test("o gatilho limpa o que passou da janela de 2h (o MESMO TTL da leitura do edge)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "DELETE FROM public.shipping_quotes_cache WHERE created_at < now() - interval '2 hours'",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "AFTER INSERT OR UPDATE ON public.shipping_quotes_cache FOR EACH STATEMENT",
    ),
  );
});

Deno.test("rollback derruba gatilho, funcao, indice e constraint (os 4 pontos)", () => {
  for (const trecho of [
    "DROP TRIGGER IF EXISTS shipping_quotes_cache_limpa_ao_gravar",
    "DROP FUNCTION IF EXISTS public.limpar_cotacoes_fora_da_janela()",
    "DROP INDEX IF EXISTS public.shipping_quotes_cache_created_at_idx",
    "DROP CONSTRAINT IF EXISTS shipping_quotes_cache_chave_unica",
  ]) {
    assertStringIncludes(rollbackN, norm(trecho));
  }
  // O dedup não é reversível e o rollback não finge que é (sem INSERT/CREATE
  // de restauração: dado de cache é regenerável).
  assert(
    !rollbackN.includes("INSERT INTO"),
    "rollback de cache não restaura dado — a próxima cotação regrava",
  );
});

Deno.test("a migration avisa a ordem de publicacao do edge (migration antes do .upsert)", () => {
  // O aviso mora num comentário multilinha: `--` de prefixo e quebras de
  // linha não podem esconder a frase — normaliza antes de procurar.
  const aviso = norm(migration.replace(/--/g, " ")).toUpperCase();
  assert(
    aviso.includes("ORDEM DE PUBLICA") && aviso.includes("DEPOIS"),
    "sem o aviso de ordem, o edge pode publicar antes da constraint e reabrir o insert duplicado",
  );
});

// ---------------------------------------------------------------------------
// A entrada VERIFICACOES provada por SABOTAGEM (mesma disciplina da B.1):
// contra o corpo do gatilho SEM a limpeza, a entrada tem de FALHAR.
// ---------------------------------------------------------------------------
Deno.test("VERIFICACOES tem entrada para a 20261166000000", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const entrada = VERIFICACOES[NOME];
  assert(entrada !== undefined, "sem entrada em VERIFICACOES para a migration");
  assertEquals(entrada[0].funcao, "limpar_cotacoes_fora_da_janela");
});

Deno.test("SABOTAGEM: com um gatilho que nao limpa, a entrada VERIFICACOES reprova", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME][0];
  const gatilhoSabotado = ["BEGIN", "RETURN NULL;", "END;"].join(" ");
  const resultado = avaliarChecagem(gatilhoSabotado, checagem);
  assertEquals(resultado.situacao, "falhou");
});

Deno.test("com o gatilho da migration, a entrada VERIFICACOES verifica", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME][0];
  const gatilhoReal = [
    "BEGIN",
    "DELETE FROM public.shipping_quotes_cache WHERE created_at < now() - interval '2 hours';",
    "RETURN NULL;",
    "END;",
  ].join(" ");
  const resultado = avaliarChecagem(gatilhoReal, checagem);
  assertEquals(resultado.situacao, "verificada");
});
