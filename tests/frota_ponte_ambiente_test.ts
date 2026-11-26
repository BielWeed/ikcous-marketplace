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
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ErroDaPonte,
  criarGhReal,
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
function githubFalso({ noRepositorio = [], gavetas = {}, roteiro = {} } = {}) {
  const log = [];
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
  return { fetch, chamadas, log, repo, gav };
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
