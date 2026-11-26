// @ts-nocheck
/**
 * Ponte A com uma GAVETA por loja OAuth (PLANO-AMBIENTE-POR-LOJA-26-11, T1-T6).
 * "Gaveta" é o GitHub Environment `loja-<projeto>`: o repositório só guarda
 * 100 segredos, e com um segredo por loja no nível do repositório a frota
 * travava em ~92 lojas OAuth. Cada loja passa a ter a gaveta dela, com o
 * MESMO nome de segredo de antes. O que este arquivo trava:
 *
 *  - T1 lojasOAuthDo devolve a gaveta de cada loja (`loja-<projeto>`);
 *  - T2 garantirAmbiente: GET 200 não faz nada; 404 cria com PUT {};
 *    limite do GitHub sobe LIMITE_DO_GITHUB; gaveta que não é de loja OAuth
 *    do cadastro recusa SEM rede;
 *  - T3 definir garante a gaveta ANTES de `gh secret set NOME --env loja-x`
 *    (sem gaveta o gh falha com 404: medido em 26/11), valor só no stdin;
 *  - T4 apagar: DELETE na gaveta; 204 ok, 404 erro com mensagem clara;
 *  - T5 listar(nomes?): lê as gavetas que existem, com concorrência limitada,
 *    e acusa segredo OAuth que sobrou no nível do REPOSITÓRIO (legado);
 *    resposta torta = erro;
 *  - T6 o comando à mão é `--env loja-x`; sobra no repositório deixa a faxina
 *    INCOMPLETA (a sessão não abre); apagarTodos lista só os que falharam.
 *
 * Nenhuma rede real e nenhum gh de verdade: o GitHub é um dublê com estado
 * (repositório, gavetas e segredos de cada gaveta) e o gh é um spawn dublê
 * que grava no mesmo estado.
 */
import { EventEmitter } from "node:events";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CONCORRENCIA_DO_GITHUB,
  ErroDaPonte,
  abrirSessao,
  criarGhReal,
  faxinar,
  lojasOAuthDo,
} from "../scripts/frota/ponte-oauth.mjs";

// Canários montados em tempo de execução (literal dispara o secretlint).
const canario = (par) => `sbp_oauth_${par.repeat(20)}`;
const CANARIO_A = canario("ab");
const TOKEN_GH = `gho_${"12".repeat(18)}`;
const CANARIOS = [CANARIO_A, TOKEN_GH];

const REPO = "dono-falso/repo-falso";
const API = "https://api.github.com";
const NOME_A = "SUPABASE_ACCESS_TOKEN_LOJA_A";
const NOME_B = "SUPABASE_ACCESS_TOKEN_LOJA_B";
const NOME_IKCOUS = "SUPABASE_ACCESS_TOKEN_IKCOUS";
const NOME_SAVY = "SUPABASE_ACCESS_TOKEN_SAVY";
const GAVETA_A = "loja-loja-a";
const GAVETA_B = "loja-loja-b";
const REF_A = "aaaaaaaaaaaaaaaaaaaa";
const REF_B = "bbbbbbbbbbbbbbbbbbbb";

function cadastro() {
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
    },
  };
}

const json = (status, corpo, headers = {}) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers,
  });

/**
 * O GitHub dublê, com estado: segredos do repositório, gavetas e os segredos
 * de cada gaveta. `roteiro["METODO /caminho"]` é uma fila de respostas que
 * passam na frente do estado (Response, ou função que devolve Response).
 * Toda chamada vai para `log` (compartilhado com o spawn dublê, para provar
 * a ORDEM entre fetch e gh).
 */
