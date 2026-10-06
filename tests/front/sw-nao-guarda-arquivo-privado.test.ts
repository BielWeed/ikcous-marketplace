import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — a gaveta de imagens do Supabase (`supabase-images-cache`)
 * só pode guardar arquivo PÚBLICO.
 *
 * O DEFEITO (R12, 04/10/2026): o ramo do Supabase cacheava QUALQUER caminho
 * com `/storage/v1/object/` ou `/storage/v1/render/` — o que inclui o
 * endereço ASSINADO de bucket privado (`/object/sign/...?token=`, ex.: a foto
 * de devolução que o lojista abre por `createSignedUrl`), o download
 * autenticado (`/object/authenticated/...`, com header Authorization) e a
 * transformação assinada (`/render/image/sign/...`). A cópia ficava no Cache
 * Storage do aparelho DEPOIS do logout, e o SW a servia por endereço a quem
 * usasse o mesmo aparelho em seguida — inclusive offline, quando o fetch
 * falha e o ramo devolve o que tinha guardado.
 *
 * Mesmo arnês de sw-fetch.test.ts / sw-identidade-fora-do-document.test.ts:
 * `environment: "node"`, globais falsos montados ANTES do `await import`, e
 * `vi.resetModules()` entre testes porque o `sw.ts` registra os listeners no
 * próprio import. A diferença: aqui o `caches` falso GUARDA de verdade (um
 * Map por nome de cache), porque a pergunta é "o que sobrou na gaveta".
 */

type Listener = (event: unknown) => void;

const IMAGE_CACHE_NAME = "supabase-images-cache";
const SUPA = "https://xyzcompany.supabase.co";

const PUBLICO_OBJETO = `${SUPA}/storage/v1/object/public/products/foto.png`;
const PUBLICO_RENDER = `${SUPA}/storage/v1/render/image/public/products/foto.png?width=340&quality=75`;

/** Formas de storage que NÃO são públicas — nenhuma pode entrar na gaveta. */
const PRIVADOS: ReadonlyArray<readonly [string, string]> = [
  [
    "objeto assinado (createSignedUrl)",
    `${SUPA}/storage/v1/object/sign/devolucoes/pedido-1/foto.jpg?token=eyJhbGciOi.assinatura`,
  ],
  [
    "transformação assinada",
    `${SUPA}/storage/v1/render/image/sign/devolucoes/pedido-1/foto.jpg?token=eyJhbGciOi.assinatura&width=200`,
  ],
  [
    "download autenticado",
    `${SUPA}/storage/v1/object/authenticated/devolucoes/pedido-1/foto.jpg`,
  ],
  [
    "transformação autenticada",
    `${SUPA}/storage/v1/render/image/authenticated/devolucoes/pedido-1/foto.jpg`,
  ],
  [
    "objeto sem prefixo de visibilidade (GET /object/{bucket}/{caminho})",
    `${SUPA}/storage/v1/object/devolucoes/pedido-1/foto.jpg`,
  ],
  [
    "upload assinado",
    `${SUPA}/storage/v1/object/upload/sign/devolucoes/pedido-1/foto.jpg?token=abc`,
  ],
  [
    "caminho público COM token na query",
    `${SUPA}/storage/v1/object/public/products/foto.png?token=abc`,
  ],
  [
    "`..` saindo do public/ para o sign/ (o parser de URL normaliza)",
    `${SUPA}/storage/v1/object/public/../sign/devolucoes/foto.jpg?x=1`,
  ],
  [
    "prefixo parecido mas não igual (publicx/)",
    `${SUPA}/storage/v1/object/publicx/devolucoes/foto.jpg`,
  ],
];

function criarSelfFalso() {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: {
      origin: "https://loja.exemplo.com",
      hostname: "loja.exemplo.com",
    },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      const atuais = listeners.get(tipo) ?? [];
      atuais.push(fn);
      listeners.set(tipo, atuais);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, listeners };
}

function chaveDe(entrada: string | Request): string {
  return typeof entrada === "string"
    ? new URL(entrada).href
    : new URL(entrada.url).href;
}

type Entrada = { readonly req: Request; readonly res: Response };
type ConteudoInicial = Record<string, ReadonlyArray<string | Request>>;

