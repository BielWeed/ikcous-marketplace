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
 *  - abrir com outro client_id ou redirect_uri descarta o refresh antigo;
 *  - revogar chama /v1/oauth/revoke e só apaga o cofre se o Supabase aceitou
 *    ou disse (400/404 invalid_grant/refresh_token_not_found) que o refresh
 *    já não vale; 401/403/429/5xx/rede/outro erro mantêm o cofre;
 *  - nenhum erro carrega token, refresh, client_secret, código, verificador
 *    nem state;
 *  - renovarComTravaLonga (sessão de publicação) SEGURA a trava até o liberar:
 *    nenhuma outra renovação da loja anda nesse meio, nem de outro processo;
 *  - tokenVigente reaproveita o access token guardado no cofre enquanto faltar
 *    MAIS que o mínimo, e toda renovação apaga o guardado ANTES de pedir o
 *    token novo (o guardado nunca é mais velho que a última renovação, gire
 *    ou não o Supabase o access token anterior).
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
  SCRIPT_CIFRAR,
  SCRIPT_DECIFRAR,
  criarCofreDpapi,
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

const OUTRO_CLIENT_ID = "c6a08374-1111-4111-8111-111111111111";
const OUTRO_SECRET = "sba_OUTRO_SEGREDO_FALSO_inventado_456";

for (const [rotulo, troca] of [
  [
    "outro client_id",
    { clientId: OUTRO_CLIENT_ID, clientSecret: OUTRO_SECRET },
  ],
  [
    "outro redirect_uri",
    { redirectUri: "https://outra.exemplo.test/autorizado" },
  ],
]) {
  Deno.test(`abrir com ${rotulo} numa loja conectada descarta o refresh antigo`, async () => {
    const cofre = await cofreConectado();
    const f = fetchFalso();
    const acesso = criarAcessoOAuth({ cofre, fetch: f });
    await acesso.abrir({
      slug: SLUG,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT,
      ...troca,
    });
    const reg = await lerRegistro(cofre);
    assertEquals(reg.refresh, undefined, "refresh de outro app/retorno ficou");
    assert(!JSON.stringify(reg).includes(REFRESH_1));
    assert(reg.pendente);
    assertEquals(
      { ...reg, ...troca },
      reg,
      "o registro não ficou com o app novo",
    );
    // sem refresh, renovar recusa sem chamar o Supabase com o par trocado
    const e = await pegarErro(() => acesso.renovar({ slug: SLUG }));
    assert(e instanceof ErroDeAcesso);
    assertEquals(e.codigo, "NAO_CONECTADA");
    assertEquals(f.chamadas.length, 0);
  });
}

Deno.test("abrir com o MESMO app e só o client_secret trocado mantém o refresh", async () => {
  const cofre = await cofreConectado();
  const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso() });
  await acesso.abrir({
    slug: SLUG,
    clientId: CLIENT_ID,
    clientSecret: OUTRO_SECRET,
    redirectUri: REDIRECT,
  });
  const reg = await lerRegistro(cofre);
  assertEquals(reg.refresh, REFRESH_1);
  assertEquals(reg.clientSecret, OUTRO_SECRET);
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

for (const status of [400, 404]) {
  for (const erro of ["invalid_grant", "refresh_token_not_found"]) {
    Deno.test(`revogar: ${status} ${erro} = o refresh já não valia; apaga o cofre e diz que já estava revogado`, async () => {
      const cofre = await cofreConectado();
      const f = fetchFalso(resposta(status, { ...corpoQueEcoa, error: erro }));
      const acesso = criarAcessoOAuth({ cofre, fetch: f });
      const r = await acesso.revogar({ slug: SLUG });
      assertEquals(r, { revogado: true, jaEstavaRevogado: true });
      assertEquals(f.chamadas.length, 1);
      assertEquals(await cofre.ler(SLUG), null);
      assertSemVazamento(r);
    });
  }
}

