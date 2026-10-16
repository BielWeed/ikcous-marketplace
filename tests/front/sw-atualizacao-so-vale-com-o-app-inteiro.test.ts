import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — o app novo só vale se chegou INTEIRO (revisão da 1.5.33,
 * 16/10/2026).
 *
 * Dois defeitos, o mesmo cenário real: a pessoa atualiza o app e perde a rede.
 *  1. O `install` engolia a falha do `addAll` e terminava "com sucesso" com o
 *     cache novo pela metade; o `activate` então apagava o cache da versão
 *     anterior (a única cópia completa do app).
 *  2. O precache só traz o `/index.html` CRU (sem a ficha da loja), que o
 *     fallback de navegação recusa; as páginas COM ficha viviam no cache
 *     velho, apagado no `activate`. Offline logo depois de atualizar:
 *     "Sem conexão", com o app funcionando minutos antes.
 *
 * O cache aqui é um Cache Storage em memória (mesma semântica do navegador:
 * `addAll` tudo-ou-nada, `match` varre os caches na ordem de criação), não um
 * dublê que devolve o que o teste manda.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const VERSAO_NOVA = "2.0.0";
const CACHE_NOVO = `app-cache-${VERSAO_NOVA}`;
const CACHE_VELHO = "app-cache-1.0.0";

const MANIFESTO = [
  { url: "index.html" },
  { url: "offline.html" },
  { url: "assets/index-ABC.js" },
  { url: "assets/vendor-DEF.js" },
];

function ficha(corpo = "") {
  return `<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script><script type="module" src="/assets/index-ABC.js"></script><link rel="modulepreload" href="/assets/vendor-DEF.js"></head><body>${corpo}</body></html>`;
}

function html(texto: string, init: ResponseInit = {}) {
  return new Response(texto, {
    status: 200,
    headers: { "content-type": "text/html" },
    ...init,
  });
}

/** Cache Storage em memória: nome -> (caminho -> resposta). */
function criarArmazem() {
  const armazem = new Map<string, Map<string, Response>>();
  const caminho = (chave: string | Request) =>
    new URL(typeof chave === "string" ? chave : chave.url, ORIGEM).pathname;

  function abrir(nome: string) {
    if (!armazem.has(nome)) armazem.set(nome, new Map());
    const dados = armazem.get(nome) as Map<string, Response>;
    return {
      dados,
      async put(chave: string | Request, resposta: Response) {
        dados.set(caminho(chave), resposta);
      },
      async match(chave: string | Request) {
        return dados.get(caminho(chave))?.clone();
      },
      async keys() {
        return [...dados.keys()].map((c) => new Request(`${ORIGEM}${c}`));
      },
      async add(url: string) {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new TypeError(`bad-response ${url}`);
        dados.set(caminho(url), resposta);
      },
      // Tudo-ou-nada, como a especificação: se UM arquivo falha, nenhum entra.
      async addAll(urls: string[]) {
        const respostas = await Promise.all(
          urls.map(async (url) => {
            const resposta = await fetch(url);
            if (!resposta.ok) throw new TypeError(`bad-response ${url}`);
            return [url, resposta] as const;
          }),
        );
        for (const [url, resposta] of respostas) {
          dados.set(caminho(url), resposta);
        }
      },
      async delete(chave: string | Request) {
        return dados.delete(caminho(chave));
      },
    };
  }

  const cachesFalso = {
    open: vi.fn(async (nome: string) => abrir(nome)),
    keys: vi.fn(async () => [...armazem.keys()]),
    has: vi.fn(async (nome: string) => armazem.has(nome)),
    delete: vi.fn(async (nome: string) => armazem.delete(nome)),
    // Como o navegador: varre os caches na ORDEM DE CRIAÇÃO.
    match: vi.fn(async (chave: string | Request) => {
      for (const dados of armazem.values()) {
        const achada = dados.get(caminho(chave));
        if (achada) return achada.clone();
      }
      return undefined;
    }),
  };
  return { armazem, cachesFalso, abrir };
}

interface Cenario {
  rede: Map<string, () => Response | Promise<Response>>;
  online: boolean;
}

