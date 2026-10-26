// @vitest-environment jsdom
//
// Achados 4 (parte do cartão de devolução) e 5 (offline) da caçada de
// 26/10/2026:
//  - "Devolver R$…", "Tentar de novo" e "Já devolvi por fora" tinham 32 a 36px
//    de altura: abaixo do alvo de toque de 44px (min-h-11);
//  - o cartão ignorava o estado offline: sem internet, o botão seguia ligado
//    e o clique só falhava depois. Os outros cartões da ficha (etiqueta,
//    rastreio) desligam as ações — este agora também, recebendo `isOffline`
//    da ficha.
// O hook é mockado (a leitura do banco tem suíte própria).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";

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

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
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
  AlertDialogAction: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-offline-1",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

function linha(extra: Partial<LinhaEstornoDoPedido>): LinhaEstornoDoPedido {
  return {
    id: "refund-1",
    amount: 30,
    status: "falhou",
    solicitado_por: "lojista",
    mp_status: null,
    mp_status_detail: null,
    tentativas: 1,
    ultimo_erro: "o banco recusou",
    motivo: null,
    created_at: "2026-09-01T10:00:00.000Z",
    concluido_em: null,
    pode_ter_saido: false,
    por_fora_liberado_em: null,
    por_fora_apos_espera_liberado: false,
    substituida_por_manual: false,
    eh_pix: false,
    ...extra,
  };
}

function hook(linhas: LinhaEstornoDoPedido[]) {
  return {
    linhas,
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
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    registrarPorForaAposEspera: vi.fn().mockResolvedValue(true),
    enviando: false,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  useEstornosDoPedidoMock.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const botao = (parte: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").includes(parte),
  );

async function montarCartao(isOffline?: boolean) {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido} isOffline={isOffline} />);
  });
}

const COM_TODOS_OS_BOTOES = [
  linha({ id: "r-falhou", status: "falhou" }),
  linha({
    id: "r-velho",
    status: "falhou",
    pode_ter_saido: true,
    por_fora_apos_espera_liberado: true,
  }),
];

describe("EstornoCard — alvo de toque de 44px", () => {
  it("'Devolver R$', 'Tentar de novo' e 'Já devolvi por fora' têm min-h-11", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hook(COM_TODOS_OS_BOTOES));
    await montarCartao();

    expect(botao("Devolver R$ 100,00")?.className).toContain("min-h-11");
    expect(botao("Tentar de novo")?.className).toContain("min-h-11");
    expect(botao("Já devolvi por fora")?.className).toContain("min-h-11");
  });
});

describe("EstornoCard — sem internet, as ações que falam com o servidor ficam desligadas", () => {
  it("online: os três botões estão ligados", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hook(COM_TODOS_OS_BOTOES));
    await montarCartao(false);

    expect(botao("Devolver R$ 100,00")?.disabled).toBe(false);
    expect(botao("Tentar de novo")?.disabled).toBe(false);
    expect(botao("Já devolvi por fora")?.disabled).toBe(false);
  });

  it("offline: 'Devolver', 'Tentar de novo' e 'Já devolvi por fora' ficam desligados e o clique não pede confirmação", async () => {
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    const h = hook(COM_TODOS_OS_BOTOES);
    useEstornosDoPedidoMock.mockReturnValue(h);
    await montarCartao(true);

    for (const parte of [
      "Devolver R$ 100,00",
      "Tentar de novo",
      "Já devolvi por fora",
    ]) {
      const b = botao(parte);
      expect(b, parte).toBeTruthy();
      expect(b?.disabled, parte).toBe(true);
      await act(async () => b?.click());
    }
    expect(confirmar).not.toHaveBeenCalled();
    expect(h.solicitarEstorno).not.toHaveBeenCalled();
    expect(h.registrarPorForaAposEspera).not.toHaveBeenCalled();
  });

  it("a ficha repassa o estado offline ao cartão", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hook([]));
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedido} onStatusChange={vi.fn()} isOffline />,
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(botao("Devolver R$ 100,00")?.disabled).toBe(true);
  });
});
