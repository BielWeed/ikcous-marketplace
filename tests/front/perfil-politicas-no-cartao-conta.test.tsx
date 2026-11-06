// @vitest-environment jsdom
//
// Defeito medido: quem já tem conta só achava Termos de uso, Privacidade e
// Trocas e devoluções no fim da lista de produtos do Início (rolagem que carrega
// 12 por vez). O cartão "Conta" do Perfil agora traz as três, ao lado de
// "Segurança e conta" e "Sobre a loja". Mesmos mocks de
// perfil-botao-sobre-a-loja-todos-os-usuarios (a tela em prova é o menu).
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "gabriel@ikcous.com", user_metadata: {} },
    profile: { full_name: "João Gabriel", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: async () => [] }),
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

vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="address-list-stub" />,
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => <div data-testid="order-timeline-stub" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Mudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Mudo);
vi.stubGlobal("IntersectionObserver", Mudo);

describe("ProfileView — as políticas da loja moram no cartão Conta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function renderizarPerfil(
    onNavigate: (view: View, id?: string) => void,
  ) {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function botaoDoCartao(titulo: string) {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.querySelector("span > span")?.textContent === titulo,
    );
  }

  it("as três políticas estão no cartão Conta e cada uma leva à sua página", async () => {
    const onNavigate = vi.fn();
    await renderizarPerfil(onNavigate);

    const termos = botaoDoCartao("Termos de uso");
    const privacidade = botaoDoCartao("Política de Privacidade");
    const trocas = botaoDoCartao("Trocas e devoluções");
    expect(termos).toBeDefined();
    expect(privacidade).toBeDefined();
    expect(trocas).toBeDefined();

    // Mesmo cartão de "Segurança e conta" e "Sobre a loja".
    const cartao = termos!.closest("div.overflow-hidden");
    expect(cartao).not.toBeNull();
    expect(cartao!.textContent).toContain("Segurança e conta");
    expect(cartao!.textContent).toContain("Sobre a loja");
    expect(cartao!.contains(privacidade!)).toBe(true);
    expect(cartao!.contains(trocas!)).toBe(true);
    expect(cartao!.textContent).not.toContain("Encerrar sessão");

    await act(async () => {
      termos!.click();
    });
    await act(async () => {
      privacidade!.click();
    });
    await act(async () => {
      trocas!.click();
    });
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      "terms",
      "privacy",
      "returns-policy",
    ]);
  });

  it("Sobre a loja e Segurança e conta seguem levando aos mesmos destinos", async () => {
    const onNavigate = vi.fn();
    await renderizarPerfil(onNavigate);
    await act(async () => {
      botaoDoCartao("Sobre a loja")!.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("about-store");
    await act(async () => {
      botaoDoCartao("Segurança e conta")!.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("account-settings");
  });
});