function githubFalso({
  noRepositorio = [],
  gavetas = {},
  roteiro = {},
  atrasoDaGavetaMs = 0,
} = {}) {
  const log = [];
  const conta = { juntos: 0, maxJuntos: 0 };
  const repo = new Set(noRepositorio);
  const gav = new Map(
    Object.entries(gavetas).map(([g, nomes]) => [g, new Set(nomes)]),
  );
  const filas = new Map(
    Object.entries(roteiro).map(([k, v]) => [k, [...[v].flat()]]),
  );
  const chamadas = [];
  const base = `/repos/${REPO}`;
  const pagina = (u, itens) => {
    const por = Number(u.searchParams.get("per_page") ?? 30);
    const p = Number(u.searchParams.get("page") ?? 1);
    return itens.slice((p - 1) * por, p * por);
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    const caminho = decodeURIComponent(u.pathname);
    chamadas.push({ metodo, caminho, url: String(url), init });
    log.push(`${metodo} ${caminho}`);
    await Promise.resolve();
    const fila = filas.get(`${metodo} ${caminho}`);
    if (fila?.length) {
      const r = fila.shift();
      return typeof r === "function" ? r() : r;
    }
    if (metodo === "GET" && caminho === `${base}/collaborators`) {
      return json(200, [
        { login: "dono-falso", permissions: { admin: true, push: true } },
      ]);
    }
    if (metodo === "GET" && caminho === `${base}/actions/secrets`) {
      const nomes = [...repo];
      return json(200, {
        total_count: nomes.length,
        secrets: pagina(u, nomes).map((name) => ({ name })),
      });
    }
    if (metodo === "GET" && caminho === `${base}/environments`) {
      const nomes = [...gav.keys()];
      return json(200, {
        total_count: nomes.length,
        environments: pagina(u, nomes).map((name) => ({ id: 1, name })),
      });
    }
    let m = new RegExp(`^${base}/environments/([^/]+)$`).exec(caminho);
    if (m && metodo === "GET") {
      return gav.has(m[1]) ? json(200, { name: m[1] }) : json(404, {});
    }
    if (m && metodo === "PUT") {
      if (!gav.has(m[1])) gav.set(m[1], new Set());
      return json(200, { name: m[1] });
    }
    m = new RegExp(`^${base}/environments/([^/]+)/secrets$`).exec(caminho);
    if (m && metodo === "GET") {
      conta.juntos++;
      conta.maxJuntos = Math.max(conta.maxJuntos, conta.juntos);
      await new Promise((r) => setTimeout(r, atrasoDaGavetaMs));
      conta.juntos--;
      const s = gav.get(m[1]);
      if (!s) return json(404, {});
      const nomes = [...s];
      return json(200, {
        total_count: nomes.length,
        secrets: pagina(u, nomes).map((name) => ({ name })),
      });
    }
    m = new RegExp(`^${base}/environments/([^/]+)/secrets/([^/]+)$`).exec(
      caminho,
    );
    if (m && metodo === "DELETE") {
      const s = gav.get(m[1]);
      if (!s?.has(m[2])) return json(404, {});
      s.delete(m[2]);
      return new Response(null, { status: 204 });
    }
    return json(404, {});
  };
  /** Põe uma resposta na frente do estado a partir de agora. */
  const roteirar = (chave, resposta) => {
    if (!filas.has(chave)) filas.set(chave, []);
    filas.get(chave).push(resposta);
  };
  return { fetch, chamadas, log, repo, gav, conta, roteirar };
}

/**
 * O gh dublê: `auth token` devolve o TOKEN_GH; `secret set NOME --env G
 * --repo R` grava na gaveta G do GitHub dublê, e falha com 404 (como o gh de
 * verdade, medido em 26/11) quando a gaveta não existe.
 */
function spawnFalso(github, { secretSet } = {}) {
  const chamadas = [];
  const sp = (cmd, args, opcoes) => {
    const filho = new EventEmitter();
    filho.stdout = new EventEmitter();
    filho.stderr = new EventEmitter();
    const registro = { cmd, args, opcoes, stdin: "", mortoCom: null };
    chamadas.push(registro);
    github.log.push(`gh ${args.slice(0, 2).join(" ")}`);
    const terminar = (codigo, saida = "", erro = "") =>
      setTimeout(() => {
        if (saida) filho.stdout.emit("data", Buffer.from(saida));
        if (erro) filho.stderr.emit("data", Buffer.from(erro));
        filho.emit("close", codigo);
      }, 0);
    filho.kill = (sinal) => {
      registro.mortoCom = sinal ?? "SIGTERM";
      terminar(null);
      return true;
    };
    filho.stdin = {
      on() {},
      end(d) {
        if (d !== undefined) registro.stdin += String(d);
        if (args[0] === "auth") return terminar(0, `${TOKEN_GH}\n`);
        if (args[0] === "secret" && args[1] === "set") {
          if (secretSet) return secretSet(registro, terminar);
          const g = args[args.indexOf("--env") + 1];
          const s = github.gav.get(g);
          if (args.indexOf("--env") < 0 || !s) {
            return terminar(
              1,
              "",
              `failed to fetch public key: HTTP 404: Not Found (${API}/repos/${REPO}/environments/${g}/secrets/public-key)`,
            );
          }
          s.add(args[2]);
          return terminar(0);
        }
        return terminar(3);
      },
    };
    return filho;
  };
  sp.chamadas = chamadas;
  return sp;
}