Deno.test("revogar: falha que pode ser NOSSA (401/403/5xx/429, outro erro OAuth, corpo estranho) mantém o cofre", async () => {
  const casos = [
    [401, { error: "invalid_grant" }],
    [403, { error: "invalid_grant" }],
    [500, { error: "invalid_grant" }],
    [503, { error: "refresh_token_not_found" }],
    [429, { error: "invalid_grant" }],
    [400, { error: "invalid_client" }],
    [400, { error: "invalid_request" }],
    [400, { error: "unsupported_token_type" }],
    [400, { error: "INVALID_GRANT" }],
    [400, { error: "invalid_grant x" }],
    [400, { error: ["invalid_grant"] }],
    [400, { error_description: "invalid_grant" }],
    [400, "invalid_grant"],
    [400, undefined],
    [404, undefined],
    [404, "<html>invalid_grant</html>"],
    [410, { error: "invalid_grant" }],
  ];
  for (const [status, corpo] of casos) {
    const cofre = await cofreConectado();
    const antes = await cofre.ler(SLUG);
    const acesso = criarAcessoOAuth({
      cofre,
      fetch: fetchFalso(
        resposta(
          status,
          typeof corpo === "object" && !Array.isArray(corpo)
            ? { error_description: corpoQueEcoa.error_description, ...corpo }
            : corpo,
        ),
      ),
    });
    const e = await pegarErro(() => acesso.revogar({ slug: SLUG }));
    assert(
      e instanceof ErroDaGestao,
      `${status} ${JSON.stringify(corpo)} não virou erro`,
    );
    assertSemVazamento(e);
    assertEquals(
      await cofre.ler(SLUG),
      antes,
      `${status} ${JSON.stringify(corpo)} apagou o cofre`,
    );
  }
});

