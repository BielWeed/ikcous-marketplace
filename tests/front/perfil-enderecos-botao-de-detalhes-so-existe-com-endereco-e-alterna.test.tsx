// @vitest-environment jsdom
//
// Caça por mutação no Perfil: no cartão "Endereços de entrega", o botão
// "Ver detalhes dos endereços" só faz sentido com pelo menos UM endereço
// cadastrado (sem endereço ele abriria "detalhes" de nada), e alterna a lista
// entre compacta e aberta, trocando o próprio texto para "Ver menos detalhes".
// Nenhum teste prendia a ausência do botão na conta sem endereços.
//
// RENDER DE VERDADE da tela; a lista de endereços é um dublê que só mostra
// quantos endereços recebeu e se veio compacta.
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

let enderecosAtuais: Array<{ id: string }> = [];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "conta-a", email: "conta-a@example.com", user_metadata: {} },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: enderecosAtuais,
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    ordersLoadError: null,
    fetchUserOrders: async () => [],
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: ({
    addresses,
    compact,
  }: {
    addresses: unknown[];
    compact?: boolean;
  }) => (
    <div
      data-testid="lista-de-enderecos"
      data-quantos={addresses.length}
      data-compacta={String(compact)}
    />
  ),
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

describe("ProfileView — botão de detalhes dos endereços", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/ProfileView");
  }, 60_000);

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar(enderecos: Array<{ id: string }>) {
    enderecosAtuais = enderecos;
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const botaoDeDetalhes = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^Ver (detalhes dos endereços|menos detalhes)$/.test(
        b.textContent?.trim() ?? "",
      ),
    );
  const lista = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="lista-de-enderecos"]');

  it("sem nenhum endereço: a lista aparece vazia e NÃO existe o botão de detalhes", async () => {
    await renderizar([]);

    expect(lista()?.dataset.quantos).toBe("0");
    expect(botaoDeDetalhes()).toBeUndefined();
  });

  it("com um endereço: lista compacta, botão 'Ver detalhes dos endereços' abre e 'Ver menos detalhes' fecha", async () => {
    await renderizar([{ id: "end-1" }]);

    expect(lista()?.dataset.quantos).toBe("1");
    expect(lista()?.dataset.compacta).toBe("true");
    expect(botaoDeDetalhes()?.textContent?.trim()).toBe(
      "Ver detalhes dos endereços",
    );

    await act(async () => botaoDeDetalhes()?.click());
    expect(lista()?.dataset.compacta).toBe("false");
    expect(botaoDeDetalhes()?.textContent?.trim()).toBe("Ver menos detalhes");

    await act(async () => botaoDeDetalhes()?.click());
    expect(lista()?.dataset.compacta).toBe("true");
    expect(botaoDeDetalhes()?.textContent?.trim()).toBe(
      "Ver detalhes dos endereços",
    );
  });
});
