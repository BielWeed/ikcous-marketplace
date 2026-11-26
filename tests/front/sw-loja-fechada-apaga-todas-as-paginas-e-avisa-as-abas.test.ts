import {
  type MotivoManutencao,
  respostaForaDoAr,
  respostaManutencao,
} from "@/hospedagem/porteiro";
import { TIPO_LOJA_FECHADA } from "@/lib/aviso-da-loja-fechada";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — a loja FORA DO AR não continua vendendo pelo app guardado.
 *
 * O DEFEITO (caça de 26/11/2026): a loja posta para dormir (`adormecida`, 503)
 * ou encerrada (`encerrada`, 410) ganha do porteiro a página "fechada". Mas a
 * navegação é cache-primeiro: a cliente que já tinha visitado abre a vitrine
 * GUARDADA, e o SW só apagava a cópia daquela ROTA. As outras páginas
 * guardadas (a inicial, a do produto, a do carrinho) continuavam abrindo a
 * vitrine inteira, e a aba aberta seguia no app: dava para encher o carrinho
 * e pagar o PIX direto no Supabase da loja, num pedido que ninguém atende.
 *
 * O QUE ESTE TESTE FIXA:
 * - `adormecida`/`encerrada` (o par status + `x-ikcous-porteiro` que o
 *   porteiro manda, com a resposta REAL dele): TODA página guardada (resposta
 *   HTML) sai de TODOS os caches — menos a "sem internet", que não abre a
 *   loja — e as abas são avisadas para recarregar (inclusive a que está
 *   abrindo agora, pelo `resultingClientId`).
 * - Manutenção passageira (`banco-indisponivel`, `html-indisponivel`), rede
 *   fora do ar e 200 não apagam nada nem avisam ninguém. `sem-loja` e
 *   `discorda` seguem apagando só a rota, como antes.
 * - Assets (JS/CSS com hash), ícones, a gaveta de fotos e a ficha ficam.
 * - Se apagar falhar, ninguém é avisado: a aba recarregaria de volta na
 *   vitrine guardada, em laço.
 * - A loja que acorda volta ao normal sozinha: a próxima navegação vem da
 *   rede e é guardada de novo.
 *
 * Mesmo molde dos vizinhos (`sw-manutencao-503-do-porteiro-...`): `sw.ts`
 * registra os listeners ao ser importado, então o self é falso e a importação
 * é feita dentro de cada teste. Aqui o Cache Storage tem VÁRIOS caches que
 * guardam de verdade (Maps), porque o que se prova é o que sobra em cada um.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const CACHE_ATUAL = "app-cache-fallback";
const CACHE_ANTIGO = "app-cache-1.5.239";
const GAVETA_DE_FOTOS = "supabase-images-cache";
const CACHE_DA_FICHA = "ikcous-identidade";
const FOTO =
  "https://abc.supabase.co/storage/v1/object/public/produtos/camisa.jpg";

const chave = (alvo: Request | string) =>
  new URL(typeof alvo === "string" ? alvo : alvo.url, ORIGEM).href;

const comTipo = (corpo: string, tipo: string) =>
  new Response(corpo, { status: 200, headers: { "content-type": tipo } });
const pagina = (corpo: string) => comTipo(corpo, "text/html; charset=utf-8");

/** O Cache Storage de uma cliente que já usou a loja: páginas, casca do
 * precache, a página "sem internet", assets com hash, ícone, foto e ficha. */
function cacheStorageInicial(): Map<string, Map<string, Response>> {
  return new Map([
    [
      CACHE_ATUAL,
      new Map([
        [`${ORIGEM}/`, pagina("<html>vitrine inicial</html>")],
        [`${ORIGEM}/produtos`, pagina("<html>vitrine produtos</html>")],
        [`${ORIGEM}/produto/camisa`, pagina("<html>produto camisa</html>")],
        [`${ORIGEM}/index.html`, pagina("<html>casca do app</html>")],
        [`${ORIGEM}/offline.html`, pagina("<html>sem internet</html>")],
        [
          `${ORIGEM}/assets/index-abc123.js`,
          comTipo("console.log(1)", "text/javascript"),
        ],
        [`${ORIGEM}/assets/index-abc123.css`, comTipo("a{}", "text/css")],
        [`${ORIGEM}/icons/heart-96x96.png`, comTipo("png", "image/png")],
      ]),
    ],
    [
      CACHE_ANTIGO,
      new Map([
        [`${ORIGEM}/carrinho`, pagina("<html>carrinho velho</html>")],
        [
          `${ORIGEM}/assets/index-old999.js`,
          comTipo("console.log(0)", "text/javascript"),
        ],
      ]),
    ],
    [GAVETA_DE_FOTOS, new Map([[FOTO, comTipo("jpg", "image/jpeg")]])],
    [
      CACHE_DA_FICHA,
      new Map([
        [`${ORIGEM}/identidade.json`, comTipo("{}", "application/json")],
      ]),
    ],
  ]);
}