Deno.test("revogar: rede caída ou prazo estourado mantém o cofre", async () => {
  for (const f of [
    fetchFalso(() => Promise.reject(new TypeError("falha de rede"))),
    fetchFalso(
      (_u, init) =>
        new Promise((_ok, falha) => {
          init.signal.addEventListener("abort", () =>
            falha(new DOMException("abortado", "AbortError")),
          );
        }),
    ),
  ]) {
    const cofre = await cofreConectado();
    const antes = await cofre.ler(SLUG);
    const acesso = criarAcessoOAuth({ cofre, fetch: f, prazoMs: 20 });
    const e = await pegarErro(() => acesso.revogar({ slug: SLUG }));
    assert(e instanceof ErroDaGestao);
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

// ------------------------------------------------- trava longa e token guardado --
// Canários montados em tempo de execução (literal no fonte dispara o secretlint).
const canario = (par) => `sbp_oauth_${par.repeat(20)}`;
const ACESSO_A = canario("ab");
const ACESSO_B = canario("cd");
const ACESSO_C = canario("ef");
const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Resposta 200 do /token com um access token escolhido. */
const tokenCom = (access, refresh = SEM_REFRESH, expiresIn = 86400) =>
  resposta(200, {
    access_token: access,
    ...(refresh === SEM_REFRESH ? {} : { refresh_token: refresh }),
    ...(expiresIn === null ? {} : { expires_in: expiresIn }),
    token_type: "Bearer",
  });

/** Erro sem nenhum dos canários de access token. */
function assertSemCanario(erro) {
  assertSemVazamento(erro, [ACESSO_A, ACESSO_B, ACESSO_C]);
}

async function cofreComGuardado(token, expiraEm, refresh = REFRESH_1) {
  const cofre = criarCofreMemoria();
  await cofre.gravar(
    SLUG,
    JSON.stringify({
      versao: 1,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT,
      refresh,
      acesso: { token, expiraEm },
    }),
  );
  return cofre;
}

/** Cofre que anota cada gravação (com o registro gravado). */
function cofreQueAnota(base, eventos, { falharGravacao } = {}) {
  return {
    ...base,
    async gravar(slug, valor) {
      const reg = JSON.parse(valor);
      eventos.push({ tipo: "gravar", reg });
      if (falharGravacao?.(reg)) throw new Error(`disco cheio ${valor}`);
      await base.gravar(slug, valor);
    },
  };
}

function fetchQueAnota(eventos, ...respostas) {
  const f = fetchFalso(...respostas);
  const g = (url, init) => {
    eventos.push({ tipo: "fetch" });
    return f(url, init);
  };
  g.chamadas = f.chamadas;
  return g;
}

/** A trava da loja está livre? (pega e solta na hora) */
async function travaLivre(cofre) {
  try {
    const l = await cofre.travar(SLUG);
    await l();
    return true;
  } catch (e) {
    if (e instanceof CofreTravado) return false;
    throw e;
  }
}

Deno.test("renovarComTravaLonga: devolve o token e SEGURA a trava até o liberar", async () => {
  const cofre = await cofreConectado();
  const f = fetchFalso(tokenCom(ACESSO_A, REFRESH_2));
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const s = await acesso.renovarComTravaLonga({ slug: SLUG });
  assertEquals(s.accessToken, ACESSO_A);
  assertEquals(s.expiraEm, AGORA + DIA);
  assertEquals(typeof s.liberar, "function");
  assertEquals(typeof s.renovarDeNovo, "function");
  assertEquals(f.chamadas.length, 1);

  // mesmo processo (mesma instância) e "outro processo" (outra instância no
  // mesmo cofre): renovar, tokenVigente, outra sessão e revogar são recusados
  const outro = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  for (const tentar of [
    () => acesso.renovar({ slug: SLUG }),
    () => outro.renovar({ slug: SLUG }),
    () => outro.tokenVigente({ slug: SLUG, minimoMs: HORA }),
    () => outro.renovarComTravaLonga({ slug: SLUG }),
    () => acesso.revogar({ slug: SLUG }),
  ]) {
    await assertRejects(tentar, CofreTravado);
  }
  assertEquals(f.chamadas.length, 1, "alguém renovou com a sessão aberta");
  assertEquals(await travaLivre(cofre), false);

  await s.liberar();
  assertEquals(await travaLivre(cofre), true);
  const f2 = fetchFalso(tokenCom(ACESSO_B));
  await criarAcessoOAuth({ cofre, fetch: f2 }).renovar({ slug: SLUG });
  assertEquals(f2.chamadas.length, 1, "depois do liberar, renovar voltou");
});

Deno.test("renovarComTravaLonga: o refresh NOVO é gravado ANTES do token sair", async () => {
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
    fetch: fetchFalso(tokenCom(ACESSO_A, REFRESH_2)),
  });
  const p = acesso.renovarComTravaLonga({ slug: SLUG }).then((s) => {
    eventos.push("devolveu");
    return s;
  });
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(eventos, ["gravar-comecou"], "devolveu antes de gravar");
  soltarGravacao();
  const s = await p;
  assertEquals(eventos, ["gravar-comecou", "gravar-terminou", "devolveu"]);
  assertEquals((await lerRegistro(base)).refresh, REFRESH_2);
  assert(
    !JSON.stringify(await lerRegistro(base)).includes(ACESSO_A),
    "o token da sessão (que vai ao GitHub) foi guardado no cofre",
  );
  await s.liberar();
});

Deno.test("renovarComTravaLonga: renovação que falha SOLTA a trava e o erro sobe sem segredo", async () => {
  for (const [rotulo, montar, Classe, quebrarCofre] of [
    ["401", () => resposta(401, corpoQueEcoa), SemAcesso, false],
    ["500", () => resposta(500, corpoQueEcoa), ErroDaGestao, false],
    [
      "cofre não grava o refresh novo",
      () => tokenCom(ACESSO_A, REFRESH_2),
      ErroDeAcesso,
      true,
    ],
  ]) {
    const base = await cofreConectado();
    const cofre = quebrarCofre
      ? cofreQueAnota(base, [], { falharGravacao: () => true })
      : base;
    const acesso = criarAcessoOAuth({ cofre, fetch: fetchFalso(montar()) });
    const e = await pegarErro(() =>
      acesso.renovarComTravaLonga({ slug: SLUG }),
    );
    assert(e instanceof Classe, `${rotulo}: ${e?.name}`);
    assertSemCanario(e);
    assertEquals(
      await travaLivre(base),
      true,
      `${rotulo}: a trava ficou presa`,
    );
  }
  // loja sem refresh: recusa sem chamar e solta a trava
  const vazio = criarCofreMemoria();
  const f = fetchFalso();
  await assertRejects(
    () =>
      criarAcessoOAuth({ cofre: vazio, fetch: f }).renovarComTravaLonga({
        slug: SLUG,
      }),
    ErroDeAcesso,
  );
  assertEquals(f.chamadas.length, 0);
  assertEquals(await travaLivre(vazio), true);
});

Deno.test("renovarComTravaLonga: trava já presa (outro processo) = CofreTravado sem chamar o Supabase", async () => {
  const cofre = await cofreConectado();
  const liberarOutro = await cofre.travar(SLUG);
  const f = fetchFalso(tokenCom(ACESSO_A));
  const acesso = criarAcessoOAuth({ cofre, fetch: f });
  await assertRejects(
    () => acesso.renovarComTravaLonga({ slug: SLUG }),
    CofreTravado,
  );
  assertEquals(f.chamadas.length, 0);
  // a recusa não mexeu na trava de quem já a tinha
  assertEquals(await travaLivre(cofre), false);
  await liberarOutro();
  assertEquals(await travaLivre(cofre), true);
});

Deno.test("renovarComTravaLonga: liberar duas vezes não solta a trava de quem travou depois", async () => {
  const cofre = await cofreConectado();
  const acesso = criarAcessoOAuth({
    cofre,
    fetch: fetchFalso(tokenCom(ACESSO_A)),
  });
  const s = await acesso.renovarComTravaLonga({ slug: SLUG });
  await s.liberar();
  const liberarDepois = await cofre.travar(SLUG); // outro comando entrou
  await s.liberar(); // segunda chamada: sem efeito
  await Promise.all([s.liberar(), s.liberar()]);
  assertEquals(await travaLivre(cofre), false, "soltou a trava alheia");
  await liberarDepois();
});

Deno.test("renovarDeNovo: renova SOB a trava longa (para matar o token no fechar) e grava o refresh novo", async () => {
  const REFRESH_3 = "refresh-FALSO-tres-0123456789";
  const cofre = await cofreConectado();
  const f = fetchFalso(
    tokenCom(ACESSO_A, REFRESH_2),
    tokenCom(ACESSO_B, REFRESH_3),
  );
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const s = await acesso.renovarComTravaLonga({ slug: SLUG });
  const r = await s.renovarDeNovo();
  assertEquals(r, { accessToken: ACESSO_B, expiraEm: AGORA + DIA });
  assertEquals(
    new URLSearchParams(f.chamadas[1].init.body).get("refresh_token"),
    REFRESH_2,
    "a renovação sob a trava não usou o refresh gravado pela primeira",
  );
  assertEquals((await lerRegistro(cofre)).refresh, REFRESH_3);
  assertEquals(await travaLivre(cofre), false, "renovarDeNovo soltou a trava");
  await s.liberar();
  assertEquals(await travaLivre(cofre), true);
});

Deno.test("renovarDeNovo: depois do liberar recusa sem chamar o Supabase", async () => {
  const cofre = await cofreConectado();
  const f = fetchFalso(tokenCom(ACESSO_A));
  const s = await criarAcessoOAuth({ cofre, fetch: f }).renovarComTravaLonga({
    slug: SLUG,
  });
  await s.liberar();
  const e = await pegarErro(() => s.renovarDeNovo());
  assert(e instanceof ErroDeAcesso);
  assertEquals(e.codigo, "TRAVA_SOLTA");
  assertEquals(f.chamadas.length, 1);
});

Deno.test("renovarDeNovo: duas chamadas juntas = UMA renovação; liberar espera ela acabar", async () => {
  const cofre = await cofreConectado();
  let soltar;
  const f = fetchFalso(
    tokenCom(ACESSO_A),
    () =>
      new Promise((r) => {
        soltar = () => r(tokenCom(ACESSO_B, REFRESH_2));
      }),
  );
  const s = await criarAcessoOAuth({ cofre, fetch: f }).renovarComTravaLonga({
    slug: SLUG,
  });
  const a = s.renovarDeNovo();
  const b = s.renovarDeNovo();
  await new Promise((r) => setTimeout(r, 10));
  const liberou = s.liberar().then(() => "liberou");
  await new Promise((r) => setTimeout(r, 10));
  // com o pedido ainda no ar, a trava NÃO pode ter sido entregue a ninguém
  assertEquals(await travaLivre(cofre), false, "soltou com a renovação no ar");
  soltar();
  const [ra, rb] = await Promise.all([a, b]);
  assertEquals(f.chamadas.length, 2, "renovou duas vezes sob a mesma trava");
  assertEquals(ra.accessToken, ACESSO_B);
  assertEquals(rb.accessToken, ACESSO_B);
  assertEquals(await liberou, "liberou");
  assertEquals((await lerRegistro(cofre)).refresh, REFRESH_2);
  assertEquals(await travaLivre(cofre), true);
});

// ---- a corrida entre PROCESSOS: trava em disco do cofre DPAPI (PowerShell falso)

function executorDpapiFalso() {
  const hex = (t) =>
    Array.from(new TextEncoder().encode(t), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const deHex = (h) =>
    new TextDecoder().decode(
      Uint8Array.from(h.match(/../g), (x) => Number.parseInt(x, 16)),
    );
  return async (_comando, args, { entrada }) => {
    const i = args.indexOf("-EncodedCommand");
    const bytes = Uint8Array.from(atob(args[i + 1]), (c) => c.charCodeAt(0));
    const script = new TextDecoder("utf-16le").decode(bytes);
    if (script === SCRIPT_CIFRAR) {
      return { codigo: 0, saida: hex(entrada.trim()), erro: "" };
    }
    if (script === SCRIPT_DECIFRAR) {
      return { codigo: 0, saida: deHex(entrada.trim()), erro: "" };
    }
    throw new Error("script inesperado");
  };
}

Deno.test("corrida entre processos: sessão e renovação ao mesmo tempo = UM pedido ao Supabase, refresh não se perde", async () => {
  const pasta = await Deno.makeTempDir({ prefix: "acesso-oauth-corrida-" });
  try {
    // dois "processos": cada um com o SEU cofre (mesma pasta) e o SEU acesso
    const cofreA = criarCofreDpapi({ pasta, executar: executorDpapiFalso() });
    const cofreB = criarCofreDpapi({ pasta, executar: executorDpapiFalso() });
    await cofreA.gravar(
      SLUG,
      JSON.stringify({
        versao: 1,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: REDIRECT,
        refresh: REFRESH_1,
      }),
    );
    // o Supabase falso GIRA o refresh: quem reusar um refresh já trocado
    // recebe invalid_grant (o que aconteceria aos dois sem a trava)
    const usados = new Set();
    let pedidos = 0;
    const supabase = (_u, init) => {
      pedidos++;
      const n = pedidos;
      const refresh = new URLSearchParams(init.body).get("refresh_token");
      if (usados.has(refresh)) {
        return Promise.resolve(resposta(400, { error: "invalid_grant" }));
      }
      usados.add(refresh);
      return new Promise((r) =>
        setTimeout(
          () => r(tokenCom(ACESSO_A, `refresh-FALSO-novo-${n}-0123`)),
          20,
        ),
      );
    };
    const a = criarAcessoOAuth({ cofre: cofreA, fetch: supabase });
    const b = criarAcessoOAuth({ cofre: cofreB, fetch: supabase });
    const [ra, rb] = await Promise.allSettled([
      a.renovarComTravaLonga({ slug: SLUG }),
      b.renovar({ slug: SLUG }),
    ]);
    const venceu = [ra, rb].filter((x) => x.status === "fulfilled");
    const perdeu = [ra, rb].filter((x) => x.status === "rejected");
    assertEquals(venceu.length, 1, "os dois renovaram (ou nenhum)");
    assert(perdeu[0].reason instanceof CofreTravado, String(perdeu[0].reason));
    assertEquals(pedidos, 1, "o perdedor chegou a pedir token");
    // o refresh no disco é o do vencedor, legível pelo outro processo
    assertEquals(
      JSON.parse(await cofreB.ler(SLUG)).refresh,
      "refresh-FALSO-novo-1-0123",
    );
    if (ra.status === "fulfilled") await ra.value.liberar();
    // trava solta: a próxima renovação do outro processo usa o refresh novo
    await b.renovar({ slug: SLUG });
    assertEquals(pedidos, 2);
    assertEquals(
      JSON.parse(await cofreA.ler(SLUG)).refresh,
      "refresh-FALSO-novo-2-0123",
    );
    const sobrou = [];
    for await (const x of Deno.readDir(pasta)) sobrou.push(x.name);
    assertEquals(sobrou, [`${SLUG}.dpapi`], "ficou trava ou temporário");
  } finally {
    await Deno.remove(pasta, { recursive: true });
  }
});

// -------------------------------------------------------------- tokenVigente --

Deno.test("tokenVigente: sem token guardado renova UMA vez e guarda token + vencimento numa gravação só", async () => {
  const base = await cofreConectado();
  const eventos = [];
  const cofre = cofreQueAnota(base, eventos);
  const f = fetchQueAnota(eventos, tokenCom(ACESSO_A, REFRESH_2));
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const r = await acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA });
  assertEquals(r, {
    accessToken: ACESSO_A,
    expiraEm: AGORA + DIA,
    reaproveitado: false,
  });
  assertEquals(
    eventos.map((e) => e.tipo),
    ["fetch", "gravar"],
  );
  const reg = await lerRegistro(base);
  assertEquals(reg.refresh, REFRESH_2);
  assertEquals(reg.acesso, { token: ACESSO_A, expiraEm: AGORA + DIA });
  assertEquals(await travaLivre(base), true);
});

