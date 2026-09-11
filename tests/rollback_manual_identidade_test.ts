// Prova, sem banco, que os rollback-manual das migrations 20261121/20261122/
// 20261123 existem, reproduzem a RPC, a view e o corpo da og-so-PNG vivos
// byte a byte, e que os seis arquivos (migrations + seus rollback-manual)
// não carregam controle de transação em nível superior — a convenção da
// casa é o db-apply.cjs abrir uma transação por arquivo.
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  removerRuido,
  detectarTransacaoExplicita,
} = require("../scripts/db-prove-rollback.cjs");

const dir = new URL("../supabase/migrations/", import.meta.url);
const RPC_VIVA =
  "2403a21fa4f3ee2c905df77b368868017bc512b0ec579452c6b8558513ecce31";
const VIEW_VIVA =
  "c5aec1aec658eb2cbcfb866ef02f5109dfff094ad78f1ab06c8cd22714bd2d21";
// Cabeçalho vivo de upsert_store_config (6 linhas, COM quebra final),
// capturado nas duas lojas em 09/09/2026:
//   CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
//    RETURNS jsonb
//    LANGUAGE plpgsql
//    SECURITY DEFINER
//    SET search_path TO 'public'
//   AS $function$
const CABECALHO_RPC_VIVO =
  "b2e597a563c1e783eca119f9ceedfde3b8e01d327d66b2fb7d15992182ef34d5";

async function sha256(texto: string): Promise<string> {
  const b = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function ler(nome: string): Promise<string> {
  return await Deno.readTextFile(new URL(nome, dir));
}

// Corpo da RPC: os bytes ESTRITAMENTE entre `AS $function$` e o próximo
// `$function$` do bloco de upsert_store_config. Medido nos arquivos
// capturados (od -c): o prosrc COMEÇA com "\n" (o que vem logo depois de
// `AS $function$`) e TERMINA com "END;\n" — por isso não se pula nem se
// inclui nada além disso.
function corpoDaRpc(sql: string): string {
  const inicio = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)",
  );
  assert(inicio >= 0, "rollback não recria upsert_store_config");
  const abre = "AS $function$";
  const a = sql.indexOf(abre, inicio);
  assert(a >= 0, "delimitador AS $function$ ausente");
  const z = sql.indexOf("$function$", a + abre.length);
  assert(z > a, "delimitador $function$ de fechamento ausente");
  return sql.slice(a + abre.length, z);
}

// Cabeçalho da RPC: da linha `CREATE OR REPLACE FUNCTION
// public.upsert_store_config(config_json jsonb)` até a linha `AS $function$`
// (inclusive, com a quebra de linha que a fecha). corpoDaRpc() fatia só o
// que vem DEPOIS de `AS $function$` — o cabeçalho (SECURITY DEFINER/INVOKER,
// entre outros) fica fora daquela prova, então precisa da sua própria.
function cabecalhoDaRpc(sql: string): string {
  const inicio = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)",
  );
  assert(inicio >= 0, "rollback não recria upsert_store_config");
  const abre = "AS $function$";
  const marca = sql.indexOf(abre, inicio);
  assert(marca >= 0, "delimitador AS $function$ ausente");
  const quebra = sql.indexOf("\n", marca + abre.length);
  assert(quebra >= 0, "quebra de linha após AS $function$ ausente");
  return sql.slice(inicio, quebra + 1);
}

// Definição da view: os bytes entre
// `CREATE VIEW public.v_store_config WITH (security_invoker=on) AS\n` e o
// primeiro ";" (inclusive). Medido: pg_get_viewdef devolve
// " SELECT id,\n ... WHERE (id = 1);" — começa com espaço e termina no ";",
// sem quebra de linha final.
function definicaoDaView(sql: string): string {
  const marca =
    "CREATE VIEW public.v_store_config WITH (security_invoker=on) AS\n";
  const a = sql.indexOf(marca);
  assert(a >= 0, "rollback não recria v_store_config");
  const z = sql.indexOf(";", a + marca.length);
  assert(z > a, "view sem ponto e vírgula de fechamento");
  return sql.slice(a + marca.length, z + 1);
}

// Corpo de branding_a2_file_valid: os bytes ESTRITAMENTE entre
// `AS $function$` e o `$function$` de fechamento do bloco que CRIA essa
// função no arquivo. Mesma lógica de corpoDaRpc(), repetida em vez de
// generalizada porque os dois âncoram em textos literais diferentes — um
// parâmetro a mais que muda o comportamento por string custa mais para ler
// do que as ~10 linhas repetidas.
function corpoDoBrandingA2FileValid(sql: string): string {
  const inicio = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.branding_a2_file_valid(asset jsonb, asset_role text)",
  );
  assert(inicio >= 0, "arquivo não (re)cria branding_a2_file_valid");
  const abre = "AS $function$";
  const a = sql.indexOf(abre, inicio);
  assert(a >= 0, "delimitador AS $function$ ausente");
  const z = sql.indexOf("$function$", a + abre.length);
  assert(z > a, "delimitador $function$ de fechamento ausente");
  return sql.slice(a + abre.length, z);
}

