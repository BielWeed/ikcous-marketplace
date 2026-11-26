// @ts-nocheck
/**
 * Acesso OAuth à conta da LOJISTA no Supabase (scripts/frota/acesso-oauth.mjs),
 * peças T4–T5 do L4b. O que este arquivo trava:
 *
 *  - o link de autorização leva PKCE S256 (vetor do RFC 7636) e um state de
 *    128 bits, e o verificador e o client_secret nunca vão no link;
 *  - lerCodigoColado aceita a URL inteira ou só o código, recusa state
 *    diferente do guardado, URL sem state, recusa da lojista, código vazio ou
 *    estranho;
 *  - receber troca o código (com o verificador) e grava o refresh no cofre
 *    ANTES de devolver o access token;
 *  - renovar grava o refresh NOVO no cofre ANTES de devolver o access token,
 *    mantém o antigo quando a resposta não traz refresh, e a renovação
 *    simultânea da mesma loja ESPERA (mesmo processo) ou é RECUSADA (trava de
 *    outro processo);
 *  - revogar chama /v1/oauth/revoke e só apaga o cofre se o Supabase aceitou;
 *  - nenhum erro carrega token, refresh, client_secret, código, verificador
 *    nem state.
 *
 * Nenhuma chamada de rede real: todo fetch aqui é falso; o cofre é o de memória.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ErroDeAcesso,
  URL_AUTORIZAR,
  URL_REVOGAR,
  URL_TOKEN,
  criarAcessoOAuth,
  gerarPkce,
  lerCodigoColado,
} from "../scripts/frota/acesso-oauth.mjs";
import {
  CofreTravado,
  criarCofreMemoria,
} from "../scripts/frota/cofre-local.mjs";
import {
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  SemAcesso,
} from "../scripts/frota/supabase-gestao.mjs";

const SLUG = "loja-nova";
const CLIENT_ID = "b5f97263-0000-4000-8000-000000000000";
const CLIENT_SECRET = "sba_SEGREDO_DO_APP_FALSO_inventado_123";
const REDIRECT = "https://gestao.exemplo.test/autorizado";
const CODIGO = "codigo-FALSO-da-lojista-0123456789";
const ACCESS = "sbp_oauth_ACCESS_FALSO_0123456789abcdef";
const REFRESH_1 = "refresh-FALSO-um-0123456789";
const REFRESH_2 = "refresh-FALSO-dois-0123456789";
const AGORA = 1_800_000_000_000;

const b64url = (b) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

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

function fetchFalso(...respostas) {
  const chamadas = [];
  const f = (url, init = {}) => {
    chamadas.push({ url: String(url), init });
    const r = respostas.shift();
    if (typeof r === "function") return r(url, init);
    if (r === undefined) throw new Error("fetch falso sem resposta");
    return Promise.resolve(r);
  };
  f.chamadas = chamadas;
  return f;
}

const SEM_REFRESH = Symbol("sem refresh_token na resposta");
const tokenOk = (refresh = REFRESH_2, extra = {}) =>
  resposta(200, {
    access_token: ACCESS,
    ...(refresh === SEM_REFRESH ? {} : { refresh_token: refresh }),
    expires_in: 86400,
    token_type: "Bearer",
    ...extra,
  });

async function lerRegistro(cofre) {
  const t = await cofre.ler(SLUG);
  return t === null ? null : JSON.parse(t);
}

async function cofreConectado(refresh = REFRESH_1) {
  const cofre = criarCofreMemoria();
  await cofre.gravar(
    SLUG,
    JSON.stringify({
      versao: 1,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT,
      refresh,
    }),
  );
  return cofre;
}

/** Todos os segredos que nenhum erro pode carregar. */
function assertSemVazamento(erro, extra = []) {
  const partes = [
    String(erro),
    String(erro?.message),
    String(erro?.stack),
    JSON.stringify(erro),
    JSON.stringify(Object.entries(erro ?? {})),
  ].join("\n");
  for (const p of [
    CLIENT_SECRET,
    CODIGO,
    ACCESS,
    REFRESH_1,
    REFRESH_2,
    ...extra,
  ]) {
    assert(!partes.includes(p), `o erro vazou um trecho proibido: ${p}`);
  }
}

