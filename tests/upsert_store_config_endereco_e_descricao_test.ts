// @ts-nocheck
// A PÁGINA "SOBRE A LOJA" GANHA ENDEREÇO E DESCRIÇÃO — prova offline do par
// 20261167000000 + rollback (pedido do dono 20/09/2026; migration
// serializada, uma por vez).
//
// O QUE ESTE TESTE FIXA: a upsert_store_config passa a conhecer
// store_address e store_description com o padrão da casa — INSERT sem
// COALESCE (ausência grava NULL, nunca inventa) e ON CONFLICT com CASE WHEN
// config_json ? 'coluna' (só sobrescreve o que veio no payload — o aceite
// "salvar um campo não apaga os outros"). Sabotar qualquer asserção abaixo
// (voltar COALESCE, esquecer o CASE, deixar a entrada VERIFICACOES que
// nunca reprova) reabre o defeito: o lojista salva o endereço e a
// descrição, o horário ou o nome somem sem ninguém perceber.
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
const NOME = "20261167000000_sobre_a_loja_ganha_endereco_e_descricao.sql";
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

Deno.test("preflight exige o corpo que a 20261165000000 DEIXOU — e o hash pinado E o miolo daquela migration (recalculado)", async () => {
  // Régua herdada da 20261165: o hash pinado é recalculardo do
  // arquivo-fonte da migration anterior, para nunca descolar — se alguém
  // editar o corpo vivo sem gerar migration nova, este teste reprova ANTES
  // do banco recusar.
  const HASH_ESPERADO =
    "4dcf11600a05bb275a478eec0314c502802f3243ae6fb85816785a1461eaef7d";
  assertStringIncludes(migrationN, norm(`IS DISTINCT FROM '${HASH_ESPERADO}'`));
  const fonte = Deno.readTextFileSync(
    `${DIR}../supabase/migrations/20261165000000_a_loja_nasce_com_frete_gratis_desligado.sql`,
  );
  const miolo = extrairMiolo(fonte);
  const hashRecalculado = await sha256Hex(miolo.replace(/\r\n/g, "\n"));
  assertEquals(
    hashRecalculado,
    HASH_ESPERADO,
    "o hash pinado divergiu do miolo da 20261165000000 — recapture ou corrija a fonte",
  );
});

Deno.test("o preflight do ROLLBACK exige o corpo que a 20261167000000 DEIXOU — hash pinado recalculado do próprio forward (achado da revisão cara 20/09)", async () => {
  const HASH_DO_ROLLBACK =
    "a6cbf93b1a9cd4b043f01ec0f03e8c2e800f5f53b3167ee2bb6ff915756e2c3b";
  assertStringIncludes(
    rollbackN,
    norm(`IS DISTINCT FROM '${HASH_DO_ROLLBACK}'`),
  );
  const miolo = extrairMiolo(migration);
  const hashRecalculado = await sha256Hex(miolo.replace(/\r\n/g, "\n"));
  assertEquals(
    hashRecalculado,
    HASH_DO_ROLLBACK,
    "o hash pinado no rollback divergiu do miolo da 20261167000000 — recapture",
  );
});

Deno.test("o INSERT grava as duas colunas SEM COALESCE (ausência grava NULL, nunca inventa)", () => {
  // Mesma régua das store_* de texto da 20261033000000: texto da loja não
  // tem valor de fábrica. Cada coluna aparece exatamente 2 vezes no corpo
  // da RPC: no VALUES do INSERT e no THEN do CASE do ON CONFLICT.
  assertEquals(
    migration.split("config_json->>'store_address'").length - 1,
    2,
    "store_address: 1 no INSERT + 1 no CASE do ON CONFLICT",
  );
  assertEquals(
    migration.split("config_json->>'store_description'").length - 1,
    2,
    "store_description: 1 no INSERT + 1 no CASE do ON CONFLICT",
  );
  assertEquals(
    migration.split("COALESCE(config_json->>'store_address'").length - 1,
    0,
    "COALESCE em store_address inventaria texto que ninguém digitou",
  );
  assertEquals(
    migration.split("COALESCE(config_json->>'store_description'").length - 1,
    0,
    "COALESCE em store_description inventaria texto que ninguém digitou",
  );
});