async function montar(
  opcoes: {
    cenario?: Partial<Cenario>;
    jaExistem?: Record<string, Record<string, Response>>;
    manifesto?: { url: string }[];
  } = {},
) {
  vi.resetModules();
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: ORIGEM },
    __WB_MANIFEST: opcoes.manifesto ?? MANIFESTO,
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null },
    skipWaiting: vi.fn(),
  };
  const { armazem, cachesFalso, abrir } = criarArmazem();
  for (const [nome, entradas] of Object.entries(opcoes.jaExistem ?? {})) {
    const cache = abrir(nome);
    for (const [c, r] of Object.entries(entradas)) cache.dados.set(c, r);
  }
  const cenario: Cenario = {
    rede: new Map(),
    online: true,
    ...(opcoes.cenario ?? {}),
  };
  const buscas: string[] = [];
  const fetchFalso = vi.fn(async (entrada: string | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada.url;
    const c = new URL(url, ORIGEM).pathname;
    buscas.push(c);
    if (!cenario.online) throw new TypeError("Failed to fetch");
    const fabrica = cenario.rede.get(c);
    if (!fabrica) return new Response("nao encontrado", { status: 404 });
    return fabrica();
  });

  vi.stubGlobal("__APP_VERSION__", VERSAO_NOVA);
  vi.stubGlobal("self", selfFalso);
  vi.stubGlobal("caches", cachesFalso);
  vi.stubGlobal("fetch", fetchFalso);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  await import("@/sw/sw");

  async function rodar(tipo: "install" | "activate") {
    const promessas: Promise<unknown>[] = [];
    (listeners.get(tipo) ?? [])[0]({
      waitUntil: (p: Promise<unknown>) => promessas.push(p),
    });
    return Promise.all(promessas);
  }

  async function navegar(caminho: string) {
    const respondWith = vi.fn();
    const waitUntil = vi.fn();
    // `mode: "navigate"` não pode ser passado ao construtor fora do navegador.
    const request = new Request(`${ORIGEM}${caminho}`);
    Object.defineProperty(request, "mode", { value: "navigate" });
    (listeners.get("fetch") ?? [])[0]({ request, respondWith, waitUntil });
    expect(respondWith).toHaveBeenCalledTimes(1);
    return (await respondWith.mock.calls[0][0]) as Response;
  }

  return { armazem, cenario, buscas, rodar, navegar, selfFalso };
}

/** Só os caches de versão do app (o activate também abre os dois fixos). */
function cachesDoApp(armazem: Map<string, unknown>) {
  return [...armazem.keys()].filter((nome) => nome.startsWith("app-cache-"));
}

/** A rede inteira do build novo no ar: todo o manifesto + a página inicial. */
function redeDoBuildNovo(
  pagina: () => Response = () => html(ficha("novo")),
): Cenario["rede"] {
  const rede: Cenario["rede"] = new Map();
  for (const { url } of MANIFESTO) {
    rede.set(`/${url}`, () =>
      url === "index.html"
        ? html("<!doctype html><html><body>cru</body></html>")
        : new Response(`conteudo de ${url}`, { status: 200 }),
    );
  }
  rede.set("/", pagina);
  return rede;
}

const VELHO_COMPLETO = {
  [CACHE_VELHO]: {
    "/assets/index-OLD.js": new Response("js velho"),
    "/produto/1": html(ficha("produto 1 visitado")),
  },
};

describe("src/sw/sw.ts — install só vale com o precache inteiro", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("arquivo que falha de forma persistente derruba o install e o cache pela metade some", async () => {
    const rede = redeDoBuildNovo();
    rede.set("/assets/vendor-DEF.js", () => new Response("", { status: 500 }));
    const { rodar, armazem } = await montar({
      cenario: { rede },
      jaExistem: VELHO_COMPLETO,
    });

    await expect(rodar("install")).rejects.toThrow(/Precache incompleto/);

    // O app antigo segue inteiro e o cache novo não ficou visível para ele.
    expect([...armazem.keys()]).toEqual([CACHE_VELHO]);
    expect(armazem.get(CACHE_VELHO)?.size).toBe(2);
  });

  it("JS ausente do deploy que o catch-all respondeu como HTML 200 derruba o install", async () => {
    const rede = redeDoBuildNovo();
    rede.set("/assets/vendor-DEF.js", () => html(ficha("catch-all")));
    const { rodar, armazem } = await montar({
      cenario: { rede },
      jaExistem: VELHO_COMPLETO,
    });

    await expect(rodar("install")).rejects.toThrow(/vendor-DEF/);

    expect(cachesDoApp(armazem)).toEqual([CACHE_VELHO]);
  });

  it("falha passageira em UM arquivo é curada arquivo a arquivo e o install completa", async () => {
    const rede = redeDoBuildNovo();
    let tentativas = 0;
    rede.set("/assets/vendor-DEF.js", () => {
      tentativas++;
      // Cai só na rodada do lote (addAll); nas tentativas seguintes responde.
      return tentativas === 1
        ? new Response("", { status: 503 })
        : new Response("vendor ok", { status: 200 });
    });
    const { rodar, armazem } = await montar({ cenario: { rede } });

    await expect(rodar("install")).resolves.toBeDefined();

    const novo = armazem.get(CACHE_NOVO);
    expect([...(novo?.keys() ?? [])].sort()).toEqual(
      [
        "/",
        "/assets/index-ABC.js",
        "/assets/vendor-DEF.js",
        "/index.html",
        "/offline.html",
      ].sort(),
    );
  });

  it("não apaga um cache da MESMA versão que já existia antes deste install", async () => {
    const rede = redeDoBuildNovo();
    rede.set("/assets/vendor-DEF.js", () => new Response("", { status: 500 }));
    const { rodar, armazem } = await montar({
      cenario: { rede },
      jaExistem: { [CACHE_NOVO]: { "/index.html": html("ja estava") } },
    });

    await expect(rodar("install")).rejects.toThrow(/Precache incompleto/);

    expect(armazem.has(CACHE_NOVO)).toBe(true);
  });
});

