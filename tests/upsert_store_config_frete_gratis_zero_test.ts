// @ts-nocheck
// A LOJA NOVA NASCE COM FRETE GRÁTIS DESLIGADO NO BANCO — prova offline do
// par 20261165000000 + rollback (fila do bastão 19/09, item 4, parte B.1;
// migration serializada, uma por vez).
//
// O DEFEITO QUE ESTE TESTE FIXA: o INSERT da upsert_store_config nascia com
// COALESCE(...free_shipping_min..., 100) e a coluna com DEFAULT 100 — a
// loja configurada sem tocar no campo anunciava "frete grátis acima de
// R$ 100" que ninguém escolheu, enquanto o front já nasce desligado
// (presetDoConfig(0)). Cada asserção está amarrada a essa ameaça: sabotar
// qualquer uma (voltar o 100, esquecer o DEFAULT, deixar a entrada
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
const NOME = "20261165000000_a_loja_nasce_com_frete_gratis_desligado.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

/** Miolo entre os dollar-quotes da upsert_store_config de um .sql — o
 * recorte que vira `prosrc` no banco (LF, como o workflow Linux aplica). */
function extrairMiolo(sql) {
  const ini = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config",
  );
  if (ini === -1)
    throw new Error("upsert_store_config não encontrada no fonte");
  const rotulo = /\$\w*\$/g;
  rotulo.lastIndex = ini;
  const abre = rotulo.exec(sql);
  const fim = sql.indexOf(abre[0], abre.index + abre[0].length);
  return sql.slice(abre.index + abre[0].length, fim);
}

async function sha256Hex(texto) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Sabotagem da entrada VERIFICACOES: o corpo VIVO de antes da migration (o
// resumo suficiente — a checagem real usa o prosrc inteiro, e o que ela
// procura é o marcador abaixo ausente nele).
const CORPO_VELHO =
  "COALESCE((config_json->>'free_shipping_min')::numeric, 100)";
const CORPO_NOVO = "COALESCE((config_json->>'free_shipping_min')::numeric, 0)";

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

Deno.test("preflight exige o corpo que a 20261121000000 DEIXOU — e o hash pinado E o miolo daquela migration (recalculado)", async () => {
  // Achado da revisão de contexto limpo (20/09): a primeira versão pinava
  // o hash 2403a21f… — que é a PRÉ-condição da 20261121, ou seja, o corpo
  // de ANTES dela; a migration seria inaplicável em banco correto. O hash
  // certo é o do miolo que a 20261121 deixou, RECALCULADO aqui do
  // arquivo-fonte para nunca descolar: se alguém editar a 20261121 (ou o
  // corpo vivo divergir), este teste reprova ANTES do banco recusar.
  const HASH_ESPERADO =
    "eb32d0e5f0963b93256b1d4ec64a9e4f98450913b912f09b2f1cc9e58a685f62";
  assertStringIncludes(migrationN, norm(`IS DISTINCT FROM '${HASH_ESPERADO}'`));
  // Régua validada: o mesmo recorte sobre o ROLLBACK da 20261121 (que
  // restaura o corpo ANTERIOR) reproduz o 2403a21f… que aquela migration
  // media — provando que a régua lê o prosrc como o banco grava.
  const fonte = Deno.readTextFileSync(
    `${DIR}../supabase/migrations/20261121000000_identidade_e_arquivos_da_loja.sql`,
  );
  const miolo = extrairMiolo(fonte);
  const hashRecalculado = await sha256Hex(miolo.replace(/\r\n/g, "\n"));
  assertEquals(
    hashRecalculado,
    HASH_ESPERADO,
    "o hash pinado divergiu do miolo da 20261121000000 — recapture ou corrija a fonte",
  );
});

Deno.test("a coluna deixa de semear 100: ALTER COLUMN ... SET DEFAULT 0", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ALTER COLUMN free_shipping_min SET DEFAULT 0;",
    ),
  );
});

Deno.test("o INSERT da RPC nasce com fallback 0 — e o 100 do defeito nao sobra em codigo (sabotagem)", () => {
  // `removerRuido` não serve aqui: ele apaga o interior de dollar-quotes
  // (é feito para achar BEGIN/COMMIT), e o corpo INTEIRO da RPC vive entre
  // $function$...$function$. A contagem é no texto bruto, com a VÍRGULA de
  // lista do INSERT fechando o marcador — o comentário do cabeçalho cita o
  // trecho velho sem a vírgula, e não conta.
  const vezesNovo = migration.split("::numeric, 0),").length - 1;
  assertEquals(
    vezesNovo,
    1,
    "o COALESCE com 0 tem de aparecer exatamente 1 vez (o galho do UPDATE não usa COALESCE)",
  );
  // Sabotagem: o trecho do defeito (com vírgula, i.e., em código) não pode
  // sobrar — voltar o 100 aqui é reabrir o furo no primeiro minuto da loja.
  const vezesVelho = migration.split("::numeric, 100),").length - 1;
  assertEquals(
    vezesVelho,
    0,
    "o COALESCE com 100 (o defeito) ainda está em código na migration",
  );
});

Deno.test("rollback devolve o DEFAULT 100 e o corpo anterior com o 100", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config ALTER COLUMN free_shipping_min SET DEFAULT 100;",
    ),
  );
  assertEquals(
    rollback.split("::numeric, 100),").length - 1,
    1,
    "o rollback restaura o corpo vivo anterior (com o COALESCE 100)",
  );
});

Deno.test("nenhuma linha de seed: o INSERT em store_config e so o da propria RPC", () => {
  // A RPC faz INSERT INTO store_config no seu galho de criação — essa é a
  // única ocorrência aceitável; seed de DADO (linhas de loja) não entra.
  assertEquals(
    migration.split("INSERT INTO public.store_config").length - 1,
    1,
    "INSERT em store_config só pode ser o galho da RPC, não seed",
  );
});

// ---------------------------------------------------------------------------
// A entrada VERIFICACOES provada por SABOTAGEM: uma entrada que nunca
// reprova é pior que entrada ausente — aqui a MESMA checagem que o db-apply
// roda contra o banco é exercitada contra o corpo VELHO (deve FALHAR) e o
// NOVO (deve VERIFICAR).
// ---------------------------------------------------------------------------
Deno.test("VERIFICACOES tem entrada para a 20261165000000", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const entrada = VERIFICACOES[NOME];
  assert(entrada !== undefined, "sem entrada em VERIFICACOES para a migration");
  assertEquals(entrada.length, 1);
  assertEquals(entrada[0].funcao, "upsert_store_config");
});

Deno.test("SABOTAGEM: com o corpo velho (100), a entrada VERIFICACOES reprova", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME][0];
  const resultado = avaliarChecagem(CORPO_VELHO, checagem);
  assertEquals(
    resultado.situacao,
    "falhou",
    "entrada que não reprova contra o corpo do defeito é pior que ausente",
  );
});

Deno.test("com o corpo novo (0), a entrada VERIFICACOES verifica", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME][0];
  const resultado = avaliarChecagem(CORPO_NOVO, checagem);
  assertEquals(resultado.situacao, "verificada");
});
