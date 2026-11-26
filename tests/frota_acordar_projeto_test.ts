import { createRequire } from "node:module";
// @ts-nocheck
/**
 * scripts/frota/acordar-projeto.mjs — o comando LOCAL que o dono roda quando a gestão avisa que o banco de uma loja foi pausado
 * pelo plano grátis do Supabase (escolha A, 26/11/2026: nada disso roda no Worker). Todas as dependências são dublês: nenhuma rede,
 * nenhum cofre DPAPI, nenhum relógio de verdade.
 *
 * O QUE ESTES TESTES MEDEM:
 *  - decidirAcordar: INACTIVE = acordar; ACTIVE_HEALTHY = nada; RESTORING/COMING_UP = só esperar; qualquer outro (inclusive os
 *    valores oficiais que não são esses e texto desconhecido) = recusar. A lista de valores é a do enum oficial (spec v1);
 *  - argumentos: --loja e --motivo obrigatórios, --esperar-min inteiro de 1 a 30 (padrão 10); uso errado sai 2 sem abrir o cofre;
 *  - loja fora do cadastro (lojas.json) é recusada sem abrir o cofre e sem rede;
 *  - NUNCA um segundo POST /restore: nem quando o status continua INACTIVE depois do pedido, nem quando o POST cai no meio
 *    (ESTADO_DESCONHECIDO) ou volta 5xx;
 *  - tempo esgotado sai com o código próprio (3) e manda conferir no painel do Supabase;
 *  - canário: cofre sem acesso, token vazio, OAuth recusado ou GET 401/403 param ANTES de qualquer POST;
 *  - nenhuma linha escrita carrega o access token, o refresh ou o client_secret.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { URL_TOKEN } from "../scripts/frota/acesso-oauth.mjs";
import {
  CODIGO_TEMPO_ESGOTADO,
  ESPERA_MAXIMA_MIN,
  ESPERA_PADRAO_MIN,
  INTERVALO_MS,
  acordar,
  decidirAcordar,
  executar,
  lerArgumentos,
} from "../scripts/frota/acordar-projeto.mjs";
import { criarCofreMemoria } from "../scripts/frota/cofre-local.mjs";
import { API_GESTAO } from "../scripts/frota/supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const { validarCadastro } = require("../scripts/frota/lojas.cjs");

const LOJA = "loja-teste";
const REF = "lojatesteaaaaaaaaaaa";
const OUTRO_REF = "outrolojaaaaaaaaaaaa";
const MOTIVO = "gestao avisou pausada em 26/11";
const CLIENT_ID = "b5f97263-0000-4000-8000-000000000000";
const CLIENT_SECRET = "sba_SEGREDO_DO_APP_FALSO_inventado_123";
const REDIRECT = "https://gestao.exemplo.test/autorizado";
const REFRESH = "refresh-FALSO-0123456789";
const ACCESS = "sbp_oauth_ACCESS_FALSO_0123456789abcdef";
const AGORA = Date.parse("2026-11-26T15:00:00Z");
const URL_PROJETO = `${API_GESTAO}/v1/projects/${REF}`;
const URL_RESTORE = `${API_GESTAO}/v1/projects/${REF}/restore`;

/** O enum oficial de V1ProjectWithDatabaseResponse.status (https://api.supabase.com/api/v1-json, lido em 26/11/2026). */
const STATUS_OFICIAIS = [
  "INACTIVE",
  "ACTIVE_HEALTHY",
  "ACTIVE_UNHEALTHY",
  "COMING_UP",
  "UNKNOWN",
  "GOING_DOWN",
  "INIT_FAILED",
  "REMOVED",
  "RESTORING",
  "UPGRADING",
  "PAUSING",
  "RESTORE_FAILED",
  "RESTARTING",
  "PAUSE_FAILED",
  "RESIZING",
  "PROMOTING",
  "RIGHTSIZING",
];

const cadastro = () =>
  validarCadastro({
    lojas: {
      [LOJA]: {
        ref: REF,
        classe: "assinante",
        apelido: "Teste",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_TESTE",
        functionsNomeadas: false,
      },
    },
  });

async function cofreComAcesso(registro = {}) {
  const cofre = criarCofreMemoria();
  await cofre.gravar(
    LOJA,
    JSON.stringify({
      versao: 1,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT,
      refresh: REFRESH,
      ...registro,
    }),
  );
  return cofre;
}

function resposta(status, corpo) {
  return new Response(
    corpo === undefined
      ? null
      : typeof corpo === "string"
        ? corpo
        : JSON.stringify(corpo),
    { status, headers: { "content-type": "application/json" } },
  );
}

