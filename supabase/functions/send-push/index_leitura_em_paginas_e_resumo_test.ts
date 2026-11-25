import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { aceitarPushServiceLocalSoNosTestes } from "../_shared/endpoint-de-push.ts";
import { bytesParaBase64Url, handler } from "./index.ts";

// Pontos que os testes antigos da send-push deixavam passar (caça por mutação,
// 25/11/2026): a leitura em PÁGINAS de `push_subscriptions` (campanha para a
// base inteira), o `ok` do resumo (ninguém recebeu = `ok: false`, nunca verde
// calado), o erro de leitura do banco (nunca vira "0 inscritos, tudo certo") e
// as duas formas de `tokens` que o painel manda. Nada toca a internet: o "push
// service" é um servidor HTTP local e o banco é um `fetch` roteado.

/** Um par de chaves de navegador fictício, reaproveitado por todas as inscrições. */
async function chavesDeNavegador() {
  const par = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  const publicaCrua = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const authCrua = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: bytesParaBase64Url(publicaCrua),
    auth: bytesParaBase64Url(authCrua),
    privada: par.privateKey,
    publicaCrua,
    authCrua,
  };
}

type Chaves = Awaited<ReturnType<typeof chavesDeNavegador>>;

/**
 * Abre o corpo `aes128gcm` que o push service recebeu (RFC 8188 + RFC 8291),
 * com a chave PRIVADA do "navegador" fictício do teste. É o que prova o
 * conteúdo do aviso que chegaria ao aparelho, não só que ele foi enviado.
 */
async function abrirAviso(corpo: Uint8Array, chaves: Chaves): Promise<any> {
  const salt = corpo.slice(0, 16);
  const tamanhoDaChave = corpo[20];
  const publicaDoServidor = corpo.slice(21, 21 + tamanhoDaChave);
  const cifrado = corpo.slice(21 + tamanhoDaChave);
  const publicaImportada = await crypto.subtle.importKey(
    "raw",
    publicaDoServidor,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const segredoEcdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: publicaImportada }, chaves.privada, 256),
  );
  const texto = new TextEncoder();
  const hkdf = async (ikm: Uint8Array, saltDoHkdf: Uint8Array, info: Uint8Array, bytes: number) => {
    const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(
      await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltDoHkdf, info }, base, bytes * 8),
    );
  };
  const infoDaChave = new Uint8Array([
    ...texto.encode("WebPush: info\0"),
    ...chaves.publicaCrua,
    ...publicaDoServidor,
  ]);
  const ikm = await hkdf(segredoEcdh, chaves.authCrua, infoDaChave, 32);
  const cek = await hkdf(ikm, salt, texto.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, texto.encode("Content-Encoding: nonce\0"), 12);
  const chaveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const aberto = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, chaveAes, cifrado),
  );
  // Último registro: o texto vai até o delimitador 0x02 (o resto é enchimento).
  const fim = aberto.lastIndexOf(2);
  return JSON.parse(new TextDecoder().decode(aberto.slice(0, fim)));
}

type Leitura = { offset: string | null; limit: string | null; userId: string | null; ordem: string | null };
type Resultado = {
  status: number;
  corpo: any;
  leituras: Leitura[];
  /** Caminho de cada entrega que o push service local recebeu. */
  entregas: string[];
  /** O que cada aviso diz, aberto com a chave do aparelho fictício (na ordem de chegada). */
  avisos: any[];
};

type Cenario = {
  /** Quantas inscrições o banco tem (endpoints /p/0 .. /p/N-1, todos de "cliente-x"). */
  inscricoes?: number;
  /** Status que o push service devolve, por caminho. Padrão: 201. */
  statusDoPush?: (caminho: string) => number;
  /** Resposta do banco ao ler `push_subscriptions`: erro HTTP em vez de linhas. */
  erroDeLeitura?: boolean;
  payload: Record<string, unknown>;
  tokens?: (base: string, chaves: Chaves) => unknown[];
};