Deno.test("o ON CONFLICT só sobrescreve o que veio no payload (o aceite 'um campo não apaga os outros')", () => {
  assertEquals(
    migration.split("store_address = CASE WHEN config_json ? 'store_address'")
      .length - 1,
    1,
  );
  assertEquals(
    migration.split(
      "store_description = CASE WHEN config_json ? 'store_description'",
    ).length - 1,
    1,
  );
});

Deno.test("a view pública expõe as duas colunas NO FIM (OR REPLACE não aceita coluna nova no meio)", () => {
  // O recorte começa no STATEMENT real (com o nome da view) — o cabeçalho
  // da migration menciona "CREATE OR REPLACE VIEW" em prosa e as colunas na
  // ficha de verificação, numa ordem diferente da lista.
  const view = norm(
    migration.slice(
      migration.indexOf("CREATE OR REPLACE VIEW public.v_store_config"),
      migration.indexOf("WHERE id = 1;"),
    ),
  );
  assert(
    view.indexOf("store_address") > view.indexOf("manutencao"),
    "store_address depois de manutencao",
  );
  assert(
    view.indexOf("store_description") > view.indexOf("store_address"),
    "store_description depois de store_address (últimas da lista)",
  );
});

Deno.test("rollback devolve o estado da 20261166000000: sem as colunas em lugar nenhum", () => {
  // A exceção é o preflight e o aviso de perda de dado (que citam os nomes
  // em prosa); em CÓDIGO do rollback (com chave de lista ou CASE) nada sobra.
  assertEquals(
    rollback.split("config_json->>'store_address'").length - 1,
    0,
    "o rollback não pode conhecer store_address na RPC",
  );
  assertEquals(
    rollback.split("store_address = CASE").length - 1,
    0,
    "o rollback não pode conhecer store_address no ON CONFLICT",
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config DROP COLUMN IF EXISTS store_description;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config DROP COLUMN IF EXISTS store_address;",
    ),
  );
});

Deno.test("nenhuma linha de seed: o INSERT em store_config e so o da propria RPC", () => {
  assertEquals(
    migration.split("INSERT INTO public.store_config").length - 1,
    1,
    "INSERT em store_config só pode ser o galho da RPC, não seed",
  );
});

// ---------------------------------------------------------------------------
// A entrada VERIFICACOES provada por SABOTAGEM: a MESMA checagem que o
// db-apply roda contra o banco é exercitada contra o corpo SEM os CASEs
// (deve FALHAR) e o corpo NOVO (deve VERIFICAR).
// ---------------------------------------------------------------------------
Deno.test("VERIFICACOES tem entrada para a 20261167000000", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const entrada = VERIFICACOES[NOME];
  assert(entrada !== undefined, "sem entrada em VERIFICACOES para a migration");
  assertEquals(entrada.length, 1);
  assertEquals(entrada[0].funcao, "upsert_store_config");
  assertEquals(entrada[0].esperado.length, 2);
});

Deno.test("SABOTAGEM: com o corpo velho (sem os CASEs), a entrada VERIFICACOES reprova", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME][0];
  const resultado = avaliarChecagem("", checagem);
  assertEquals(
    resultado.situacao,
    "falhou",
    "entrada que não reprova contra o corpo sem os CASEs é pior que ausente",
  );
});

Deno.test("com o corpo novo (com os CASEs), a entrada VERIFICACOES verifica", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME][0];
  const corpoNovo =
    "store_address = CASE WHEN config_json ? 'store_address'\n" +
    "      THEN config_json->>'store_address'\n" +
    "      ELSE store_config.store_address END,\n" +
    "    store_description = CASE WHEN config_json ? 'store_description'\n" +
    "      THEN config_json->>'store_description'\n" +
    "      ELSE store_config.store_description END,";
  const resultado = avaliarChecagem(corpoNovo, checagem);
  assertEquals(resultado.situacao, "verificada");
});