/** O que sobra de cada cache: só as chaves, em ordem. */
function retrato(gavetas: Map<string, Map<string, Response>>) {
  return Object.fromEntries(
    [...gavetas].map(([nome, gaveta]) => [nome, [...gaveta.keys()].sort()]),
  );
}

/** O que deve sobrar quando a loja fecha: nenhuma página, exceto a "sem
 * internet"; todo o resto intacto. */
const SEM_PAGINAS = {
  [CACHE_ATUAL]: [
    `${ORIGEM}/assets/index-abc123.css`,
    `${ORIGEM}/assets/index-abc123.js`,
    `${ORIGEM}/icons/heart-96x96.png`,
    `${ORIGEM}/offline.html`,
  ],
  [CACHE_ANTIGO]: [`${ORIGEM}/assets/index-old999.js`],
  [GAVETA_DE_FOTOS]: [FOTO],
  [CACHE_DA_FICHA]: [`${ORIGEM}/identidade.json`],
};

function respostaDoPorteiro(motivo: MotivoManutencao): Response {
  if (motivo === "adormecida" || motivo === "encerrada")
    return respostaForaDoAr(
      { estado: motivo, nome: "Loja Bela", ref: "abcdefghijklmnopqrst" },
      "hit",
      undefined,
    );
  return respostaManutencao(motivo, "ausente");
}

function montar(rede: () => Promise<Response>) {
  const listeners = new Map<string, Listener[]>();
  const gavetas = cacheStorageInicial();
  const falhas = { apagar: false };

  const gavetaDe = (nome: string) => {
    let gaveta = gavetas.get(nome);
    if (!gaveta) {
      gaveta = new Map();
      gavetas.set(nome, gaveta);
    }
    return gaveta;
  };
  const cacheDe = (nome: string) => {
    const gaveta = gavetaDe(nome);
    return {
      match: async (alvo: Request | string) => gaveta.get(chave(alvo))?.clone(),
      put: async (alvo: Request | string, resposta: Response) => {
        gaveta.set(chave(alvo), resposta);
      },
      delete: async (alvo: Request | string) => {
        if (falhas.apagar) throw new Error("cache indisponivel");
        return gaveta.delete(chave(alvo));
      },
      keys: async () => [...gaveta.keys()].map((url) => new Request(url)),
      addAll: async () => undefined,
    };
  };

  const abaAberta = { id: "aba-aberta", postMessage: vi.fn() };
  const abaSemControle = { id: "aba-sem-controle", postMessage: vi.fn() };
  const abaDaNavegacao = { id: "aba-da-navegacao", postMessage: vi.fn() };
  const matchAll = vi.fn(async () => [abaAberta, abaSemControle]);
  const get = vi.fn(async (id: string) =>
    id === abaDaNavegacao.id ? abaDaNavegacao : undefined,
  );

  vi.stubGlobal("self", {
    location: { origin: ORIGEM },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll, get },
    registration: { waiting: null, installing: null },
    skipWaiting: vi.fn(),
  });
  vi.stubGlobal("caches", {
    match: async (alvo: Request | string, opcoes?: { cacheName?: string }) => {
      const ordem = opcoes?.cacheName
        ? [gavetas.get(opcoes.cacheName)]
        : [...gavetas.values()];
      for (const gaveta of ordem) {
        const achada = gaveta?.get(chave(alvo));
        if (achada) return achada.clone();
      }
      return undefined;
    },
    open: async (nome: string) => cacheDe(nome),
    keys: async () => [...gavetas.keys()],
    has: async (nome: string) => gavetas.has(nome),
    delete: async (nome: string) => gavetas.delete(nome),
  });
  vi.stubGlobal("fetch", vi.fn(rede));
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  const abas = [abaAberta, abaSemControle, abaDaNavegacao];
  return { listeners, gavetas, falhas, abas, matchAll };
}

/** Abre a rota como navegação (de uma aba que vai virar `aba-da-navegacao`) e
 * espera TUDO que o SW pendurou em `waitUntil`, inclusive o que ele pendura
 * depois, no meio do caminho. */
