// @vitest-environment jsdom
//
// Laudo do sócio r2 (Frente 1, 08/09/2026): `useCacheWarmer` mandava o
// service worker guardar, no tamanho ORIGINAL, todos os banners e TODAS as
// fotos dos 15 primeiros produtos. Só a 1ª foto de cada produto tem
// consumidor real no endereço cru (SearchBar.tsx, CartItemsList.tsx,
// ShippingProgress.tsx, ReviewCard.tsx) — banner e foto 2..N são sempre
// pedidos na versão TRANSFORMADA (imageUrl.ts), que a gaveta de 100 vagas do
// service worker não casa por endereço exato (sw.ts:176). O original
// aquecido nunca era servido a quem pede a transformada, e ainda expulsava
// da gaveta as fotos que o cliente acabou de ver.
//
// Três provas:
// 1. A lista mandada ao SW tem "/" + 1 URL por produto (a primeira),
//    ZERO banners.
// 2. A URL aquecida do produto é a MESMA STRING que a SearchBar usa para
//    montar a miniatura da sugestão — observada do consumidor de verdade,
//    nunca hardcoded.
// 3. Em rede lenta (2G/economia de dados), nenhuma imagem é aquecida — o
//    comportamento de hoje continua.
//
// Andaime: sem @testing-library/react (não faz parte deste projeto).
// Segue o padrão de dashboard-tudo-cobre-o-historico-inteiro.test.tsx
// (Sonda via useEffect, createRoot + act) e de
// searchbar-acha-produto-acentuado.test.tsx (SearchBar real, foco + input
// nativo via setter do protótipo, dispatch de "input").
import { act, createElement, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchBar } from "@/components/ui/custom/SearchBar";
import { useCacheWarmer } from "@/hooks/useCacheWarmer";
import type { Product } from "@/types";

// ── Dublês compartilhados ────────────────────────────────────────────────

const mockGetAll = vi.fn();

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: (store: string) => mockGetAll(store),
    }),
  },
}));

// A SearchBar só usa `useProducts` de fato (StoreContext/useCart/supabase
// não aparecem no import dela hoje), mas os quatro dublês seguem o mesmo
// molde de searchbar-acha-produto-acentuado.test.tsx por precaução —
// custam zero neste arquivo e evitam quebrar se a SearchBar ganhar uma
// dessas dependências depois.
let catalogoDaSearchBar: Product[] = [];
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogoDaSearchBar }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos testes vizinhos deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function bannerDeTeste(id: string) {
  return { id, imageUrl: `https://cdn.teste/banners/${id}-original.jpg` };
}

