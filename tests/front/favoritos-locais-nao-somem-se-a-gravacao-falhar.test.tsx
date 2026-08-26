// @vitest-environment jsdom
//
// LOJA-05 — os favoritos do visitante somem para sempre quando ele cria
// conta e a gravação no servidor falha.
//
// Até 26/08/2026, `FavoritesContext.tsx` disparava um `upsert` por produto
// favoritado localmente e esperava com `Promise.all(promises)` sem NUNCA ler
// o `{ error }` de cada resultado — e o cliente do Supabase não rejeita a
// promessa quando `shouldThrowOnError` é `false` (o padrão aqui:
// node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts:390-391).
// Então, mesmo com todo `upsert` falhando, o código seguia direto para
// `setLocalFavorites([])` + `localStorage.removeItem(FAVORITES_KEY)` e
// disparava `toast.success("Seus favoritos locais foram sincronizados!")` —
// perda silenciosa e definitiva do que só existia no aparelho.
//
// ATUALIZADO em 26/08/2026 (achado 2 da revisão de contexto limpo sobre esta
// mesma correção): a primeira versão deste teste mantinha o que falhou
// DENTRO da chave anônima `ikcous_favorites` — e isso vazava o favorito de
// quem logou para o próximo visitante do mesmo aparelho, num logout
// seguinte (ver favoritos-nao-vazam-para-proximo-visitante-no-logout.test.tsx).
// A chave anônima agora muda de dono no login, SEMPRE — o que não grava vai
// para uma fila POR USUÁRIO (`ikcous_favorites_pendentes:<id>`), nunca de
// volta para o balde anônimo. As asserções abaixo migraram para essa fila.
//
// Este teste prende os DOIS ramos: (1) alguns produtos sincronizam e outros
// falham — só os que falharam continuam retidos (na fila do usuário), sem
// toast de sucesso mentindo sobre os outros; (2) todos falham — nada é
// perdido.
//
// Vermelho contra o código antigo: com o dublê do supabase abaixo devolvendo
// `{ error }` em pelo menos um `upsert`, o código antigo ignora o erro,
// esvazia `localStorage` inteiro e chama `toast.success`. As asserções de
// "o que falhou continua salvo" e "toast.success não dispara com erro
// pendente" reprovariam contra ele.
import { act } from "react";
import { useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FavoritesContext } from "@/contexts/FavoritesContext";
import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";
// `usuarioDaVez` abaixo é sempre `{ id: "u1" }` nestes testes.
const PENDING_KEY = "ikcous_favorites_pendentes:u1";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] as Product[], loading: false }),
}));

let usuarioDaVez: { id: string } | null = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// product_id -> resultado do upsert. `undefined` = sucesso ({ error: null }).
let resultadoPorProduto: Record<string, { message: string } | undefined> = {};
const chamadasUpsert: string[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push(obj.product_id);
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
// cor-da-loja-vem-do-banco.test.tsx / auth-logout-cleanup.test.tsx.
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

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    price: 10,
    images: [],
  } as unknown as Product;
}

// O que importa é que a chave anônima não carregue nenhum produto — seja
// porque a chave foi removida, seja porque ficou com "[]". As duas formas
// são equivalentes para quem lê depois (useLocalStorage trata ausência e
// "[]" como a mesma lista vazia), então a asserção é sobre CONTEÚDO, nunca
// sobre a chave existir ou não (`toBeNull()` reprova contra "[]", que é um
// resultado igualmente correto). Mesmo helper de
// favoritos-nao-vazam-para-proximo-visitante-no-logout.test.tsx.
function idsNaChaveAnonima(storage: ReturnType<typeof criarStorageFake>) {
  const raw = storage.getItem(FAVORITES_KEY);
  if (!raw) return [];
  return (JSON.parse(raw) as Product[]).map((p) => p.id);
}

function Sonda({ aoRenderizar }: { aoRenderizar: (v: unknown) => void }) {
  const ctx = useContext(FavoritesContext);
  aoRenderizar(ctx);
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let storageFake: ReturnType<typeof criarStorageFake>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  chamadasUpsert.length = 0;
  resultadoPorProduto = {};
  usuarioDaVez = { id: "u1" };
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

async function renderizarComLocaisPreExistentes(ids: string[]) {
  storageFake.setItem(FAVORITES_KEY, JSON.stringify(ids.map(produto)));

  const { FavoritesProvider } = await import("@/contexts/FavoritesContext");
  const { toast } = await import("sonner");

  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda aoRenderizar={() => {}} />
      </FavoritesProvider>,
    );
  });
  // Várias voltas de microtarefa: o sync é assíncrono (Promise.all dos
  // upserts) e só depois disso setLocalFavorites/fetchDbFavorites rodam.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return { toast };
}

describe("FavoritesContext — sync local->servidor não apaga o que não gravou", () => {
  it("um produto falha, outro sincroniza: o que falhou continua salvo, sem toast de sucesso", async () => {
    resultadoPorProduto = { p2: { message: "network down" } };

    const { toast } = await renderizarComLocaisPreExistentes(["p1", "p2"]);

    expect(chamadasUpsert.sort()).toEqual(["p1", "p2"]);

    // A chave anônima muda de dono no login, sempre — não fica retendo
    // nada, sincronizado ou não.
    expect(idsNaChaveAnonima(storageFake)).toEqual([]);

    const pendentes = JSON.parse(
      storageFake.getItem(PENDING_KEY) ?? "[]",
    ) as Product[];
    const idsPendentes = pendentes.map((p) => p.id);

    // p1 sincronizou: não pode continuar retido em nenhuma fila.
    expect(idsPendentes).not.toContain("p1");
    // p2 falhou: tem que continuar retido (na fila deste usuário), ou o
    // favorito da pessoa desaparece para sempre.
    expect(idsPendentes).toContain("p2");

    // Nenhuma mensagem de "sincronizado com sucesso" pode aparecer quando
    // parte do lote falhou — isso é exatamente a mentira que o defeito
    // contava para a pessoa.
    expect(toast.success).not.toHaveBeenCalledWith(
      expect.stringContaining("sincronizados"),
    );
    expect(toast.error).toHaveBeenCalled();
  });

  it("todos os produtos falham: localStorage continua com os dois, nada é apagado", async () => {
    resultadoPorProduto = {
      p1: { message: "network down" },
      p2: { message: "network down" },
    };

    const { toast } = await renderizarComLocaisPreExistentes(["p1", "p2"]);

    expect(idsNaChaveAnonima(storageFake)).toEqual([]);

    const pendentes = JSON.parse(
      storageFake.getItem(PENDING_KEY) ?? "[]",
    ) as Product[];
    const idsPendentes = pendentes.map((p) => p.id);

    expect(idsPendentes.sort()).toEqual(["p1", "p2"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("todos sincronizam: aí sim o local é limpo e o sucesso é avisado", async () => {
    resultadoPorProduto = {};

    const { toast } = await renderizarComLocaisPreExistentes(["p1", "p2"]);

    expect(idsNaChaveAnonima(storageFake)).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("sincronizados"),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
