// @vitest-environment jsdom
//
// Peça 24: o botão "Sobre a Loja" no Perfil é visível a TODOS os usuários —
// usuário comum E admin. O bloco "MODO ADMIN" é condicional (isAdmin); o
// cartão novo NÃO mora dentro de ramo nenhum: os dois cenários abaixo provam
// isso renderizando a ProfileView real, uma vez por perfil.
//
// Mesmo padrão de mocks de user-profile-view-visitante-le-pela-vitrine.test.tsx
// (createRoot + act; hooks dublês; filhos pesados de lista stubados — a tela
// em prova aqui é o menu, não a lista de endereços).
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let flagAdmin = false;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "gabriel@ikcous.com", user_metadata: {} },
    profile: { full_name: "João Gabriel", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: flagAdmin,
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

// Filhos de lista não são o assunto deste teste: a ProfileView inteira de
// verdade está montada, só os blocos de listagem externos viram stubs.
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="address-list-stub" />,
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => <div data-testid="order-timeline-stub" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

describe("ProfileView — botão Sobre a Loja para TODOS os usuários (peça 24)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  function botaoSobreALoja() {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Sobre a Loja"),
    );
  }

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

  it("usuário COMUM vê o botão e ele navega para about-store", async () => {
    flagAdmin = false;
    const onNavigate = vi.fn();

    await renderizarPerfil(onNavigate);

    // Prova de que este cenário é um usuário comum: o bloco admin não está na
    // tela, mas o cartão novo está.
    expect(hospedeiro.textContent).not.toContain("Modo Admin");
    const botao = botaoSobreALoja();
    expect(botao).toBeDefined();

    await act(async () => {
      botao!.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("about-store");
  });

  it("ADMIN também vê o botão (nada de ramo condicional em volta)", async () => {
    flagAdmin = true;
    const onNavigate = vi.fn();

    await renderizarPerfil(onNavigate);

    expect(hospedeiro.textContent).toContain("Modo Admin");
    expect(botaoSobreALoja()).toBeDefined();
  });

  it("ordem do dono: Sobre a Loja logo abaixo de Segurança e Conta; Encerrar Sessão em cartão separado embaixo", async () => {
    flagAdmin = false;

    await renderizarPerfil(() => {});

    const botao = botaoSobreALoja();
    expect(botao).toBeDefined();
    // O botão novo vive NO MESMO cartão de Segurança e Conta (a linha acima
    // dele), e esse cartão NÃO contém a ação destrutiva.
    const cartao = botao!.closest("div.overflow-hidden");
    expect(cartao).not.toBeNull();
    expect(cartao!.textContent).toContain("Segurança e Conta");
    expect(cartao!.textContent).not.toContain("Encerrar Sessão");

    // Encerrar Sessão ganhou cartão PRÓPRIO, DEPOIS do cartão do botão novo.
    const cartoes = [...hospedeiro.querySelectorAll("div.overflow-hidden")];
    const indiceDoCartao = cartoes.indexOf(cartao!);
    const cartaoEncerrar = cartoes
      .slice(indiceDoCartao + 1)
      .find((c) => c.textContent?.includes("Encerrar Sessão"));
    expect(cartaoEncerrar).toBeDefined();
  });
});