/**
 * `caches` falso que guarda de verdade: um Map de URL → {Request, Response}
 * por nome. Guarda o REQUEST inteiro (com headers), não só a URL: o Cache
 * real devolve em `keys()` o Request que foi gravado, e o SW antigo gravava
 * Request com `Authorization: Bearer` — a purga tem de enxergar esse header.
 * `gravacoes` registra todo `put`, em ordem, para os testes de corrida.
 */
function criarCachesFalso(conteudoInicial: ConteudoInicial = {}) {
  const gavetas = new Map<string, Map<string, Entrada>>();
  for (const [nome, entradas] of Object.entries(conteudoInicial)) {
    gavetas.set(
      nome,
      new Map(
        entradas.map((e) => {
          const req = typeof e === "string" ? new Request(e) : e;
          return [chaveDe(req), { req, res: new Response("velho") }];
        }),
      ),
    );
  }
  const abertos: string[] = [];
  const gravacoes: Array<{ readonly cache: string; readonly url: string }> = [];

  function gaveta(nome: string) {
    let g = gavetas.get(nome);
    if (!g) {
      g = new Map();
      gavetas.set(nome, g);
    }
    return g;
  }

  function criarCache(nome: string) {
    const g = gaveta(nome);
    return {
      match: vi.fn(async (req: string | Request) => g.get(chaveDe(req))?.res),
      put: vi.fn(async (req: string | Request, res: Response) => {
        const pedido = typeof req === "string" ? new Request(req) : req;
        gravacoes.push({ cache: nome, url: chaveDe(pedido) });
        g.set(chaveDe(pedido), { req: pedido, res });
      }),
      addAll: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(async () => Array.from(g.values()).map((e) => e.req)),
      delete: vi.fn(async (req: string | Request) => g.delete(chaveDe(req))),
    };
  }

  const cachesFalso = {
    open: vi.fn(async (nome: string) => {
      abertos.push(nome);
      return criarCache(nome);
    }),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn(async () => Array.from(gavetas.keys())),
    delete: vi.fn(async (nome: string) => gavetas.delete(nome)),
  };

  const urlsEm = (nome: string) => Array.from(gavetas.get(nome)?.keys() ?? []);
  return { cachesFalso, urlsEm, abertos, gravacoes };
}

/** Mesma régua da produção, escrita à parte para o teste não se auto-provar. */
function ehPublico(href: string): boolean {
  const u = new URL(href);
  return (
    !u.searchParams.has("token") &&
    (u.pathname.startsWith("/storage/v1/object/public/") ||
      u.pathname.startsWith("/storage/v1/render/image/public/"))
  );
}