Deno.test("tokenVigente: reaproveita o guardado enquanto falta MAIS que o mínimo (1 renovação por dia)", async () => {
  const cofre = await cofreConectado();
  let agora = AGORA;
  const f = fetchFalso(tokenCom(ACESSO_A, REFRESH_2), tokenCom(ACESSO_B));
  // um ensaio por hora, cada um num "processo" novo (instância nova)
  const tokens = [];
  for (let h = 0; h <= 22; h++) {
    agora = AGORA + h * HORA;
    const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => agora });
    const r = await acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA });
    tokens.push(r.accessToken);
    assertEquals(r.reaproveitado, h > 0 && h < 22, `hora ${h}`);
  }
  // 0h renova; 1h..21h reaproveitam; 22h: falta EXATAMENTE o mínimo -> renova
  assertEquals(f.chamadas.length, 2, "renovou mais de uma vez no dia");
  assertEquals(tokens.slice(0, 22), Array(22).fill(ACESSO_A));
  assertEquals(tokens[22], ACESSO_B);
  assertEquals((await lerRegistro(cofre)).acesso.token, ACESSO_B);
});

Deno.test("tokenVigente: guardado com pouco tempo é trocado, e o velho sai do cofre ANTES do pedido", async () => {
  const base = await cofreComGuardado(ACESSO_A, AGORA + HORA);
  const eventos = [];
  const cofre = cofreQueAnota(base, eventos);
  const f = fetchQueAnota(eventos, tokenCom(ACESSO_B));
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const r = await acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA });
  assertEquals(r.accessToken, ACESSO_B);
  assertEquals(r.reaproveitado, false);
  assertEquals(
    eventos.map((e) => e.tipo),
    ["gravar", "fetch", "gravar"],
  );
  assertEquals(eventos[0].reg.acesso, undefined, "o velho não saiu antes");
  assertEquals(eventos[0].reg.refresh, REFRESH_1, "a limpeza mexeu no refresh");
  assertEquals((await lerRegistro(base)).acesso, {
    token: ACESSO_B,
    expiraEm: AGORA + DIA,
  });
});

