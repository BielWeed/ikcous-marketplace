import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — o ramo "entrega a cópia guardada e atualiza em segundo
 * plano" (stale-while-revalidate dos assets) não guarda HTML no lugar de um
 * arquivo que não é página.
 *
 * O defeito medido: depois de uma release, o aparelho ainda pede o chunk
 * ANTIGO (`/assets/index-VELHO.js`). A hospedagem não o tem mais e respondia
 * 200 com o `index.html` do app (a reescrita `/(.*)` do vercel.json cobria
 * `/assets/`). O ramo guardava QUALQUER 200 e trocava o JavaScript bom pelo
 * HTML: a abertura seguinte, servida pelo service worker antigo, recebia HTML
 * no lugar do script e o app travava na tela de carregamento. A conferência
 * de `content-type` já existia na instalação e no reparo do precache; faltou
 * aqui.
 *
 * Mesmo molde de `sw-revalidacao-espera-a-atualizacao-que-esta-instalando.test.ts`:
 * `sw.ts` registra os listeners como efeito colateral do import, então o self
 * é falso e a importação é feita dentro de cada teste — do `sw.ts` REAL.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const HTML_DO_APP = "<!doctype html><html><title>app</title></html>";
const JS_VELHO = "console.log('app antigo');";
const JS_NOVO = "console.log('app novo');";

// Response montada à mão tem `type` "default"; o ramo só guarda "basic"/"cors".
// Na rede de verdade a resposta same-origin é "basic", então o dublê também é.
class RespostaBasica extends Response {
  get type(): ResponseType {
    return "basic";
  }
  clone(): Response {
    const copia = super.clone();
    Object.setPrototypeOf(copia, RespostaBasica.prototype);
    return copia;
  }
}

// Uma gaveta só, qualquer que seja o nome pedido a `caches.open`: o teste fala
// do que está guardado, não de como a versão batiza o cache.
class GavetaFalsa {
  private mapa = new Map<string, Response>();
  private chave(r: Request | string): string {
    return new URL(typeof r === "string" ? r : r.url, ORIGEM).pathname;
  }
  async match(r: Request | string) {
    return this.mapa.get(this.chave(r))?.clone();
  }
  async put(r: Request | string, resposta: Response) {
    this.mapa.set(this.chave(r), resposta.clone());
  }
  async keys() {
    return [...this.mapa.keys()].map((p) => new Request(ORIGEM + p));
  }
  async delete(r: Request | string) {
    return this.mapa.delete(this.chave(r));
  }
  async addAll() {}
  async add() {}
}

function montar(rede: () => Promise<Response>) {
  const listeners = new Map<string, Listener[]>();
  const gaveta = new GavetaFalsa();
  vi.stubGlobal("self", {
    location: { origin: ORIGEM },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null, installing: null },
    skipWaiting: vi.fn(),
  });
  vi.stubGlobal("caches", {
    open: async () => gaveta,
    match: (r: Request | string) => gaveta.match(r),
    keys: async () => [],
    delete: async () => true,
  });
  vi.stubGlobal("fetch", vi.fn(rede));
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  return { listeners, gaveta };
}

async function pedirAsset(listeners: Map<string, Listener[]>, caminho: string) {
  let resposta: Promise<Response> | undefined;
  (listeners.get("fetch") ?? [])[0]({
    request: new Request(ORIGEM + caminho),
    respondWith: (p: Promise<Response>) => {
      resposta = p;
    },
    waitUntil: () => {},
  });
  const r = await resposta;
  // O put é encadeado em promessas soltas: deixa a fila esvaziar.
  for (let i = 0; i < 5; i++) await new Promise((ok) => setTimeout(ok, 0));
  if (!r) throw new Error("o service worker não chamou respondWith");
  return { tipo: r.headers.get("content-type") ?? "", corpo: await r.text() };
}

const htmlNoLugarDoAsset = () =>
  Promise.resolve(
    new RespostaBasica(HTML_DO_APP, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
      },
    }),
  );

const jsGuardado = () =>
  new RespostaBasica(JS_VELHO, {
    status: 200,
    headers: { "content-type": "application/javascript" },
  });

describe("sw.ts — asset que a hospedagem devolve como HTML não entra na gaveta", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("chunk antigo guardado + hospedagem devolvendo HTML: o JavaScript bom continua na gaveta e é servido na abertura seguinte", async () => {
    const { listeners, gaveta } = montar(htmlNoLugarDoAsset);
    await gaveta.put("/assets/index-VELHO.js", jsGuardado());
    await import("@/sw/sw");

    const primeira = await pedirAsset(listeners, "/assets/index-VELHO.js");
    expect(primeira.tipo).toBe("application/javascript");

    const guardado = await gaveta.match("/assets/index-VELHO.js");
    expect(guardado?.headers.get("content-type")).toBe(
      "application/javascript",
    );
    expect(await guardado?.text()).toBe(JS_VELHO);

    const segunda = await pedirAsset(listeners, "/assets/index-VELHO.js");
    expect(segunda.tipo).toBe("application/javascript");
    expect(segunda.corpo).toBe(JS_VELHO);
  });

  it("chunk que nunca esteve na gaveta (ex.: tela do painel) + HTML da hospedagem: nada é guardado", async () => {
    const { listeners, gaveta } = montar(htmlNoLugarDoAsset);
    await import("@/sw/sw");

    await pedirAsset(listeners, "/assets/AdminOrdersView-VELHO.js");

    expect(
      await gaveta.match("/assets/AdminOrdersView-VELHO.js"),
    ).toBeUndefined();
  });

  it("a conferência não depende de maiúsculas no cabeçalho (Text/HTML também fica de fora)", async () => {
    const { listeners, gaveta } = montar(() =>
      Promise.resolve(
        new RespostaBasica(HTML_DO_APP, {
          status: 200,
          headers: { "content-type": "Text/HTML" },
        }),
      ),
    );
    await import("@/sw/sw");

    await pedirAsset(listeners, "/assets/AdminOrdersView-VELHO.js");

    expect(
      await gaveta.match("/assets/AdminOrdersView-VELHO.js"),
    ).toBeUndefined();
  });

  // O outro lado da borda: a trava não pode matar a atualização em segundo
  // plano de quem é arquivo de verdade.
  it("hospedagem devolvendo o arquivo de verdade (JavaScript novo): a gaveta é atualizada como sempre", async () => {
    const { listeners, gaveta } = montar(() =>
      Promise.resolve(
        new RespostaBasica(JS_NOVO, {
          status: 200,
          headers: { "content-type": "application/javascript" },
        }),
      ),
    );
    await gaveta.put("/assets/index-VELHO.js", jsGuardado());
    await import("@/sw/sw");

    await pedirAsset(listeners, "/assets/index-VELHO.js");

    const guardado = await gaveta.match("/assets/index-VELHO.js");
    expect(await guardado?.text()).toBe(JS_NOVO);
  });

  it("resposta 200 sem cabeçalho content-type continua sendo guardada (a trava é só para HTML)", async () => {
    const { listeners, gaveta } = montar(() => {
      const semTipo = new RespostaBasica(null, { status: 200 });
      return Promise.resolve(semTipo);
    });
    await import("@/sw/sw");

    await pedirAsset(listeners, "/assets/sem-tipo.bin");

    expect(await gaveta.match("/assets/sem-tipo.bin")).toBeDefined();
  });
});