function montar(estado = {}, extra = {}) {
  const github = githubFalso(estado);
  const spawn = spawnFalso(github, extra);
  const gh = criarGhReal({
    repo: REPO,
    cadastro: extra.cadastro ?? cadastro(),
    spawn,
    fetch: github.fetch,
    env: { PATH: "x" },
    agora: () => 1_800_000_000_000,
  });
  return { github, spawn, gh };
}

async function montarEntrado(estado = {}, extra = {}) {
  const m = montar(estado, extra);
  await m.gh.entrar();
  return m;
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
    assert(!texto.includes(c), `${rotulo} carrega um token`);
  }
}

// ------------------------------------------------- T1 a gaveta da loja --

Deno.test("T1 lojasOAuthDo: cada loja OAuth leva a gaveta loja-<projeto>; IKCOUS e Savy não aparecem", () => {
  assertEquals(lojasOAuthDo(cadastro()), [
    { projeto: "loja-a", ref: REF_A, nome: NOME_A, ambiente: GAVETA_A },
    { projeto: "loja-b", ref: REF_B, nome: NOME_B, ambiente: GAVETA_B },
  ]);
});

// ------------------------------------------- T2 garantir a gaveta ------

const caminhoDa = (g) => `/repos/${REPO}/environments/${g}`;

Deno.test("T2 garantirAmbiente: gaveta que existe (GET 200) não faz mais nada", async () => {
  const m = await montarEntrado({ gavetas: { [GAVETA_A]: [] } });
  await m.gh.garantirAmbiente(GAVETA_A);
  assertEquals(
    m.github.chamadas.map((c) => `${c.metodo} ${c.caminho}`),
    [`GET ${caminhoDa(GAVETA_A)}`],
  );
});

Deno.test("T2 garantirAmbiente: gaveta que não existe (404) é criada com PUT {}; repetir é idempotente", async () => {
  const m = await montarEntrado();
  await m.gh.garantirAmbiente(GAVETA_A);
  assertEquals(
    m.github.chamadas.map((c) => `${c.metodo} ${c.caminho}`),
    [`GET ${caminhoDa(GAVETA_A)}`, `PUT ${caminhoDa(GAVETA_A)}`],
  );
  const put = m.github.chamadas[1];
  assertEquals(put.init.body, "{}");
  assertEquals(put.init.headers["content-type"], "application/json");
  assertEquals(put.init.headers.authorization, `Bearer ${TOKEN_GH}`);
  assertEquals(put.url, `${API}${caminhoDa(GAVETA_A)}`);
  assert(m.github.gav.has(GAVETA_A), "a gaveta não foi criada");
  // de novo: a gaveta já existe, só o GET
  await m.gh.garantirAmbiente(GAVETA_A);
  assertEquals(m.github.chamadas.length, 3);
  assertEquals(m.github.chamadas[2].metodo, "GET");
});

Deno.test("T2 garantirAmbiente: limite do GitHub (429, ou 403 com sinal de limite) sobe LIMITE_DO_GITHUB com esperarMs, e não cria nada", async () => {
  const casos = [
    [`GET ${caminhoDa(GAVETA_A)}`, json(429, {}, { "retry-after": "5" }), 5000],
    [
      `GET ${caminhoDa(GAVETA_A)}`,
      json(
        403,
        {},
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(1_800_000_000 + 9),
        },
      ),
      9000,
    ],
    [
      `GET ${caminhoDa(GAVETA_A)}`,
      json(403, { message: "You have exceeded a secondary rate limit." }),
      60_000,
    ],
    [`PUT ${caminhoDa(GAVETA_A)}`, json(429, {}, { "retry-after": "2" }), 2000],
  ];
  for (const [chave, resposta, ms] of casos) {
    const m = await montarEntrado({ roteiro: { [chave]: resposta } });
    const e = await pegarErro(() => m.gh.garantirAmbiente(GAVETA_A));
    assert(e instanceof ErroDaPonte, `${chave}: ${e}`);
    assertEquals(e.codigo, "LIMITE_DO_GITHUB", chave);
    assertEquals(e.esperarMs, ms, chave);
    assertEquals(m.github.gav.has(GAVETA_A), false, `${chave}: criou`);
    if (chave.startsWith("GET")) {
      assertEquals(m.github.chamadas.length, 1, `${chave}: tentou o PUT`);
    }
    assertSemCanario(e, `erro de ${chave}`);
  }
});