const projeto = (status, ref = REF) =>
  resposta(200, { id: 1, ref, name: "loja", status });

/**
 * http falso, roteado por método + URL:
 *  - POST /v1/oauth/token -> `token` (padrão: access token válido);
 *  - GET  /v1/projects/{ref} -> os itens de `status`, na ordem; o último se repete;
 *  - POST /v1/projects/{ref}/restore -> `restore` (padrão 200 sem corpo).
 * Item pode ser texto (status), Response, ou função que devolve Response/lança.
 */
function httpFalso({ token, status = [], restore } = {}) {
  const chamadas = [];
  const fila = [...status];
  const f = async (url, init = {}) => {
    const u = String(url);
    const metodo = init.method ?? "GET";
    chamadas.push({ url: u, metodo });
    if (u === URL_TOKEN && metodo === "POST") {
      if (typeof token === "function") return token();
      return (
        token ?? resposta(200, { access_token: ACCESS, expires_in: 86400 })
      );
    }
    if (u === URL_PROJETO && metodo === "GET") {
      const item = fila.length > 1 ? fila.shift() : fila[0];
      if (item === undefined) throw new Error("http falso sem status");
      if (typeof item === "function") return item();
      return typeof item === "string" ? projeto(item) : item;
    }
    if (u === URL_RESTORE && metodo === "POST") {
      if (typeof restore === "function") return restore();
      return restore ?? resposta(200);
    }
    throw new Error(`http falso: chamada inesperada ${metodo} ${u}`);
  };
  f.chamadas = chamadas;
  f.posts = () =>
    chamadas.filter((c) => c.url === URL_RESTORE && c.metodo === "POST").length;
  f.gets = () =>
    chamadas.filter((c) => c.url === URL_PROJETO && c.metodo === "GET").length;
  f.gestao = () =>
    chamadas.filter((c) => c.url.startsWith(`${API_GESTAO}/v1/projects`))
      .length;
  return f;
}

function relogioFalso() {
  let t = AGORA;
  const esperas = [];
  return {
    agora: () => t,
    esperar: async (ms) => {
      esperas.push(ms);
      t += ms;
    },
    esperas,
  };
}

async function rodarAcordar({
  http,
  cofre,
  esperarMin = ESPERA_PADRAO_MIN,
  relogio = relogioFalso(),
}) {
  const linhas = [];
  const r = await acordar({
    loja: LOJA,
    ref: REF,
    motivo: MOTIVO,
    esperarMin,
    cofre: cofre ?? (await cofreComAcesso()),
    http,
    relogio,
    escrever: (l) => linhas.push(String(l)),
  });
  return { ...r, linhas, texto: linhas.join("\n"), relogio };
}

function semSegredo(texto) {
  for (const s of [ACCESS, REFRESH, CLIENT_SECRET]) {
    assert(!texto.includes(s), `a saída vazou um segredo: ${s}`);
  }
}

// ------------------------------------------------------------ decidirAcordar --

Deno.test("decidirAcordar: INACTIVE acorda, ACTIVE_HEALTHY não faz nada, RESTORING/COMING_UP só esperam", () => {
  assertEquals(decidirAcordar("INACTIVE").acao, "acordar");
  const nada = decidirAcordar("ACTIVE_HEALTHY");
  assertEquals(nada.acao, "nada");
  assertStringIncludes(nada.mensagem, "já está acordada");
  assertEquals(decidirAcordar("RESTORING").acao, "esperar");
  assertEquals(decidirAcordar("COMING_UP").acao, "esperar");
});

Deno.test("decidirAcordar: todo outro valor oficial é recusado, com o status na mensagem", () => {
  const conhecidos = new Set([
    "INACTIVE",
    "ACTIVE_HEALTHY",
    "RESTORING",
    "COMING_UP",
  ]);
  for (const s of STATUS_OFICIAIS.filter((x) => !conhecidos.has(x))) {
    const d = decidirAcordar(s);
    assertEquals(d.acao, "recusar", `${s} não foi recusado`);
    assertStringIncludes(d.mensagem, s);
  }
});

Deno.test("decidirAcordar: status desconhecido, minúsculo, vazio ou não-texto é recusado (nunca acorda)", () => {
  for (const s of [
    "inactive",
    "PAUSED",
    "",
    " INACTIVE",
    "INACTIVE\n",
    undefined,
    null,
    42,
    {},
    ["INACTIVE"],
  ]) {
    const d = decidirAcordar(s);
    assertEquals(d.acao, "recusar", `${JSON.stringify(s)} não foi recusado`);
    assert(typeof d.mensagem === "string" && d.mensagem.length > 0);
    assert(!d.mensagem.includes("\n"), "a mensagem ecoou a quebra de linha");
  }
});