function produtoDeTeste(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-base",
    name: "Produto Base",
    description: "",
    price: 10,
    images: [],
    category: "Categoria",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

// Node 25 pisa em `localStorage` global antes do jsdom (mesmo contorno de
// global-error-boundary-recovery-preserva-sessao-e-carrinho.test.tsx e
// cor-da-loja-vem-do-banco.test.tsx): sem isto, o `localStorage` do
// ambiente nem tem `.clear`/`.getItem` funcionais. O hook só usa
// getItem/setItem (log de forense), então o dublê pode ser mínimo.
function storageSimples(): Storage {
  const mapa = new Map<string, string>();
  return {
    getItem: (chave: string) =>
      mapa.has(chave) ? (mapa.get(chave) as string) : null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
    clear: () => {
      mapa.clear();
    },
    key: (index: number) => Array.from(mapa.keys()).at(index) ?? null,
    get length() {
      return mapa.size;
    },
  } as Storage;
}

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

describe("useCacheWarmer — aquece só o que tem consumidor (laudo sócio r2, Frente 1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // `vi.resetAllMocks()` reseta também o `DataVault.init.mockResolvedValue`
    // definido na fábrica do `vi.mock` (módulo-level, roda 1x), deixando-o
    // sem implementação para o resto do arquivo. Resetar só o que cada teste
    // de fato reconfigura evita esse estrago.
    mockGetAll.mockReset();
    catalogoDaSearchBar = [];
    postMessage = vi.fn();

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn().mockResolvedValue({ active: { postMessage } }),
      },
      configurable: true,
    });

    // Fallback do warmer direto por cliente (linhas 50-73, inalteradas):
    // stub para não bater na rede de verdade nem exigir Cache Storage real.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("caches", {
      open: vi.fn().mockResolvedValue({ put: vi.fn() }),
    } as unknown as CacheStorage);
    // jsdom não implementa requestIdleCallback: o hook cairia no
    // setTimeout(2000ms) sem isto. Stub que roda a callback na hora.
    vi.stubGlobal("requestIdleCallback", (cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    vi.stubGlobal("localStorage", storageSimples());

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
    Reflect.deleteProperty(globalThis.navigator, "connection");
  });

  async function montarWarmerEEsperarMensagem() {
    function Sonda() {
      useCacheWarmer();
      return null;
    }

    await act(async () => {
      raiz.render(createElement(Sonda));
    });

    await esperarAte(() => postMessage.mock.calls.length > 0);
    return postMessage.mock.calls[0][0] as { type: string; urls: string[] };
  }

  it("posta '/' + a 1ª foto de cada produto, e ZERO banners", async () => {
    mockGetAll.mockImplementation((store: string) => {
      if (store === "banners") {
        return Promise.resolve([bannerDeTeste("b1"), bannerDeTeste("b2")]);
      }
      if (store === "products") {
        return Promise.resolve([
          produtoDeTeste({
            id: "p1",
            images: [
              "https://cdn.teste/p1/foto-1-original.jpg",
              "https://cdn.teste/p1/foto-2-original.jpg",
            ],
          }),
          produtoDeTeste({
            id: "p2",
            images: ["https://cdn.teste/p2/foto-1-original.jpg"],
          }),
        ]);
      }
      return Promise.resolve([]);
    });

    const mensagem = await montarWarmerEEsperarMensagem();

    expect(mensagem.type).toBe("WARM_CACHE");
    // Igualdade do array INTEIRO, não `toContain`: uma lista velha com
    // banners e a foto 2 ainda dentro passaria num `toContain`.
    expect(mensagem.urls).toEqual([
      "/",
      "https://cdn.teste/p1/foto-1-original.jpg",
      "https://cdn.teste/p2/foto-1-original.jpg",
    ]);
  });

  it("descarta produto sem foto (nem images[0], nem imagem_url) sem quebrar os demais", async () => {
    mockGetAll.mockImplementation((store: string) => {
      if (store === "banners") return Promise.resolve([bannerDeTeste("b1")]);
      if (store === "products") {
        return Promise.resolve([
          produtoDeTeste({ id: "sem-foto", images: [] }),
          produtoDeTeste({
            id: "com-foto",
            images: ["https://cdn.teste/com-foto/foto-1.jpg"],
          }),
        ]);
      }
      return Promise.resolve([]);
    });

    const mensagem = await montarWarmerEEsperarMensagem();

    expect(mensagem.urls).toEqual([
      "/",
      "https://cdn.teste/com-foto/foto-1.jpg",
    ]);
  });

  it("produto sem a PROPRIEDADE images (não array vazio, ausente de vez) não derruba o aquecimento inteiro", async () => {
    // Dado vindo do IndexedDB é `any` (vault.getAll<any>) — este objeto
    // reproduz um registro legado que nunca ganhou o campo `images`, só
    // `imagem_url`. `produtoDeTeste` sempre injeta `images: []` por padrão
    // (linha 76), então aqui o objeto é montado na mão, sem a propriedade.
    const produtoSemPropriedadeImages = {
      id: "so-imagem-url",
      imagem_url: "https://cdn.teste/so-imagem-url/foto-legada.jpg",
    } as unknown as Product;

    mockGetAll.mockImplementation((store: string) => {
      if (store === "banners") return Promise.resolve([bannerDeTeste("b1")]);
      if (store === "products") {
        return Promise.resolve([
          produtoDeTeste({
            id: "com-images",
            images: ["https://cdn.teste/com-images/foto-1.jpg"],
          }),
          produtoSemPropriedadeImages,
        ]);
      }
      return Promise.resolve([]);
    });

    // Se `p.images[0]` lançar sem guarda, o `catch` externo do hook engole o
    // erro (`console.warn`) e o `postMessage` NUNCA acontece — a falha certa
    // deste teste é o timeout do `esperarAte`, não um TypeError estourado.
    const mensagem = await montarWarmerEEsperarMensagem();

    expect(mensagem.type).toBe("WARM_CACHE");
    expect(mensagem.urls).toEqual([
      "/",
      "https://cdn.teste/com-images/foto-1.jpg",
      "https://cdn.teste/so-imagem-url/foto-legada.jpg",
    ]);
  });

  it("a URL aquecida do produto é a MESMA STRING que a SearchBar usa na miniatura da sugestão", async () => {
    // Endereço no formato de arquivo público do Supabase Storage
    // (CAMINHO_ORIGINAL de imageUrl.ts) de propósito: só assim a mutação (c)
    // — trocar pela versão TRANSFORMADA via `imagemRedimensionada` — produz
    // uma string DIFERENTE. Uma URL fora desse formato faz
    // `imagemRedimensionada` devolvê-la intacta (linha 39 de imageUrl.ts),
    // e a mutação passaria sem ser pega.
    const produtoCompartilhado = produtoDeTeste({
      id: "prod-contrato",
      name: "Caneca Termica Premium",
      category: "Casa",
      images: [
        "https://xyzsupabase.co/storage/v1/object/public/produtos/prod-contrato/foto-1.jpg",
        "https://xyzsupabase.co/storage/v1/object/public/produtos/prod-contrato/foto-2.jpg",
      ],
    });

    mockGetAll.mockImplementation((store: string) => {
      // Um banner na mistura é o que faz este teste cair contra o código
      // ATUAL: hoje o banner entra na lista ANTES das fotos de produto
      // (`[...CRITICAL_URLS, ...bannerUrls, ...productUrls]`), então
      // `imagensAquecidas` teria o banner + as DUAS fotos do produto (3
      // itens) em vez de 1 — a asserção de tamanho já reprova, antes mesmo
      // de comparar a string com a SearchBar.
      if (store === "banners") {
        return Promise.resolve([bannerDeTeste("banner-que-nao-e-produto")]);
      }
      if (store === "products") return Promise.resolve([produtoCompartilhado]);
      return Promise.resolve([]);
    });
    catalogoDaSearchBar = [produtoCompartilhado];

    const mensagem = await montarWarmerEEsperarMensagem();
    const imagensAquecidas = mensagem.urls.filter((url) => url !== "/");
    expect(imagensAquecidas).toHaveLength(1);
    const urlAquecidaDoProduto = imagensAquecidas[0];

    // Renderiza a SearchBar de verdade e digita o nome do produto — mesmo
    // andaime de searchbar-acha-produto-acentuado.test.tsx.
    const hospedeiroBusca = document.createElement("div");
    document.body.appendChild(hospedeiroBusca);
    const raizBusca = createRoot(hospedeiroBusca);

    function Involucro() {
      const [valor, setValor] = useState("");
      return createElement(SearchBar, { value: valor, onChange: setValor });
    }

    await act(async () => {
      raizBusca.render(createElement(Involucro));
    });

    const campo = hospedeiroBusca.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    await act(async () => {
      campo.focus();
      setter?.call(campo, "caneca termica");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // `useDeferredValue` empurra o resultado para um render seguinte.
    await act(async () => {
      await Promise.resolve();
    });

    const imgDaSugestao = hospedeiroBusca.querySelector(
      "img",
    ) as HTMLImageElement | null;
    expect(
      imgDaSugestao,
      "SearchBar não renderizou nenhuma sugestão",
    ).not.toBeNull();

    expect(imgDaSugestao?.getAttribute("src")).toBe(urlAquecidaDoProduto);

    act(() => {
      raizBusca.unmount();
    });
    hospedeiroBusca.remove();
  });

  it("em rede lenta (2G / economia de dados), posta SÓ '/' — nenhuma imagem", async () => {
    Object.defineProperty(globalThis.navigator, "connection", {
      value: { saveData: true },
      configurable: true,
    });

    mockGetAll.mockImplementation((store: string) => {
      if (store === "banners") return Promise.resolve([bannerDeTeste("b1")]);
      if (store === "products") {
        return Promise.resolve([
          produtoDeTeste({
            id: "p1",
            images: ["https://cdn.teste/p1/foto-1-original.jpg"],
          }),
        ]);
      }
      return Promise.resolve([]);
    });

    const mensagem = await montarWarmerEEsperarMensagem();

    expect(mensagem.urls).toEqual(["/"]);
  });
});