Deno.test("T2 garantirAmbiente: 403 de PERMISSÃO (sem sinal de limite) e 5xx sobem HTTP, sem PUT", async () => {
  for (const r of [
    json(403, { message: "Resource not accessible by integration" }),
    json(500, {}),
    json(401, { message: TOKEN_GH }),
  ]) {
    const m = await montarEntrado({
      roteiro: { [`GET ${caminhoDa(GAVETA_A)}`]: r },
    });
    const e = await pegarErro(() => m.gh.garantirAmbiente(GAVETA_A));
    assert(e instanceof ErroDaPonte, String(e));
    assertEquals(e.codigo, "HTTP");
    assertEquals(e.status, r.status);
    assertEquals(m.github.chamadas.length, 1, "tentou o PUT");
    assertSemCanario(e, "erro do garantirAmbiente");
  }
  // PUT recusado (422: nome inválido) também sobe
  const m = await montarEntrado({
    roteiro: { [`PUT ${caminhoDa(GAVETA_A)}`]: json(422, {}) },
  });
  const e = await pegarErro(() => m.gh.garantirAmbiente(GAVETA_A));
  assertEquals(e.status, 422);
});

Deno.test("T2 garantirAmbiente: gaveta que não é de loja OAuth do cadastro recusa SEM rede; sem entrar também", async () => {
  const m = await montarEntrado();
  for (const nome of [
    "loja-ikcous-publicada",
    "loja-savy",
    "loja-loja",
    "loja-a",
    "LOJA-LOJA-A",
    `${GAVETA_A}/../x`,
    `${GAVETA_A} `,
    NOME_A,
    "",
    undefined,
    null,
  ]) {
    const e = await pegarErro(() => m.gh.garantirAmbiente(nome));
    assert(e instanceof ErroDaPonte, `${nome}: ${e}`);
    assertEquals(e.codigo, "NOME_RECUSADO", String(nome));
  }
  assertEquals(m.github.chamadas.length, 0);
  const semEntrar = montar();
  await assertRejects(
    () => semEntrar.gh.garantirAmbiente(GAVETA_A),
    ErroDaPonte,
  );
  assertEquals(semEntrar.github.chamadas.length, 0);
});

// ------------------------------------------ T3 gravar na gaveta --------

Deno.test("T3 definir: garante a gaveta ANTES do `gh secret set NOME --env loja-x --repo R`, valor só no stdin", async () => {
  const m = await montarEntrado();
  await m.gh.definir(NOME_A, CANARIO_A);
  assertEquals(m.github.log, [
    "gh auth token",
    `GET ${caminhoDa(GAVETA_A)}`,
    `PUT ${caminhoDa(GAVETA_A)}`,
    "gh secret set",
  ]);
  const c = m.spawn.chamadas[1];
  assertEquals(c.cmd, "gh");
  assertEquals(c.args, [
    "secret",
    "set",
    NOME_A,
    "--env",
    GAVETA_A,
    "--repo",
    REPO,
  ]);
  assertEquals(c.stdin, CANARIO_A);
  assertEquals(c.opcoes.shell, false);
  assertSemCanario(c.args, "argv");
  assertSemCanario(c.opcoes.env, "env do filho");
  assertEquals([...m.github.gav.get(GAVETA_A)], [NOME_A]);
  assertEquals([...m.github.repo], [], "gravou no nível do repositório");
  // o valor do segredo nunca vai num pedido à API (só o gh o cifra)
  for (const ch of m.github.chamadas) {
    assert(!JSON.stringify(ch).includes(CANARIO_A), "o valor foi à API");
  }
});

Deno.test("T3 definir: gaveta que não se garante (5xx, limite) — o gh nem roda e o erro não carrega o valor", async () => {
  for (const r of [json(500, {}), json(429, {}, { "retry-after": "1" })]) {
    const m = await montarEntrado({
      roteiro: { [`GET ${caminhoDa(GAVETA_A)}`]: r },
    });
    const e = await pegarErro(() => m.gh.definir(NOME_A, CANARIO_A));
    assert(e instanceof ErroDaPonte, String(e));
    assertEquals(
      m.spawn.chamadas.map((x) => x.args[0]),
      ["auth"],
      "o gh rodou sem a gaveta",
    );
    assertSemCanario(e, "erro do definir");
  }
});

Deno.test("T3 definir: sinal que cai enquanto a gaveta é garantida — o gh nem roda (ABERTURA_INTERROMPIDA)", async () => {
  const controle = new AbortController();
  const m = await montarEntrado({
    gavetas: { [GAVETA_A]: [] },
    roteiro: {
      [`GET ${caminhoDa(GAVETA_A)}`]: () => {
        controle.abort();
        return json(200, { name: GAVETA_A });
      },
    },
  });
  const e = await pegarErro(() =>
    m.gh.definir(NOME_A, CANARIO_A, { sinal: controle.signal }),
  );
  assert(e instanceof ErroDaPonte, String(e));
  assertEquals(e.codigo, "ABERTURA_INTERROMPIDA");
  assertEquals(
    m.spawn.chamadas.map((x) => x.args[0]),
    ["auth"],
  );
  assertEquals([...m.github.gav.get(GAVETA_A)], []);
});

