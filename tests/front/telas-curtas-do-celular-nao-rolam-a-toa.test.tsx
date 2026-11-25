// @vitest-environment jsdom
//
// No celular, a área de conteúdo é MENOR que a janela: a altura da tela menos
// o cabeçalho (~53px a 390px de largura; a barra de baixo é flutuante). Uma
// tela curta com `min-h-screen` (100svh) pede a janela INTEIRA dentro dessa
// área e a tela rola ~53px à toa — medido no navegador a 390x844: scrollHeight
// 844 contra clientHeight 791. `min-h-full` preenche exatamente a área
// (791 = 791) e o conteúdo centrado continua centrado.
//
// Contrato: a raiz de uma tela curta (esqueleto do perfil e os dois estados
// vazios do pedido) NÃO pede 100svh. Mesmo mecanismo já resolvido no AuthView.
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

import { ProfileSkeleton } from "@/components/ui/custom/Skeletons";

const { fetchUserOrders, estado } = vi.hoisted(() => ({
  // Referência estável: a tela relê os pedidos quando ela muda.
  fetchUserOrders: vi.fn(),
  estado: {
    user: null as { id: string } | null,
    loading: false,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: [],
    ordersLoadError: null,
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: estado.loading }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

function armazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => {
      dados.set(c, String(v));
    },
    removeItem: (c: string) => {
      dados.delete(c);
    },
    clear: () => dados.clear(),
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

const classesDaRaiz = () =>
  (hospedeiro.firstElementChild as HTMLElement).className.split(/\s+/);

async function abrirPedido(orderId: string) {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={orderId}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

// A primeira importação da tela transforma o módulo inteiro (segundos): fora
// do relógio de cada teste, para o timeout não virar falha intermitente.
beforeAll(async () => {
  await import("@/views/customer/OrderDetailsView");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", armazem());
  vi.stubGlobal("localStorage", armazem());
  estado.user = null;
  estado.loading = false;
  fetchUserOrders.mockResolvedValue([]);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("telas curtas do celular não rolam à toa", () => {
  it("o esqueleto do perfil enche a área, sem pedir a janela inteira", () => {
    act(() => raiz.render(<ProfileSkeleton />));

    const classes = classesDaRaiz();
    expect(classes).not.toContain("min-h-screen");
    expect(classes).toContain("min-h-full");
  });

  it("'Sincronizando pedido…' enche a área, sem pedir a janela inteira", async () => {
    estado.loading = true;
    await abrirPedido("pedido-qualquer");

    expect(hospedeiro.textContent).toContain("Sincronizando pedido");
    const classes = classesDaRaiz();
    expect(classes).not.toContain("min-h-screen");
    expect(classes).toContain("min-h-full");
  });

  it("'Pedido não encontrado' enche a área, sem pedir a janela inteira", async () => {
    await abrirPedido("");

    expect(hospedeiro.textContent).toContain(
      "Este link de pedido está incompleto",
    );
    const classes = classesDaRaiz();
    expect(classes).not.toContain("min-h-screen");
    expect(classes).toContain("min-h-full");
  });
});
