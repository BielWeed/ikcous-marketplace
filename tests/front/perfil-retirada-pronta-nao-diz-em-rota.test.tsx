// @vitest-environment jsdom
//
// RETIRADA NA LOJA: no Perfil, o cartão "Pedidos em Andamento" de um pedido
// "Pronto para retirar" (gravado como `shipping`) mostrava a etapa "Em rota"
// com caminhão -- a cliente vai BUSCAR, nada está a caminho (14/10/2026).
//
// Este teste usa a ProfileView de verdade com o OrderTimeline REAL (o teste
// de `OrderTimeline` sozinho não prova que a tela passa a informação de
// retirada para ele). Mesmo harness de perfil-busca-pedidos-ao-abrir.test.tsx.
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  linhas: [] as Array<Record<string, unknown>>,
};

function builderDoFetch() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: estado.linhas, error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => builderDoFetch()),
    channel: vi.fn(() => {
      const canal: any = {};
      canal.on = vi.fn(() => canal);
      canal.subscribe = vi.fn(() => canal);
      return canal;
    }),
    removeChannel: vi.fn(() => Promise.resolve()),
    rpc: vi.fn(),
  },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => {
  const usuario = {
    id: "user-1",
    email: "cliente@ikcous.com",
    user_metadata: {},
  };
  return {
    useAuth: () => ({
      user: usuario,
      profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
      logout: vi.fn(),
      isAdmin: false,
      loading: false,
      updateProfile: async () => true,
    }),
  };
});

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function linhaDoPedido(retirada: boolean): Record<string, unknown> {
  return {
    id: "pedido-andamento-1",
    user_id: "user-1",
    status: "shipping",
    total: 50,
    created_at: new Date().toISOString(),
    customer_data: retirada
      ? { pickup_address: "Rua Fictícia de Teste, 100 — Centro" }
      : {},
    items: [],
  };
}

describe("ProfileView — o cartão do pedido pronto para retirar não diz 'Em rota'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function renderizar(): Promise<string> {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    const onNavigate = vi.fn() as (view: View, id?: string) => void;
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} isActive={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return hospedeiro.textContent ?? "";
  }

  it("retirada pronta (shipping): o cartão mostra 'Pronto para retirar' e nada de 'Em rota'", async () => {
    estado.linhas = [linhaDoPedido(true)];
    const texto = await renderizar();
    expect(texto).toContain("Pedidos em Andamento");
    expect(texto).toContain("Pronto para retirar");
    expect(texto).not.toContain("Em rota");
  });

  it("entrega a caminho (shipping): o cartão continua 'Em rota' (controle)", async () => {
    estado.linhas = [linhaDoPedido(false)];
    const texto = await renderizar();
    expect(texto).toContain("Pedidos em Andamento");
    expect(texto).toContain("Em rota");
    expect(texto).not.toContain("Pronto para retirar");
  });
});