async function pegarErro(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("era para lançar e não lançou");
}

/** Corpo de erro que ecoa tudo de sensível, para provar que nada passa. */
const corpoQueEcoa = {
  error: "invalid_request",
  error_description: `${CLIENT_SECRET} ${CODIGO} ${ACCESS} ${REFRESH_1} ${REFRESH_2}`,
};

// --------------------------------------------------------------- PKCE e link --

Deno.test("PKCE: vetor do RFC 7636 (apêndice B)", () => {
  const octetos = Uint8Array.from([
    116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
    22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
  ]);
  const { verificador, desafio } = gerarPkce(() => octetos);
  assertEquals(verificador, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assertEquals(desafio, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

Deno.test("abrir: link com PKCE S256, state de 128 bits, sem segredo nem verificador", async () => {
  const pedidos = [];
  const aleatorio = (n) => {
    pedidos.push(n);
    return randomBytes(n);
  };
  const cofre = criarCofreMemoria();
  const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso(), aleatorio });
  const { url } = await acesso.abrir({
    slug: SLUG,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT,
  });
  const u = new URL(url);
  assertEquals(`${u.origin}${u.pathname}`, URL_AUTORIZAR);
  assertEquals(URL_AUTORIZAR, "https://api.supabase.com/v1/oauth/authorize");
  const p = u.searchParams;
  assertEquals(p.get("client_id"), CLIENT_ID);
  assertEquals(p.get("redirect_uri"), REDIRECT);
  assertEquals(p.get("response_type"), "code");
  assertEquals(p.get("code_challenge_method"), "S256");

  const reg = await lerRegistro(cofre);
  assertEquals(reg.clientSecret, CLIENT_SECRET);
  assertEquals(p.get("state"), reg.pendente.state);
  // 128 bits = 16 bytes = 22 caracteres base64url
  assert(pedidos.includes(16), `aleatorio pedido com ${pedidos}`);
  assertEquals(reg.pendente.state.length, 22);
  assert(/^[A-Za-z0-9_-]{22}$/.test(reg.pendente.state));
  const desafio = b64url(
    createHash("sha256").update(reg.pendente.verificador).digest(),
  );
  assertEquals(p.get("code_challenge"), desafio);
  assert(reg.pendente.verificador.length >= 43);
  assert(!url.includes(CLIENT_SECRET), "client_secret no link");
  assert(!url.includes(reg.pendente.verificador), "verificador no link");
});

Deno.test("abrir duas vezes: state e verificador novos a cada vez", async () => {
  const cofre = criarCofreMemoria();
  const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso() });
  const args = {
    slug: SLUG,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT,
  };
  await acesso.abrir(args);
  const a = (await lerRegistro(cofre)).pendente;
  await acesso.abrir(args);
  const b = (await lerRegistro(cofre)).pendente;
  assertNotEquals(a.state, b.state);
  assertNotEquals(a.verificador, b.verificador);
});

Deno.test("abrir de novo numa loja já conectada não perde o refresh", async () => {
  const cofre = await cofreConectado();
  const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso() });
  await acesso.abrir({
    slug: SLUG,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT,
  });
  const reg = await lerRegistro(cofre);
  assertEquals(reg.refresh, REFRESH_1);
  assert(reg.pendente);
});

