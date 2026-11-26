// @ts-nocheck
/**
 * Ponte A (scripts/frota/ponte-oauth.mjs), T7 do PLANO-PORTAO-OAUTH-PONTE-A.
 * A sessão de publicação abre UMA vez por loja OAuth (renovarComTravaLonga),
 * grava o token no segredo do GitHub da loja e apaga no fim. O que este
 * arquivo trava:
 *
 *  - faxina ANTES de tudo: todo segredo de loja OAuth que já está no GitHub
 *    sai antes de qualquer renovação (e só o de loja OAuth);
 *  - uma renovação por loja; tokenDe nunca renova;
 *  - recusa ANTES da rede: nome fora do padrão, o legado, nome de loja que não
 *    é OAuth (IKCOUS/Savy), loja pedida que não é OAuth, duplicada, vazia;
 *  - validade: token sem prazo ou curto recusa ANTES de gravar segredo;
 *    validaAte é o menor vencimento;
 *  - falha ou sinal no meio da abertura: apaga TODOS os nomes OAuth (como a
 *    faxina), solta todas as travas e o erro sobe com a limpeza;
 *  - fechar(): apaga todos mesmo com o primeiro apagar falhando, solta as
 *    travas, pode ser chamado duas vezes, devolve o comando para apagar à mão;
 *    com matarTokenNoFechar faz uma última renovação (P6b) DEPOIS de apagar;
 *  - colaborador com escrita além do dono: recusa abrir (mudança 6);
 *  - o adaptador real do gh: lê `gh auth token` UMA vez (só memória), grava
 *    com `gh secret set` pelo stdin sem quebra de linha e sem shell, apaga e
 *    lista com fetch dentro do processo (mudança 2), e nunca toca segredo de
 *    loja que não é OAuth;
 *  - canário: nenhum token aparece em mensagem, argumento, resultado nem no
 *    process.env.
 *
 * Nenhuma rede real e nenhum gh de verdade: fetch e spawn são dublês; o cofre
 * é o de memória.
 */
import { EventEmitter } from "node:events";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { URL_TOKEN, criarAcessoOAuth } from "../scripts/frota/acesso-oauth.mjs";
import {
  CofreTravado,
  criarCofreMemoria,
} from "../scripts/frota/cofre-local.mjs";
import {
  ErroDaPonte,
  MINIMO_PADRAO_MS,
  abrirSessao,
  criarGhReal,
  faxinar,
  lojasOAuthDo,
} from "../scripts/frota/ponte-oauth.mjs";

// Canários montados em tempo de execução (literal dispara o secretlint).
const canario = (par) => `sbp_oauth_${par.repeat(20)}`;
const CANARIO_A = canario("ab");
const CANARIO_B = canario("cd");
const CANARIO_MORTO = canario("ef");
const TOKEN_GH = `gho_${"12".repeat(18)}`;
const CANARIOS = [CANARIO_A, CANARIO_B, CANARIO_MORTO, TOKEN_GH];

const HORA = 3_600_000;
const AGORA = 1_800_000_000_000;
const REPO = "dono-falso/repo-falso";
const NOME_A = "SUPABASE_ACCESS_TOKEN_LOJA_A";
const NOME_B = "SUPABASE_ACCESS_TOKEN_LOJA_B";
const NOME_IKCOUS = "SUPABASE_ACCESS_TOKEN_IKCOUS";
const NOME_SAVY = "SUPABASE_ACCESS_TOKEN_SAVY";
const REF_A = "aaaaaaaaaaaaaaaaaaaa";
const REF_B = "bbbbbbbbbbbbbbbbbbbb";

function cadastro(extra = {}) {
  return {
    lojas: {
      loja: {
        projeto: "loja",
        ref: "cccccccccccccccccccc",
        classe: "legado",
        acesso: "cli",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN",
      },
      "ikcous-publicada": {
        projeto: "ikcous-publicada",
        ref: "cccccccccccccccccccc",
        classe: "assinante",
        acesso: "cli",
        segredoDoToken: NOME_IKCOUS,
      },
      savy: {
        projeto: "savy",
        ref: "dddddddddddddddddddd",
        classe: "assinante",
        acesso: "cli",
        segredoDoToken: NOME_SAVY,
      },
      "loja-a": {
        projeto: "loja-a",
        ref: REF_A,
        classe: "assinante",
        acesso: "oauth",
        segredoDoToken: NOME_A,
      },
      "loja-b": {
        projeto: "loja-b",
        ref: REF_B,
        classe: "assinante",
        acesso: "oauth",
        segredoDoToken: NOME_B,
      },
      ...extra,
    },
  };
}

/** O cadastro sem as lojas OAuth (só IKCOUS, Savy e o legado). */
function cadastroSemOAuth() {
  const c = cadastro();
  return {
    lojas: Object.fromEntries(
      Object.entries(c.lojas).filter(([, l]) => l.acesso !== "oauth"),
    ),
  };
}

const REFRESH = {
  "loja-a": "refresh-FALSO-loja-a-0123",
  "loja-b": "refresh-FALSO-loja-b-0123",
};
const TOKEN_DA_LOJA = { "loja-a": CANARIO_A, "loja-b": CANARIO_B };

