// @vitest-environment jsdom
//
// Caça de leitor de tela: depois do "sim" na pergunta de dinheiro, o botão que
// a abriu fica desligado ("Devolvendo…") ou some (pedido cancelado) e o foco
// caía no body. Os dois chamadores informam ao `useConfirmarAcao` o título do
// cartão como alvo estável:
//  · EstornoCard → o título "Devolução de dinheiro";
//  · ficha do pedido (cancelar) → o título "Pedido #…".
// O mecanismo do gancho está provado com o Radix de verdade em
// confirmacao-do-painel-devolve-o-foco-a-lugar-que-existe.test.tsx; aqui a
// janela é um dublê que guarda o `onCloseAutoFocus` para o teste chamá-lo
// como o Radix chamaria, depois de a tela reagir ao "sim".
import type { Order } from "@/types";
import { act, useState } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let aoFecharAJanela: ((evento: Event) => void) | undefined;

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({
    children,
    "data-testid": idDeTeste,
    onCloseAutoFocus,
  }: {
    children: ReactNode;
    "data-testid"?: string;
    onCloseAutoFocus?: (evento: Event) => void;
  }) => {
    aoFecharAJanela = onCloseAutoFocus;
    return <div data-testid={idDeTeste}>{children}</div>;
  },
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" data-acao-da-janela="" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: null, error: null }),
          ),
        })),
      })),
    })),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// O "Devolver" desliga de verdade: `enviando` é estado do dublê do hook.
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => {
    const [enviando, setEnviando] = useState(false);
    return {
      linhas: [],
      pago: 100,
      devolvido: 0,
      emCurso: 0,
      emDuvida: 0,
      disponivel: 100,
      reservadoPorFora: 0,
      carregando: false,
      pedidoCarregado: true,
      erro: false,
      recarregar: vi.fn(),
      solicitarEstorno: async () => setEnviando(true),
      registrarPorForaAposEspera: vi.fn(),
      enviando,
    };
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "pedido-foco-123456",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    paymentStatus: "pago",
    status: "processing",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    ...parcial,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  aoFecharAJanela = undefined;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

function botao(texto: string): HTMLButtonElement {
  const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").includes(texto),
  );
  expect(achado, `botão "${texto}"`).toBeTruthy();
  return achado!;
}

async function responderSimEFechar(origem: HTMLButtonElement) {
  await act(async () => {
    origem.focus();
    origem.click();
  });
  const sim = hospedeiro.querySelector<HTMLButtonElement>(
    "[data-acao-da-janela]",
  )!;
  await act(async () => sim.click());
  expect(aoFecharAJanela).toBeTypeOf("function");
  act(() => aoFecharAJanela?.(new Event("focusScope.autoFocusOnUnmount")));
}

describe("pergunta de dinheiro — o foco vai ao título do cartão depois do 'sim'", () => {
  it("EstornoCard: 'Devolvendo…' desligado, foco no título 'Devolução de dinheiro'", async () => {
    const { EstornoCard } = await import(
      "@/components/admin/orders/EstornoCard"
    );
    await act(async () =>
      raiz.render(<EstornoCard order={pedido({ status: "cancelled" })} />),
    );
    const origem = botao("Devolver R$ 100,00");
    await responderSimEFechar(origem);
    expect(origem.textContent).toContain("Devolvendo…");
    expect(origem.disabled).toBe(true);
    const titulo = document.activeElement as HTMLElement;
    expect(titulo.tagName).toBe("H3");
    expect(titulo.textContent).toBe("Devolução de dinheiro");
  });

  it("ficha do pedido: cancelado, o botão some e o foco vai ao título 'Pedido #…'", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const onStatusChange = vi.fn(async () => {});
    await act(async () =>
      raiz.render(
        <OrderDetail order={pedido()} onStatusChange={onStatusChange} />,
      ),
    );
    const origem = botao("Cancelar pedido");
    await act(async () => {
      origem.focus();
      origem.click();
    });
    const sim = hospedeiro.querySelector<HTMLButtonElement>(
      "[data-acao-da-janela]",
    )!;
    await act(async () => sim.click());
    expect(onStatusChange).toHaveBeenCalled();
    // O pedido volta cancelado: a barra de ação (e o botão de origem) some.
    await act(async () =>
      raiz.render(
        <OrderDetail
          order={pedido({ status: "cancelled" })}
          onStatusChange={onStatusChange}
        />,
      ),
    );
    expect(origem.isConnected).toBe(false);
    act(() => aoFecharAJanela?.(new Event("focusScope.autoFocusOnUnmount")));
    const titulo = document.activeElement as HTMLElement;
    expect(titulo.tagName).toBe("H1");
    expect(titulo.textContent).toContain("Pedido");
  });
});