Deno.test("renovar (outro comando) apaga o token guardado ANTES do pedido e não guarda o novo", async () => {
  // Se o Supabase invalidar o access token anterior a cada renovação (P6b),
  // o guardado morre aqui; se não invalidar, perde-se só uma renovação. Nos
  // dois casos o cofre nunca oferece um token mais velho que a última troca.
  const base = await cofreComGuardado(ACESSO_A, AGORA + 20 * HORA);
  const eventos = [];
  const cofre = cofreQueAnota(base, eventos);
  const f = fetchQueAnota(eventos, tokenCom(ACESSO_B), tokenCom(ACESSO_C));
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const r = await acesso.renovar({ slug: SLUG });
  assertEquals(r, { accessToken: ACESSO_B, expiraEm: AGORA + DIA });
  assertEquals(
    eventos.map((e) => e.tipo),
    ["gravar", "fetch"],
  );
  assertEquals(eventos[0].reg.acesso, undefined);
  const reg = await lerRegistro(base);
  assertEquals(reg.acesso, undefined);
  assertEquals(reg.refresh, REFRESH_1);
  // o próximo ensaio NÃO recebe o ACESSO_A: renova
  const v = await acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA });
  assertEquals(v.accessToken, ACESSO_C);
  assertEquals(v.reaproveitado, false);
});