Deno.test("abrir recusa client_id, segredo ou redirect estranhos (sem ecoar o segredo)", async () => {
  const base = {
    slug: SLUG,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT,
  };
  const ruins = [
    { clientId: "" },
    { clientId: "a b" },
    { clientId: "x&redirect_uri=https://evil" },
    { clientSecret: "" },
    { clientSecret: `${CLIENT_SECRET}\n` },
    { redirectUri: "http://evil.example/autorizado" },
    { redirectUri: "javascript:alert(1)" },
    { redirectUri: "nao-e-url" },
    { redirectUri: "https://gestao.exemplo.test/autorizado#frag" },
  ];
  for (const r of ruins) {
    const cofre = criarCofreMemoria();
    const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso() });
    const e = await pegarErro(() => acesso.abrir({ ...base, ...r }));
    assert(e instanceof ErroDaGestao, `aceitou ${JSON.stringify(r)}`);
    assertSemVazamento(e);
    assertEquals(await cofre.ler(SLUG), null);
  }
  // localhost em http é aceito (o callback local da prova)
  const acesso = criarAcessoOAuth({
    cofre: criarCofreMemoria(),
    fetch: fetchFalso(),
  });
  await acesso.abrir({
    ...base,
    redirectUri: "http://localhost:8787/callback",
  });
  await acesso.abrir({
    ...base,
    redirectUri: "http://127.0.0.1:8787/callback",
  });
});

// ------------------------------------------------------------ código colado --

const STATE = "AAAAAAAAAAAAAAAAAAAAAA";
const OUTRO_STATE = "BBBBBBBBBBBBBBBBBBBBBB";

Deno.test("lerCodigoColado: URL inteira com o state certo devolve o código", () => {
  assertEquals(
    lerCodigoColado(`  ${REDIRECT}?code=${CODIGO}&state=${STATE}  \n`, STATE),
    CODIGO,
  );
  assertEquals(
    lerCodigoColado(
      `http://localhost:8787/callback?state=${STATE}&code=${CODIGO}`,
      STATE,
    ),
    CODIGO,
  );
});

Deno.test("lerCodigoColado: só o código (ou só a query) também serve", () => {
  assertEquals(lerCodigoColado(` ${CODIGO} `, STATE), CODIGO);
  assertEquals(
    lerCodigoColado(`?code=${CODIGO}&state=${STATE}`, STATE),
    CODIGO,
  );
  assertEquals(lerCodigoColado(`code=${CODIGO}&state=${STATE}`, STATE), CODIGO);
});

Deno.test("lerCodigoColado: recusa state divergente, ausente, recusa da lojista e lixo", () => {
  const ruins = [
    `${REDIRECT}?code=${CODIGO}&state=${OUTRO_STATE}`,
    `${REDIRECT}?code=${CODIGO}&state=${STATE}x`,
    `${REDIRECT}?code=${CODIGO}`,
    `${REDIRECT}?code=${CODIGO}&state=`,
    `?code=${CODIGO}&state=${OUTRO_STATE}`,
    `${REDIRECT}?error=access_denied&state=${STATE}`,
    `${REDIRECT}?state=${STATE}`,
    `${REDIRECT}?code=&state=${STATE}`,
    "",
    "   \n ",
    "curto",
    "tem espaco no meio 123456",
    '"codigo-entre-aspas-123"',
    "<script>alert(1)</script>",
    `${"a".repeat(600)}`,
    "código-com-acento-123",
    undefined,
    42,
  ];
  for (const colado of ruins) {
    let e;
    try {
      lerCodigoColado(colado, STATE);
    } catch (x) {
      e = x;
    }
    assert(
      e instanceof ErroDeAcesso,
      `aceitou: ${String(colado).slice(0, 60)}`,
    );
    assertSemVazamento(e, [STATE, OUTRO_STATE]);
  }
});

Deno.test("lerCodigoColado: sem state guardado, recusa até o código puro", () => {
  for (const guardado of [undefined, "", null]) {
    let e;
    try {
      lerCodigoColado(CODIGO, guardado);
    } catch (x) {
      e = x;
    }
    assert(e instanceof ErroDeAcesso);
  }
});

