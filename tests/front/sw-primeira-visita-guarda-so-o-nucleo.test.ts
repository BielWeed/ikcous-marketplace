import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — a primeira visita deixa de baixar o app inteiro (plano de
 * 26/11/2026, lote B). Hoje o `install` baixa ~140 arquivos no primeiro acesso
 * de TODO visitante, e cada um é um pedido contado pela Vercel (no Hobby, 1
 * milhão no mês pausa o projeto e tira todas as lojas do ar).
 *
 *  - 1ª instalação (nenhum `app-cache-*` de outra versão no aparelho): o
 *    install guarda só as entradas marcadas `nucleo: true` (+ a `/` com a
 *    ficha); o activate repara só o núcleo (T4+T5).
 *  - Atualização (há cache da versão anterior): o app inteiro, como sempre,
 *    mas o que já está guardado com o MESMO nome em /assets/ (o nome leva o
 *    hash do conteúdo) é copiado, não baixado; nunca HTML (T6). Fora de
 *    /assets/, nunca: a revalidação do `fetch` regrava o cache da versão em
 *    uso sem olhar revisão (revisão Opus do PR #1906 desfez a cópia por
 *    revisão do T7).
 *  - Volta (navegação atendida pelo service worker): completa o resto em 2º
 *    plano — 3 s depois, lotes de 6, parando com atualização a caminho, rede
 *    lenta ou economia de dados; nunca rejeita (T8).
 *  - Manifesto sem nenhuma marca: tudo como hoje (falha segura).
 *
 * O cache é um Cache Storage em memória com a semântica do navegador (molde de
 * `sw-atualizacao-so-vale-com-o-app-inteiro.test.ts`).
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const CACHE_VELHO = "app-cache-1.0.0";
const CACHE_NOVO = "app-cache-2.0.0";
/** O registro de revisões que um build intermediário deste PR gravava (a
 * cópia por revisão saiu na revisão Opus do PR #1906): fica no molde para
 * provar que nem ele faz o install copiar arquivo sem hash no nome. */
const REVISOES = "/__ikcous/revisoes-do-precache.json";

/** O manifesto de um build com a marca: núcleo = entrada, vitrine, CSS,
 * página offline e ícone. Carrinho, checkout e o resto ficam fora. */
const MANIFESTO = [
  { url: "index.html", revision: "html-1" },
  { url: "offline.html", revision: "off-1", nucleo: true },
  { url: "icons/heart-96x96.png", revision: "heart-1", nucleo: true },
  { url: "icons/badge-96x96.png", revision: "badge-1" },
  { url: "assets/index-ABC.js", revision: null, nucleo: true },
  { url: "assets/index-ABC.css", revision: null, nucleo: true },
  { url: "assets/HomeView-H1.js", revision: null, nucleo: true },
  { url: "assets/CartView-C1.js", revision: null },
  { url: "assets/CheckoutView-K1.js", revision: null },
  { url: "assets/a-1.js", revision: null },
  { url: "assets/a-2.js", revision: null },
  { url: "assets/a-3.js", revision: null },
  { url: "assets/a-4.js", revision: null },
  { url: "assets/a-5.js", revision: null },
  { url: "assets/a-6.js", revision: null },
];
const NUCLEO = MANIFESTO.filter((e) => e.nucleo).map((e) => `/${e.url}`);
const FORA_DO_NUCLEO = MANIFESTO.filter((e) => !e.nucleo).map(
  (e) => `/${e.url}`,
);
const SEM_MARCA = MANIFESTO.map(({ url, revision }) => ({ url, revision }));

function ficha(citados = ["/assets/index-ABC.js", "/assets/index-ABC.css"]) {
  const tags = citados
    .map((c) =>
      c.endsWith(".css")
        ? `<link rel="stylesheet" href="${c}">`
        : `<script type="module" src="${c}"></script>`,
    )
    .join("");
  return `<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script>${tags}</head><body>loja</body></html>`;
}