// -------------------------------------------------------------- argumentos --

Deno.test("lerArgumentos: --loja e --motivo obrigatórios; --esperar-min padrão 10", () => {
  assertEquals(lerArgumentos(["--loja", LOJA, "--motivo", MOTIVO]), {
    loja: LOJA,
    motivo: MOTIVO,
    esperarMin: ESPERA_PADRAO_MIN,
  });
  assertEquals(ESPERA_PADRAO_MIN, 10);
  assertEquals(ESPERA_MAXIMA_MIN, 30);
  assertEquals(
    lerArgumentos(["--motivo", MOTIVO, "--loja", LOJA, "--esperar-min", "30"])
      .esperarMin,
    30,
  );
  assertEquals(
    lerArgumentos(["--loja", LOJA, "--motivo", MOTIVO, "--esperar-min", "1"])
      .esperarMin,
    1,
  );
});

Deno.test("lerArgumentos: falta, repetição, valor ausente, argumento estranho e formato ruim são uso errado", () => {
  const ruins = [
    [],
    ["--loja", LOJA],
    ["--motivo", MOTIVO],
    ["--loja", "--motivo", MOTIVO],
    ["--loja", LOJA, "--motivo"],
    ["--loja", LOJA, "--loja", LOJA, "--motivo", MOTIVO],
    ["--loja", LOJA, "--motivo", MOTIVO, "--ref", REF],
    ["--loja", LOJA, "--motivo", MOTIVO, "extra"],
    ["--loja", "Loja_Teste", "--motivo", MOTIVO],
    ["--loja", "../x", "--motivo", MOTIVO],
    ["--loja", LOJA, "--motivo", "ab"],
    ["--loja", LOJA, "--motivo", "x".repeat(201)],
    ["--loja", LOJA, "--motivo", "linha\nquebrada"],
    ...["0", "31", "-1", "5.5", "abc", "1e1", "", "010"].map((n) => [
      "--loja",
      LOJA,
      "--motivo",
      MOTIVO,
      "--esperar-min",
      n,
    ]),
  ];
  for (const argv of ruins) {
    assertThrows(
      () => lerArgumentos(argv),
      Error,
      undefined,
      `passou: ${JSON.stringify(argv)}`,
    );
  }
});

Deno.test("executar: uso errado sai 2 sem abrir o cofre nem tocar a rede", async () => {
  const http = httpFalso({ status: ["INACTIVE"] });
  let abriu = 0;
  const linhas = [];
  const r = await executar(
    ["--loja", LOJA, "--motivo", MOTIVO, "--esperar-min", "31"],
    {
      cadastro: cadastro(),
      abrirCofre: () => {
        abriu++;
        return criarCofreMemoria();
      },
      http,
      relogio: relogioFalso(),
      escrever: (l) => linhas.push(l),
    },
  );
  assertEquals(r.codigo, 2);
  assertEquals(abriu, 0);
  assertEquals(http.chamadas.length, 0);
});

Deno.test("executar: loja fora do cadastro é recusada sem abrir o cofre nem tocar a rede", async () => {
  const http = httpFalso({ status: ["INACTIVE"] });
  let abriu = 0;
  const linhas = [];
  for (const loja of ["nao-existe", "constructor"]) {
    const r = await executar(["--loja", loja, "--motivo", MOTIVO], {
      cadastro: cadastro(),
      abrirCofre: () => {
        abriu++;
        return criarCofreMemoria();
      },
      http,
      relogio: relogioFalso(),
      escrever: (l) => linhas.push(l),
    });
    assertEquals(r.codigo, 1, loja);
  }
  assertEquals(abriu, 0);
  assertEquals(http.chamadas.length, 0);
  assertStringIncludes(linhas.join("\n"), "lojas.json");
});

Deno.test("executar: loja do cadastro passa o ref do cadastro e acorda (caminho completo)", async () => {
  const http = httpFalso({
    status: ["INACTIVE", "COMING_UP", "ACTIVE_HEALTHY"],
  });
  const cofre = await cofreComAcesso();
  const linhas = [];
  const r = await executar(["--loja", LOJA, "--motivo", MOTIVO], {
    cadastro: cadastro(),
    abrirCofre: () => cofre,
    http,
    relogio: relogioFalso(),
    escrever: (l) => linhas.push(l),
  });
  assertEquals(r.codigo, 0);
  assertEquals(http.posts(), 1);
  const texto = linhas.join("\n");
  assertStringIncludes(texto, MOTIVO);
  assertStringIncludes(texto, REF);
  semSegredo(texto);
});