Deno.test("renovarComTravaLonga e receber também tiram o token guardado do cofre", async () => {
  const base = await cofreComGuardado(ACESSO_A, AGORA + 20 * HORA);
  const s = await criarAcessoOAuth({
    cofre: base,
    fetch: fetchFalso(tokenCom(ACESSO_B, REFRESH_2)),
    agora: () => AGORA,
  }).renovarComTravaLonga({ slug: SLUG });
  const reg = await lerRegistro(base);
  assertEquals(reg.acesso, undefined, "a sessão deixou o guardado velho");
  assertEquals(reg.refresh, REFRESH_2);
  await s.liberar();

  // receber (autorização nova) com um guardado de antes
  const f = fetchFalso(tokenCom(ACESSO_C, REFRESH_1));
  const { acesso, cofre, state } = await abrirComFetch(f);
  const atual = await lerRegistro(cofre);
  await cofre.gravar(
    SLUG,
    JSON.stringify({
      ...atual,
      acesso: { token: ACESSO_A, expiraEm: AGORA + DIA },
    }),
  );
  await acesso.receber({
    slug: SLUG,
    colado: `?code=${CODIGO}&state=${state}`,
  });
  const depois = await lerRegistro(cofre);
  assertEquals(depois.acesso, undefined, "receber deixou o guardado velho");
  assert(!JSON.stringify(depois).includes(ACESSO_C), "receber guardou o token");
});