Deno.test("T3 definir: sem entrar, nome que não é OAuth ou valor torto recusam SEM rede e sem gh", async () => {
  const semEntrar = montar();
  await assertRejects(
    () => semEntrar.gh.definir(NOME_A, CANARIO_A),
    ErroDaPonte,
  );
  assertEquals(semEntrar.github.chamadas.length, 0);
  assertEquals(semEntrar.spawn.chamadas.length, 0);
  const m = await montarEntrado();
  for (const [nome, valor] of [
    [NOME_IKCOUS, CANARIO_A],
    [NOME_SAVY, CANARIO_A],
    ["SUPABASE_ACCESS_TOKEN", CANARIO_A],
    [NOME_A, ""],
    [NOME_A, `${CANARIO_A}\n`],
  ]) {
    await assertRejects(() => m.gh.definir(nome, valor), ErroDaPonte);
  }
  assertEquals(m.github.chamadas.length, 0);
  assertEquals(m.spawn.chamadas.length, 1, "só o auth token");
});

Deno.test("T3 definir: com a gaveta já existente, um GET e o gh (nada de PUT)", async () => {
  const m = await montarEntrado({ gavetas: { [GAVETA_B]: [] } });
  await m.gh.definir(NOME_B, CANARIO_A);
  assertEquals(m.github.log, [
    "gh auth token",
    `GET ${caminhoDa(GAVETA_B)}`,
    "gh secret set",
  ]);
  assertEquals([...m.github.gav.get(GAVETA_B)], [NOME_B]);
});

// ------------------------------------------ T4 apagar da gaveta --------

Deno.test("T4 apagar: DELETE na gaveta da loja (204 ok); repetir dá 404, que sobe com mensagem clara", async () => {
  const m = await montarEntrado({ gavetas: { [GAVETA_A]: [NOME_A] } });
  await m.gh.apagar(NOME_A);
  assertEquals(
    m.github.chamadas[0].url,
    `${API}${caminhoDa(GAVETA_A)}/secrets/${NOME_A}`,
  );
  assertEquals(m.github.chamadas[0].metodo, "DELETE");
  assertEquals(m.github.chamadas[0].init.redirect, "manual");
  assertEquals([...m.github.gav.get(GAVETA_A)], []);
  const e = await pegarErro(() => m.gh.apagar(NOME_A));
  assert(e instanceof ErroDaPonte, String(e));
  assertEquals(e.status, 404);
  assert(e.message.includes(NOME_A), e.message);
  assert(e.message.includes(GAVETA_A), e.message);
  assert(e.message.includes("não existe"), e.message);
  assertSemCanario(e, "erro do apagar");
});

Deno.test("T4 apagar: nunca apaga no nível do repositório, e o limite sobe LIMITE_DO_GITHUB", async () => {
  const m = await montarEntrado({ noRepositorio: [NOME_A] });
  const e = await pegarErro(() => m.gh.apagar(NOME_A));
  assertEquals(e.status, 404);
  assertEquals(
    m.github.chamadas.map((c) => c.caminho),
    [`${caminhoDa(GAVETA_A)}/secrets/${NOME_A}`],
  );
  assertEquals([...m.github.repo], [NOME_A]);
  const limite = await montarEntrado({
    roteiro: {
      [`DELETE ${caminhoDa(GAVETA_B)}/secrets/${NOME_B}`]: json(
        429,
        {},
        { "retry-after": "4" },
      ),
    },
  });
  const el = await pegarErro(() => limite.gh.apagar(NOME_B));
  assertEquals(el.codigo, "LIMITE_DO_GITHUB");
  assertEquals(el.esperarMs, 4000);
});

// ------------------------------------------ T5 listar as gavetas -------

const SEGREDOS_DO_REPO = `/repos/${REPO}/actions/secrets`;
const LISTA_DE_GAVETAS = `/repos/${REPO}/environments`;