// ------------------------------------------------------------------ receber --

async function abrirComFetch(f, cofre = criarCofreMemoria()) {
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  await acesso.abrir({
    slug: SLUG,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT,
  });
  const reg = await lerRegistro(cofre);
  return {
    acesso,
    cofre,
    state: reg.pendente.state,
    verificador: reg.pendente.verificador,
  };
}

Deno.test("receber: troca o código com o verificador e grava o refresh antes de devolver", async () => {
  const f = fetchFalso(tokenOk(REFRESH_1));
  const { acesso, cofre, state, verificador } = await abrirComFetch(f);
  const r = await acesso.receber({
    slug: SLUG,
    colado: `${REDIRECT}?code=${CODIGO}&state=${state}`,
  });
  assertEquals(r.accessToken, ACCESS);
  assertEquals(r.expiraEm, AGORA + 86400 * 1000);

  assertEquals(f.chamadas.length, 1);
  const c = f.chamadas[0];
  assertEquals(c.url, URL_TOKEN);
  assertEquals(URL_TOKEN, "https://api.supabase.com/v1/oauth/token");
  assertEquals(c.init.method, "POST");
  const h = new Headers(c.init.headers);
  assertEquals(h.get("content-type"), "application/x-www-form-urlencoded");
  assertEquals(
    h.get("authorization"),
    `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
  );
  const corpo = new URLSearchParams(c.init.body);
  assertEquals(corpo.get("grant_type"), "authorization_code");
  assertEquals(corpo.get("code"), CODIGO);
  assertEquals(corpo.get("redirect_uri"), REDIRECT);
  assertEquals(corpo.get("code_verifier"), verificador);
  assert(!corpo.has("client_secret"), "segredo no corpo além do Basic");

  const reg = await lerRegistro(cofre);
  assertEquals(reg.refresh, REFRESH_1);
  assertEquals(reg.pendente, undefined, "a autorização pendente não foi limpa");
  assert(
    !JSON.stringify(reg).includes(ACCESS),
    "access token foi para o cofre",
  );
});

Deno.test("receber: state divergente nem chega a chamar o Supabase", async () => {
  const f = fetchFalso();
  const { acesso, cofre } = await abrirComFetch(f);
  const antes = await cofre.ler(SLUG);
  const e = await pegarErro(() =>
    acesso.receber({
      slug: SLUG,
      colado: `${REDIRECT}?code=${CODIGO}&state=${OUTRO_STATE}`,
    }),
  );
  assert(e instanceof ErroDeAcesso);
  assertEquals(f.chamadas.length, 0);
  assertEquals(await cofre.ler(SLUG), antes);
  assertSemVazamento(e, [OUTRO_STATE]);
});

Deno.test("receber sem ter aberto: recusa sem chamar o Supabase", async () => {
  const f = fetchFalso();
  for (const cofre of [criarCofreMemoria(), await cofreConectado()]) {
    const acesso = criarAcessoOAuth({ cofre, fetch: f });
    await assertRejects(
      () => acesso.receber({ slug: SLUG, colado: CODIGO }),
      ErroDeAcesso,
    );
  }
  assertEquals(f.chamadas.length, 0);
});

Deno.test("receber: resposta sem refresh_token é erro (loja ficaria sem renovação)", async () => {
  const f = fetchFalso(tokenOk(SEM_REFRESH));
  const { acesso, state, cofre } = await abrirComFetch(f);
  const e = await pegarErro(() =>
    acesso.receber({ slug: SLUG, colado: `?code=${CODIGO}&state=${state}` }),
  );
  assert(e instanceof ErroDeAcesso);
  assertSemVazamento(e);
  assertEquals((await lerRegistro(cofre)).refresh, undefined);
});

Deno.test("receber: 400 do Supabase ecoando segredo vira erro sem segredo", async () => {
  const f = fetchFalso(resposta(400, corpoQueEcoa));
  const { acesso, state } = await abrirComFetch(f);
  const e = await pegarErro(() =>
    acesso.receber({ slug: SLUG, colado: `?code=${CODIGO}&state=${state}` }),
  );
  assert(e instanceof ErroDaGestao);
  assertSemVazamento(e, [state]);
});

// ------------------------------------------------------------------ renovar --

Deno.test("renovar: manda o refresh guardado e devolve o access token", async () => {
  const cofre = await cofreConectado();
  const f = fetchFalso(tokenOk(REFRESH_2));
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const r = await acesso.renovar({ slug: SLUG });
  assertEquals(r.accessToken, ACCESS);
  assertEquals(r.expiraEm, AGORA + 86400 * 1000);
  const c = f.chamadas[0];
  assertEquals(c.url, URL_TOKEN);
  const corpo = new URLSearchParams(c.init.body);
  assertEquals(corpo.get("grant_type"), "refresh_token");
  assertEquals(corpo.get("refresh_token"), REFRESH_1);
  assertEquals(
    new Headers(c.init.headers).get("authorization"),
    `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
  );
  assertEquals((await lerRegistro(cofre)).refresh, REFRESH_2);
});