Deno.test("tokenVigente: limpeza do guardado que falha = nada renovado, erro sem segredo", async () => {
  const base = await cofreComGuardado(ACESSO_A, AGORA + HORA);
  const antes = await base.ler(SLUG);
  const cofre = cofreQueAnota(base, [], { falharGravacao: () => true });
  const f = fetchFalso(tokenCom(ACESSO_B));
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  for (const tentar of [
    () => acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA }),
    () => acesso.renovar({ slug: SLUG }),
  ]) {
    const e = await pegarErro(tentar);
    assert(e instanceof ErroDeAcesso);
    assertEquals(e.codigo, "GUARDADO_NAO_SAIU");
    assertSemCanario(e);
  }
  assertEquals(f.chamadas.length, 0, "renovou sem limpar o guardado");
  assertEquals(await base.ler(SLUG), antes);
  assertEquals(await travaLivre(base), true);
});

Deno.test("tokenVigente: gravação do token novo que falha", async () => {
  // refresh NÃO girou: o token sai (vale), e o cofre fica SEM guardado
  {
    const base = await cofreConectado();
    const cofre = cofreQueAnota(base, [], {
      falharGravacao: (reg) => reg.acesso !== undefined,
    });
    const acesso = criarAcessoOAuth({
      cofre,
      fetch: fetchFalso(tokenCom(ACESSO_A)),
      agora: () => AGORA,
    });
    const r = await acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA });
    assertEquals(r.accessToken, ACESSO_A);
    assertEquals(r.reaproveitado, false);
    const reg = await lerRegistro(base);
    assertEquals(reg.acesso, undefined);
    assertEquals(reg.refresh, REFRESH_1);
  }
  // refresh GIROU: igual ao renovar, o token NÃO sai (o refresh novo se perdeu)
  {
    const base = await cofreConectado();
    const cofre = cofreQueAnota(base, [], { falharGravacao: () => true });
    const acesso = criarAcessoOAuth({
      cofre,
      fetch: fetchFalso(tokenCom(ACESSO_A, REFRESH_2)),
      agora: () => AGORA,
    });
    const e = await pegarErro(() =>
      acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA }),
    );
    assert(e instanceof ErroDeAcesso);
    assertEquals(e.codigo, "COFRE_NAO_GRAVOU");
    assertSemCanario(e);
    assertEquals(await travaLivre(base), true);
  }
});

Deno.test("tokenVigente: renovação sem prazo (expires_in ausente) não guarda nada", async () => {
  const cofre = await cofreConectado();
  const f = fetchFalso(
    tokenCom(ACESSO_A, SEM_REFRESH, null),
    tokenCom(ACESSO_B, SEM_REFRESH, null),
  );
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const r = await acesso.tokenVigente({ slug: SLUG, minimoMs: HORA });
  assertEquals(r, {
    accessToken: ACESSO_A,
    expiraEm: null,
    reaproveitado: false,
  });
  assertEquals((await lerRegistro(cofre)).acesso, undefined);
  const r2 = await acesso.tokenVigente({ slug: SLUG, minimoMs: HORA });
  assertEquals(r2.accessToken, ACESSO_B, "reaproveitou token sem prazo");
});

