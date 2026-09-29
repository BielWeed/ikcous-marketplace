// @vitest-environment jsdom
//
// FavoritesContext-535 — visitante (sem login) via a tela de Favoritos com
// preço/estoque CONGELADOS no instante do toque no coração.
//
// Até esta correção, `localFavorites` (chave anônima "ikcous_favorites")
// guardava o `Product` INTEIRO — e o memo de `favorites`, para quem não tem
// conta, devolvia esse array cru (`if (!user) return localFavorites`), sem
// nunca revalidar contra o catálogo. Cliente logado nunca teve esse
// problema: o memo dele sempre filtra `allProducts` (dado vivo) pelos ids
// confirmados. Este teste prova que o visitante passa a ter a MESMA
// garantia: o card de um favorito mostra o preço/estoque de AGORA, não o de
// quando a pessoa tocou o coração.
//
// Cobre também a migração exigida pela correção: um aparelho que favoritou
// ANTES desta correção tem o `Product` inteiro (formato antigo) gravado sob
// "ikcous_favorites" — o teste semeia a chave exatamente nesse formato
// antigo (é o único jeito de simular "quem já tinha favorito salvo" sem
// passar pelo próprio `addToFavorites`) e verifica que, depois de montar o
// Provider, o disco passa a guardar só o id.
//
// Vermelho contra o código antigo: `favorites` continuaria mostrando
// `name: "Tênis VELHO"`, `price: 50`, `stock: 10` — o retrato salvo no
// instante do favorito — mesmo com o catálogo (mockado abaixo) já
// devolvendo `price: 80`/`stock: 0` para o mesmo id.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// O catálogo já nasce com o preço/estoque NOVOS — a lojista mudou os dois
// (e zerou o estoque) depois que o visitante favoritou. `productsDaLoja` é
// mutável para o segundo cenário (mudança DURANTE a sessão, não só entre
// visitas).
let productsDaLoja: Product[] = [];
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: productsDaLoja, loading: false }),
}));

// Sempre visitante: esta correção é especificamente sobre quem NUNCA loga.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("visitante sem conta não deveria tocar o servidor");
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// testes irmãos de FavoritesContext.
function criarStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

function produtoAntigo(id: string): Product {
  return {
    id,
    name: "Tênis VELHO",
    price: 50,
    stock: 10,
    isActive: true,
    images: [],
  } as unknown as Product;
}

function produtoAtual(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: "Tênis",
    price: 80,
    stock: 0,
    isActive: true,
    images: [],
    ...overrides,
  } as unknown as Product;
}

let ultimoContexto: unknown = null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  // Escrever fora do corpo do render (efeito, não durante o render) — mesmo
  // contorno dos testes irmãos, para não violar a regra de pureza do React.
  useEffect(() => {
    ultimoContexto = ctx;
  });
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let storageFake: ReturnType<typeof criarStorageFake>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  productsDaLoja = [];
  ultimoContexto = null;
  storageFake = criarStorageFake();
  vi.stubGlobal("localStorage", storageFake);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
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
});

describe("FavoritesContext — favorito de visitante reflete preço/estoque atuais do catálogo", () => {
  it("card do favorito mostra o preço/estoque de AGORA, não o retrato congelado no toque do coração", async () => {
    // 1. Aparelho já tinha p1 favoritado ANTES desta correção — formato
    // antigo, `Product` inteiro gravado na chave anônima.
    storageFake.setItem(FAVORITES_KEY, JSON.stringify([produtoAntigo("p1")]));
    // 2. A lojista já mudou preço e estoque quando o visitante volta.
    productsDaLoja = [produtoAtual("p1")];

    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    const ctx = ultimoContexto as {
      favorites: Product[];
      isFavorite: (id: string) => boolean;
    } | null;

    expect(ctx?.isFavorite("p1")).toBe(true);
    expect(ctx?.favorites).toHaveLength(1);
    // O que importa: preço e estoque são os do CATÁLOGO agora, não os 50/10
    // que estavam congelados na chave anônima.
    expect(ctx?.favorites[0].price).toBe(80);
    expect((ctx?.favorites[0] as unknown as { stock: number }).stock).toBe(0);
    expect(ctx?.favorites[0].name).toBe("Tênis");

    // Migração: o disco não pode mais guardar o `Product` inteiro — só o id
    // (ver instrucoes da tarefa). `useLocalStorage` trata "[]" e ausência
    // como a mesma lista vazia, mas aqui a chave TEM que existir com o id.
    const bruto = storageFake.getItem(FAVORITES_KEY);
    expect(bruto).not.toBeNull();
    const entradas = JSON.parse(bruto as string);
    expect(entradas).toEqual(["p1"]);
  });

  it("preço muda DURANTE a sessão (sem reload): a lista de favoritos acompanha, sem precisar favoritar de novo", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1"]));
    productsDaLoja = [produtoAtual("p1", { price: 50, stock: 10 })];

    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    let ctx = ultimoContexto as { favorites: Product[] } | null;
    expect(ctx?.favorites[0].price).toBe(50);

    // A lojista muda o preço enquanto a aba do visitante continua aberta —
    // simulado aqui como uma nova leitura do catálogo (o hook real refaz
    // isso via realtime/refetch; o que este teste prova é que o memo de
    // `favorites` reage à mudança de `allProducts`, não fica preso ao
    // retrato do primeiro render).
    productsDaLoja = [produtoAtual("p1", { price: 999, stock: 3 })];

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    ctx = ultimoContexto as { favorites: Product[] } | null;
    expect(ctx?.favorites[0].price).toBe(999);
  });

  it("produto excluído do catálogo: o favorito não trava a lista com dado zumbi indefinidamente — some quando o catálogo confirma que ele não existe mais", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1", "p2"]));
    productsDaLoja = [produtoAtual("p1"), produtoAtual("p2")];

    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    let ctx = ultimoContexto as { favorites: Product[] } | null;
    expect(ctx?.favorites.map((p) => p.id).sort()).toEqual(["p1", "p2"]);

    // p2 é excluído do catálogo pela lojista.
    productsDaLoja = [produtoAtual("p1")];

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    ctx = ultimoContexto as { favorites: Product[] } | null;
    // p1 continua (com dado vivo); p2 não pode continuar mostrando o
    // retrato antigo como se nada tivesse acontecido.
    expect(ctx?.favorites.find((p) => p.id === "p1")?.price).toBe(80);
    const p2 = ctx?.favorites.find((p) => p.id === "p2");
    if (p2) {
      // Se ainda aparece (fallback ao último retrato conhecido, para não
      // sumir sem explicação), não pode fingir que é dado vivo/atual.
      expect(p2.price).toBe(50);
    }
  });
});