Deno.test("renovar: o refresh NOVO é gravado ANTES do access token ser devolvido", async () => {
  const base = await cofreConectado();
  const eventos = [];
  let soltarGravacao;
  const portao = new Promise((r) => {
    soltarGravacao = r;
  });
  const cofre = {
    ...base,
    async gravar(slug, valor) {
      eventos.push("gravar-comecou");
      await portao;
      await base.gravar(slug, valor);
      eventos.push("gravar-terminou");
    },
  };
  const acesso = criarAcessoOAuth({
    cofre,
    fetch: fetchFalso(tokenOk(REFRESH_2)),
  });
  const p = acesso.renovar({ slug: SLUG }).then((r) => {
    eventos.push("devolveu");
    return r;
  });
  // dá tempo de sobra para a renovação andar até a gravação
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(eventos, ["gravar-comecou"], "devolveu antes de gravar");
  soltarGravacao();
  const r = await p;
  assertEquals(eventos, ["gravar-comecou", "gravar-terminou", "devolveu"]);
  assertEquals(r.accessToken, ACCESS);
  assertEquals((await lerRegistro(base)).refresh, REFRESH_2);
});

Deno.test("renovar: cofre que não grava = erro, e o access token NÃO sai", async () => {
  const base = await cofreConectado();
  const cofre = {
    ...base,
    async gravar() {
      throw new Error(`disco cheio ${REFRESH_2}`);
    },
  };
  const acesso = criarAcessoOAuth({
    cofre,
    fetch: fetchFalso(tokenOk(REFRESH_2)),
  });
  const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
  assert(e instanceof ErroDeAcesso);
  assertSemVazamento(e);
  // a trava foi solta mesmo com o erro
  const liberar = await base.travar(SLUG);
  await liberar();
});

Deno.test("renovar: resposta sem refresh mantém o antigo (sem regravar)", async () => {
  const base = await cofreConectado();
  let gravou = 0;
  const cofre = {
    ...base,
    async gravar(s, v) {
      gravou++;
      await base.gravar(s, v);
    },
  };
  const acesso = criarAcessoOAuth({
    cofre,
    fetch: fetchFalso(tokenOk(SEM_REFRESH)),
  });
  const r = await acesso.renovar({ slug: SLUG });
  assertEquals(r.accessToken, ACCESS);
  assertEquals((await lerRegistro(base)).refresh, REFRESH_1);
  assertEquals(gravou, 0);
});

