// @ts-nocheck
/* eslint-disable security/detect-non-literal-require -- teste: os require são de arquivos fixos deste repositório (RAIZ + caminho constante). */
/**
 * A ORGANIZAÇÃO CENTRAL DO SUPABASE como dado (scripts/frota/org-central.json,
 * lido por scripts/frota/org-central.cjs) — o modelo de 01/12/2026, em que a
 * IKCOUS é dona de todos os bancos numa org só ("IKCOUS Lojas").
 *
 * O arquivo é um contrato de CREDENCIAL: o nova-loja tira dele a chave do cofre
 * local (uma autorização da org, não uma por loja), o cadastro tira o NOME do
 * segredo do GitHub que as lojas novas recebem, e o lojas.cjs só aceita um
 * segredo repetido entre lojas se for este. Por isso o leitor falha FECHADO:
 *  - `slug` é `null` (org ainda não criada) ou um ref de 20 letras minúsculas;
 *  - `chaveDoCofre` casa com RE_PROJETO (o formato das chaves do cofre);
 *  - `segredoDoGitHub` casa com RE_SEGREDO e nunca é o segredo legado;
 *  - qualquer campo fora da lista é recusado (inclusive `__proto__`).
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const orgMod = require(join(RAIZ, "scripts/frota/org-central.cjs"));
const lojasMod = require(join(RAIZ, "scripts/frota/lojas.cjs"));

const jsonDeHoje = () =>
  JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/org-central.json")),
  );

/** A mensagem com que `validarOrgCentral` recusa `bruto` ("" se aceitou). */
function recusa(bruto: unknown): string {
  try {
    orgMod.validarOrgCentral(bruto);
  } catch (e) {
    return e.message;
  }
  return "";
}
function ruim(alterar: (j: any) => void, trecho: string) {
  const j = jsonDeHoje();
  alterar(j);
  const msg = recusa(j);
  const { _comentario, ...semComentario } = j;
  assert(
    msg !== "",
    `aceitou o que devia recusar: ${JSON.stringify(semComentario)}`,
  );
  assertStringIncludes(msg, trecho);
}

Deno.test("o arquivo de hoje: org ainda sem slug, 'IKCOUS Lojas', cofre org-ikcous-lojas, segredo SUPABASE_ACCESS_TOKEN_LOJAS", () => {
  const org = orgMod.carregarOrgCentral();
  assertEquals(org.slug, null);
  assertEquals(org.nome, "IKCOUS Lojas");
  assertEquals(org.chaveDoCofre, "org-ikcous-lojas");
  assertEquals(org.segredoDoGitHub, "SUPABASE_ACCESS_TOKEN_LOJAS");
  // devolvido congelado: quem lê não consegue trocar o segredo em memória
  assert(Object.isFrozen(org));
  // e os formatos são os MESMOS do cadastro de lojas (nenhum regex copiado)
  assert(lojasMod.RE_PROJETO.test(org.chaveDoCofre));
  assert(lojasMod.RE_SEGREDO.test(org.segredoDoGitHub));
  assert(org.segredoDoGitHub !== lojasMod.SEGREDO_LEGADO);
});

Deno.test("slug: só null ou 20 letras minúsculas (o slug que a API do Supabase dá à org)", () => {
  // aceitos
  const comSlug = { ...jsonDeHoje(), slug: "abcdefghijklmnopqrst" };
  assertEquals(orgMod.validarOrgCentral(comSlug).slug, "abcdefghijklmnopqrst");
  assertEquals(orgMod.validarOrgCentral(jsonDeHoje()).slug, null);
  // recusados
  ruim((j) => (j.slug = "ABCDEFGHIJKLMNOPQRST"), "slug");
  ruim((j) => (j.slug = "abcdefghijklmnopqrs"), "slug"); // 19
  ruim((j) => (j.slug = "abcdefghijklmnopqrstu"), "slug"); // 21
  ruim((j) => (j.slug = "abcdefghij0123456789"), "slug");
  ruim((j) => (j.slug = ""), "slug");
  ruim((j) => (j.slug = "abcdefghijklmnopqrs\n"), "slug");
  ruim((j) => (j.slug = 1234567890), "slug");
  ruim((j) => (j.slug = false), "slug");
  // ausente não é o mesmo que null: o campo é obrigatório
  ruim((j) => Reflect.deleteProperty(j, "slug"), "slug");
});

Deno.test("chaveDoCofre: casa com RE_PROJETO (o formato das chaves do cofre local)", () => {
  ruim((j) => (j.chaveDoCofre = "Org-ikcous"), "chaveDoCofre");
  ruim((j) => (j.chaveDoCofre = "o"), "chaveDoCofre");
  ruim((j) => (j.chaveDoCofre = "org_ikcous"), "chaveDoCofre");
  ruim((j) => (j.chaveDoCofre = "org ikcous"), "chaveDoCofre");
  ruim((j) => (j.chaveDoCofre = "../cofre"), "chaveDoCofre");
  ruim((j) => (j.chaveDoCofre = "a".repeat(41)), "chaveDoCofre");
  ruim((j) => (j.chaveDoCofre = null), "chaveDoCofre");
  ruim((j) => Reflect.deleteProperty(j, "chaveDoCofre"), "chaveDoCofre");
});