describe("src/sw/sw.ts — activate não apaga o app antigo sem o novo inteiro", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cache novo incompleto (despejado pelo navegador): o antigo fica", async () => {
    const { rodar, armazem } = await montar({
      jaExistem: {
        ...VELHO_COMPLETO,
        [CACHE_NOVO]: { "/index.html": html("so um arquivo") },
      },
    });

    await rodar("activate");

    expect(armazem.has(CACHE_VELHO)).toBe(true);
    expect(armazem.has(CACHE_NOVO)).toBe(true);
  });

  it("cache novo despejado em parte e rede de volta: o activate baixa o que falta e então apaga o antigo", async () => {
    const { rodar, armazem, buscas } = await montar({
      cenario: { rede: redeDoBuildNovo() },
      jaExistem: {
        ...VELHO_COMPLETO,
        [CACHE_NOVO]: { "/index.html": html("so um arquivo") },
      },
    });

    await rodar("activate");

    expect(buscas).toContain("/assets/vendor-DEF.js");
    expect(cachesDoApp(armazem)).toEqual([CACHE_NOVO]);
    expect(armazem.get(CACHE_NOVO)?.has("/assets/vendor-DEF.js")).toBe(true);
  });

  it("controle: cache novo inteiro apaga o antigo, como sempre", async () => {
    const novo: Record<string, Response> = {};
    for (const { url } of MANIFESTO) novo[`/${url}`] = new Response(url);
    const { rodar, armazem } = await montar({
      jaExistem: { ...VELHO_COMPLETO, [CACHE_NOVO]: novo },
    });

    await rodar("activate");

    expect(cachesDoApp(armazem)).toEqual([CACHE_NOVO]);
  });
});

describe("src/sw/sw.ts — atualizou e ficou sem rede", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function atualizarEFicarOffline(
    pagina?: () => Response,
    jaExistem = VELHO_COMPLETO,
  ) {
    const m = await montar({
      cenario: { rede: redeDoBuildNovo(pagina) },
      jaExistem,
    });
    await m.rodar("install");
    await m.rodar("activate");
    m.cenario.online = false;
    return m;
  }

  it("a rota nunca visitada abre com a ficha da loja, não 'Sem conexão'", async () => {
    const { navegar, armazem } = await atualizarEFicarOffline();

    // O cache da versão anterior (com as páginas visitadas) já foi embora.
    expect(cachesDoApp(armazem)).toEqual([CACHE_NOVO]);

    const resposta = await navegar("/pedido/123");
    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain('id="ikcous-loja"');
  });

  it("porteiro fora do ar só no install: o activate tenta de novo antes de apagar as páginas antigas", async () => {
    const m = await montar({
      cenario: {
        rede: redeDoBuildNovo(() => new Response("fora", { status: 503 })),
      },
      jaExistem: VELHO_COMPLETO,
    });
    await m.rodar("install");
    expect(m.armazem.get(CACHE_NOVO)?.has("/")).toBe(false);

    // O porteiro volta antes da ativação.
    m.cenario.rede.set("/", () => html(ficha("novo")));
    await m.rodar("activate");
    m.cenario.online = false;

    expect(m.armazem.get(CACHE_NOVO)?.has("/")).toBe(true);
    const resposta = await m.navegar("/pedido/123");
    expect(await resposta.text()).toContain('id="ikcous-loja"');
  });

  it("página inicial sem ficha (porteiro fora do ar no install) não é guardada: segue recusando o HTML cru", async () => {
    const { navegar, armazem } = await atualizarEFicarOffline(() =>
      html("<!doctype html><html><body>sem ficha</body></html>"),
    );

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
    const resposta = await navegar("/pedido/123");
    // O fallback recusa o /index.html cru: cai na página "Sem internet".
    const corpo = await resposta.text();
    expect(corpo).not.toContain("cru");
    expect(corpo).toContain("offline.html");
  });

  it("página inicial de um deploy mais novo (arquivos fora do precache) não é guardada", async () => {
    const { armazem } = await atualizarEFicarOffline(() =>
      html(
        `<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script><script type="module" src="/assets/index-NOVISSIMO.js"></script></head></html>`,
      ),
    );

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
  });

  it("página inicial que veio de um redirecionamento não é guardada", async () => {
    const { armazem } = await atualizarEFicarOffline(() => {
      const resposta = html(ficha("redirecionada"));
      Object.defineProperty(resposta, "redirected", { value: true });
      return resposta;
    });

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
  });
});