function html(texto: string) {
  return new Response(texto, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function arquivo(texto: string, tipo = "text/javascript") {
  return new Response(texto, {
    status: 200,
    headers: { "content-type": tipo },
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
      async addAll(urls: string[]) {
        const respostas = await Promise.all(
          urls.map(async (url) => {
            const resposta = await fetch(url);
            if (!resposta.ok) throw new TypeError(`bad-response ${url}`);
            return [url, resposta] as const;
          }),
        );
        for (const [url, resposta] of respostas)
          dados.set(caminho(url), resposta);
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

/** A rede do build no ar: todo o manifesto + a página inicial com a ficha. */
function redeDoBuild(): Map<string, () => Response | Promise<Response>> {
  const rede = new Map<string, () => Response | Promise<Response>>();
  for (const { url } of MANIFESTO)
    rede.set(`/${url}`, () =>
      url.endsWith(".html")
        ? html(`<!doctype html><html><body>${url}</body></html>`)
        : url.endsWith(".css")
          ? arquivo(`/* ${url} */`, "text/css")
          : url.endsWith(".png")
            ? arquivo(`png ${url}`, "image/png")
            : arquivo(`// ${url}`),
    );
  rede.set("/", () => html(ficha()));
  rede.set("/identidade.json", () => arquivo("{}", "application/json"));
  return rede;
}

async function montar(
  opcoes: {
    versao?: string;
    manifesto?: Record<string, unknown>[];
    jaExistem?: Record<string, Record<string, Response>>;
    rede?: Map<string, () => Response | Promise<Response>>;
    conexao?: { saveData?: boolean; effectiveType?: string };
  } = {},
) {
  vi.resetModules();
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: ORIGEM, hostname: "loja.exemplo.com" },
    navigator: opcoes.conexao ? { connection: opcoes.conexao } : {},
    __WB_MANIFEST: opcoes.manifesto ?? MANIFESTO,
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null as unknown, installing: null as unknown },
    skipWaiting: vi.fn(),
  };
  const { armazem, cachesFalso, abrir } = criarArmazem();
  for (const [nome, entradas] of Object.entries(opcoes.jaExistem ?? {})) {
    const cache = abrir(nome);
    for (const [c, r] of Object.entries(entradas)) cache.dados.set(c, r);
  }
  const rede = opcoes.rede ?? redeDoBuild();
  const estado = { online: true };
  const buscas: string[] = [];
  const fetchFalso = vi.fn(async (entrada: string | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada.url;
    const c = new URL(url, ORIGEM).pathname;
    buscas.push(c);
    if (!estado.online) throw new TypeError("Failed to fetch");
    const fabrica = rede.get(c);
    if (!fabrica) return new Response("nao encontrado", { status: 404 });
    return fabrica();
  });

  vi.stubGlobal("__APP_VERSION__", opcoes.versao ?? "2.0.0");
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
    for (const fn of listeners.get(tipo) ?? [])
      fn({ waitUntil: (p: Promise<unknown>) => promessas.push(p) });
    return Promise.all(promessas);
  }

  /** Navegação atendida pelo SW. Devolve as promessas do `waitUntil`. */
  function navegar(caminho: string, cabecalhos: Record<string, string> = {}) {
    const respondWith = vi.fn();
    const promessas: Promise<unknown>[] = [];
    const request = new Request(`${ORIGEM}${caminho}`, {
      headers: cabecalhos,
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    (listeners.get("fetch") ?? [])[0]({
      request,
      respondWith,
      waitUntil: (p: Promise<unknown>) => promessas.push(p),
    });
    return { respondWith, promessas };
  }

  function mensagem(data: unknown) {
    for (const fn of listeners.get("message") ?? []) fn({ data });
  }

  return {
    armazem,
    buscas,
    estado,
    rede,
    rodar,
    navegar,
    mensagem,
    selfFalso,
  };
}

const guardados = (armazem: Map<string, Map<string, Response>>, nome: string) =>
  [...(armazem.get(nome)?.keys() ?? [])].sort();

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("1ª instalação: só o núcleo (T4+T5)", () => {
  it("o install baixa só o núcleo + a página inicial com a ficha", async () => {
    const { rodar, armazem, buscas } = await montar();

    await rodar("install");

    expect(guardados(armazem, CACHE_NOVO)).toEqual([...NUCLEO, "/"].sort());
    for (const fora of FORA_DO_NUCLEO) expect(buscas).not.toContain(fora);
  });

  it("o activate da 1ª vez com o núcleo inteiro não baixa nada de fora dele", async () => {
    const { rodar, buscas } = await montar();
    await rodar("install");
    buscas.length = 0;

    await rodar("activate");

    expect(buscas.filter((b) => FORA_DO_NUCLEO.includes(b))).toEqual([]);
  });

  it("o activate da 1ª vez repara só o núcleo despejado, não a lista inteira", async () => {
    const { rodar, armazem, buscas } = await montar();
    await rodar("install");
    armazem.get(CACHE_NOVO)?.delete("/assets/HomeView-H1.js");
    buscas.length = 0;

    await rodar("activate");

    expect(buscas).toContain("/assets/HomeView-H1.js");
    expect(buscas.filter((b) => FORA_DO_NUCLEO.includes(b))).toEqual([]);
    expect(armazem.get(CACHE_NOVO)?.has("/assets/HomeView-H1.js")).toBe(true);
  });

  it("a página inicial que cita arquivo FORA do núcleo não é guardada na 1ª instalação", async () => {
    const rede = redeDoBuild();
    rede.set("/", () =>
      html(ficha(["/assets/index-ABC.js", "/assets/CartView-C1.js"])),
    );
    const { rodar, armazem } = await montar({ rede });

    await rodar("install");

    expect(armazem.get(CACHE_NOVO)?.has("/")).toBe(false);
  });

  it("um arquivo do núcleo que falha derruba o install (o núcleo também só vale inteiro)", async () => {
    const rede = redeDoBuild();
    rede.set("/assets/HomeView-H1.js", () => new Response("", { status: 500 }));
    const { rodar, armazem } = await montar({ rede });

    await expect(rodar("install")).rejects.toThrow(/Precache incompleto/);
    expect(armazem.has(CACHE_NOVO)).toBe(false);
  });

  it("falha segura: manifesto SEM nenhuma marca baixa o app inteiro, como hoje", async () => {
    const { rodar, armazem, buscas } = await montar({ manifesto: SEM_MARCA });

    await rodar("install");

    for (const fora of FORA_DO_NUCLEO) expect(buscas).toContain(fora);
    for (const { url } of SEM_MARCA)
      expect(armazem.get(CACHE_NOVO)?.has(`/${url}`)).toBe(true);
  });

  it("falha segura: Cache Storage que não lista os nomes = app inteiro", async () => {
    const m = await montar();
    vi.mocked(caches.keys).mockRejectedValueOnce(new Error("disco"));

    await m.rodar("install");

    for (const fora of FORA_DO_NUCLEO) expect(m.buscas).toContain(fora);
  });

  it("cache de OUTRO app (nome sem app-cache-) não conta como versão anterior", async () => {
    const { rodar, buscas } = await montar({
      jaExistem: {
        "supabase-images-cache": { "/x.png": arquivo("x", "image/png") },
        "ikcous-identidade": { "/identidade.json": arquivo("{}") },
      },
    });

    await rodar("install");

    for (const fora of FORA_DO_NUCLEO) expect(buscas).not.toContain(fora);
  });
});

describe("atualização: o app inteiro, copiando o que não mudou (T6+T7)", () => {
  /** O que a versão anterior guardou: o núcleo dela (mesmos nomes) e o
   * registro de revisões que o install dela escreveu. */
  function velhoComNucleo(
    revisoes: Record<string, string> | null,
    trocas: Record<string, Response> = {},
  ) {
    const velho: Record<string, Response> = {
      "/assets/index-ABC.js": arquivo("// velho index-ABC"),
      "/assets/index-ABC.css": arquivo("/* velho */", "text/css"),
      "/assets/HomeView-H1.js": arquivo("// velho HomeView"),
      "/offline.html": html("offline velho"),
      "/index.html": html("index velho"),
      "/icons/heart-96x96.png": arquivo("png velho heart", "image/png"),
      "/icons/badge-96x96.png": arquivo("png velho badge", "image/png"),
      "/produto/1": html(ficha()),
      ...(revisoes
        ? {
            [REVISOES]: arquivo(JSON.stringify(revisoes), "application/json"),
          }
        : {}),
      ...trocas,
    };
    return { [CACHE_VELHO]: velho };
  }

  it("baixa o app inteiro, mas copia de /assets/ o que tem o MESMO nome no cache anterior", async () => {
    const { rodar, armazem, buscas } = await montar({
      jaExistem: velhoComNucleo(null),
    });

    await rodar("install");

    // Copiados (mesmo nome = mesmo conteúdo): nenhum pedido à rede.
    for (const c of [
      "/assets/index-ABC.js",
      "/assets/index-ABC.css",
      "/assets/HomeView-H1.js",
    ])
      expect(buscas).not.toContain(c);
    expect(
      await armazem.get(CACHE_NOVO)?.get("/assets/HomeView-H1.js")?.text(),
    ).toBe("// velho HomeView");
    // O resto do app (fora do núcleo) é baixado: atualização = app inteiro.
    for (const c of ["/assets/CartView-C1.js", "/assets/a-6.js"])
      expect(buscas).toContain(c);
    for (const { url } of MANIFESTO)
      expect(armazem.get(CACHE_NOVO)?.has(`/${url}`), url).toBe(true);
  });

  it("nunca copia HTML: index.html e offline.html vêm da rede mesmo guardados", async () => {
    const { rodar, armazem, buscas } = await montar({
      jaExistem: velhoComNucleo({
        "/offline.html": "off-1",
        "/index.html": "html-1",
      }),
    });

    await rodar("install");

    expect(buscas).toContain("/offline.html");
    expect(buscas).toContain("/index.html");
    expect(await armazem.get(CACHE_NOVO)?.get("/offline.html")?.text()).toBe(
      "<!doctype html><html><body>offline.html</body></html>",
    );
  });

  it("não copia de /assets/ o que o cache anterior guardou como HTML (catch-all no lugar do JS)", async () => {
    const jaExistem = velhoComNucleo(null, {
      "/assets/HomeView-H1.js": html("index no lugar"),
    });
    const { rodar, armazem, buscas } = await montar({ jaExistem });

    await rodar("install");

    expect(buscas).toContain("/assets/HomeView-H1.js");
    expect(
      await armazem.get(CACHE_NOVO)?.get("/assets/HomeView-H1.js")?.text(),
    ).toBe("// assets/HomeView-H1.js");
  });

  it("fora de /assets/: baixa da rede mesmo com a MESMA revisão no registro anterior", async () => {
    const { rodar, armazem, buscas } = await montar({
      jaExistem: velhoComNucleo({
        "/icons/heart-96x96.png": "heart-1",
        "/icons/badge-96x96.png": "badge-0",
      }),
    });

    await rodar("install");

    expect(buscas).toContain("/icons/heart-96x96.png");
    expect(
      await armazem.get(CACHE_NOVO)?.get("/icons/heart-96x96.png")?.text(),
    ).toBe("png icons/heart-96x96.png");
    expect(buscas).toContain("/icons/badge-96x96.png");
    expect(armazem.get(CACHE_NOVO)?.has(REVISOES)).toBe(false);
  });

  it("duas versões em sequência: a 2ª só baixa o /assets/ que mudou e o que não tem hash no nome", async () => {
    const v1 = await montar({ versao: "1.0.0", manifesto: SEM_MARCA });
    await v1.rodar("install");
    await v1.rodar("activate");
    const anterior = Object.fromEntries(
      [...(v1.armazem.get(CACHE_VELHO)?.entries() ?? [])].map(([k, r]) => [
        k,
        r.clone(),
      ]),
    );

    const manifestoV2 = MANIFESTO.map((e) =>
      e.url === "assets/a-6.js"
        ? { url: "assets/a-6-NOVO.js", revision: null }
        : e,
    );
    const rede = redeDoBuild();
    rede.set("/assets/a-6-NOVO.js", () => arquivo("// novo"));
    const v2 = await montar({
      manifesto: manifestoV2,
      jaExistem: { [CACHE_VELHO]: anterior },
      rede,
    });
    await v2.rodar("install");

    const deArquivo = v2.buscas.filter(
      (b) => b !== "/" && b !== "/identidade.json",
    );
    expect(deArquivo.sort()).toEqual(
      [
        "/assets/a-6-NOVO.js",
        "/icons/badge-96x96.png",
        "/icons/heart-96x96.png",
        "/index.html",
        "/offline.html",
      ].sort(),
    );
  });

  it("arquivo SEM hash no nome nunca é copiado: a N+2 que volta à revisão da N baixa o loading.css, não leva o da N+1 que o cache da N guardou", async () => {
    // 1. A cliente está na N (loading.css revisão "load-N").
    // 2. Sai a N+1 com outro loading.css; a revalidação em segundo plano do
    //    fetch regrava no cache da N (versão em uso) o loading.css da N+1,
    //    sem olhar revisão — a etiqueta da N continua dizendo "load-N".
    // 3. A N+1 fica esperando (a cliente não ativa).
    // 4. Sai a N+2, que reverte: revisão "load-N" de novo.
    // 5. O install da N+2 NÃO pode copiar o loading.css do cache da N.
    const manifesto = [
      ...MANIFESTO,
      { url: "loading.css", revision: "load-N" },
    ];
    const rede = redeDoBuild();
    rede.set("/loading.css", () => arquivo("/* loading da N */", "text/css"));
    const { rodar, armazem, buscas } = await montar({
      manifesto,
      rede,
      jaExistem: velhoComNucleo(
        { "/loading.css": "load-N", "/icons/heart-96x96.png": "heart-1" },
        { "/loading.css": arquivo("/* loading da N+1 */", "text/css") },
      ),
    });

    await rodar("install");

    expect(buscas).toContain("/loading.css");
    expect(await armazem.get(CACHE_NOVO)?.get("/loading.css")?.text()).toBe(
      "/* loading da N */",
    );
    // O mesmo vale para todo arquivo fora de /assets/ (ícones etc.).
    expect(buscas).toContain("/icons/heart-96x96.png");
    // Controle: /assets/ (hash no nome) continua copiado, sem rede.
    expect(buscas).not.toContain("/assets/HomeView-H1.js");
    expect(
      await armazem.get(CACHE_NOVO)?.get("/assets/HomeView-H1.js")?.text(),
    ).toBe("// velho HomeView");
  });

  it("o activate da atualização exige o app INTEIRO antes de apagar o anterior (como hoje)", async () => {
    const m = await montar({ jaExistem: velhoComNucleo(null) });
    await m.rodar("install");
    m.armazem.get(CACHE_NOVO)?.delete("/assets/CartView-C1.js");
    m.estado.online = false;

    await m.rodar("activate");

    expect(m.armazem.has(CACHE_VELHO)).toBe(true);
  });
});

describe("volta: completa o resto em 2º plano (T8)", () => {
  async function primeiraVisitaInstalada(
    opcoes: Parameters<typeof montar>[0] = {},
  ) {
    const m = await montar(opcoes);
    await m.rodar("install");
    await m.rodar("activate");
    m.buscas.length = 0;
    vi.useFakeTimers();
    return m;
  }

  const deFora = (buscas: string[]) =>
    buscas.filter((b) => FORA_DO_NUCLEO.includes(b));

  it("nada antes de 3 s; depois, o resto entra no cache e a navegação não muda", async () => {
    const m = await primeiraVisitaInstalada();
    const { respondWith, promessas } = m.navegar("/");
    expect(respondWith).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(deFora(m.buscas)).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    await Promise.all(promessas);

    for (const { url } of MANIFESTO)
      expect(m.armazem.get(CACHE_NOVO)?.has(`/${url}`), url).toBe(true);
  });

  it("baixa em lotes de 6: o 7º só sai depois que o 1º lote termina", async () => {
    const pendentes: (() => void)[] = [];
    const rede = redeDoBuild();
    for (const c of FORA_DO_NUCLEO) {
      const original = rede.get(c) as () => Response;
      rede.set(
        c,
        () =>
          new Promise<Response>((resolve) => {
            pendentes.push(() => resolve(original()));
          }),
      );
    }
    const m = await montar({ rede });
    // O install e o activate da 1ª vez não pedem nada de fora do núcleo.
    await m.rodar("install");
    await m.rodar("activate");
    m.buscas.length = 0;
    vi.useFakeTimers();

    const { promessas } = m.navegar("/");
    await vi.advanceTimersByTimeAsync(3000);
    expect(deFora(m.buscas)).toHaveLength(6);

    for (const soltar of pendentes.splice(0)) soltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(deFora(m.buscas)).toHaveLength(FORA_DO_NUCLEO.length);

    for (const soltar of pendentes.splice(0)) soltar();
    await Promise.all(promessas);
  });

  it("para com uma atualização a caminho (installing ou waiting)", async () => {
    const m = await primeiraVisitaInstalada();
    m.selfFalso.registration.installing = {};
    const { promessas } = m.navegar("/");
    await vi.runAllTimersAsync();
    await Promise.all(promessas);
    expect(deFora(m.buscas)).toEqual([]);

    m.selfFalso.registration.installing = null;
    m.selfFalso.registration.waiting = {};
    const outra = m.navegar("/");
    await vi.runAllTimersAsync();
    await Promise.all(outra.promessas);
    expect(deFora(m.buscas)).toEqual([]);
  });

  it("versão nova ativou durante a espera e apagou o cache desta: o completar não o recria nem baixa nada", async () => {
    const m = await primeiraVisitaInstalada();
    const { promessas } = m.navegar("/");
    await vi.advanceTimersByTimeAsync(1000);
    // O activate da versão nova apaga app-cache-<esta> no meio da espera.
    m.armazem.delete(CACHE_NOVO);

    await vi.runAllTimersAsync();
    await Promise.all(promessas);

    expect(m.armazem.has(CACHE_NOVO)).toBe(false);
    // Só a própria navegação foi à rede; nenhum arquivo do precache.
    expect(m.buscas.filter((b) => b !== "/")).toEqual([]);
  });

  it("para com rede lenta (aviso da página) ou sem sinal", async () => {
    const m = await primeiraVisitaInstalada();
    m.mensagem({ type: "SET_NETWORK_QUALITY", quality: "slow" });
    const { promessas } = m.navegar("/");
    await vi.runAllTimersAsync();
    await Promise.all(promessas);
    expect(deFora(m.buscas)).toEqual([]);
  });

  it("para com economia de dados: cabeçalho Save-Data da navegação", async () => {
    const m = await primeiraVisitaInstalada();
    const { promessas } = m.navegar("/", { "save-data": "on" });
    await vi.runAllTimersAsync();
    await Promise.all(promessas);
    expect(deFora(m.buscas)).toEqual([]);
  });

  it("para com economia de dados ou 2G informados pelo navegador ao service worker", async () => {
    for (const conexao of [{ saveData: true }, { effectiveType: "2g" }]) {
      const m = await primeiraVisitaInstalada({ conexao });
      const { promessas } = m.navegar("/");
      await vi.runAllTimersAsync();
      await Promise.all(promessas);
      expect(deFora(m.buscas), JSON.stringify(conexao)).toEqual([]);
      vi.useRealTimers();
    }
  });

  it("controle: conexão 4G sem economia de dados completa normalmente", async () => {
    const m = await primeiraVisitaInstalada({
      conexao: { saveData: false, effectiveType: "4g" },
    });
    const { promessas } = m.navegar("/");
    await vi.runAllTimersAsync();
    await Promise.all(promessas);
    expect(deFora(m.buscas).sort()).toEqual([...FORA_DO_NUCLEO].sort());
  });

  it("nunca rejeita: sem rede, a promessa do waitUntil termina bem e nada entra", async () => {
    const m = await primeiraVisitaInstalada();
    m.estado.online = false;
    const { promessas } = m.navegar("/");
    await vi.runAllTimersAsync();
    await expect(Promise.all(promessas)).resolves.toBeDefined();
    expect(m.armazem.get(CACHE_NOVO)?.has("/assets/CartView-C1.js")).toBe(
      false,
    );
  });

  it("arquivo que volta como HTML (deploy novo sem o chunk antigo) não entra no cache", async () => {
    const rede = redeDoBuild();
    rede.set("/assets/CartView-C1.js", () => html(ficha()));
    const m = await primeiraVisitaInstalada({ rede });
    const { promessas } = m.navegar("/");
    await vi.runAllTimersAsync();
    await Promise.all(promessas);
    expect(m.armazem.get(CACHE_NOVO)?.has("/assets/CartView-C1.js")).toBe(
      false,
    );
    expect(m.armazem.get(CACHE_NOVO)?.has("/assets/a-1.js")).toBe(true);
  });

  it("index.html de um deploy mais novo (cita arquivo fora do precache) não entra", async () => {
    const rede = redeDoBuild();
    rede.set("/index.html", () => html(ficha(["/assets/index-NOVISSIMO.js"])));
    const m = await primeiraVisitaInstalada({ rede });
    const { promessas } = m.navegar("/");
    await vi.runAllTimersAsync();
    await Promise.all(promessas);
    expect(m.armazem.get(CACHE_NOVO)?.has("/index.html")).toBe(false);
  });

  it("duas navegações seguidas não baixam o resto duas vezes", async () => {
    // Rede que segura as respostas: o 1º completar ainda está no ar quando a
    // 2ª navegação chega.
    const pendentes: (() => void)[] = [];
    const rede = redeDoBuild();
    for (const c of FORA_DO_NUCLEO) {
      const original = rede.get(c) as () => Response;
      rede.set(
        c,
        () =>
          new Promise<Response>((resolve) => {
            pendentes.push(() => resolve(original()));
          }),
      );
    }
    const m = await primeiraVisitaInstalada({ rede });
    const a = m.navegar("/");
    await vi.advanceTimersByTimeAsync(3000);
    const b = m.navegar("/produto/1");
    await vi.advanceTimersByTimeAsync(3000);
    expect(deFora(m.buscas)).toHaveLength(6);

    while (pendentes.length > 0) {
      for (const soltar of pendentes.splice(0)) soltar();
      await vi.advanceTimersByTimeAsync(0);
    }
    await Promise.all([...a.promessas, ...b.promessas]);
    expect(deFora(m.buscas).sort()).toEqual([...FORA_DO_NUCLEO].sort());
  });

  it("falha segura: manifesto sem marca não arma relógio nem baixa nada na navegação", async () => {
    const m = await montar({ manifesto: SEM_MARCA });
    await m.rodar("install");
    await m.rodar("activate");
    vi.useFakeTimers();
    const antes = vi.getTimerCount();
    m.navegar("/");
    expect(vi.getTimerCount()).toBe(antes);
  });
});