Deno.test("T5 listar: lê o repositório, a lista de gavetas e só as gavetas que existem; devolve o que está nelas", async () => {
  const m = await montarEntrado({ gavetas: { [GAVETA_A]: [NOME_A] } });
  const r = await m.gh.listar();
  assertEquals(r, { nomes: [NOME_A], sobrasNoRepositorio: [] });
  assertEquals(
    m.github.chamadas.map((c) => `${c.metodo} ${c.caminho}`),
    [
      `GET ${SEGREDOS_DO_REPO}`,
      `GET ${LISTA_DE_GAVETAS}`,
      `GET ${caminhoDa(GAVETA_A)}/secrets`,
    ],
    "leu a gaveta que não existe",
  );
  assertEquals(
    m.github.chamadas[2].url,
    `${API}${caminhoDa(GAVETA_A)}/secrets?per_page=100&page=1`,
  );
  // as duas gavetas existem, só uma tem o segredo
  const m2 = await montarEntrado({
    gavetas: { [GAVETA_A]: [], [GAVETA_B]: [NOME_B] },
  });
  assertEquals(await m2.gh.listar(), {
    nomes: [NOME_B],
    sobrasNoRepositorio: [],
  });
});

Deno.test("T5 listar(nomes): só lê a gaveta dos nomes pedidos; pedido torto recusa SEM rede", async () => {
  const m = await montarEntrado({
    gavetas: { [GAVETA_A]: [NOME_A], [GAVETA_B]: [NOME_B] },
  });
  assertEquals(await m.gh.listar([NOME_B]), {
    nomes: [NOME_B],
    sobrasNoRepositorio: [],
  });
  assert(
    !m.github.chamadas.some((c) => c.caminho.includes(GAVETA_A)),
    "leu a gaveta de quem não foi pedido",
  );
  const antes = m.github.chamadas.length;
  for (const nomes of [[NOME_IKCOUS], [NOME_A, "OUTRO"], "x", [undefined]]) {
    const e = await pegarErro(() => m.gh.listar(nomes));
    assert(e instanceof ErroDaPonte, String(e));
  }
  assertEquals(m.github.chamadas.length, antes, "foi à rede com pedido torto");
  const semEntrar = montar();
  await assertRejects(() => semEntrar.gh.listar(), ErroDaPonte);
  assertEquals(semEntrar.github.chamadas.length, 0);
});

Deno.test("T5 listar: segredo OAuth que sobrou no nível do REPOSITÓRIO volta em sobrasNoRepositorio; o da IKCOUS não é sobra", async () => {
  const m = await montarEntrado({
    noRepositorio: [NOME_IKCOUS, NOME_B, "OUTRO_QUALQUER"],
    gavetas: { [GAVETA_A]: [NOME_A] },
  });
  assertEquals(await m.gh.listar(), {
    nomes: [NOME_A],
    sobrasNoRepositorio: [NOME_B],
  });
  // pedido só da loja-a: a sobra da loja-b no repositório continua acusada
  assertEquals((await m.gh.listar([NOME_A])).sobrasNoRepositorio, [NOME_B]);
});

Deno.test("T5 listar: gaveta com outra caixa de letra na lista do GitHub (o nome não diferencia) é lida", async () => {
  const m = await montarEntrado({
    gavetas: { [GAVETA_A]: [NOME_A] },
    roteiro: {
      [`GET ${LISTA_DE_GAVETAS}`]: json(200, {
        total_count: 1,
        environments: [{ name: GAVETA_A.toUpperCase() }],
      }),
    },
  });
  assertEquals((await m.gh.listar()).nomes, [NOME_A]);
});

Deno.test("T5 listar: resposta torta em QUALQUER leitura (repositório, lista de gavetas, gaveta) é erro, nunca lista vazia", async () => {
  const tortas = () => [
    json(200, { secrets: "x" }),
    json(200, []),
    json(200, { total_count: 1, secrets: [{}] }),
    json(500, {}),
    new Response("nao json", { status: 200 }),
  ];
  const casos = [
    [`GET ${SEGREDOS_DO_REPO}`, tortas()],
    [
      `GET ${LISTA_DE_GAVETAS}`,
      [
        json(200, { total_count: 1, environments: [{}] }),
        json(200, { total_count: 1, environments: "x" }),
        json(200, { environments: [] }),
        json(404, {}),
        new Response("nao json", { status: 200 }),
      ],
    ],
    [`GET ${caminhoDa(GAVETA_A)}/secrets`, tortas()],
  ];
  for (const [chave, respostas] of casos) {
    for (const r of respostas) {
      const m = await montarEntrado({
        gavetas: { [GAVETA_A]: [NOME_A] },
        roteiro: { [chave]: r },
      });
      const e = await pegarErro(() => m.gh.listar());
      assert(e instanceof ErroDaPonte, `${chave} ${r.status}: ${e}`);
    }
  }
});

