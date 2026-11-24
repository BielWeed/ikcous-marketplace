// @vitest-environment jsdom
//
// "Limpar indisponíveis" (favoritos da conta cujo produto a loja pausou ou
// tirou do catálogo) fecha com UM aviso, e os vizinhos só provam os extremos
// (tudo removido / nada removido). Aqui ficam as bordas do aviso:
//
// - exatamente 1 removido: "1 favorito removido" (singular); 2: "2 favoritos
//   removidos" (plural);
// - falha PARCIAL (uma remoção deu certo, a seguinte falhou): o aviso é de
//   erro, nunca o de sucesso -- dizer "1 favorito removido" para quem pediu
//   para limpar dois esconde que um continua lá;
// - nada a limpar: nenhuma remoção, nenhum aviso.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";

const mundo = vi.hoisted(() => ({
  usuario: { id: "conta-limpar-1" },
  idsNoServidor: [] as string[],
  idsQueFalham: new Set<string>(),
  removidosPedidos: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      {
        id: "p1",
        name: "Produto p1",
        price: 10,
        stock: 5,
        isActive: true,
        images: [],
      },
    ],
    loading: false,
    catalogoDaRedeAplicado: true,
    catalogoErro: null,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: mundo.idsNoServidor.map((product_id, indice) => ({
              product_id,
              created_at: new Date(2026, 0, 1, 0, indice).toISOString(),
            })),
            error: null,
          }),
      }),
      delete: () => ({
        eq: () => ({
          eq: (_coluna: string, produtoId: string) => {
            mundo.removidosPedidos.push(produtoId);
            return Promise.resolve({
              error: mundo.idsQueFalham.has(produtoId)
                ? { message: "sem rede" }
                : null,
            });
          },
        }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Contexto = NonNullable<React.ContextType<typeof FavoritesContext>>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
const observar = vi.fn<(valor: Contexto | undefined) => void>();
const atual = () => observar.mock.calls.at(-1)?.[0] as Contexto;

function Sonda() {
  observar(useContext(FavoritesContext));
  return null;
}

async function montarELimpar(idsNoServidor: string[]) {
  mundo.idsNoServidor = idsNoServidor;
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
  await act(async () => {
    await atual().limparIndisponiveis();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mundo.idsNoServidor = [];
  mundo.idsQueFalham.clear();
  mundo.removidosPedidos = [];
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void valores.set(chave, valor),
    removeItem: (chave: string) => void valores.delete(chave),
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("favoritos da conta: aviso de 'Limpar indisponíveis'", () => {
  it("um removido diz 'favorito' no singular", async () => {
    await montarELimpar(["p1", "fora-1"]);

    expect(mundo.removidosPedidos).toEqual(["fora-1"]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("1 favorito removido");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("dois removidos dizem 'favoritos' no plural", async () => {
    await montarELimpar(["p1", "fora-1", "fora-2"]);

    expect(mundo.removidosPedidos).toEqual(["fora-1", "fora-2"]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("2 favoritos removidos");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falha parcial: uma removida e outra não avisa o ERRO, não o sucesso", async () => {
    mundo.idsQueFalham.add("fora-2");

    await montarELimpar(["p1", "fora-1", "fora-2"]);

    expect(mundo.removidosPedidos).toEqual(["fora-1", "fora-2"]);
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível remover todos os favoritos indisponíveis",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("nada indisponível: não remove nada e não avisa nada", async () => {
    await montarELimpar(["p1"]);

    expect(mundo.removidosPedidos).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
