// @vitest-environment jsdom
//
// Achado 2 da revisão de contexto limpo (26/08/2026), cenário de aparelho
// COMPARTILHADO (balcão da loja, tablet de casa) — de ponta a ponta:
//
// 1. Visitante A favorita produtos sem conta (ficam em "ikcous_favorites").
// 2. A cria conta / faz login, e a gravação no servidor FALHA (sem rede).
//    A correção anterior (favoritos-locais-nao-somem-se-a-gravacao-falhar)
//    já garante, corretamente, que os favoritos de A não somem do
//    aparelho.
// 3. A sai da conta (logout).
// 4. Pessoa B abre o app como visitante, no MESMO aparelho.
//
// Até 26/08/2026, o passo 2 deixava os favoritos que falharam DENTRO do
// balde anônimo "ikcous_favorites" — a mesma chave que um visitante sem
// conta lê. B via os 5 favoritos de A.
//
// A correção move o que falhou para uma chave POR USUÁRIO
// ("ikcous_favorites_pendentes:<id>"), e a lista anônima muda de dono no
// login — sempre, com sucesso ou com falha. Este teste prova as DUAS
// pontas: A não perde o que favoritou (o disco continua com os dois
// produtos, contados em `pendingCount`, enquanto A está logada) e B não
// herda o que era de A.
//
// ATUALIZADO em 26/08/2026 (redesenho subtrativo) — a versão anterior deste
// teste também afirmava que os 2 produtos apareciam em `ctx.favorites`
// enquanto pendentes. Isso descrevia o mecanismo antigo (pendente
// renderizado como favorito), que foi removido por ser a raiz de três
// defeitos. A asserção migrou: `favorites` fica VAZIA enquanto os dois só
// existem na fila (nunca sincronizaram), e `pendingCount` é quem carrega a
// informação — sem criar um item tocável na lista.
//
// Vermelho contra o código antigo: `setLocalFavorites(naoSincronizados)`
// escrevia de volta em "ikcous_favorites" (a chave anônima), então depois
// do logout de A, `localStorage.getItem("ikcous_favorites")` continuava
// com os produtos de A — e é exatamente isso que a asserção final (o que B
// vê) reprovaria.
import type { Context } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { useContext, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] as Product[], loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// product_id -> resultado do upsert. `undefined` = sucesso ({ error: null }).
let resultadoPorProduto: Record<string, { message: string } | undefined> = {};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          const erro = resultadoPorProduto[obj.product_id];
          return Promise.resolve({
            data: erro ? null : [{}],
            error: erro ?? null,
          });
        },
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
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

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno de
// favoritos-locais-nao-somem-se-a-gravacao-falhar.test.tsx.
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

// O que importa é que a chave anônima não carregue nenhum produto de A —
// seja porque a chave foi removida, seja porque ficou com "[]". As duas
// formas são equivalentes para quem lê depois (useLocalStorage trata
// ausência e "[]" como a mesma lista vazia), então a asserção é sobre
// CONTEÚDO, não sobre a chave existir ou não.
function idsNaChaveAnonima(storage: ReturnType<typeof criarStorageFake>) {
  const raw = storage.getItem(FAVORITES_KEY);
  if (!raw) return [];
  return (JSON.parse(raw) as Product[]).map((p) => p.id);
}

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    price: 10,
    images: [],
  } as unknown as Product;
}

let ultimoContexto: unknown = null;
// `contexto` chega como PROP, resolvido a partir do MESMO import dinâmico
// que gerou o `FavoritesProvider` usado no teste. `vi.resetModules()` no
// `beforeEach` cria um `FavoritesContext` NOVO a cada import — usar uma
// referência importada estaticamente no topo do arquivo (antes do reset)
// faria `useContext` nunca casar com o Provider renderizado, devolvendo
// sempre o valor padrão (`undefined`).
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  // Escrever em `ultimoContexto` (declarada fora do componente) DENTRO do
  // corpo do render é efeito colateral impuro — react-hooks/globals reprova.
  // Mover para um efeito é a mesma captura, sem mutar durante o render.
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
  resultadoPorProduto = {};
  usuarioDaVez = null;
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

describe("FavoritesContext — favorito não sincronizado não vaza para o próximo visitante", () => {
  it("A favorita sem conta, login falha ao sincronizar, A sai — B (visitante) não vê os favoritos de A", async () => {
    // 1. Visitante A favorita 2 produtos sem conta.
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([produto("p1"), produto("p2")]),
    );

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

    // 2. A cria conta / loga — e a gravação FALHA para os dois produtos.
    resultadoPorProduto = {
      p1: { message: "network down" },
      p2: { message: "network down" },
    };
    usuarioDaVez = { id: "userA" };

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    // A lista anônima muda de dono no login, sempre — não pode continuar
    // com os produtos de A depois que a conta assumiu a posse.
    expect(idsNaChaveAnonima(storageFake)).toEqual([]);

    // Mas A não pode ter perdido o dado: os 2 produtos continuam retidos em
    // disco (write-ahead) e contados em `pendingCount` — só não aparecem
    // como ITEM da lista, porque a fila pendente é um buffer invisível
    // (ver o comentário grande em FavoritesContext.tsx antes do memo de
    // `favorites`).
    const ctxComAntesDoLogout = ultimoContexto as {
      favorites: Product[];
      pendingCount: number;
    } | null;
    expect(ctxComAntesDoLogout?.favorites).toEqual([]);
    expect(ctxComAntesDoLogout?.pendingCount).toBe(2);

    // 3. A sai da conta.
    usuarioDaVez = null;

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    // 4. B abre o app como visitante, no MESMO aparelho. B não pode ver
    // nenhum favorito de A: nem no localStorage anônimo, nem no contexto,
    // nem na contagem de pendentes (o defeito 3 do redesenho — "a fila de
    // A aparece na tela de B" — vale tanto para itens quanto para o
    // contador).
    expect(idsNaChaveAnonima(storageFake)).toEqual([]);

    const ctxDeB = ultimoContexto as {
      favorites: Product[];
      pendingCount: number;
    } | null;
    expect(ctxDeB?.favorites ?? []).toEqual([]);
    expect(ctxDeB?.pendingCount ?? 0).toBe(0);
  });
});
