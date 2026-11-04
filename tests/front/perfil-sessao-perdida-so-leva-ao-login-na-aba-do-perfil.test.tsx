// @vitest-environment jsdom
//
// A aba Perfil fica montada (escondida) depois da primeira visita. Se a
// sessão acaba por outro motivo (saiu em outra aba, token revogado) enquanto
// a pessoa olha um produto ou o carrinho, o Perfil escondido remontava como
// visitante e jogava a pessoa na tela de login sem explicação. Só a aba
// VISÍVEL do Perfil pode levar ao login — inclusive o botão Sair, que é
// feito com o Perfil na frente.
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoAuth, fetchAddresses } = vi.hoisted(() => ({
  estadoAuth: {
    user: null as { id: string; email: string; user_metadata: object } | null,
    loading: false,
  },
  fetchAddresses: vi.fn(async () => {}),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: estadoAuth.user,
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: estadoAuth.loading,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses,
    deleteAddress: async () => true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: vi.fn() }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "IKCOUS - imports",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="address-list-stub" />,
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => <div data-testid="order-timeline-stub" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CLIENTE = {
  id: "user-1",
  email: "cliente@ikcous.com",
  user_metadata: {},
};

describe("ProfileView — só a aba visível leva ao login", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    onNavigate.mockClear();
    fetchAddresses.mockClear();
    estadoAuth.user = CLIENTE;
    estadoAuth.loading = false;
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
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

  async function renderizar(isActive: boolean) {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} isActive={isActive} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("sessão perdida com o Perfil ESCONDIDO: não manda a pessoa para o login", async () => {
    await renderizar(false);
    estadoAuth.user = null;
    await renderizar(false);

    expect(onNavigate).not.toHaveBeenCalledWith("auth");
  });

  it("sessão perdida com o Perfil VISÍVEL (ex.: botão Sair): leva ao login", async () => {
    await renderizar(true);
    estadoAuth.user = null;
    await renderizar(true);

    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  it("visitante que toca na aba Perfil (escondida -> visível): leva ao login", async () => {
    estadoAuth.user = null;
    await renderizar(false);
    expect(onNavigate).not.toHaveBeenCalledWith("auth");

    await renderizar(true);
    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  it("visitante com o Perfil visível desde o início: leva ao login", async () => {
    estadoAuth.user = null;
    await renderizar(true);

    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  it("verificação de sessão ainda em andamento: não redireciona (nem visível)", async () => {
    estadoAuth.user = null;
    estadoAuth.loading = true;
    await renderizar(true);

    expect(onNavigate).not.toHaveBeenCalledWith("auth");
  });

  it("logado: busca os endereços e não navega", async () => {
    await renderizar(true);

    expect(fetchAddresses).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