async function chamar(cenario: Cenario): Promise<Resultado> {
  const parVapid = await webpush.generateVapidKeys({ extractable: true });
  const vapid = await webpush.exportVapidKeys(parVapid);
  const chaves = await chavesDeNavegador();
  const entregas: string[] = [];
  const leituras: Leitura[] = [];
  const avisos: any[] = [];
  const desfazerBrecha = aceitarPushServiceLocalSoNosTestes();
  const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const bruto = new Uint8Array(await req.arrayBuffer());
    const caminho = new URL(req.url).pathname;
    entregas.push(caminho);
    try {
      avisos.push(await abrirAviso(bruto, chaves));
    } catch (erro) {
      avisos.push({ erroAoAbrir: String(erro) });
    }
    return new Response(null, { status: cenario.statusDoPush?.(caminho) ?? 201 });
  });
  const base = `http://localhost:${servidor.addr.port}`;
  const fetchAnterior = globalThis.fetch;
  const anteriores = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_SECRET_KEYS",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ].map((chave) => [chave, Deno.env.get(chave)] as const);

  try {
    const total = cenario.inscricoes ?? 0;
    const banco = Array.from({ length: total }, (_, i) => ({
      id: String(i).padStart(5, "0"),
      user_id: "cliente-x",
      endpoint: `${base}/p/${i}`,
      p256dh: chaves.p256dh,
      auth: chaves.auth,
    }));

    Deno.env.set("SUPABASE_URL", "https://supa-fake.local");
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" }));
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" }));
    Deno.env.set("VAPID_PUBLIC_KEY", JSON.stringify(vapid.publicKey));
    Deno.env.set("VAPID_PRIVATE_KEY", JSON.stringify(vapid.privateKey));

    globalThis.fetch = async (entrada, opcoes) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      if (url.origin === base) return await fetchAnterior(entrada, opcoes);
      if (url.origin !== "https://supa-fake.local") {
        throw new Error("Requisição fora do roteiro do teste");
      }
      const json = (dados: unknown, status = 200) =>
        new Response(JSON.stringify(dados), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/auth/v1/user") {
        return json({
          id: "admin-de-teste",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "email", role: "admin" },
        });
      }
      if (url.pathname === "/rest/v1/profiles") {
        return json({ id: "admin-de-teste", role: "admin" });
      }
      if (url.pathname === "/rest/v1/push_subscriptions") {
        const metodo = opcoes?.method ?? (entrada instanceof Request ? entrada.method : "GET");
        if (metodo === "GET") {
          const offset = url.searchParams.get("offset");
          const limit = url.searchParams.get("limit");
          leituras.push({
            offset,
            limit,
            userId: url.searchParams.get("user_id"),
            ordem: url.searchParams.get("order"),
          });
          if (cenario.erroDeLeitura) {
            return json({ message: "falha simulada do banco", code: "XX000" }, 500);
          }
          const inicio = Number(offset ?? 0);
          const quantos = Number(limit ?? 1000);
          return json(banco.slice(inicio, inicio + quantos));
        }
      }
      throw new Error("Operação fora do roteiro do banco");
    };

    const corpoDaChamada = cenario.tokens
      ? { ...cenario.payload, tokens: cenario.tokens(base, chaves) }
      : cenario.payload;
    const resposta = await handler(
      new Request("http://local/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-de-teste" },
        body: JSON.stringify(corpoDaChamada),
      }),
    );
    return { status: resposta.status, corpo: await resposta.json(), leituras, entregas, avisos };
  } finally {
    globalThis.fetch = fetchAnterior;
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
    desfazerBrecha();
    await servidor.shutdown();
  }
}

const campanha = { title: "Promoção", body: "Texto fictício" };

Deno.test("campanha para a base inteira lê TODAS as páginas: 401 inscritos = 401 avisos, sem repetir nem pular ninguém", async () => {
  const r = await chamar({ inscricoes: 401, payload: campanha });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.ok, true);
  assertEquals(r.corpo.total, 401);
  assertEquals(r.corpo.enviados, 401);
  assertEquals(r.corpo.falharam, 0);
  assertEquals(r.corpo.naoTentados, 0);
  // Páginas de 200, uma atrás da outra: 0, 200, 400. Terceira vem com UMA linha.
  assertEquals(r.leituras.map((l) => [l.offset, l.limit]), [["0", "200"], ["200", "200"], ["400", "200"]]);
  // Cada aparelho recebeu exatamente UM aviso (o primeiro e o último inclusive).
  assertEquals(r.entregas.length, 401);
  assertEquals(new Set(r.entregas).size, 401);
  assert(r.entregas.includes("/p/0") && r.entregas.includes("/p/200") && r.entregas.includes("/p/400"));
});

Deno.test("base com exatamente 200 inscritos: uma página cheia puxa a seguinte, que vem vazia, e todos recebem", async () => {
  const r = await chamar({ inscricoes: 200, payload: campanha });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.enviados, 200);
  assertEquals(r.leituras.map((l) => l.offset), ["0", "200"]);
  assertEquals(new Set(r.entregas).size, 200);
});