/** `n` lojas OAuth (refs de 20 letras distintas), sem IKCOUS/Savy. */
function cadastroGrande(n) {
  const letra = (k) => String.fromCharCode(97 + (k % 26));
  const lojas = Array.from({ length: n }, (_, i) => [
    `loja-g${i}`,
    {
      projeto: `loja-g${i}`,
      ref: `${letra(Math.floor(i / 26))}${letra(i)}`.padEnd(20, "q"),
      classe: "assinante",
      acesso: "oauth",
      segredoDoToken: `SUPABASE_ACCESS_TOKEN_LOJA_G${i}`,
    },
  ]);
  return { lojas: Object.fromEntries(lojas) };
}

Deno.test("T5 listar: 120 gavetas — pagina a lista de gavetas e lê no máximo CONCORRENCIA_DO_GITHUB ao mesmo tempo", async () => {
  const cad = cadastroGrande(120);
  const gavetas = Object.fromEntries(
    lojasOAuthDo(cad).map((l) => [l.ambiente, [l.nome]]),
  );
  const m = await montarEntrado(
    { gavetas, atrasoDaGavetaMs: 2 },
    { cadastro: cad },
  );
  const r = await m.gh.listar();
  assertEquals(r.nomes.length, 120);
  assertEquals(
    m.github.chamadas.filter((c) => c.caminho === LISTA_DE_GAVETAS).length,
    2,
    "não paginou a lista de gavetas",
  );
  assert(
    m.github.conta.maxJuntos <= CONCORRENCIA_DO_GITHUB,
    `${m.github.conta.maxJuntos} gavetas lidas ao mesmo tempo`,
  );
  assert(m.github.conta.maxJuntos > 1, "leu uma gaveta por vez");
});

// --------------------------------- T6 faxina, fechar e o comando à mão --

const acessoDuble = () => {
  const ev = { renovou: [], soltou: [] };
  return {
    ev,
    acesso: {
      async renovarComTravaLonga({ slug }) {
        ev.renovou.push(slug);
        return {
          accessToken: CANARIO_A,
          expiraEm: 1_800_000_000_000 + 20 * 3_600_000,
          async renovarDeNovo() {},
          async liberar() {
            ev.soltou.push(slug);
          },
        };
      },
    },
  };
};

const abrir = (m, acesso) =>
  abrirSessao({
    cadastro: cadastro(),
    acesso,
    gh: m.gh,
    agora: () => 1_800_000_000_000,
    matarTokenNoFechar: false,
    dormir: async () => {},
  });

Deno.test("T6 faxinar: apaga nas gavetas; o que não sai volta com `gh secret delete NOME --env loja-x --repo R`", async () => {
  const m = montar({
    gavetas: { [GAVETA_A]: [NOME_A], [GAVETA_B]: [NOME_B] },
    roteiro: {
      [`DELETE ${caminhoDa(GAVETA_A)}/secrets/${NOME_A}`]: json(500, {}),
    },
  });
  const r = await faxinar({ cadastro: cadastro(), gh: m.gh });
  assertEquals(r, {
    apagados: [NOME_B],
    naoApagados: [
      {
        nome: NOME_A,
        comando: `gh secret delete ${NOME_A} --env ${GAVETA_A} --repo ${REPO}`,
      },
    ],
  });
  assertEquals([...m.github.gav.get(GAVETA_B)], []);
});

Deno.test("T6 faxinar: sobra OAuth no REPOSITÓRIO não é apagada pela ponte — volta com o comando do repositório, e só ela", async () => {
  const m = montar({
    noRepositorio: [NOME_A, NOME_IKCOUS],
    gavetas: { [GAVETA_B]: [NOME_B] },
  });
  const r = await faxinar({ cadastro: cadastro(), gh: m.gh });
  assertEquals(r, {
    apagados: [NOME_B],
    naoApagados: [
      {
        nome: NOME_A,
        comando: `gh secret delete ${NOME_A} --app actions --repo ${REPO}`,
      },
    ],
  });
  assert(
    !m.github.chamadas.some(
      (c) => c.metodo === "DELETE" && c.caminho.startsWith(SEGREDOS_DO_REPO),
    ),
    "a ponte apagou no nível do repositório",
  );
  assertEquals([...m.github.repo].sort(), [NOME_A, NOME_IKCOUS].sort());
});