Deno.test("segredoDoGitHub: casa com RE_SEGREDO e NUNCA é o segredo legado (o dos alvos de teste antigos)", () => {
  ruim((j) => (j.segredoDoGitHub = "SUPABASE_ACCESS_TOKEN"), "legado");
  ruim((j) => (j.segredoDoGitHub = "VERCEL_TOKEN"), "segredoDoGitHub");
  ruim(
    (j) => (j.segredoDoGitHub = "SUPABASE_ACCESS_TOKEN_lojas"),
    "segredoDoGitHub",
  );
  ruim(
    (j) => (j.segredoDoGitHub = "SUPABASE_ACCESS_TOKEN_A-B"),
    "segredoDoGitHub",
  );
  ruim(
    (j) => (j.segredoDoGitHub = `SUPABASE_ACCESS_TOKEN_${"X".repeat(25)}`),
    "segredoDoGitHub",
  );
  ruim((j) => (j.segredoDoGitHub = ""), "segredoDoGitHub");
  ruim((j) => Reflect.deleteProperty(j, "segredoDoGitHub"), "segredoDoGitHub");
});

Deno.test("nome: texto curto e legível, obrigatório", () => {
  ruim((j) => (j.nome = ""), "nome");
  ruim((j) => (j.nome = 1), "nome");
  ruim((j) => (j.nome = "IKCOUS\nLojas"), "nome");
  ruim((j) => (j.nome = "x".repeat(65)), "nome");
  ruim((j) => Reflect.deleteProperty(j, "nome"), "nome");
});

Deno.test("campo desconhecido é recusado — inclusive __proto__ e constructor vindos do JSON", () => {
  ruim((j) => (j.token = "qualquer"), "campo desconhecido");
  ruim(
    (j) => (j.segredoDaOrg = "SUPABASE_ACCESS_TOKEN_X"),
    "campo desconhecido",
  );
  const comProto = JSON.parse(
    '{"slug":null,"nome":"IKCOUS Lojas","chaveDoCofre":"org-ikcous-lojas","segredoDoGitHub":"SUPABASE_ACCESS_TOKEN_LOJAS","__proto__":{"x":1}}',
  );
  assertStringIncludes(recusa(comProto), "campo desconhecido");
  ruim((j) => (j.constructor = 1), "campo desconhecido");
  // o comentário de documentação é aceito, mas só como texto
  ruim((j) => (j._comentario = { x: 1 }), "_comentario");
});

Deno.test("a raiz torta falha fechado, no objeto e no disco", () => {
  for (const bruto of [null, undefined, [], "x", 1, true])
    assertStringIncludes(recusa(bruto), "raiz");
  const dir = Deno.makeTempDirSync({ prefix: "org-central-" });
  try {
    const caminho = join(dir, "org-central.json");
    Deno.writeTextFileSync(caminho, "{ nao e json");
    let msg = "";
    try {
      orgMod.carregarOrgCentral(caminho);
    } catch (e) {
      msg = e.message;
    }
    assertStringIncludes(msg, "não é JSON");
    // e um arquivo bom fora do lugar padrão é lido igual
    Deno.writeTextFileSync(caminho, JSON.stringify(jsonDeHoje()));
    assertEquals(
      orgMod.carregarOrgCentral(caminho).chaveDoCofre,
      "org-ikcous-lojas",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// O segredo da org NUNCA é o segredo PRÓPRIO de uma loja (pedido do coordenador,
// 26/11/2026). O lojas.cjs aceita o segredo da org repetido entre lojas e o
// gerador o entrega a toda loja da org: se o org-central.json apontasse para
// SUPABASE_ACCESS_TOKEN_SAVY, o token de acesso TOTAL à conta do dono que a
// Savy usa passaria a ir para toda loja nova. Só pelo dado não dá para separar
// "a Savy entrou na org" de "o nome da org virou o da Savy", então a régua é
// a lista FECHADA dos segredos próprios que existem (SEGREDOS_PROPRIOS), e o
// teste cruzado abaixo reprova se uma loja do lojas.json tiver segredo próprio
// fora dela.
// ---------------------------------------------------------------------------
Deno.test("segredoDoGitHub: nunca o segredo PRÓPRIO de uma loja de hoje (IKCOUS, Savy)", () => {
  ruim(
    (j) => (j.segredoDoGitHub = "SUPABASE_ACCESS_TOKEN_SAVY"),
    "segredo próprio",
  );
  ruim(
    (j) => (j.segredoDoGitHub = "SUPABASE_ACCESS_TOKEN_IKCOUS"),
    "segredo próprio",
  );
  // o legado continua recusado pela regra dele
  ruim((j) => (j.segredoDoGitHub = "SUPABASE_ACCESS_TOKEN"), "legado");
  // um nome novo, que não é de loja nenhuma, passa
  assertEquals(
    orgMod.validarOrgCentral({
      ...jsonDeHoje(),
      segredoDoGitHub: "SUPABASE_ACCESS_TOKEN_ORG2",
    }).segredoDoGitHub,
    "SUPABASE_ACCESS_TOKEN_ORG2",
  );
});

Deno.test("cruzado com o lojas.json: todo segredo próprio de loja (o que não é o da org) está na lista fechada, e o da org não é de nenhuma loja com segredo próprio", () => {
  const org = orgMod.carregarOrgCentral();
  const cadastro = lojasMod.carregarLojas();
  const proprios = Object.values(cadastro.lojas)
    .filter(
      (l) =>
        l.classe === "assinante" && l.segredoDoToken !== org.segredoDoGitHub,
    )
    .map((l) => l.segredoDoToken);
  assert(proprios.length >= 2, "IKCOUS e Savy sumiram do cadastro?");
  for (const s of proprios)
    assert(
      orgMod.SEGREDOS_PROPRIOS.includes(s),
      `${s} é segredo próprio de loja e falta em SEGREDOS_PROPRIOS de org-central.cjs`,
    );
  assert(!orgMod.SEGREDOS_PROPRIOS.includes(org.segredoDoGitHub));
  assert(Object.isFrozen(orgMod.SEGREDOS_PROPRIOS));
});
