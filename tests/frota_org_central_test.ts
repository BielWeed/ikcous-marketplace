// @ts-nocheck
/* eslint-disable security/detect-non-literal-require, security/detect-object-injection -- teste: os require são de arquivos fixos deste repositório (RAIZ + caminho constante) e as chaves de loja são constantes do próprio teste. */
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
import { segredoDaLoja } from "../scripts/frota/cadastro-da-loja.mjs";

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
    // e um arquivo bom fora do lugar padrão é lido igual (com o lojas.json ao
    // lado, que o leitor confere contra a chave do cofre)
    Deno.writeTextFileSync(caminho, JSON.stringify(jsonDeHoje()));
    Deno.copyFileSync(
      join(RAIZ, "scripts/frota/lojas.json"),
      join(dir, "lojas.json"),
    );
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

/**
 * O que reprova no cruzamento org × cadastro de lojas (lista vazia = ok):
 *  - segredo PRÓPRIO de loja (o que não é o da org) fora de SEGREDOS_PROPRIOS;
 *  - o segredo da org dentro de SEGREDOS_PROPRIOS;
 *  - loja cujo segredo derivado do nome é o nome da org (ver abaixo).
 */
function problemasDoCruzamento(org, cadastro): string[] {
  const problemas: string[] = [];
  for (const l of Object.values(cadastro.lojas)) {
    if (l.classe !== "assinante" || l.segredoDoToken === org.segredoDoGitHub)
      continue;
    if (!orgMod.SEGREDOS_PROPRIOS.includes(l.segredoDoToken))
      problemas.push(
        `${l.segredoDoToken} é segredo próprio de ${l.projeto} e falta em SEGREDOS_PROPRIOS de org-central.cjs`,
      );
  }
  // O PONTO CEGO (revisão Opus de aac075e73): uma loja cujo segredo DERIVADO do
  // nome (o que o cadastro daria a ela) é o nome da org — a loja `lojas` — some
  // da conta acima porque "usa o segredo da org". Ela nunca pode existir, com
  // segredo nenhum: o dono gravaria o token dela por cima do da org.
  for (const l of Object.values(cadastro.lojas)) {
    if (segredoDaLoja(l.projeto) === org.segredoDoGitHub)
      problemas.push(
        `a loja ${l.projeto} tem o segredo derivado ${org.segredoDoGitHub}, que é o nome da org central`,
      );
  }
  if (orgMod.SEGREDOS_PROPRIOS.includes(org.segredoDoGitHub))
    problemas.push("o segredo da org está em SEGREDOS_PROPRIOS");
  return problemas;
}

Deno.test("cruzado com o lojas.json: todo segredo próprio de loja está na lista fechada, o da org não é próprio de ninguém, e nenhuma loja tem o segredo DERIVADO igual ao nome da org", () => {
  const org = orgMod.carregarOrgCentral();
  const cadastro = lojasMod.carregarLojas();
  const proprios = Object.values(cadastro.lojas).filter(
    (l) => l.classe === "assinante" && l.segredoDoToken !== org.segredoDoGitHub,
  );
  assert(proprios.length >= 2, "IKCOUS e Savy sumiram do cadastro?");
  assertEquals(problemasDoCruzamento(org, cadastro), []);
  assert(Object.isFrozen(orgMod.SEGREDOS_PROPRIOS));

  // CONTROLES: o cruzamento acha cada caso (senão a lista vazia não prova nada)
  const comLoja = (projeto, segredoDoToken) => {
    const j = JSON.parse(
      Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")),
    );
    j.lojas[projeto] = {
      ref: "yzaaaaaaaaaaaaaaaaab",
      classe: "assinante",
      apelido: "Teste",
      segredoDoToken,
      functionsNomeadas: true,
    };
    return lojasMod.validarCadastro(j);
  };
  // a loja `lojas` no segredo da org: passa no validador, e o cruzamento pega
  assertEquals(
    problemasDoCruzamento(org, comLoja("lojas", org.segredoDoGitHub)),
    [
      `a loja lojas tem o segredo derivado ${org.segredoDoGitHub}, que é o nome da org central`,
    ],
  );
  // loja com segredo próprio fora da lista fechada
  assertEquals(
    problemasDoCruzamento(
      org,
      comLoja("loja-x", "SUPABASE_ACCESS_TOKEN_LOJA_X"),
    ),
    [
      "SUPABASE_ACCESS_TOKEN_LOJA_X é segredo próprio de loja-x e falta em SEGREDOS_PROPRIOS de org-central.cjs",
    ],
  );
  // loja normal na org: nada a apontar
  assertEquals(
    problemasDoCruzamento(org, comLoja("loja-da-ana", org.segredoDoGitHub)),
    [],
  );
});

// ---------------------------------------------------------------------------
// A chave do cofre da org NUNCA é o nome de uma loja (revisão Opus de
// aac075e73): o cofre local guarda a autorização da org sob `chaveDoCofre` e a
// de cada loja sob o nome dela; uma loja `org-ikcous-lojas` leria e gravaria a
// autorização da ORG INTEIRA como se fosse a dela.
// ---------------------------------------------------------------------------
Deno.test("chaveDoCofre: recusada se for o nome de uma loja do lojas.json (a loja org-ikcous-lojas)", () => {
  const msg = (() => {
    try {
      orgMod.validarOrgCentral(jsonDeHoje(), {
        slugsDasLojas: ["savy", "org-ikcous-lojas"],
      });
    } catch (e) {
      return e.message;
    }
    return "";
  })();
  assertStringIncludes(msg, "chaveDoCofre");
  assertStringIncludes(msg, "org-ikcous-lojas");
  // sem colisão passa
  assertEquals(
    orgMod.validarOrgCentral(jsonDeHoje(), {
      slugsDasLojas: ["savy", "ikcous-publicada"],
    }).chaveDoCofre,
    "org-ikcous-lojas",
  );
});

Deno.test("carregarOrgCentral confere a chave contra o lojas.json ao lado: loja org-ikcous-lojas é recusada, lojas.json ausente ou torto falha fechado", () => {
  const dir = Deno.makeTempDirSync({ prefix: "org-central-lojas-" });
  try {
    const caminho = join(dir, "org-central.json");
    Deno.writeTextFileSync(caminho, JSON.stringify(jsonDeHoje()));
    const carregar = () => {
      try {
        return { org: orgMod.carregarOrgCentral(caminho), msg: "" };
      } catch (e) {
        return { org: null, msg: e.message };
      }
    };
    // sem lojas.json: falha fechado
    assertStringIncludes(carregar().msg, "lojas.json");
    // lojas.json torto: falha fechado
    Deno.writeTextFileSync(join(dir, "lojas.json"), "{ torto");
    assertStringIncludes(carregar().msg, "lojas.json");
    Deno.writeTextFileSync(join(dir, "lojas.json"), '{"lojas": []}');
    assertStringIncludes(carregar().msg, "lojas.json");
    // com uma loja chamada org-ikcous-lojas: recusado
    const lojas = JSON.parse(
      Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")),
    );
    lojas.lojas["org-ikcous-lojas"] = { ...lojas.lojas.savy };
    Deno.writeTextFileSync(join(dir, "lojas.json"), JSON.stringify(lojas));
    const r = carregar();
    assertStringIncludes(r.msg, "chaveDoCofre");
    assertStringIncludes(r.msg, "org-ikcous-lojas");
    // o lojas.json de hoje: passa
    Deno.copyFileSync(
      join(RAIZ, "scripts/frota/lojas.json"),
      join(dir, "lojas.json"),
    );
    assertEquals(carregar().org?.chaveDoCofre, "org-ikcous-lojas");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