Deno.test("renovar: refresh vazio ou estranho na resposta não substitui o guardado", async () => {
  for (const ruim of ["", "tem espaço", 42]) {
    const cofre = await cofreConectado();
    const acesso = criarAcessoOAuth({
      cofre,
      fetch: fetchFalso(tokenOk(ruim)),
    });
    const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
    assert(
      e instanceof ErroDaGestao,
      `aceitou refresh ${JSON.stringify(ruim)}`,
    );
    assertEquals((await lerRegistro(cofre)).refresh, REFRESH_1);
  }
});

Deno.test("renovar: duas renovações simultâneas no mesmo processo ESPERAM a mesma", async () => {
  const cofre = await cofreConectado();
  let soltar;
  const f = fetchFalso(
    () =>
      new Promise((r) => {
        soltar = () => r(tokenOk(REFRESH_2));
      }),
  );
  const acesso = criarAcessoOAuth({ cofre, fetch: f });
  const a = acesso.renovar({ slug: SLUG });
  const b = acesso.renovar({ slug: SLUG });
  await new Promise((r) => setTimeout(r, 10));
  soltar();
  const [ra, rb] = await Promise.all([a, b]);
  assertEquals(f.chamadas.length, 1, "renovou duas vezes");
  assertEquals(ra.accessToken, ACCESS);
  assertEquals(rb.accessToken, ACCESS);
  // depois que acabou, uma renovação nova volta a chamar
  const f2 = fetchFalso(tokenOk(SEM_REFRESH));
  const acesso2 = criarAcessoOAuth({ cofre, fetch: f2 });
  await acesso2.renovar({ slug: SLUG });
  assertEquals(f2.chamadas.length, 1);
});

Deno.test("renovar: trava de outro processo = RECUSA, sem chamar o Supabase", async () => {
  const cofre = await cofreConectado();
  const liberarOutro = await cofre.travar(SLUG); // "outro processo"
  const f = fetchFalso(tokenOk());
  const acesso = criarAcessoOAuth({ cofre, fetch: f });
  await assertRejects(() => acesso.renovar({ slug: SLUG }), CofreTravado);
  assertEquals(f.chamadas.length, 0);
  await liberarOutro();
  await acesso.renovar({ slug: SLUG });
  assertEquals(f.chamadas.length, 1);
});

for (const [rotulo, r] of [
  [
    "400 invalid_grant",
    () => resposta(400, { ...corpoQueEcoa, error: "invalid_grant" }),
  ],
  ["401", () => resposta(401, corpoQueEcoa)],
  ["403", () => resposta(403, corpoQueEcoa)],
]) {
  Deno.test(`renovar: ${rotulo} vira SemAcesso, cofre intacto, sem segredo no erro`, async () => {
    const cofre = await cofreConectado();
    const antes = await cofre.ler(SLUG);
    const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso(r()) });
    const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
    assert(e instanceof SemAcesso, `${rotulo} não virou SemAcesso`);
    assertSemVazamento(e);
    assertEquals(await cofre.ler(SLUG), antes);
  });
}

Deno.test("renovar: 500 ecoando segredo vira erro sem segredo, cofre intacto", async () => {
  const cofre = await cofreConectado();
  const antes = await cofre.ler(SLUG);
  const acesso = criarAcessoOAuth({
    cofre,
    fetch: fetchFalso(resposta(500, corpoQueEcoa)),
  });
  const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
  assert(e instanceof ErroDaGestao);
  assert(!(e instanceof SemAcesso));
  assertEquals(e.status, 500);
  assertSemVazamento(e);
  assertEquals(await cofre.ler(SLUG), antes);
});

Deno.test("renovar: prazo estourado = ESTADO_DESCONHECIDO, refresh antigo mantido, trava solta", async () => {
  const cofre = await cofreConectado();
  const f = fetchFalso(
    (_u, init) =>
      new Promise((_ok, falha) => {
        init.signal.addEventListener("abort", () =>
          falha(new DOMException("abortado", "AbortError")),
        );
      }),
  );
  const acesso = criarAcessoOAuth({ cofre, fetch: f, prazoMs: 20 });
  const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
  assertSemVazamento(e);
  assertEquals((await lerRegistro(cofre)).refresh, REFRESH_1);
  const liberar = await cofre.travar(SLUG);
  await liberar();
});