function respostaToken(access, expiresIn = 86400) {
  return new Response(
    JSON.stringify({
      access_token: access,
      ...(expiresIn === null ? {} : { expires_in: expiresIn }),
      token_type: "Bearer",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * O lado Supabase da renovação. `porLoja[slug]` troca a resposta: função que
 * recebe o número da chamada daquela loja (1, 2, ...) e devolve Response ou
 * Promise. Sem entrada, devolve o token da loja com 24 h.
 */
function supabaseFalso(log, porLoja = {}) {
  const chamadas = { "loja-a": 0, "loja-b": 0 };
  const f = (url, init = {}) => {
    assertEquals(String(url), URL_TOKEN);
    const refresh = new URLSearchParams(String(init.body)).get("refresh_token");
    const slug = Object.keys(REFRESH).find((s) => REFRESH[s] === refresh);
    if (!slug) throw new Error("fetch falso: refresh desconhecido");
    chamadas[slug] += 1;
    log.push(`renovou:${slug}`);
    const r = porLoja[slug];
    if (r) return Promise.resolve(r(chamadas[slug]));
    return Promise.resolve(
      respostaToken(chamadas[slug] === 1 ? TOKEN_DA_LOJA[slug] : CANARIO_MORTO),
    );
  };
  f.chamadas = chamadas;
  return f;
}

async function cofreConectado() {
  const cofre = criarCofreMemoria();
  for (const slug of Object.keys(REFRESH)) {
    await cofre.gravar(
      slug,
      JSON.stringify({
        versao: 1,
        clientId: "b5f97263-0000-4000-8000-000000000000",
        clientSecret: "segredo-do-app-FALSO-inventado",
        redirectUri: "https://gestao.exemplo.test/autorizado",
        refresh: REFRESH[slug],
      }),
    );
  }
  return cofre;
}

async function travaLivre(cofre, slug) {
  try {
    const l = await cofre.travar(slug);
    await l();
    return true;
  } catch (e) {
    if (e instanceof CofreTravado) return false;
    throw e;
  }
}

/** Dublê do gh no contrato da ponte (o real é testado mais abaixo). */
function ghFalso(
  log,
  { existentes = [], escrita = ["dono-falso"], falhas = {} } = {},
) {
  const segredos = new Map(existentes.map((n) => [n, "valor-velho"]));
  const gravacoes = [];
  return {
    repo: REPO,
    dono: "dono-falso",
    segredos,
    gravacoes,
    async entrar() {
      log.push("entrar");
      if (falhas.entrar) throw new ErroDaPonte("gh falso: sem login");
    },
    async comEscrita() {
      log.push("colaboradores");
      return escrita;
    },
    async listar() {
      log.push("listar");
      if (falhas.listar) throw new ErroDaPonte("gh falso: lista falhou");
      return [...segredos.keys()];
    },
    async definir(nome, valor, opcoes = {}) {
      log.push(`definir:${nome}`);
      gravacoes.push({ nome, valor });
      const f = falhas.definir?.[nome];
      if (f) return f({ nome, valor, opcoes, segredos });
      segredos.set(nome, valor);
    },
    async apagar(nome) {
      log.push(`apagar:${nome}`);
      const f = falhas.apagar?.[nome];
      if (f) return f({ nome, segredos });
      segredos.delete(nome);
    },
    async esquecer() {
      log.push("esquecer");
    },
  };
}

async function montar(opcoes = {}) {
  const log = [];
  const cofre = await cofreConectado();
  const fetch = supabaseFalso(log, opcoes.porLoja);
  const acesso = criarAcessoOAuth({ cofre, fetch, agora: () => AGORA });
  const gh = ghFalso(log, opcoes.gh);
  return { log, cofre, fetch, acesso, gh };
}

async function pegarErro(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("era para lançar e não lançou");
}

function assertSemCanario(coisa, rotulo = "valor") {
  const texto =
    coisa instanceof Error
      ? [
          String(coisa),
          coisa.message,
          coisa.stack,
          JSON.stringify(coisa),
          JSON.stringify(Object.entries(coisa)),
        ].join("\n")
      : JSON.stringify(coisa);
  for (const c of CANARIOS) {
    assert(!String(texto).includes(c), `${rotulo} vazou um token`);
  }
}

const abrir = (m, extra = {}) =>
  abrirSessao({
    cadastro: cadastro(),
    acesso: m.acesso,
    gh: m.gh,
    agora: () => AGORA,
    matarTokenNoFechar: false,
    ...extra,
  });

// ------------------------------------------------------------- cadastro --

Deno.test("lojasOAuthDo: só as lojas oauth, com nome do segredo vindo do cadastro", () => {
  assertEquals(lojasOAuthDo(cadastro()), [
    { projeto: "loja-a", ref: REF_A, nome: NOME_A },
    { projeto: "loja-b", ref: REF_B, nome: NOME_B },
  ]);
});

// ---------------------------------------------------------- 4. recusas --

Deno.test("recusa ANTES da rede: nome fora do padrão, legado, nome de loja que não é OAuth", async () => {
  const casos = [
    [
      "fora do padrão",
      {
        "loja-c": {
          ref: "eeeeeeeeeeeeeeeeeeee",
          classe: "assinante",
          acesso: "oauth",
          segredoDoToken: "OUTRO_SEGREDO",
        },
      },
    ],
    [
      "legado",
      {
        "loja-c": {
          ref: "eeeeeeeeeeeeeeeeeeee",
          classe: "assinante",
          acesso: "oauth",
          segredoDoToken: "SUPABASE_ACCESS_TOKEN",
        },
      },
    ],
    [
      "IKCOUS",
      {
        "loja-c": {
          ref: "eeeeeeeeeeeeeeeeeeee",
          classe: "assinante",
          acesso: "oauth",
          segredoDoToken: NOME_IKCOUS,
        },
      },
    ],
    [
      "Savy",
      {
        "loja-c": {
          ref: "eeeeeeeeeeeeeeeeeeee",
          classe: "assinante",
          acesso: "oauth",
          segredoDoToken: NOME_SAVY,
        },
      },
    ],
    [
      "oauth em legado",
      {
        "loja-c": {
          ref: "eeeeeeeeeeeeeeeeeeee",
          classe: "legado",
          acesso: "oauth",
          segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJA_C",
        },
      },
    ],
    [
      "nome repetido entre oauth",
      {
        "loja-c": {
          ref: "eeeeeeeeeeeeeeeeeeee",
          classe: "assinante",
          acesso: "oauth",
          segredoDoToken: NOME_A,
        },
      },
    ],
    [
      "ref inválido",
      {
        "loja-c": {
          ref: "CURTO",
          classe: "assinante",
          acesso: "oauth",
          segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJA_C",
        },
      },
    ],
  ];
  for (const [rotulo, extra] of casos) {
    const m = await montar();
    const e = await pegarErro(() => abrir(m, { cadastro: cadastro(extra) }));
    assert(e instanceof ErroDaPonte, `${rotulo}: ${e}`);
    assertEquals(m.log, [], `${rotulo}: tocou a rede`);
    // faxina avulsa recusa igual
    const m2 = await montar();
    await assertRejects(
      () => faxinar({ cadastro: cadastro(extra), gh: m2.gh }),
      ErroDaPonte,
    );
    assertEquals(m2.log, [], `${rotulo}: a faxina tocou a rede`);
  }
});

Deno.test("recusa ANTES da rede: loja pedida que não é OAuth, desconhecida, repetida, lista vazia", async () => {
  for (const lojas of [
    ["ikcous-publicada"],
    ["savy"],
    ["loja"],
    ["nao-existe"],
    ["loja-a", "loja-a"],
    [],
    "loja-a",
  ]) {
    const m = await montar();
    await assertRejects(() => abrir(m, { lojas }), ErroDaPonte);
    assertEquals(m.log, [], `lojas=${JSON.stringify(lojas)} tocou a rede`);
  }
});

Deno.test("recusa ANTES da rede: cadastro sem loja OAuth, minimoMs torto, matarTokenNoFechar ausente, sinal já abortado", async () => {
  const semOauth = cadastroSemOAuth();
  const abortado = new AbortController();
  abortado.abort();
  for (const extra of [
    { cadastro: semOauth },
    { cadastro: null },
    { minimoMs: 0 },
    { minimoMs: Number.NaN },
    { matarTokenNoFechar: undefined },
    { matarTokenNoFechar: "sim" },
    { sinal: abortado.signal },
  ]) {
    const m = await montar();
    await assertRejects(() => abrir(m, extra), ErroDaPonte);
    assertEquals(m.log, []);
  }
});

// ---------------------------------------------------- 1, 2, 8: abertura --

Deno.test("abertura: entra no gh, confere escrita, faxina (só OAuth) ANTES de renovar, renova 1 vez por loja, grava", async () => {
  const m = await montar({
    gh: {
      existentes: [NOME_A, NOME_IKCOUS, NOME_SAVY, "SUPABASE_ACCESS_TOKEN"],
    },
  });
  const s = await abrir(m);
  assertEquals(m.log, [
    "entrar",
    "colaboradores",
    "listar",
    `apagar:${NOME_A}`,
    "renovou:loja-a",
    "renovou:loja-b",
    `definir:${NOME_A}`,
    `definir:${NOME_B}`,
  ]);
  // o que não é OAuth ficou intocado
  assert(m.gh.segredos.has(NOME_IKCOUS));
  assert(m.gh.segredos.has(NOME_SAVY));
  assert(m.gh.segredos.has("SUPABASE_ACCESS_TOKEN"));
  assertEquals(m.gh.segredos.get(NOME_A), CANARIO_A);
  assertEquals(m.gh.segredos.get(NOME_B), CANARIO_B);
  assertEquals(s.estado, "aberta");
  assertEquals(
    s.lojas.map((l) => l.nome),
    [NOME_A, NOME_B],
  );
  await s.fechar();
});

Deno.test("tokenDe devolve o MESMO token gravado e nunca renova; ref fora da sessão e depois do fechar recusam", async () => {
  const m = await montar();
  const s = await abrir(m);
  for (let i = 0; i < 5; i++) {
    assertEquals(s.tokenDe(REF_A), CANARIO_A);
    assertEquals(s.tokenDe(REF_B), CANARIO_B);
  }
  assertEquals(m.fetch.chamadas, { "loja-a": 1, "loja-b": 1 });
  assertEquals(
    s.tokenDe(REF_A),
    m.gh.gravacoes.find((g) => g.nome === NOME_A).valor,
  );
  const fora = pegarErroSinc(() => s.tokenDe("cccccccccccccccccccc"));
  assert(fora instanceof ErroDaPonte);
  await s.fechar();
  const depois = pegarErroSinc(() => s.tokenDe(REF_A));
  assert(depois instanceof ErroDaPonte);
  assertEquals(depois.codigo, "SESSAO_FECHADA");
  assertEquals(fora.codigo, "FORA_DA_SESSAO");
  assertSemCanario(depois, "erro do tokenDe");
});

function pegarErroSinc(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("era para lançar e não lançou");
}

Deno.test("abertura com lista de lojas: só a pedida renova e grava; a faxina continua sendo de TODA loja OAuth", async () => {
  const m = await montar({ gh: { existentes: [NOME_B] } });
  const s = await abrir(m, { lojas: ["loja-a"] });
  assertEquals(m.fetch.chamadas, { "loja-a": 1, "loja-b": 0 });
  assertEquals(
    m.log.filter((x) => x.startsWith("definir")),
    [`definir:${NOME_A}`],
  );
  assert(
    !m.gh.segredos.has(NOME_B),
    "a faxina deixou o segredo velho da loja-b",
  );
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
  assertEquals(await travaLivre(m.cofre, "loja-a"), false);
  await s.fechar();
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
});

Deno.test("as travas ficam PRESAS durante a sessão e soltam no fechar", async () => {
  const m = await montar();
  const s = await abrir(m);
  assertEquals(await travaLivre(m.cofre, "loja-a"), false);
  assertEquals(await travaLivre(m.cofre, "loja-b"), false);
  await s.fechar();
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
});

// ------------------------------------------------------------ 5. prazo --

Deno.test("validade: token sem prazo recusa ANTES de gravar qualquer segredo e solta as travas", async () => {
  const m = await montar({
    porLoja: { "loja-b": () => respostaToken(CANARIO_B, null) },
  });
  const e = await pegarErro(() => abrir(m));
  assert(e instanceof ErroDaPonte);
  assertEquals(e.codigo, "TOKEN_SEM_PRAZO");
  assertEquals(m.gh.gravacoes, []);
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
  assertSemCanario(e, "erro de prazo");
});

Deno.test("validade: token que dura menos que o mínimo recusa antes de gravar; validaAte é o menor vencimento", async () => {
  const curto = await montar({
    porLoja: { "loja-a": () => respostaToken(CANARIO_A, 3600) },
  });
  const e = await pegarErro(() => abrir(curto));
  assertEquals(e.codigo, "TOKEN_CURTO");
  assertEquals(curto.gh.gravacoes, []);
  assertEquals(await travaLivre(curto.cofre, "loja-a"), true);

  // exatamente o mínimo passa; o menor dos dois vira o validaAte
  const m = await montar({
    porLoja: { "loja-b": () => respostaToken(CANARIO_B, 3 * 3600) },
  });
  const s = await abrir(m, { minimoMs: 3 * HORA });
  assertEquals(s.validaAte, AGORA + 3 * HORA);
  await s.fechar();
  assertEquals(MINIMO_PADRAO_MS, 2 * HORA);
});

// ------------------------------------------- 6 + mudança 5: falha no meio --

Deno.test("falha na renovação da 2ª loja: apaga TODOS os nomes OAuth, solta as travas, erro sobe com a limpeza", async () => {
  const m = await montar({
    porLoja: { "loja-b": () => new Response("{}", { status: 500 }) },
  });
  const e = await pegarErro(() => abrir(m));
  assertEquals(e.status, 500);
  assertEquals(m.gh.gravacoes, []);
  const apagados = m.log.filter((x) => x.startsWith("apagar:")).sort();
  assertEquals(apagados, [`apagar:${NOME_A}`, `apagar:${NOME_B}`]);
  assertEquals(e.limpeza.naoApagados, []);
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
});

Deno.test("falha ao gravar o 2º segredo (que pode ter gravado): os dois nomes saem do GitHub, travas soltas", async () => {
  const m = await montar({
    gh: {
      falhas: {
        definir: {
          [NOME_B]: ({ nome, valor, segredos }) => {
            segredos.set(nome, valor); // o gh gravou e mesmo assim falhou
            throw new ErroDaPonte("gh falso: saiu com código 1");
          },
        },
      },
    },
  });
  const e = await pegarErro(() => abrir(m));
  assert(e instanceof ErroDaPonte);
  assert(!m.gh.segredos.has(NOME_A));
  assert(!m.gh.segredos.has(NOME_B));
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
  assertSemCanario(e, "erro da gravação");
  assertSemCanario(e.limpeza, "limpeza");
});

Deno.test("falha na faxina (segredo velho não sai): não abre, não renova", async () => {
  const m = await montar({
    gh: {
      existentes: [NOME_A],
      falhas: {
        apagar: {
          [NOME_A]: () => {
            throw new ErroDaPonte("gh falso: 500");
          },
        },
      },
    },
  });
  const e = await pegarErro(() => abrir(m));
  assertEquals(e.codigo, "FAXINA_INCOMPLETA");
  assertEquals(m.fetch.chamadas, { "loja-a": 0, "loja-b": 0 });
  assertEquals(
    e.limpeza.naoApagados.map((x) => x.nome),
    [NOME_A],
  );
});

Deno.test("sinal no meio da gravação: o gh em voo é cortado, TODOS os nomes OAuth saem, travas soltas", async () => {
  const controle = new AbortController();
  let sinalRecebido = null;
  const m = await montar({
    gh: {
      falhas: {
        definir: {
          [NOME_B]: ({ nome, valor, opcoes, segredos }) => {
            sinalRecebido = opcoes.sinal;
            segredos.set(nome, valor);
            setTimeout(() => controle.abort(), 0);
            return new Promise((_ok, falha) => {
              opcoes.sinal.addEventListener("abort", () =>
                falha(new ErroDaPonte("gh falso: morto")),
              );
            });
          },
        },
      },
    },
  });
  const e = await pegarErro(() => abrir(m, { sinal: controle.signal }));
  assert(e instanceof ErroDaPonte);
  assertEquals(e.codigo, "ABERTURA_INTERROMPIDA");
  assert(sinalRecebido === controle.signal, "o definir não recebeu o sinal");
  assertEquals(m.gh.segredos.size, 0);
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
});

Deno.test("sinal durante a renovação: a abertura cai na hora, e a trava da renovação atrasada solta quando ela chega", async () => {
  const controle = new AbortController();
  let soltarResposta;
  const m = await montar({
    porLoja: {
      "loja-b": () => {
        setTimeout(() => controle.abort(), 0);
        return new Promise((ok) => {
          soltarResposta = () => ok(respostaToken(CANARIO_B));
        });
      },
    },
  });
  // a abertura cai NA HORA, sem esperar a renovação (nem o prazo de 30 s dela)
  let relogio;
  const e = await Promise.race([
    pegarErro(() => abrir(m, { sinal: controle.signal })),
    new Promise((ok) => {
      relogio = setTimeout(() => ok("pendurou"), 2000);
    }),
  ]);
  clearTimeout(relogio);
  assert(
    e !== "pendurou",
    "a abertura esperou a renovação em voo em vez de cair com o sinal",
  );
  assertEquals(e.codigo, "ABERTURA_INTERROMPIDA");
  assertEquals(m.gh.gravacoes, []);
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  soltarResposta();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
});

// ------------------------------------------------- mudança 6: escrita --

Deno.test("colaborador com escrita além do dono: recusa abrir sem renovar nem gravar", async () => {
  const m = await montar({ gh: { escrita: ["dono-falso", "intruso-falso"] } });
  const e = await pegarErro(() => abrir(m));
  assertEquals(e.codigo, "ESCRITA_DE_TERCEIROS");
  assert(e.message.includes("intruso-falso"));
  assertEquals(m.fetch.chamadas, { "loja-a": 0, "loja-b": 0 });
  assertEquals(m.gh.gravacoes, []);
});

Deno.test("dono com outra caixa de letra não conta como terceiro", async () => {
  const m = await montar({ gh: { escrita: ["Dono-Falso"] } });
  const s = await abrir(m);
  await s.fechar();
});

// --------------------------------------------------------- 7. fechar --

Deno.test("fechar: apaga TODOS mesmo com o primeiro apagar falhando, solta travas, idempotente, comando à mão", async () => {
  const m = await montar({
    gh: {
      falhas: {
        apagar: {
          [NOME_A]: () => {
            throw new ErroDaPonte("gh falso: 500");
          },
        },
      },
    },
  });
  const s = await abrir(m);
  const [r1, r2] = await Promise.all([s.fechar(), s.fechar()]);
  const r3 = await s.fechar();
  assert(r1 === r2 && r2 === r3, "fechar duas vezes refez o trabalho");
  assertEquals(m.log.filter((x) => x.startsWith("apagar:")).length, 2);
  assertEquals(r1.apagados, [NOME_B]);
  assertEquals(r1.naoApagados, [
    {
      nome: NOME_A,
      comando: `gh secret delete ${NOME_A} --app actions --repo ${REPO}`,
    },
  ]);
  assertEquals(s.estado, "fechada");
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
  assertSemCanario(r1, "resultado do fechar");
  assert(m.log.includes("esquecer"), "o token do gh ficou na memória");
});

Deno.test("fechar: apagar que falha mas a lista prova que o segredo não existe conta como apagado", async () => {
  const m = await montar({
    gh: {
      falhas: {
        apagar: {
          [NOME_A]: ({ nome, segredos }) => {
            segredos.delete(nome);
            throw new ErroDaPonte("gh falso: 404");
          },
        },
      },
    },
  });
  const s = await abrir(m);
  const r = await s.fechar();
  assertEquals(r.apagados.sort(), [NOME_A, NOME_B]);
  assertEquals(r.naoApagados, []);
});

Deno.test("fechar: lista que também falha deixa o nome em naoApagados (nunca 'apagado' no escuro)", async () => {
  const m = await montar({
    gh: {
      falhas: {
        apagar: {
          [NOME_A]: () => {
            throw new ErroDaPonte("x");
          },
        },
      },
    },
  });
  const s = await abrir(m);
  m.gh.listar = async () => {
    throw new ErroDaPonte("lista caiu");
  };
  const r = await s.fechar();
  assertEquals(
    r.naoApagados.map((x) => x.nome),
    [NOME_A],
  );
});

Deno.test("fechar com matarTokenNoFechar: renova de novo cada loja DEPOIS de apagar, e o token novo não sai", async () => {
  const m = await montar();
  const s = await abrir(m, { matarTokenNoFechar: true });
  const r = await s.fechar();
  const iApagar = Math.max(
    m.log.indexOf(`apagar:${NOME_A}`),
    m.log.indexOf(`apagar:${NOME_B}`),
  );
  const iMatar = Math.min(
    m.log.lastIndexOf("renovou:loja-a"),
    m.log.lastIndexOf("renovou:loja-b"),
  );
  assertEquals(m.fetch.chamadas, { "loja-a": 2, "loja-b": 2 });
  assert(iApagar < iMatar, `matou antes de apagar: ${m.log}`);
  assertEquals(r.tokensNaoMortos, []);
  assertSemCanario(r, "resultado do fechar");
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
});

Deno.test("fechar com matarTokenNoFechar: renovação que falha volta em tokensNaoMortos e a trava solta mesmo assim", async () => {
  const m = await montar({
    porLoja: {
      "loja-a": (n) =>
        n === 1
          ? respostaToken(CANARIO_A)
          : new Response("{}", { status: 500 }),
    },
  });
  const s = await abrir(m, { matarTokenNoFechar: true });
  const r = await s.fechar();
  assertEquals(r.tokensNaoMortos, ["loja-a"]);
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
});

Deno.test("fechar SEM matarTokenNoFechar não renova de novo", async () => {
  const m = await montar();
  const s = await abrir(m);
  await s.fechar();
  assertEquals(m.fetch.chamadas, { "loja-a": 1, "loja-b": 1 });
});

Deno.test("falha na abertura com matarTokenNoFechar: só a loja cujo segredo foi tentado é renovada de novo", async () => {
  const m = await montar({
    gh: {
      falhas: {
        definir: {
          [NOME_B]: () => {
            throw new ErroDaPonte("gh falso");
          },
        },
      },
    },
  });
  const e = await pegarErro(() => abrir(m, { matarTokenNoFechar: true }));
  assert(e instanceof ErroDaPonte);
  assertEquals(m.fetch.chamadas, { "loja-a": 2, "loja-b": 2 });
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
});

Deno.test("falha na abertura ANTES de gravar, com matarTokenNoFechar: token que não foi ao GitHub não é renovado de novo", async () => {
  const m = await montar({
    porLoja: { "loja-b": () => respostaToken(CANARIO_B, 600) },
  });
  const e = await pegarErro(() => abrir(m, { matarTokenNoFechar: true }));
  assertEquals(e.codigo, "TOKEN_CURTO");
  assertEquals(m.fetch.chamadas, { "loja-a": 1, "loja-b": 1 });
  assertEquals(e.limpeza.tokensNaoMortos, []);
  assertEquals(await travaLivre(m.cofre, "loja-a"), true);
  assertEquals(await travaLivre(m.cofre, "loja-b"), true);
});

// ------------------------------------------------------------ faxina --

Deno.test("faxinar avulsa: entra, apaga só os segredos OAuth que existem, nada renova", async () => {
  const log = [];
  const gh = ghFalso(log, { existentes: [NOME_B, NOME_IKCOUS] });
  const r = await faxinar({ cadastro: cadastro(), gh });
  assertEquals(log, ["entrar", "listar", `apagar:${NOME_B}`, "esquecer"]);
  assertEquals(r.apagados, [NOME_B]);
  assertEquals(r.naoApagados, []);
  assert(gh.segredos.has(NOME_IKCOUS));
});

Deno.test("faxinar sem loja OAuth no cadastro: nem entra no gh", async () => {
  const semOauth = cadastroSemOAuth();
  const log = [];
  const r = await faxinar({ cadastro: semOauth, gh: ghFalso(log) });
  assertEquals(r, { apagados: [], naoApagados: [] });
  assertEquals(log, []);
});

// ------------------------------------------------------- 9. canário --

Deno.test("canário: nenhum token em erro, resultado, argumento de nome nem process.env", async () => {
  const erros = [];
  for (const porLoja of [
    { "loja-b": () => respostaToken(CANARIO_B, null) },
    {
      "loja-b": () =>
        new Response(
          JSON.stringify({ error: "x", error_description: CANARIO_A }),
          { status: 500 },
        ),
    },
  ]) {
    erros.push(await pegarErro(async () => abrir(await montar({ porLoja }))));
  }
  for (const e of erros) assertSemCanario(e, "erro");
  const m = await montar();
  const s = await abrir(m);
  const r = await s.fechar();
  assertSemCanario(r, "fechar");
  assertSemCanario(
    { lojas: s.lojas, validaAte: s.validaAte, estado: s.estado },
    "sessão",
  );
  for (const linha of m.log) assertSemCanario(linha, "chamada ao gh");
  assertSemCanario(Deno.env.toObject(), "process.env");
});

// ------------------------------------------------- adaptador real do gh --

/** spawn falso: cada chamada consome um roteiro { saida, erro, codigo, travar }. */
function spawnFalso(...roteiros) {
  const chamadas = [];
  const sp = (cmd, args, opcoes) => {
    const roteiro = roteiros.shift() ?? { codigo: 0 };
    const filho = new EventEmitter();
    filho.stdout = new EventEmitter();
    filho.stderr = new EventEmitter();
    const registro = { cmd, args, opcoes, stdin: "", mortoCom: null };
    chamadas.push(registro);
    const terminar = (codigo) =>
      setTimeout(() => {
        if (roteiro.saida)
          filho.stdout.emit("data", Buffer.from(roteiro.saida));
        if (roteiro.erro) filho.stderr.emit("data", Buffer.from(roteiro.erro));
        filho.emit("close", codigo);
      }, 0);
    filho.kill = (sinal) => {
      registro.mortoCom = sinal ?? "SIGTERM";
      terminar(null);
      return true;
    };
    filho.stdin = {
      on() {},
      write(d) {
        registro.stdin += String(d);
      },
      end(d) {
        if (d !== undefined) registro.stdin += String(d);
        if (roteiro.enoent) {
          setTimeout(
            () =>
              filho.emit(
                "error",
                Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
              ),
            0,
          );
          return;
        }
        if (!roteiro.travar) terminar(roteiro.codigo ?? 0);
      },
    };
    return filho;
  };
  sp.chamadas = chamadas;
  return sp;
}

function fetchGh(...respostas) {
  const chamadas = [];
  const f = (url, init = {}) => {
    chamadas.push({ url: String(url), init });
    const r = respostas.shift();
    if (typeof r === "function") return Promise.resolve(r(url, init));
    if (r === undefined) throw new Error("fetch falso sem resposta");
    return Promise.resolve(r);
  };
  f.chamadas = chamadas;
  return f;
}

const json = (status, corpo) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

function ghReal(spawn, fetch, extra = {}) {
  return criarGhReal({
    repo: REPO,
    cadastro: cadastro(),
    spawn,
    fetch,
    env: { PATH: "x" },
    ...extra,
  });
}

Deno.test("gh real: entrar lê `gh auth token` UMA vez, sem shell, e o token só vai no cabeçalho do fetch", async () => {
  const sp = spawnFalso({ saida: `${TOKEN_GH}\n` });
  const f = fetchGh(
    json(204),
    json(204),
    json(200, { total_count: 0, secrets: [] }),
  );
  const gh = ghReal(sp, f);
  await gh.entrar();
  await gh.entrar();
  await gh.apagar(NOME_A);
  await gh.apagar(NOME_B);
  await gh.listar();
  assertEquals(sp.chamadas.length, 1);
  assertEquals(sp.chamadas[0].cmd, "gh");
  assertEquals(sp.chamadas[0].args, [
    "auth",
    "token",
    "--hostname",
    "github.com",
  ]);
  assertEquals(sp.chamadas[0].opcoes.shell, false);
  assertEquals(
    f.chamadas[0].url,
    `https://api.github.com/repos/${REPO}/actions/secrets/${NOME_A}`,
  );
  assertEquals(f.chamadas[0].init.method, "DELETE");
  assertEquals(f.chamadas[0].init.redirect, "manual");
  assertEquals(f.chamadas[0].init.headers.authorization, `Bearer ${TOKEN_GH}`);
  for (const c of f.chamadas) assert(!c.url.includes(TOKEN_GH));
  assertEquals(gh.dono, "dono-falso");
  assertEquals(gh.repo, REPO);
});

Deno.test("gh real: apagar/listar/comEscrita sem entrar recusam sem rede; esquecer apaga o token da memória", async () => {
  const sp = spawnFalso({ saida: TOKEN_GH });
  const f = fetchGh();
  const gh = ghReal(sp, f);
  await assertRejects(() => gh.apagar(NOME_A), ErroDaPonte);
  await assertRejects(() => gh.listar(), ErroDaPonte);
  await assertRejects(() => gh.comEscrita(), ErroDaPonte);
  await gh.entrar();
  await gh.esquecer();
  await assertRejects(() => gh.apagar(NOME_A), ErroDaPonte);
  assertEquals(f.chamadas.length, 0);
});

Deno.test("gh real: entrar sem login, sem gh ou com saída estranha recusa sem ecoar a saída", async () => {
  for (const roteiro of [
    { codigo: 1, erro: `not logged in ${TOKEN_GH}` },
    { enoent: true },
    { saida: "" },
    { saida: `${TOKEN_GH} ${TOKEN_GH}` },
  ]) {
    const e = await pegarErro(() =>
      ghReal(spawnFalso(roteiro), fetchGh()).entrar(),
    );
    assert(e instanceof ErroDaPonte, String(e));
    assertSemCanario(e, "erro do entrar");
  }
});

Deno.test("gh real: definir passa o valor SÓ pelo stdin, sem quebra de linha, args na ordem do plano", async () => {
  const sp = spawnFalso({ codigo: 0 });
  const gh = ghReal(sp, fetchGh());
  await gh.definir(NOME_A, CANARIO_A);
  const c = sp.chamadas[0];
  assertEquals(c.cmd, "gh");
  assertEquals(c.args, [
    "secret",
    "set",
    NOME_A,
    "--app",
    "actions",
    "--repo",
    REPO,
  ]);
  assertEquals(c.stdin, CANARIO_A);
  assertEquals(c.opcoes.shell, false);
  assertEquals(c.opcoes.windowsHide, true);
  assertSemCanario(c.args, "argv");
  assertSemCanario(c.opcoes.env, "env do filho");
});

Deno.test("gh real: definir que falha não ecoa o valor nem o token que o gh imprimir", async () => {
  const sp = spawnFalso({
    codigo: 1,
    erro: `HTTP 403: ${CANARIO_A} ghp_${"9".repeat(36)}`,
  });
  const e = await pegarErro(() =>
    ghReal(sp, fetchGh()).definir(NOME_A, CANARIO_A),
  );
  assert(e instanceof ErroDaPonte);
  assert(e.message.includes("HTTP 403"), e.message);
  assertSemCanario(e, "erro do definir");
  assert(!e.message.includes("9".repeat(36)));
});

Deno.test("gh real: definir com sinal abortado mata o gh e recusa", async () => {
  const sp = spawnFalso({ travar: true });
  const controle = new AbortController();
  const p = ghReal(sp, fetchGh()).definir(NOME_A, CANARIO_A, {
    sinal: controle.signal,
  });
  setTimeout(() => controle.abort(), 0);
  const e = await pegarErro(() => p);
  assert(e instanceof ErroDaPonte);
  assert(sp.chamadas[0].mortoCom !== null, "o gh não foi morto");
});

Deno.test("gh real: nunca toca segredo que não é de loja OAuth (nem spawn nem fetch)", async () => {
  const sp = spawnFalso({ saida: TOKEN_GH });
  const f = fetchGh();
  const gh = ghReal(sp, f);
  await gh.entrar();
  for (const nome of [
    NOME_IKCOUS,
    NOME_SAVY,
    "SUPABASE_ACCESS_TOKEN",
    "OUTRO",
    `${NOME_A} --x`,
  ]) {
    await assertRejects(() => gh.definir(nome, CANARIO_A), ErroDaPonte);
    await assertRejects(() => gh.apagar(nome), ErroDaPonte);
  }
  assertEquals(sp.chamadas.length, 1);
  assertEquals(f.chamadas.length, 0);
});

Deno.test("gh real: apagar só aceita 204; 404 e 5xx sobem (quem decide é a lista)", async () => {
  for (const status of [404, 500, 302, 401]) {
    const gh = ghReal(
      spawnFalso({ saida: TOKEN_GH }),
      fetchGh(json(status, { message: TOKEN_GH })),
    );
    await gh.entrar();
    const e = await pegarErro(() => gh.apagar(NOME_A));
    assert(e instanceof ErroDaPonte, `${status}: ${e}`);
    assertEquals(e.status, status);
    assertSemCanario(e, "erro do apagar");
  }
});

Deno.test("gh real: listar pagina até o total e devolve só os nomes", async () => {
  const pagina1 = Array.from({ length: 100 }, (_, i) => ({
    name: `SEGREDO_${i}`,
  }));
  const f = fetchGh(
    json(200, { total_count: 101, secrets: pagina1 }),
    json(200, { total_count: 101, secrets: [{ name: NOME_A }] }),
  );
  const gh = ghReal(spawnFalso({ saida: TOKEN_GH }), f);
  await gh.entrar();
  const nomes = await gh.listar();
  assertEquals(nomes.length, 101);
  assertEquals(nomes.at(-1), NOME_A);
  assertEquals(
    f.chamadas[0].url,
    `https://api.github.com/repos/${REPO}/actions/secrets?per_page=100&page=1`,
  );
  assertEquals(
    f.chamadas[1].url,
    `https://api.github.com/repos/${REPO}/actions/secrets?per_page=100&page=2`,
  );
});

Deno.test("gh real: listar com resposta torta recusa", async () => {
  for (const r of [
    json(200, { secrets: "x" }),
    json(200, []),
    json(403, {}),
    new Response("nao json", { status: 200 }),
  ]) {
    const gh = ghReal(spawnFalso({ saida: TOKEN_GH }), fetchGh(r));
    await gh.entrar();
    await assertRejects(() => gh.listar(), ErroDaPonte);
  }
});

Deno.test("gh real: comEscrita devolve quem tem push/maintain/admin, de todas as afiliações", async () => {
  const f = fetchGh(
    json(200, [
      {
        login: "dono-falso",
        permissions: { admin: true, push: true, pull: true },
      },
      {
        login: "leitor",
        permissions: { admin: false, maintain: false, push: false, pull: true },
      },
      {
        login: "mantenedor",
        permissions: { admin: false, maintain: true, push: false, pull: true },
      },
      { login: "escritor", permissions: { push: true, pull: true } },
    ]),
  );
  const gh = ghReal(spawnFalso({ saida: TOKEN_GH }), f);
  await gh.entrar();
  assertEquals(await gh.comEscrita(), ["dono-falso", "mantenedor", "escritor"]);
  assertEquals(
    f.chamadas[0].url,
    `https://api.github.com/repos/${REPO}/collaborators?affiliation=all&per_page=100&page=1`,
  );
});

Deno.test("gh real: comEscrita com colaborador sem permissions ou resposta torta recusa (falha fechada)", async () => {
  for (const r of [
    json(200, [{ login: "x" }]),
    json(200, { a: 1 }),
    json(403, []),
  ]) {
    const gh = ghReal(spawnFalso({ saida: TOKEN_GH }), fetchGh(r));
    await gh.entrar();
    await assertRejects(() => gh.comEscrita(), ErroDaPonte);
  }
});

Deno.test("gh real: repositório fora de OWNER/REPO recusa na criação", () => {
  for (const repo of [
    "",
    "so-um",
    "a/b/c",
    "https://github.com/a/b",
    "a/..",
    "a b/c",
  ]) {
    assert(
      pegarErroSinc(() =>
        criarGhReal({
          repo,
          cadastro: cadastro(),
          spawn: spawnFalso(),
          fetch: fetchGh(),
        }),
      ) instanceof ErroDaPonte,
      repo,
    );
  }
});