Deno.test("ninguém recebeu: HTTP 200 com ok false e a contagem verdadeira de falhas (nunca 'ok' calado)", async () => {
  const r = await chamar({ inscricoes: 3, payload: campanha, statusDoPush: () => 500 });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.ok, false);
  assertEquals(r.corpo.enviados, 0);
  assertEquals(r.corpo.falharam, 3);
  assertEquals(r.corpo.total, 3);
  assertEquals(r.corpo.removidas, 0);
});

Deno.test("entrega parcial: ok true, e enviados/falharam contam cada aparelho como ele foi", async () => {
  const r = await chamar({
    inscricoes: 3,
    payload: campanha,
    statusDoPush: (caminho) => (caminho === "/p/1" ? 500 : 201),
  });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.ok, true);
  assertEquals(r.corpo.enviados, 2);
  assertEquals(r.corpo.falharam, 1);
  assertEquals(r.corpo.total, 3);
});

Deno.test("o banco falha ao ler as inscrições: 400 com ok false, nenhum aviso sai e nunca vira '0 inscritos, tudo certo'", async () => {
  const r = await chamar({ inscricoes: 5, payload: campanha, erroDeLeitura: true });
  assertEquals(r.status, 400);
  assertEquals(r.corpo.ok, false);
  assertEquals(typeof r.corpo.error, "string");
  assertEquals(r.entregas, []);
  assertEquals(r.leituras.length, 1, "falhou na primeira página e parou: não segue lendo");
});

Deno.test("base sem nenhum inscrito: ok true, tudo zero e nenhuma tentativa de envio", async () => {
  const r = await chamar({ inscricoes: 0, payload: campanha });
  assertEquals(r.status, 200);
  assertEquals(r.corpo, {
    ok: true,
    total: 0,
    enviados: 0,
    falharam: 0,
    removidas: 0,
    naoTentados: 0,
    falhas: [],
  });
  assertEquals(r.entregas, []);
  assertEquals(r.leituras.length, 1);
});

Deno.test("tokens do painel chegam nas DUAS formas (keys aninhadas e p256dh/auth soltos) e todos recebem", async () => {
  const r = await chamar({
    payload: campanha,
    tokens: (base, chaves) => [
      { endpoint: `${base}/p/aninhado`, keys: { p256dh: chaves.p256dh, auth: chaves.auth } },
      { endpoint: `${base}/p/solto`, p256dh: chaves.p256dh, auth: chaves.auth },
    ],
  });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.ok, true);
  assertEquals(r.corpo.enviados, 2);
  assertEquals(r.entregas.sort(), ["/p/aninhado", "/p/solto"]);
  assertEquals(r.leituras, [], "com tokens explícitos o banco de inscrições nem é lido");
});

Deno.test("token explícito sem chaves não derruba a campanha: conta como falha daquele aparelho", async () => {
  const r = await chamar({
    payload: campanha,
    tokens: (base, chaves) => [
      { endpoint: `${base}/p/bom`, keys: { p256dh: chaves.p256dh, auth: chaves.auth } },
      { endpoint: `${base}/p/sem-chave` },
    ],
  });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.enviados, 1);
  assertEquals(r.corpo.falharam, 1);
  assertEquals(r.entregas, ["/p/bom"]);
  assertStringIncludes(JSON.stringify(r.corpo.falhas), "quantidade");
});

Deno.test("o aviso chega ao aparelho com título, texto, url e data como o painel mandou", async () => {
  const r = await chamar({
    inscricoes: 1,
    payload: { title: "Promoção", body: "Texto fictício", url: "/ofertas", data: { campanha: "natal" } },
  });
  assertEquals(r.status, 200);
  assertEquals(r.avisos, [{ title: "Promoção", body: "Texto fictício", url: "/ofertas", data: { campanha: "natal" } }]);
});

Deno.test("sem url nem data no pedido, o aviso abre a página inicial (url '/') e leva data null", async () => {
  const r = await chamar({ inscricoes: 1, payload: campanha });
  assertEquals(r.status, 200);
  assertEquals(r.avisos, [{ title: "Promoção", body: "Texto fictício", url: "/", data: null }]);
  // url vazia e data vazia valem como ausentes.
  const vazios = await chamar({ inscricoes: 1, payload: { ...campanha, url: "", data: null } });
  assertEquals(vazios.avisos, [{ title: "Promoção", body: "Texto fictício", url: "/", data: null }]);
});

Deno.test("a leitura das inscrições é ordenada por id (crescente): sem ordem estável as páginas repetem ou pulam aparelhos", async () => {
  const r = await chamar({ inscricoes: 3, payload: campanha });
  assertEquals(r.leituras.map((l) => l.ordem), ["id.asc"]);
});