async function esvaziarFila(vezes = 20) {
  for (let i = 0; i < vezes; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("src/sw/sw.ts — a gaveta de imagens só guarda arquivo público (R12)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importarSw(conteudoInicial: ConteudoInicial = {}) {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso, urlsEm, abertos, gravacoes } =
      criarCachesFalso(conteudoInicial);
    const fetchMock = vi.fn(
      async (_alvo: RequestInfo | URL) =>
        new Response("bytes-da-imagem", { status: 200 }),
    );

    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", cachesFalso);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );

    await import("@/sw/sw");

    const um = (tipo: string) => {
      const lista = listeners.get(tipo) ?? [];
      expect(lista.length).toBe(1);
      return lista[0];
    };
    return { um, fetchMock, urlsEm, abertos, cachesFalso, gravacoes };
  }

  function eventoDeFetch(request: Request) {
    return { request, respondWith: vi.fn(), waitUntil: vi.fn() };
  }

  describe("fetch", () => {
    it.each([
      ["objeto público", PUBLICO_OBJETO],
      ["render público", PUBLICO_RENDER],
    ])("%s: intercepta e guarda na gaveta", async (_nome, url) => {
      const { um, urlsEm } = await importarSw();
      const evento = eventoDeFetch(new Request(url));

      um("fetch")(evento);

      expect(evento.respondWith).toHaveBeenCalledTimes(1);
      const resposta = await evento.respondWith.mock.calls[0][0];
      expect(resposta.status).toBe(200);
      await esvaziarFila();
      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(url).href]);
    });

    it.each(PRIVADOS)(
      "%s: NÃO intercepta (sem respondWith), NÃO busca pelo SW e NÃO guarda",
      async (_nome, url) => {
        const { um, fetchMock, urlsEm, abertos } = await importarSw();
        const evento = eventoDeFetch(new Request(url));

        um("fetch")(evento);
        await esvaziarFila();

        expect(evento.respondWith).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(abertos).not.toContain(IMAGE_CACHE_NAME);
        expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([]);
      },
    );

    it("caminho público pedido COM header Authorization: não intercepta nem guarda", async () => {
      const { um, fetchMock, urlsEm } = await importarSw();
      const evento = eventoDeFetch(
        new Request(PUBLICO_OBJETO, {
          headers: { Authorization: "Bearer token-do-cliente" },
        }),
      );

      um("fetch")(evento);
      await esvaziarFila();

      expect(evento.respondWith).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([]);
    });

    it("endereço assinado JÁ na gaveta (versão antiga do SW) não é servido dela", async () => {
      const assinado = PRIVADOS[0][1];
      const { um } = await importarSw({ [IMAGE_CACHE_NAME]: [assinado] });
      const evento = eventoDeFetch(new Request(assinado));

      um("fetch")(evento);

      expect(evento.respondWith).not.toHaveBeenCalled();
    });
  });

  describe("activate", () => {
    it("apaga da gaveta as entradas legadas que não são públicas e mantém as públicas", async () => {
      const privados = PRIVADOS.map(([, url]) => url);
      const naoStorage = `${SUPA}/rest/v1/products?select=*`;
      const { um, urlsEm } = await importarSw({
        [IMAGE_CACHE_NAME]: [
          PUBLICO_OBJETO,
          ...privados,
          PUBLICO_RENDER,
          naoStorage,
        ],
        "app-cache-velho": ["https://loja.exemplo.com/assets/a.js"],
      });
      const waitUntil = vi.fn();

      um("activate")({ waitUntil });
      await Promise.all(waitUntil.mock.calls.map((c) => c[0]));

      expect(urlsEm(IMAGE_CACHE_NAME).sort()).toEqual(
        [new URL(PUBLICO_OBJETO).href, new URL(PUBLICO_RENDER).href].sort(),
      );
      // A purga de versões velhas continua valendo junto.
      expect(urlsEm("app-cache-velho")).toEqual([]);
    });

    it("entrada legada em caminho público gravada COM Authorization é apagada; a mesma URL sem Authorization fica", async () => {
      const comBearer = new Request(PUBLICO_OBJETO, {
        headers: { Authorization: "Bearer token-de-quem-saiu" },
      });
      const { um, urlsEm } = await importarSw({
        [IMAGE_CACHE_NAME]: [comBearer, PUBLICO_RENDER],
      });
      const waitUntil = vi.fn();

      um("activate")({ waitUntil });
      await Promise.all(waitUntil.mock.calls.map((c) => c[0]));

      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(PUBLICO_RENDER).href]);
    });

    it("falha ao ler a gaveta não derruba o activate", async () => {
      const { um, cachesFalso } = await importarSw({
        [IMAGE_CACHE_NAME]: [PRIVADOS[0][1]],
      });
      const original = cachesFalso.open.getMockImplementation()!;
      cachesFalso.open.mockImplementation(async (nome: string) => {
        const cache = await original(nome);
        if (nome === IMAGE_CACHE_NAME) {
          cache.keys = vi.fn().mockRejectedValue(new Error("disco"));
        }
        return cache;
      });
      const waitUntil = vi.fn();

      um("activate")({ waitUntil });

      await expect(
        Promise.all(waitUntil.mock.calls.map((c) => c[0])),
      ).resolves.toBeDefined();
    });
  });

  describe("mensagem de purga (logout)", () => {
    it("PURGAR_ARQUIVOS_PRIVADOS apaga só o que não é público", async () => {
      const { um, urlsEm } = await importarSw({
        [IMAGE_CACHE_NAME]: [PUBLICO_OBJETO, PRIVADOS[0][1], PRIVADOS[2][1]],
      });
      const waitUntil = vi.fn();

      um("message")({ data: { type: "PURGAR_ARQUIVOS_PRIVADOS" }, waitUntil });
      await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
      await esvaziarFila();

      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(PUBLICO_OBJETO).href]);
    });

    it("a mensagem de purga nunca busca nem guarda URL que venha nela", async () => {
      const { um, fetchMock, urlsEm } = await importarSw({
        [IMAGE_CACHE_NAME]: [],
      });
      const waitUntil = vi.fn();

      um("message")({
        data: {
          type: "PURGAR_ARQUIVOS_PRIVADOS",
          url: PUBLICO_OBJETO,
          urls: [PUBLICO_OBJETO, PRIVADOS[0][1]],
        },
        waitUntil,
      });
      await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
      await esvaziarFila();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([]);
    });

    it("logout apaga entrada pública gravada COM Authorization e mantém a pública sem", async () => {
      const comBearer = new Request(PUBLICO_RENDER, {
        headers: { Authorization: "Bearer token-de-quem-saiu" },
      });
      const { um, urlsEm } = await importarSw({
        [IMAGE_CACHE_NAME]: [PUBLICO_OBJETO, comBearer],
      });
      const waitUntil = vi.fn();

      um("message")({ data: { type: "PURGAR_ARQUIVOS_PRIVADOS" }, waitUntil });
      await Promise.all(waitUntil.mock.calls.map((c) => c[0]));

      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(PUBLICO_OBJETO).href]);
    });

    it("tipo desconhecido não apaga nada", async () => {
      const { um, urlsEm } = await importarSw({
        [IMAGE_CACHE_NAME]: [PRIVADOS[0][1]],
      });

      um("message")({ data: { type: "PURGAR_TUDO_QUE_EU_QUISER" } });
      await esvaziarFila();

      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(PRIVADOS[0][1]).href]);
    });
  });

  describe("corrida: download em voo no instante do logout", () => {
    it("fetch privado e público pendentes durante a purga: depois do logout nenhum put privado acontece", async () => {
      const { um, fetchMock, urlsEm, gravacoes } = await importarSw();
      // A rede só responde quando o teste mandar — reproduz o download que
      // ainda está em voo quando a pessoa toca em "Sair".
      const pendentes: Array<() => void> = [];
      fetchMock.mockImplementation(
        (_alvo: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            pendentes.push(() =>
              resolve(new Response("bytes-da-imagem", { status: 200 })),
            );
          }),
      );
      const assinado = PRIVADOS[0][1];
      const eventoPrivado = eventoDeFetch(new Request(assinado));
      const eventoPublico = eventoDeFetch(new Request(PUBLICO_OBJETO));
      um("fetch")(eventoPrivado);
      um("fetch")(eventoPublico);
      await esvaziarFila();

      // Logout com os dois downloads ainda pendentes.
      const waitUntil = vi.fn();
      um("message")({ data: { type: "PURGAR_ARQUIVOS_PRIVADOS" }, waitUntil });
      await Promise.all(waitUntil.mock.calls.map((c) => c[0]));
      const gravacoesAteOLogout = gravacoes.length;

      // A rede responde DEPOIS do logout.
      for (const responder of pendentes) responder();
      await esvaziarFila();

      const depoisDoLogout = gravacoes.slice(gravacoesAteOLogout);
      expect(
        depoisDoLogout.filter(
          (g) => !ehPublico(g.url) && g.cache === IMAGE_CACHE_NAME,
        ),
      ).toEqual([]);
      expect(gravacoes.map((g) => g.url)).not.toContain(new URL(assinado).href);
      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(PUBLICO_OBJETO).href]);
      // O privado nem passou pelo SW: o navegador o busca sozinho.
      expect(eventoPrivado.respondWith).not.toHaveBeenCalled();
    });
  });

  describe("WARM_CACHE (pré-aquecimento pedido pela página)", () => {
    it("aquece só arquivo público do Supabase; assinado, autenticado e REST ficam de fora", async () => {
      const { um, fetchMock, urlsEm } = await importarSw();
      const privados = PRIVADOS.map(([, url]) => url);

      um("message")({
        data: {
          type: "WARM_CACHE",
          urls: [
            PUBLICO_OBJETO,
            ...privados,
            `${SUPA}/rest/v1/orders?select=*`,
          ],
        },
      });
      await esvaziarFila();

      const buscados = fetchMock.mock.calls.map(
        (c) => new URL(String(c[0])).href,
      );
      expect(buscados).toEqual([new URL(PUBLICO_OBJETO).href]);
      expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(PUBLICO_OBJETO).href]);
    });
  });
});