Deno.test("T6 abrirSessao: sobra no repositório = FAXINA_INCOMPLETA — nada renova nem grava, e a limpeza traz o comando do repositório", async () => {
  const m = montar({ noRepositorio: [NOME_B] });
  const { acesso, ev } = acessoDuble();
  const e = await pegarErro(() => abrir(m, acesso));
  assert(e instanceof ErroDaPonte, String(e));
  assertEquals(e.codigo, "FAXINA_INCOMPLETA");
  assertStringIncludes(e.message, NOME_B);
  assertStringIncludes(e.message, "REPOSITÓRIO");
  assertEquals(ev.renovou, []);
  assertEquals(
    m.spawn.chamadas.filter((c) => c.args[0] === "secret").length,
    0,
  );
  assertEquals(
    e.limpeza.naoApagados.filter((x) => x.nome === NOME_B),
    [
      {
        nome: NOME_B,
        comando: `gh secret delete ${NOME_B} --app actions --repo ${REPO}`,
      },
    ],
  );
  assertEquals([...m.github.repo], [NOME_B], "a ponte apagou no repositório");
  assertSemCanario(e, "erro da abertura");
});

Deno.test("T6 sessão de ponta a ponta com o gh real: cada loja grava na gaveta dela (criada na hora), o fechar apaga das gavetas e o repositório fica intocado", async () => {
  const m = montar({ noRepositorio: [NOME_IKCOUS] });
  const { acesso, ev } = acessoDuble();
  const s = await abrir(m, acesso);
  assertEquals(
    s.lojas.map((l) => l.ambiente),
    [GAVETA_A, GAVETA_B],
  );
  assertEquals([...m.github.gav.get(GAVETA_A)], [NOME_A]);
  assertEquals([...m.github.gav.get(GAVETA_B)], [NOME_B]);
  const r = await s.fechar();
  assertEquals(r.apagados, [NOME_A, NOME_B]);
  assertEquals(r.naoApagados, []);
  assertEquals([...m.github.gav.get(GAVETA_A)], []);
  assertEquals([...m.github.gav.get(GAVETA_B)], []);
  assertEquals([...m.github.repo], [NOME_IKCOUS]);
  assertEquals(ev.soltou.sort(), ["loja-a", "loja-b"]);
  assertSemCanario(r, "resultado do fechar");
});

Deno.test("T6 fechar: só o que falhou volta em naoApagados, com o comando --env da gaveta", async () => {
  const m = montar();
  const { acesso } = acessoDuble();
  const s = await abrir(m, acesso);
  // a partir daqui, o DELETE da loja-b falha (500) e ela continua na gaveta
  m.github.roteirar(
    `DELETE ${caminhoDa(GAVETA_B)}/secrets/${NOME_B}`,
    json(500, {}),
  );
  const r = await s.fechar();
  assertEquals(r.apagados, [NOME_A]);
  assertEquals(r.naoApagados, [
    {
      nome: NOME_B,
      comando: `gh secret delete ${NOME_B} --env ${GAVETA_B} --repo ${REPO}`,
    },
  ]);
});

/** gh dublê mínimo para a faxina: o 1º listar é o da faxina; os seguintes,
 * os de conferir o que falhou. Todo apagar falha. */
function ghDeLista(listas) {
  const log = [];
  return {
    repo: REPO,
    dono: "dono-falso",
    log,
    async entrar() {},
    async comEscrita() {
      return ["dono-falso"];
    },
    async listar(nomes) {
      log.push(`listar:${nomes ?? "tudo"}`);
      return listas.shift();
    },
    async definir() {},
    async apagar(nome) {
      log.push(`apagar:${nome}`);
      throw new ErroDaPonte("gh falso: 500");
    },
    async esquecer() {},
  };
}

Deno.test("T6 apagarTodos: lista de conferência fora do formato (o array antigo) não prova nada — o nome fica em naoApagados", async () => {
  for (const conferencia of [[], { nomes: "x" }, null, { sobras: [] }]) {
    const gh = ghDeLista([
      { nomes: [NOME_A], sobrasNoRepositorio: [] },
      conferencia,
    ]);
    const r = await faxinar({ cadastro: cadastro(), gh });
    assertEquals(gh.log, [
      "listar:tudo",
      `apagar:${NOME_A}`,
      `listar:${NOME_A}`,
    ]);
    assertEquals(r.apagados, [], JSON.stringify(conferencia));
    assertEquals(
      r.naoApagados.map((x) => x.nome),
      [NOME_A],
    );
  }
});

Deno.test("T6 faxina: lista fora do formato é erro, nunca 'nada a apagar'", async () => {
  for (const lista of [
    [NOME_A],
    { nomes: [NOME_A] },
    { sobrasNoRepositorio: [] },
    { nomes: [NOME_A], sobrasNoRepositorio: "x" },
    null,
  ]) {
    const e = await pegarErro(() =>
      faxinar({ cadastro: cadastro(), gh: ghDeLista([lista]) }),
    );
    assert(e instanceof ErroDaPonte, `${JSON.stringify(lista)}: ${e}`);
    assertEquals(e.codigo, "RESPOSTA_INVALIDA");
  }
});