async function abrir(listeners: Map<string, Listener[]>, caminho: string) {
  const request = new Request(`${ORIGEM}${caminho}`);
  Object.defineProperty(request, "mode", { value: "navigate" });
  const esperas: Promise<unknown>[] = [];
  const respondWith = vi.fn();
  (listeners.get("fetch") ?? [])[0]({
    request,
    resultingClientId: "aba-da-navegacao",
    respondWith,
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });
  const resposta = (await respondWith.mock.calls[0][0]) as Response;
  let vistas = 0;
  while (vistas < esperas.length) {
    const lote = esperas.slice(vistas);
    vistas = esperas.length;
    await Promise.all(lote);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return resposta;
}

const avisadas = (abas: { postMessage: ReturnType<typeof vi.fn> }[]) =>
  abas.map((aba) => aba.postMessage.mock.calls.length);

describe("sw.ts — loja fora do ar apaga todas as páginas guardadas e avisa as abas", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["adormecida", 503, "Loja Bela está fechada no momento."],
    ["encerrada", 410, "Loja Bela não está mais no ar."],
  ] as const)(
    "%s na revalidação: some TODA página guardada (não só a rota) e todas as abas são avisadas",
    async (motivo, status, texto) => {
      const { listeners, gavetas, abas, matchAll } = montar(async () =>
        respostaDoPorteiro(motivo),
      );
      await import("@/sw/sw");

      // A abertura de agora já foi respondida do cache (cache-primeiro, de
      // propósito: rede fora do ar não pode virar tela branca)...
      const agora = await abrir(listeners, "/produtos");
      expect(await agora.text()).toBe("<html>vitrine produtos</html>");

      // ...mas nenhuma página da loja sobra em cache nenhum.
      expect(retrato(gavetas)).toEqual(SEM_PAGINAS);
      // E toda aba (a aberta, a que o SW não controla e a que está abrindo
      // agora) recebe o aviso para recarregar.
      expect(matchAll).toHaveBeenCalledWith({
        type: "window",
        includeUncontrolled: true,
      });
      for (const aba of abas)
        expect(aba.postMessage).toHaveBeenCalledExactlyOnceWith({
          tipo: TIPO_LOJA_FECHADA,
        });

      // Outra rota que estava guardada (a do produto) já não abre a vitrine:
      // vem a página da loja fechada.
      const produto = await abrir(listeners, "/produto/camisa");
      expect(produto.status).toBe(status);
      expect(await produto.text()).toContain(texto);
    },
  );

  it("adormecida numa rota nunca visitada: a página fechada passa e o resto também é apagado", async () => {
    const { listeners, gavetas, abas } = montar(async () =>
      respostaDoPorteiro("adormecida"),
    );
    await import("@/sw/sw");

    const resposta = await abrir(listeners, "/sobre");

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("x-ikcous-porteiro")).toBe("adormecida");
    expect(retrato(gavetas)).toEqual(SEM_PAGINAS);
    for (const aba of abas)
      expect(aba.postMessage).toHaveBeenCalledExactlyOnceWith({
        tipo: TIPO_LOJA_FECHADA,
      });
  });

  it("rota nunca visitada e o `waitUntil` tardio recusado: a página fechada passa mesmo assim (não vira 'sem internet')", async () => {
    const { listeners, gavetas } = montar(async () =>
      respostaDoPorteiro("adormecida"),
    );
    await import("@/sw/sw");
    const request = new Request(`${ORIGEM}/sobre`);
    Object.defineProperty(request, "mode", { value: "navigate" });
    const esperas: Promise<unknown>[] = [];
    const respondWith = vi.fn();
    (listeners.get("fetch") ?? [])[0]({
      request,
      resultingClientId: "aba-da-navegacao",
      respondWith,
      // O 1º `waitUntil` (o da corrida rede x app guardado) vale; o tardio,
      // pendurado depois que a rede respondeu, é recusado pelo navegador.
      waitUntil: (p: Promise<unknown>) => {
        if (esperas.length > 0)
          throw new DOMException("x", "InvalidStateError");
        esperas.push(p);
      },
    });

    const resposta = (await respondWith.mock.calls[0][0]) as Response;
    await Promise.all(esperas);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("x-ikcous-porteiro")).toBe("adormecida");
    // A limpeza segue mesmo sem o `waitUntil`.
    await vi.waitFor(() => expect(retrato(gavetas)).toEqual(SEM_PAGINAS));
  });

  it.each(["banco-indisponivel", "html-indisponivel"] as const)(
    "manutenção passageira (%s): cache intacto e ninguém é avisado",
    async (motivo) => {
      const { listeners, gavetas, abas } = montar(async () =>
        respostaDoPorteiro(motivo),
      );
      const antes = retrato(gavetas);
      await import("@/sw/sw");

      const resposta = await abrir(listeners, "/produtos");

      expect(await resposta.text()).toBe("<html>vitrine produtos</html>");
      expect(retrato(gavetas)).toEqual(antes);
      expect(avisadas(abas)).toEqual([0, 0, 0]);
    },
  );

  it.each(["sem-loja", "discorda"] as const)(
    "%s segue apagando só a rota e não avisa ninguém (comportamento de antes)",
    async (motivo) => {
      const { listeners, gavetas, abas } = montar(async () =>
        respostaDoPorteiro(motivo),
      );
      const esperado = cacheStorageInicial();
      esperado.get(CACHE_ATUAL)?.delete(`${ORIGEM}/produtos`);
      await import("@/sw/sw");

      await abrir(listeners, "/produtos");

      expect(retrato(gavetas)).toEqual(retrato(esperado));
      expect(avisadas(abas)).toEqual([0, 0, 0]);
    },
  );

  it("par trocado (410 com `adormecida`): nada apagado, ninguém avisado", async () => {
    const { listeners, gavetas, abas } = montar(
      async () =>
        new Response("<html>x</html>", {
          status: 410,
          headers: { "x-ikcous-porteiro": "adormecida" },
        }),
    );
    const antes = retrato(gavetas);
    await import("@/sw/sw");

    await abrir(listeners, "/produtos");

    expect(retrato(gavetas)).toEqual(antes);
    expect(avisadas(abas)).toEqual([0, 0, 0]);
  });

  it("200: nada apagado, ninguém avisado, a página é regravada", async () => {
    const { listeners, gavetas, abas } = montar(async () =>
      pagina("<html>vitrine nova</html>"),
    );
    const antes = retrato(gavetas);
    await import("@/sw/sw");

    await abrir(listeners, "/produtos");

    expect(retrato(gavetas)).toEqual(antes);
    expect(
      await gavetas.get(CACHE_ATUAL)?.get(`${ORIGEM}/produtos`)?.clone().text(),
    ).toBe("<html>vitrine nova</html>");
    expect(avisadas(abas)).toEqual([0, 0, 0]);
  });

  it("rede fora do ar: nada apagado, ninguém avisado", async () => {
    const { listeners, gavetas, abas } = montar(async () => {
      throw new TypeError("Failed to fetch");
    });
    const antes = retrato(gavetas);
    await import("@/sw/sw");

    const resposta = await abrir(listeners, "/produtos");

    expect(await resposta.text()).toBe("<html>vitrine produtos</html>");
    expect(retrato(gavetas)).toEqual(antes);
    expect(avisadas(abas)).toEqual([0, 0, 0]);
  });

  it("falha ao apagar: ninguém é avisado (a aba voltaria à vitrine guardada, em laço) e a abertura não quebra", async () => {
    const { listeners, falhas, abas } = montar(async () =>
      respostaDoPorteiro("adormecida"),
    );
    falhas.apagar = true;
    await import("@/sw/sw");

    const resposta = await abrir(listeners, "/produtos");

    expect(await resposta.text()).toBe("<html>vitrine produtos</html>");
    expect(avisadas(abas)).toEqual([0, 0, 0]);
  });

  it("a loja acordou: a próxima navegação vem da rede, é guardada de novo e ninguém é avisado", async () => {
    let fechada = true;
    const { listeners, gavetas, abas } = montar(async () =>
      fechada
        ? respostaDoPorteiro("adormecida")
        : pagina("<html>vitrine reaberta</html>"),
    );
    await import("@/sw/sw");

    await abrir(listeners, "/produtos");
    expect(retrato(gavetas)).toEqual(SEM_PAGINAS);
    expect(avisadas(abas)).toEqual([1, 1, 1]);

    fechada = false;
    const resposta = await abrir(listeners, "/");

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("<html>vitrine reaberta</html>");
    expect(
      await gavetas.get(CACHE_ATUAL)?.get(`${ORIGEM}/`)?.clone().text(),
    ).toBe("<html>vitrine reaberta</html>");
    expect(avisadas(abas)).toEqual([1, 1, 1]);
  });

  it("duas aberturas ao mesmo tempo vendo a loja fechada: as duas terminam sem erro e nada sobra", async () => {
    const { listeners, gavetas } = montar(async () =>
      respostaDoPorteiro("adormecida"),
    );
    await import("@/sw/sw");

    await Promise.all([
      abrir(listeners, "/produtos"),
      abrir(listeners, "/produto/camisa"),
    ]);

    expect(retrato(gavetas)).toEqual(SEM_PAGINAS);
  });
});
