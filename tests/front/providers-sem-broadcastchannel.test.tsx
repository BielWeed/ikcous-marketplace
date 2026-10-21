// @vitest-environment jsdom
import { type ComponentType, type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => {
  const products: unknown[] = [];
  return { useProducts: () => ({ products }) };
});
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag de teste do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe.each(["ausente", "bloqueado"])("canal %s", (situacao) => {
  beforeEach(() => {
    vi.stubGlobal("BroadcastChannel", undefined);
    if (situacao === "ausente") {
      Reflect.deleteProperty(globalThis, "BroadcastChannel");
    } else {
      vi.stubGlobal(
        "BroadcastChannel",
        class {
          constructor() {
            throw new DOMException("Canal bloqueado", "SecurityError");
          }
        },
      );
    }
  });

  it.each(["carrinho", "favoritos", "notificações"])(
    "monta e desmonta %s sem derrubar a loja",
    async (nome) => {
      let Provider: ComponentType<{ children: ReactNode }>;
      if (nome === "carrinho") {
        Provider = (await import("@/contexts/CartContext")).CartProvider;
      } else if (nome === "favoritos") {
        Provider = (await import("@/contexts/FavoritesContext"))
          .FavoritesProvider;
      } else {
        Provider = (await import("@/contexts/NotificationContext"))
          .NotificationProvider;
      }
      await act(async () => {
        raiz.render(
          <Provider>
            <span>Loja aberta</span>
          </Provider>,
        );
      });
      expect(hospedeiro.textContent).toBe("Loja aberta");
      await act(async () => raiz.unmount());
      expect(hospedeiro.textContent).toBe("");
    },
  );
});
