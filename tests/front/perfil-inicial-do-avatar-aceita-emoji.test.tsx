// @vitest-environment jsdom
//
// Achado 9 (R21): a inicial do avatar do Perfil (sem foto) usava
// `charAt(0)`, que devolve só METADE de um emoji (par substituto UTF-16) e o
// navegador desenha um losango quebrado. Sua conta e Perfil público já usam
// `Array.from`. RENDER DE VERDADE da ProfileView; só os hooks de dados são
// dublês. Dados inventados (nada de cliente real).
import type { Address, Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  isAdmin: false,
  userCriadoEm: "2026-10-15T12:00:00Z" as string | undefined,
  profile: {
    full_name: "Maria Teste Silva",
    avatar_url: null,
    cover_url: null,
    whatsapp: "34988887777",
  } as Record<string, unknown> | null,
  addresses: [] as Address[],
  loading: false,
  erroAoCarregar: false,
  orders: [] as Order[],
};
const logout = vi.fn();
const fetchAddresses = vi.fn(async () => {});
const deleteAddress = vi.fn(async () => true);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "maria.teste@exemplo.test",
      user_metadata: {},
      created_at: estado.userCriadoEm,
    },
    profile: estado.profile,
    logout,
    isAdmin: estado.isAdmin,
    loading: false,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.addresses,
    fetchAddresses,
    deleteAddress,
    loading: estado.loading,
    erroAoCarregar: estado.erroAoCarregar,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: estado.orders,
    fetchUserOrders: async () => estado.orders,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja Teste", whatsappNumber: "34999999999" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

describe("ProfileView — inicial do avatar sem foto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.isAdmin = false;
    estado.addresses = [];
    estado.loading = false;
    estado.erroAoCarregar = false;
    estado.orders = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function inicialDoAvatarPara(nome: string) {
    estado.profile = {
      full_name: nome,
      avatar_url: null,
      cover_url: null,
      whatsapp: "34988887777",
    };
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // A inicial é o único texto decorativo (aria-hidden) com a classe do avatar.
    return hospedeiro.querySelector('span[aria-hidden="true"].text-4xl')
      ?.textContent;
  }

  it("nome que começa com emoji mostra o emoji inteiro, não metade dele", async () => {
    expect(await inicialDoAvatarPara("😀 Ana")).toBe("😀");
  });

  it("nome comum continua mostrando a inicial em maiúscula", async () => {
    expect(await inicialDoAvatarPara("  maria Teste")).toBe("M");
  });
});