// ------------------------------------------------------------------- fluxo --

Deno.test("acordar: INACTIVE -> UM POST /restore -> espera de 15 s até ACTIVE_HEALTHY, saída 0", async () => {
  const http = httpFalso({
    status: ["INACTIVE", "INACTIVE", "COMING_UP", "ACTIVE_HEALTHY"],
  });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 0);
  assertEquals(http.posts(), 1);
  assertEquals(http.gets(), 4);
  assertEquals(INTERVALO_MS, 15_000);
  assertEquals(r.relogio.esperas, [15_000, 15_000, 15_000]);
  // o POST vem DEPOIS do primeiro GET (nunca às cegas)
  const ordem = http.chamadas
    .filter((c) => c.url !== URL_TOKEN)
    .map((c) => `${c.metodo} ${c.url}`);
  assertEquals(ordem[0], `GET ${URL_PROJETO}`);
  assertEquals(ordem[1], `POST ${URL_RESTORE}`);
  semSegredo(r.texto);
});

Deno.test("acordar: ACTIVE_HEALTHY sai 0 dizendo que já está acordada, sem POST e sem esperar", async () => {
  const http = httpFalso({ status: ["ACTIVE_HEALTHY"] });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 0);
  assertEquals(http.posts(), 0);
  assertEquals(r.relogio.esperas, []);
  assertStringIncludes(r.texto, "já está acordada");
});

Deno.test("acordar: RESTORING/COMING_UP só espera, sem POST", async () => {
  for (const inicial of ["RESTORING", "COMING_UP"]) {
    const http = httpFalso({
      status: [inicial, "COMING_UP", "ACTIVE_HEALTHY"],
    });
    const r = await rodarAcordar({ http });
    assertEquals(r.codigo, 0, inicial);
    assertEquals(http.posts(), 0, inicial);
  }
});

Deno.test("acordar: esperando sem ter pedido, se o projeto volta a INACTIVE NÃO pede restore (recusa)", async () => {
  const http = httpFalso({ status: ["RESTORING", "INACTIVE"] });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 1);
  assertEquals(http.posts(), 0);
});

Deno.test("acordar: status recusado no começo (PAUSING, REMOVED, desconhecido) sai 1 sem POST", async () => {
  for (const s of ["PAUSING", "REMOVED", "RESTORE_FAILED", "QUALQUER_COISA"]) {
    const http = httpFalso({ status: [s] });
    const r = await rodarAcordar({ http });
    assertEquals(r.codigo, 1, s);
    assertEquals(http.posts(), 0, s);
  }
});

Deno.test("acordar: resposta do GET de OUTRO projeto (ref diferente) é recusada sem POST", async () => {
  const http = httpFalso({ status: [projeto("INACTIVE", OUTRO_REF)] });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 1);
  assertEquals(http.posts(), 0);
});

// ---------------------------------------------------------- nunca 2º POST --

Deno.test("NUNCA um 2º POST: status continua INACTIVE depois do pedido -> um POST só e tempo esgotado", async () => {
  const http = httpFalso({ status: ["INACTIVE"] });
  const r = await rodarAcordar({ http, esperarMin: 2 });
  assertEquals(http.posts(), 1);
  assertEquals(r.codigo, CODIGO_TEMPO_ESGOTADO);
});

Deno.test("NUNCA um 2º POST: o POST cai no meio (ESTADO_DESCONHECIDO) -> acompanha o status sem pedir de novo", async () => {
  const http = httpFalso({
    status: ["INACTIVE", "INACTIVE", "COMING_UP", "ACTIVE_HEALTHY"],
    restore: () => Promise.reject(new TypeError("rede caiu")),
  });
  const r = await rodarAcordar({ http });
  assertEquals(http.posts(), 1);
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.texto, "PODE ter");
});

Deno.test("NUNCA um 2º POST: 5xx no POST também só acompanha; 4xx (402 do plano) para sem esperar", async () => {
  const h500 = httpFalso({
    status: ["INACTIVE", "INACTIVE", "ACTIVE_HEALTHY"],
    restore: () => resposta(500, "erro"),
  });
  const r500 = await rodarAcordar({ http: h500 });
  assertEquals(h500.posts(), 1);
  assertEquals(r500.codigo, 0);

  const h402 = httpFalso({
    status: ["INACTIVE"],
    restore: () => resposta(402, { message: "plano" }),
  });
  const r402 = await rodarAcordar({ http: h402 });
  assertEquals(h402.posts(), 1);
  assertEquals(h402.gets(), 1);
  assertEquals(r402.codigo, 1);
  assertStringIncludes(r402.texto, "Restore project");
});