Deno.test("rollback-manual da 20261121 reproduz a RPC viva byte a byte", async () => {
  const sql = await ler(
    "rollback-manual-20261121000000_identidade_e_arquivos_da_loja.sql",
  );
  assertEquals(await sha256(corpoDaRpc(sql)), RPC_VIVA);
});

Deno.test("rollback-manual da 20261121 reproduz a view viva byte a byte", async () => {
  const sql = await ler(
    "rollback-manual-20261121000000_identidade_e_arquivos_da_loja.sql",
  );
  assertEquals(await sha256(definicaoDaView(sql)), VIEW_VIVA);
});

Deno.test("rollback-manual da 20261121 reproduz o cabecalho vivo da RPC", async () => {
  const sql = await ler(
    "rollback-manual-20261121000000_identidade_e_arquivos_da_loja.sql",
  );
  assertEquals(await sha256(cabecalhoDaRpc(sql)), CABECALHO_RPC_VIVO);
});

// PR #534 — a 20261123 aperta o og para so PNG trocando SÓ o corpo de
// branding_a2_file_valid. A prova é contra o TEXTO da 20261121 (não um hash
// fixo): é o mesmo bloco, na mesma migration-mãe da função, então comparar
// direto contra ela (em vez de uma constante capturada à mão) sobrevive a
// qualquer futura recaptura de baseline sem precisar reeditar este teste.
Deno.test("rollback-manual da 20261123 reproduz o corpo vivo de branding_a2_file_valid byte a byte", async () => {
  const original = await ler(
    "20261121000000_identidade_e_arquivos_da_loja.sql",
  );
  const rollback = await ler(
    "rollback-manual-20261123000000_arte_de_compartilhamento_so_png.sql",
  );
  assertEquals(
    corpoDoBrandingA2FileValid(rollback),
    corpoDoBrandingA2FileValid(original),
  );
});

Deno.test("a migration 20261123 aperta o og para so PNG, sem jpeg/webp soltos na linha do og", async () => {
  const sql = await ler("20261123000000_arte_de_compartilhamento_so_png.sql");
  assert(
    sql.includes(
      "WHEN 'og' THEN mime='image/png' AND asset->>'width'='1200' AND asset->>'height'='630'",
    ),
    "linha nova do og não encontrada com o formato esperado",
  );
  // A asserção é sobre a linha do OG, nunca sobre o arquivo inteiro: as
  // linhas header/loader continuam legitimamente com jpeg/webp/svg, e um
  // `!sql.includes('image/jpeg')` ingênuo reprovaria a migration certa.
  const linhaOg = sql.split("\n").find((l) => l.includes("WHEN 'og'"));
  assert(linhaOg, "linha do WHEN 'og' não encontrada");
  assert(
    !linhaOg.includes("image/jpeg"),
    `linha do og ainda aceita jpeg: ${linhaOg}`,
  );
  assert(
    !linhaOg.includes("image/webp"),
    `linha do og ainda aceita webp: ${linhaOg}`,
  );
});

// Ancorado em `detectarTransacaoExplicita`/`removerRuido` (as mesmas funções
// que o db-prove-rollback.cjs usa na Fase 0), nunca numa regex ingênua: o
// corpo da RPC copiado aqui termina em "END;\n" na coluna 0 — legítimo
// dentro do dollar-quote `$function$...$function$` — e uma regex que não
// remove o dollar-quote primeiro acusaria esse "END;" como controle de
// transação de nível superior, uma recusa falsa.
Deno.test("nenhum dos seis arquivos carrega controle de transacao no topo", async () => {
  for (const nome of [
    "20261121000000_identidade_e_arquivos_da_loja.sql",
    "20261122000000_gravacao_concorrente_da_identidade.sql",
    "rollback-manual-20261121000000_identidade_e_arquivos_da_loja.sql",
    "rollback-manual-20261122000000_gravacao_concorrente_da_identidade.sql",
    "20261123000000_arte_de_compartilhamento_so_png.sql",
    "rollback-manual-20261123000000_arte_de_compartilhamento_so_png.sql",
  ]) {
    const sql = await ler(nome);
    const achados = detectarTransacaoExplicita(removerRuido(sql)).achados;
    assert(
      achados.length === 0,
      `${nome} tem controle de transação no topo: ${achados.join("/")}`,
    );
  }
});

Deno.test("rollback-manual da 20261122 desfaz os seis objetos da A5", async () => {
  const sql = await ler(
    "rollback-manual-20261122000000_gravacao_concorrente_da_identidade.sql",
  );
  for (const trecho of [
    "DROP TRIGGER IF EXISTS branding_a5_track_revision ON public.store_config",
    "DROP FUNCTION IF EXISTS public.branding_a5_track_revision()",
    "DROP FUNCTION IF EXISTS public.read_store_identity()",
    "DROP FUNCTION IF EXISTS public.save_store_identity(text,jsonb,jsonb)",
    "DROP CONSTRAINT IF EXISTS store_config_identity_revision_a5_check",
    "DROP COLUMN IF EXISTS identity_revision",
    "DROP SEQUENCE IF EXISTS public.branding_a5_revision_seq",
  ]) {
    assert(sql.includes(trecho), `falta: ${trecho}`);
  }
});