Deno.test("tokenVigente: guardado malformado é ignorado (renova), não tranca a loja", async () => {
  for (const ruim of [
    { token: "", expiraEm: AGORA + DIA },
    { token: "tem espaço", expiraEm: AGORA + DIA },
    { token: ACESSO_A, expiraEm: "amanhã" },
    { token: ACESSO_A },
    "texto",
    null,
  ]) {
    const cofre = await cofreConectado();
    const atual = await lerRegistro(cofre);
    await cofre.gravar(SLUG, JSON.stringify({ ...atual, acesso: ruim }));
    const f = fetchFalso(tokenCom(ACESSO_B));
    const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
    const r = await acesso.tokenVigente({ slug: SLUG, minimoMs: HORA });
    assertEquals(r.accessToken, ACESSO_B, JSON.stringify(ruim));
    assertEquals(f.chamadas.length, 1);
  }
});

Deno.test("tokenVigente: mínimo inválido recusa sem tocar cofre nem rede", async () => {
  for (const minimoMs of [
    undefined,
    -1,
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "7200000",
  ]) {
    const cofre = await cofreComGuardado(ACESSO_A, AGORA + DIA);
    let travou = 0;
    const contado = {
      ...cofre,
      async travar(s) {
        travou++;
        return cofre.travar(s);
      },
    };
    const f = fetchFalso();
    const e = await pegarErro(() =>
      criarAcessoOAuth({ cofre: contado, fetch: f }).tokenVigente({
        slug: SLUG,
        minimoMs,
      }),
    );
    assert(e instanceof ErroDeAcesso, String(minimoMs));
    assertEquals(e.codigo, "PEDIDO_INVALIDO");
    assertEquals(travou, 0);
    assertEquals(f.chamadas.length, 0);
  }
});

Deno.test("tokenVigente: trava de outro processo = CofreTravado, mesmo com guardado bom", async () => {
  const cofre = await cofreComGuardado(ACESSO_A, AGORA + DIA);
  const liberarOutro = await cofre.travar(SLUG);
  const f = fetchFalso();
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  await assertRejects(
    () => acesso.tokenVigente({ slug: SLUG, minimoMs: HORA }),
    CofreTravado,
  );
  assertEquals(f.chamadas.length, 0);
  await liberarOutro();
});

Deno.test("tokenVigente: pedidos simultâneos no mesmo processo = UMA renovação", async () => {
  const cofre = await cofreConectado();
  let soltar;
  const f = fetchFalso(
    () =>
      new Promise((r) => {
        soltar = () => r(tokenCom(ACESSO_A, REFRESH_2));
      }),
  );
  const acesso = criarAcessoOAuth({ cofre, fetch: f, agora: () => AGORA });
  const a = acesso.tokenVigente({ slug: SLUG, minimoMs: HORA });
  const b = acesso.tokenVigente({ slug: SLUG, minimoMs: HORA });
  await new Promise((r) => setTimeout(r, 10));
  soltar();
  const [ra, rb] = await Promise.all([a, b]);
  assertEquals(f.chamadas.length, 1);
  assertEquals(ra.accessToken, ACESSO_A);
  assertEquals(rb.accessToken, ACESSO_A);
});

Deno.test("tokenVigente: SemAcesso sobe sem segredo, o refresh fica e o guardado velho não", async () => {
  const cofre = await cofreComGuardado(ACESSO_A, AGORA + HORA);
  const acesso = criarAcessoOAuth({
    cofre,
    fetch: fetchFalso(resposta(401, corpoQueEcoa)),
    agora: () => AGORA,
  });
  const e = await pegarErro(() =>
    acesso.tokenVigente({ slug: SLUG, minimoMs: 2 * HORA }),
  );
  assert(e instanceof SemAcesso);
  assertSemCanario(e);
  const reg = await lerRegistro(cofre);
  assertEquals(reg.refresh, REFRESH_1);
  assertEquals(reg.acesso, undefined, "o guardado com pouco tempo ficou");
});
