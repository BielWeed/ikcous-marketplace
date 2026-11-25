// @vitest-environment jsdom
//
// Caça por mutação no Perfil, dois estados dos endereços de entrega:
//   1. Sem conta aberta o Perfil não pede os endereços (nem os pedidos): quem
//      não entrou só é levado ao login. Pedir endereço sem sessão é chamada que
//      sempre falha.
//   2. Quando os endereços falharam e uma nova busca já está em andamento, o
//      botão "Tentar de novo" fica travado (toque repetido não dispara outra
//      busca por cima da primeira); com a busca parada ele funciona e chama a
//      busca UMA vez. E se ainda não há endereço nenhum e a busca está no ar, o
//      que aparece é o "Carregando endereços", sem o aviso de erro.
//
// RENDER DE VERDADE da tela; só os hooks de dados e a lista de endereços são
// dublês.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { fetchAddresses, fetchUserOrders, onNavigate, estado } = vi.hoisted(
  () => ({
    fetchAddresses: vi.fn(),
    fetchUserOrders: vi.fn(),
    onNavigate: vi.fn(),
    estado: {
      user: null as { id: string; email: string } | null,
      enderecos: [] as Array<{ id: string }>,
      carregando: false,
      erro: false,
    },
  }),
);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: estado.user,
    profile: estado.user
      ? { full_name: "Cliente", avatar_url: null, cover_url: null }
      : null,
    fetchProfile: vi.fn().mockResolvedValue(true),
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.enderecos,
    fetchAddresses,
    deleteAddress: vi.fn(),
    loading: estado.carregando,
    erroAoCarregar: estado.erro,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], ordersLoadError: null, fetchUserOrders }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="lista-de-enderecos" />,
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

describe("ProfileView — endereços: sem conta e 'Tentar de novo'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/ProfileView");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchAddresses.mockResolvedValue(undefined);
    fetchUserOrders.mockResolvedValue([]);
    estado.user = { id: "conta-a", email: "conta-a@example.com" };
    estado.enderecos = [];
    estado.carregando = false;
    estado.erro = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar() {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const tentarDeNovoDosEnderecos = () =>
    hospedeiro
      .querySelector('[role="alert"]')
      ?.querySelector<HTMLButtonElement>("button");

  it("sem conta aberta: leva ao login e não pede endereços nem pedidos", async () => {
    estado.user = null;

    await renderizar();

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("auth");
    expect(fetchAddresses).not.toHaveBeenCalled();
    expect(fetchUserOrders).not.toHaveBeenCalled();
  });

  it("controle: com conta aberta, pede os endereços uma vez ao abrir", async () => {
    await renderizar();

    expect(fetchAddresses).toHaveBeenCalledTimes(1);
  });

  it("falhou e a nova busca está no ar: o 'Tentar de novo' fica travado", async () => {
    estado.enderecos = [{ id: "end-1" }];
    estado.erro = true;
    estado.carregando = true;

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar seus endereços agora.",
    );
    expect(tentarDeNovoDosEnderecos()?.disabled).toBe(true);
  });

  it("falhou e a busca parou: o 'Tentar de novo' funciona e busca UMA vez", async () => {
    estado.enderecos = [{ id: "end-1" }];
    estado.erro = true;
    estado.carregando = false;

    await renderizar();
    fetchAddresses.mockClear();

    expect(tentarDeNovoDosEnderecos()?.disabled).toBe(false);
    await act(async () => tentarDeNovoDosEnderecos()?.click());

    expect(fetchAddresses).toHaveBeenCalledTimes(1);
  });

  it("sem endereço nenhum e a busca no ar: mostra 'Carregando endereços', sem o aviso de erro", async () => {
    estado.enderecos = [];
    estado.erro = true;
    estado.carregando = true;

    await renderizar();

    expect(hospedeiro.textContent).toContain("Carregando endereços");
    expect(hospedeiro.textContent).not.toContain(
      "Não conseguimos carregar seus endereços agora.",
    );
  });
});