Deno.test("renovar: 200 sem access_token ou que não é JSON não devolve token", async () => {
  for (const r of [
    resposta(200, { refresh_token: REFRESH_2, expires_in: 10 }),
    resposta(200, { access_token: "", expires_in: 10 }),
    resposta(200, `não é json ${REFRESH_2}`),
  ]) {
    const cofre = await cofreConectado();
    const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso(r) });
    const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
    assert(e instanceof ErroDaGestao);
    assertSemVazamento(e);
    assertEquals((await lerRegistro(cofre)).refresh, REFRESH_1);
  }
});

Deno.test("renovar: loja sem registro, sem refresh ou com registro corrompido = erro sem conteúdo", async () => {
  const f = fetchFalso();
  const vazio = criarCofreMemoria();
  await assertRejects(
    () => criarAcessoOAuth({ cofre: vazio, fetch: f }).renovar({ slug: SLUG }),
    ErroDeAcesso,
  );
  const corrompido = criarCofreMemoria();
  await corrompido.gravar(SLUG, `{quebrado ${CLIENT_SECRET}`);
  const e = await pegarErro(() =>
    criarAcessoOAuth({ cofre: corrompido, fetch: f }).renovar({ slug: SLUG }),
  );
  assert(e instanceof ErroDeAcesso);
  assertSemVazamento(e);
  assertEquals(f.chamadas.length, 0);
});

// ------------------------------------------------------------------ revogar --

Deno.test("revogar: chama /v1/oauth/revoke com o refresh e só então apaga o cofre", async () => {
  const cofre = await cofreConectado();
  const f = fetchFalso(resposta(204));
  const acesso = criarAcessoOAuth({ cofre, fetch: f });
  const r = await acesso.revogar({ slug: SLUG });
  assertEquals(r.revogado, true);
  assertEquals(f.chamadas.length, 1);
  assertEquals(f.chamadas[0].url, URL_REVOGAR);
  assertEquals(URL_REVOGAR, "https://api.supabase.com/v1/oauth/revoke");
  assertEquals(f.chamadas[0].init.method, "POST");
  assertEquals(JSON.parse(f.chamadas[0].init.body), {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_1,
  });
  assertEquals(await cofre.ler(SLUG), null);
});

Deno.test("revogar: Supabase recusou = cofre mantido e erro sem segredo", async () => {
  for (const [r, classe] of [
    [resposta(500, corpoQueEcoa), ErroDaGestao],
    [resposta(401, corpoQueEcoa), SemAcesso],
  ]) {
    const cofre = await cofreConectado();
    const antes = await cofre.ler(SLUG);
    const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso(r) });
    const e = await pegarErro(() => acesso.revogar({ slug: SLUG }));
    assert(e instanceof classe);
    assertSemVazamento(e);
    assertEquals(await cofre.ler(SLUG), antes);
  }
});

Deno.test("revogar: loja sem nada guardado não chama o Supabase", async () => {
  const f = fetchFalso();
  const acesso = criarAcessoOAuth({ cofre: criarCofreMemoria(), fetch: f });
  assertEquals((await acesso.revogar({ slug: SLUG })).revogado, false);
  assertEquals(f.chamadas.length, 0);
});

Deno.test("revogar: com outra operação travando a loja, recusa sem chamar", async () => {
  const cofre = await cofreConectado();
  const liberar = await cofre.travar(SLUG);
  const f = fetchFalso(resposta(204));
  const acesso = criarAcessoOAuth({ cofre, fetch: f });
  await assertRejects(() => acesso.revogar({ slug: SLUG }), CofreTravado);
  assertEquals(f.chamadas.length, 0);
  await liberar();
});
