// @vitest-environment jsdom
//
// Defeito do dono (25/09/2026, print da conta real): o Perfil não mostrava o
// cartão "Pedidos em Andamento" enquanto Carrinho > Meus Pedidos mostrava
// EM ANDAMENTO (5). Causa (laudo do investigador, reproduzida com o hook
// real): `useOrders` NÃO busca ao montar — o estado nasce do cache
// `ikcous_orders_cache_<id>`, que só `fetchUserOrders` grava, e cada tela tem
// a SUA cópia da lista. A CartView chama a busca; a ProfileView nunca chamou.
// Depois do login (o logout apaga o cache) o Perfil nascia vazio.
//
// Por isso este teste usa o `useOrders` REAL, com o Supabase simulado, o
// realtime "saudável" (inscrição sem erro, sem reconexão que buscaria por
// conta própria) e o cache do aparelho VAZIO. Um dublê do hook inteiro
// esconderia o defeito — foi o que cegou a primeira sonda.
import type { View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linhasDoBanco = [
  {
    id: "pedido-andamento-1",
    user_id: "user-1",
    status: "pending",
    total: 50,
    created_at: new Date().toISOString(),
    customer_data: {},
    items: [],
  },
];
let buscasDePedidos = 0;

function builderDoFetch() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) => {
    buscasDePedidos++;
    return Promise.resolve({ data: linhasDoBanco, error: null }).then(
      resolve,
      reject,
    );
  };
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
  // Referência ESTÁVEL do usuário, como no AuthContext real: um objeto novo
  // a cada render trocaria a identidade de `fetchUserOrders` em todo render.
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

describe("ProfileView — busca os pedidos ao abrir (hook real, cache vazio)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    buscasDePedidos = 0;
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    // Cache do aparelho VAZIO: o estado de quem acabou de entrar na conta.
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
    const onNavigate = vi.fn() as (view: View, id?: string) => void;
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} isActive={isActive} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("aba visível: o cartão Pedidos em Andamento aparece sem precisar abrir Meus Pedidos", async () => {
    await renderizar(true);

    expect(buscasDePedidos).toBeGreaterThan(0);
    expect(hospedeiro.textContent).toContain("Pedidos em Andamento");
  });

  it("aba escondida não busca; ao voltar a ser a visível, busca de novo", async () => {
    await renderizar(false);
    expect(buscasDePedidos).toBe(0);

    await renderizar(true);
    expect(buscasDePedidos).toBe(1);
    expect(hospedeiro.textContent).toContain("Pedidos em Andamento");

    // Sai e volta: a cópia do Perfil não recebe a busca de outra tela, então
    // cada retorno à aba relê.
    await renderizar(false);
    await renderizar(true);
    expect(buscasDePedidos).toBe(2);
  });
});
