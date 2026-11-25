import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — as FRONTEIRAS do `install`, do `activate` e da navegação
 * lenta que os testes vizinhos deixavam soltas (caça por mutação, 25/11/2026).
 *
 * Cada caso aqui nasceu de um defeito de uma linha plantado de propósito no
 * service worker que NENHUM teste existente derrubava:
 *  - o prazo de 5 s da rede (trocar por 4999/5001 passava);
 *  - o texto do erro de precache incompleto (quantos faltaram, quais);
 *  - `.htm` tratado como se fosse arquivo que chegou "como HTML por engano";
 *  - página inicial com erro do servidor (500) guardada como se fosse boa;
 *  - HTML que cita um arquivo de `<link href>` fora do precache guardado;
 *  - o `activate` apagando o app antigo com UM arquivo do novo ainda faltando
 *    ou com o cache novo ilegível;
 *  - o reparo do precache mexendo no que nem chegou a baixar / deixando HTML
 *    no lugar do JavaScript.
 *
 * O Cache Storage é em memória (mesma semântica do navegador), como nos outros
 * testes do service worker.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const VERSAO_NOVA = "3.0.0";
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
  const apagados: string[] = [];
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
        apagados.push(`${nome}:${caminho(chave)}`);
        return dados.delete(caminho(chave));
      },
    };
  }

  const cachesFalso = {
    open: vi.fn(async (nome: string) => abrir(nome)),
    keys: vi.fn(async () => [...armazem.keys()]),
    has: vi.fn(async (nome: string) => armazem.has(nome)),
    delete: vi.fn(async (nome: string) => armazem.delete(nome)),
    match: vi.fn(async (chave: string | Request) => {
      for (const dados of armazem.values()) {
        const achada = dados.get(caminho(chave));
        if (achada) return achada.clone();
      }
      return undefined;
    }),
  };
  return { armazem, apagados, cachesFalso, abrir };
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
    abrirFalhaPara?: string;
  } = {},
) {
  vi.resetModules();
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: ORIGEM, hostname: "loja.exemplo.com" },
    __WB_MANIFEST: opcoes.manifesto ?? MANIFESTO,
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null },
    skipWaiting: vi.fn(),
  };
  const { armazem, apagados, cachesFalso, abrir } = criarArmazem();
  for (const [nome, entradas] of Object.entries(opcoes.jaExistem ?? {})) {
    const cache = abrir(nome);
    for (const [c, r] of Object.entries(entradas)) cache.dados.set(c, r);
  }
  if (opcoes.abrirFalhaPara) {
    const abrirOriginal = cachesFalso.open.getMockImplementation() as (
      nome: string,
    ) => Promise<unknown>;
    cachesFalso.open.mockImplementation(async (nome: string) => {
      if (nome === opcoes.abrirFalhaPara) throw new Error("cache ilegível");
      return abrirOriginal(nome) as never;
    });
  }
  const cenario: Cenario = {
    rede: new Map(),
    online: true,
    ...(opcoes.cenario ?? {}),
  };
  const sinais = new Map<string, AbortSignal | undefined>();
  const fetchFalso = vi.fn(
    async (entrada: string | Request, init?: RequestInit) => {
      const url = typeof entrada === "string" ? entrada : entrada.url;
      const c = new URL(url, ORIGEM).pathname;
      sinais.set(c, init?.signal ?? undefined);
      if (!cenario.online) throw new TypeError("Failed to fetch");
      const fabrica = cenario.rede.get(c);
      if (!fabrica) return new Response("nao encontrado", { status: 404 });
      return fabrica();
    },
  );

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

  function iniciarNavegacao(caminhoDaRota: string) {
    const respondWith = vi.fn();
    const waitUntil = vi.fn();
    const request = new Request(`${ORIGEM}${caminhoDaRota}`);
    Object.defineProperty(request, "mode", { value: "navigate" });
    (listeners.get("fetch") ?? [])[0]({ request, respondWith, waitUntil });
    expect(respondWith).toHaveBeenCalledTimes(1);
    return respondWith.mock.calls[0][0] as Promise<Response>;
  }

  return {
    armazem,
    apagados,
    cenario,
    sinais,
    rodar,
    iniciarNavegacao,
    selfFalso,
  };
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

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("src/sw/sw.ts — o prazo de 5 segundos da rede do install", () => {
  it("a página inicial e a ficha da loja do install pedem prazo de EXATAMENTE 5000 ms", async () => {
    const espia = vi.spyOn(AbortSignal, "timeout");
    const { rodar } = await montar({ cenario: { rede: redeDoBuildNovo() } });

    await rodar("install");

    const prazos = espia.mock.calls.map((chamada) => chamada[0]);
    // Uma para `/` (guardarPaginaInicialComFicha) e uma para /identidade.json.
    expect(prazos).toEqual([5000, 5000]);
  });

  it("sem AbortSignal.timeout (iOS 15) o aborto da página inicial cai em 5000 ms, nem antes nem depois", async () => {
    vi.useFakeTimers();
    const original = AbortSignal.timeout;
    (AbortSignal as { timeout?: unknown }).timeout = undefined;
    try {
      const { rodar, sinais } = await montar({
        cenario: { rede: redeDoBuildNovo() },
      });
      await rodar("install");

      const sinal = sinais.get("/") as AbortSignal;
      expect(sinal).toBeInstanceOf(AbortSignal);
      expect(sinal.aborted).toBe(false);

      vi.advanceTimersByTime(4999);
      expect(sinal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(sinal.aborted).toBe(true);
    } finally {
      AbortSignal.timeout = original;
    }
  });
});

describe("src/sw/sw.ts — a navegação lenta abre o app guardado no 5º segundo", () => {
  it("rota nunca visitada com a rede pendurada: nada abre em 4999 ms e o app guardado abre em 5000 ms", async () => {
    vi.useFakeTimers();
    const { iniciarNavegacao, cenario } = await montar({
      jaExistem: { [CACHE_NOVO]: { "/": html(ficha("app guardado")) } },
    });
    // A rede conecta e nunca responde.
    cenario.rede.set("/pedido/9", () => new Promise<Response>(() => {}));

    const resposta = iniciarNavegacao("/pedido/9");
    let resolvida: Response | null = null;
    void resposta.then((r) => {
      resolvida = r;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(resolvida).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(resolvida).not.toBeNull();
    expect(await (resolvida as unknown as Response).text()).toContain(
      "app guardado",
    );
  });
});

describe("src/sw/sw.ts — o erro de precache incompleto diz o que faltou", () => {
  it("lista só os 3 primeiros arquivos e conta o total certo", async () => {
    const rede = new Map<string, () => Response>();
    for (const { url } of MANIFESTO) {
      rede.set(`/${url}`, () => new Response("", { status: 500 }));
    }
    const { rodar } = await montar({ cenario: { rede } });

    await expect(rodar("install")).rejects.toThrow(
      "[SW] Precache incompleto: faltaram 4 de 4 arquivos (index.html, offline.html, assets/index-ABC.js). O app anterior continua valendo.",
    );
  });
});

describe("src/sw/sw.ts — o que o install aceita no precache", () => {
  it("página .htm legítima (responde HTML) não derruba o install, só arquivo que NÃO é página", async () => {
    const rede = redeDoBuildNovo();
    rede.set("/ajuda.htm", () => html("<!doctype html><p>ajuda</p>"));
    const { rodar, armazem } = await montar({
      cenario: { rede },
      manifesto: [...MANIFESTO, { url: "ajuda.htm" }],
    });

    await expect(rodar("install")).resolves.toBeDefined();

    expect(armazem.get(CACHE_NOVO)?.has("/ajuda.htm")).toBe(true);
  });

  it("página inicial com a ficha mas resposta de ERRO do servidor (500) não é guardada em '/'", async () => {
    const rede = redeDoBuildNovo(() =>
      html(ficha("erro do servidor"), { status: 500 }),
    );
    const { rodar, armazem } = await montar({ cenario: { rede } });

    await rodar("install");

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
  });

  it("página inicial que cita, por <link href>, um arquivo de /assets/ fora do precache não é guardada", async () => {
    const rede = redeDoBuildNovo(() =>
      html(
        `<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script><script type="module" src="/assets/index-ABC.js"></script><link rel="stylesheet" href="/assets/estilo-NOVO.css"></head></html>`,
      ),
    );
    const { rodar, armazem } = await montar({ cenario: { rede } });

    await rodar("install");

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
  });

  it("página inicial que cita, por <script src>, um arquivo de /assets/ fora do precache não é guardada", async () => {
    const rede = redeDoBuildNovo(() =>
      html(
        `<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script><link rel="modulepreload" href="/assets/vendor-DEF.js"><script type="module" src="/assets/index-NOVO.js"></script></head></html>`,
      ),
    );
    const { rodar, armazem } = await montar({ cenario: { rede } });

    await rodar("install");

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
  });
});

describe("src/sw/sw.ts — o activate só apaga o app antigo com o novo inteiro", () => {
  it("faltando UM só arquivo no cache novo e sem rede para baixá-lo: o app antigo fica", async () => {
    const quase: Record<string, Response> = {};
    for (const { url } of MANIFESTO.slice(0, 3)) {
      quase[`/${url}`] = new Response(url);
    }
    const { rodar, armazem, cenario } = await montar({
      jaExistem: { ...VELHO_COMPLETO, [CACHE_NOVO]: quase },
    });
    cenario.online = false;

    await rodar("activate");

    expect(armazem.has(CACHE_VELHO)).toBe(true);
    expect(armazem.get(CACHE_NOVO)?.has("/assets/vendor-DEF.js")).toBe(false);
  });

  it("cache novo ilegível (abrir falha): ninguém é apagado, o app antigo fica", async () => {
    const { rodar, armazem } = await montar({
      jaExistem: VELHO_COMPLETO,
      abrirFalhaPara: CACHE_NOVO,
    });

    await rodar("activate");

    expect(armazem.has(CACHE_VELHO)).toBe(true);
  });

  it("o reparo descarta o arquivo que o catch-all respondeu como HTML e, por isso, mantém o app antigo", async () => {
    const quase: Record<string, Response> = {
      "/index.html": new Response("cru"),
      "/offline.html": new Response("offline"),
      "/assets/index-ABC.js": new Response("js"),
    };
    const rede = redeDoBuildNovo();
    rede.set("/assets/vendor-DEF.js", () => html(ficha("catch-all")));
    const { rodar, armazem } = await montar({
      cenario: { rede },
      jaExistem: { ...VELHO_COMPLETO, [CACHE_NOVO]: quase },
    });

    await rodar("activate");

    expect(armazem.get(CACHE_NOVO)?.has("/assets/vendor-DEF.js")).toBe(false);
    expect(armazem.has(CACHE_VELHO)).toBe(true);
  });

  it("o reparo sem rede não tenta apagar o que nem chegou a ser baixado", async () => {
    const { rodar, apagados, cenario } = await montar({
      jaExistem: {
        ...VELHO_COMPLETO,
        [CACHE_NOVO]: { "/index.html": new Response("so um") },
      },
    });
    cenario.online = false;

    await rodar("activate");

    expect(apagados.filter((a) => a.startsWith(`${CACHE_NOVO}:`))).toEqual([]);
  });
});

describe("src/sw/sw.ts — o activate assume o controle das abas abertas", () => {
  it("chama clients.claim() uma vez, para a página já aberta passar a ser servida pelo worker novo", async () => {
    const { rodar, selfFalso } = await montar({
      cenario: { rede: redeDoBuildNovo() },
    });

    await rodar("activate");

    expect(selfFalso.clients.claim).toHaveBeenCalledTimes(1);
  });
});

describe("src/sw/sw.ts — sem rede, a página inicial guardada só serve COM a ficha da loja", () => {
  it("'/' guardada sem a ficha (HTML cru) nunca é entregue no lugar da loja: cai na página 'Sem internet'", async () => {
    const { iniciarNavegacao, cenario } = await montar({
      jaExistem: {
        [CACHE_NOVO]: {
          "/": html(
            "<!doctype html><html><body>HTML CRU SEM FICHA</body></html>",
          ),
          "/offline.html": html("<!doctype html><p>PAGINA SEM INTERNET</p>"),
        },
      },
    });
    cenario.online = false;

    const resposta = await iniciarNavegacao("/pedido/777");

    const corpo = await resposta.text();
    expect(corpo).toContain("PAGINA SEM INTERNET");
    expect(corpo).not.toContain("HTML CRU");
  });

  it("'/' guardada com a ficha é entregue (controle do caso acima)", async () => {
    const { iniciarNavegacao, cenario } = await montar({
      jaExistem: {
        [CACHE_NOVO]: {
          "/": html(ficha("LOJA GUARDADA")),
          "/offline.html": html("<p>PAGINA SEM INTERNET</p>"),
        },
      },
    });
    cenario.online = false;

    const resposta = await iniciarNavegacao("/pedido/777");

    expect(await resposta.text()).toContain("LOJA GUARDADA");
  });

  it("página guardada cujo corpo não dá para ler não é entregue: sem prova da ficha, não vale", async () => {
    // O cache devolve um objeto cujo clone() lança (corpo já consumido).
    const ilegivel = {
      ok: true,
      status: 200,
      clone() {
        return {
          clone() {
            throw new TypeError("corpo já lido");
          },
          text() {
            throw new TypeError("corpo já lido");
          },
        };
      },
    } as unknown as Response;
    const { iniciarNavegacao, cenario } = await montar({
      jaExistem: {
        [CACHE_NOVO]: {
          "/": ilegivel,
          "/offline.html": html("<p>PAGINA SEM INTERNET</p>"),
        },
      },
    });
    cenario.online = false;

    const resposta = await iniciarNavegacao("/pedido/777");

    expect(await resposta.text()).toContain("PAGINA SEM INTERNET");
  });
});

describe("src/sw/sw.ts — a navegação não deixa relógio de 5 s para trás", () => {
  it("rede que FALHA na hora: o relógio da navegação lenta é desarmado (nada pendurado depois)", async () => {
    vi.useFakeTimers();
    const { iniciarNavegacao, cenario } = await montar({
      jaExistem: { [CACHE_NOVO]: { "/offline.html": html("<p>OFFLINE</p>") } },
    });
    cenario.online = false;
    const relogiosAntes = vi.getTimerCount();

    const resposta = await iniciarNavegacao("/pedido/5");
    expect(await resposta.text()).toContain("OFFLINE");

    expect(vi.getTimerCount()).toBe(relogiosAntes);
  });

  it("rede que RESPONDE na hora: o relógio também é desarmado", async () => {
    vi.useFakeTimers();
    const { iniciarNavegacao, cenario } = await montar();
    cenario.rede.set("/pedido/5", () => html(ficha("PEDIDO")));
    const relogiosAntes = vi.getTimerCount();

    const resposta = await iniciarNavegacao("/pedido/5");
    expect(await resposta.text()).toContain("PEDIDO");

    expect(vi.getTimerCount()).toBe(relogiosAntes);
  });
});