// ---------------------------------------------------------- tempo esgotado --

Deno.test("tempo esgotado: COMING_UP para sempre com --esperar-min 1 -> código próprio e manda conferir no painel", async () => {
  const http = httpFalso({ status: ["COMING_UP"] });
  const r = await rodarAcordar({ http, esperarMin: 1 });
  assertEquals(r.codigo, CODIGO_TEMPO_ESGOTADO);
  assert(
    CODIGO_TEMPO_ESGOTADO !== 0 &&
      CODIGO_TEMPO_ESGOTADO !== 1 &&
      CODIGO_TEMPO_ESGOTADO !== 2,
  );
  // GET em 0, 15, 30, 45 e 60 s: o último já está no prazo
  assertEquals(http.gets(), 5);
  assertEquals(
    r.relogio.esperas.reduce((a, b) => a + b, 0),
    60_000,
  );
  assertStringIncludes(r.texto, "painel do Supabase");
});

Deno.test("tempo esgotado: GET que falha durante a espera não para o comando nem gera POST novo", async () => {
  const http = httpFalso({
    status: [
      "INACTIVE",
      () => resposta(500, "x"),
      () => Promise.reject(new TypeError("rede")),
      "ACTIVE_HEALTHY",
    ],
  });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 0);
  assertEquals(http.posts(), 1);
});

Deno.test("RESTORE_FAILED durante a espera para na hora com 1 (não espera o prazo inteiro)", async () => {
  const http = httpFalso({
    status: ["INACTIVE", "COMING_UP", "RESTORE_FAILED"],
  });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 1);
  assertEquals(http.posts(), 1);
  assertEquals(http.gets(), 3);
});

// ------------------------------------------------------------------ canário --

Deno.test("canário: GET 401/403 para ANTES de qualquer POST", async () => {
  for (const status of [401, 403]) {
    const http = httpFalso({ status: [() => resposta(status, `x ${ACCESS}`)] });
    const r = await rodarAcordar({ http });
    assertEquals(r.codigo, 1, String(status));
    assertEquals(http.posts(), 0, String(status));
    semSegredo(r.texto);
  }
});

Deno.test("canário: cofre sem acesso da loja para sem tocar a Management API", async () => {
  const http = httpFalso({ status: ["INACTIVE"] });
  const r = await rodarAcordar({ http, cofre: criarCofreMemoria() });
  assertEquals(r.codigo, 1);
  assertEquals(http.chamadas.length, 0);
  assertStringIncludes(r.texto, "Restore project");
});

Deno.test("canário: token vazio ou OAuth recusado param sem tocar a Management API", async () => {
  const casos = [
    () => resposta(200, { access_token: "", expires_in: 86400 }),
    () => resposta(200, { expires_in: 86400 }),
    () => resposta(401, { error: "invalid_client" }),
    () => resposta(400, { error: "invalid_grant" }),
  ];
  for (const token of casos) {
    const http = httpFalso({ token, status: ["INACTIVE"] });
    const r = await rodarAcordar({ http });
    assertEquals(r.codigo, 1);
    assertEquals(http.gestao(), 0);
    semSegredo(r.texto);
  }
});

Deno.test("canário: 401 no meio da espera para (sem 2º POST) e diz que o restore já foi pedido", async () => {
  const http = httpFalso({ status: ["INACTIVE", () => resposta(401, "x")] });
  const r = await rodarAcordar({ http });
  assertEquals(r.codigo, 1);
  assertEquals(http.posts(), 1);
  assertStringIncludes(r.texto, "já foi pedido");
});

Deno.test("nenhuma linha escrita carrega token, refresh nem client_secret (todos os caminhos)", async () => {
  const cenarios = [
    { status: ["INACTIVE", "ACTIVE_HEALTHY"] },
    { status: [() => resposta(403, `eco ${ACCESS} ${REFRESH}`)] },
    { status: ["INACTIVE"], restore: () => resposta(402, `eco ${ACCESS}`) },
    {
      status: ["INACTIVE"],
      restore: () => Promise.reject(new TypeError(`rede ${ACCESS}`)),
    },
    {
      token: () => resposta(500, `eco ${CLIENT_SECRET}`),
      status: ["INACTIVE"],
    },
  ];
  for (const c of cenarios) {
    const r = await rodarAcordar({ http: httpFalso(c), esperarMin: 1 });
    semSegredo(r.texto);
  }
});
