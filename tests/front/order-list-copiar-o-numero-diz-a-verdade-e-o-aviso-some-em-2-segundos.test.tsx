// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), OrderList, botão do número do pedido (#XXXXXX).
//  - copiou: o botão vira "Copiado!", sai o aviso verde "Número do pedido copiado" e o texto
//    copiado é o número CURTO que a tela escreve (os 6 finais), nunca o id interno inteiro;
//  - o "Copiado!" volta ao número em 2 segundos (nem antes, nem depois);
//  - NÃO copiou (a API do navegador recusou): aviso de erro, nenhum "Copiado!" e nenhum
//    aviso de sucesso — o app não comemora o que não fez;
//  - tocar no número NÃO abre o pedido (o cartão inteiro é clicável).
// Relógio falso e sem rede; dados inventados.
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

import type { Order } from "@/types";

const copiar = vi.hoisted(() => vi.fn());
const aviso = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/copiar-para-clipboard", () => ({ copiarParaClipboard: copiar }));
vi.mock("sonner", () => ({ toast: aviso }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const pedido: Order = {
  id: "bbbbbbbb-2222-3333-4444-5555556789ab",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList: copiar o número do pedido", () => {
  // Aquece a tela pesada uma vez (o primeiro import custa vários segundos numa máquina carregada).
  beforeAll(async () => {
    await import("@/components/ui/custom/OrderList");
  }, 60_000);

  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    copiar.mockReset();
    aviso.success.mockReset();
    aviso.error.mockReset();
    onNavigate.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={onNavigate} />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  const botaoCopiar = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Copiar número do pedido"]',
    ) as HTMLButtonElement;

  async function tocarEmCopiar() {
    await act(async () => {
      botaoCopiar().click();
    });
  }

  it("copiou: 'Copiado!', aviso de sucesso e o número curto na área de transferência", async () => {
    copiar.mockResolvedValue(true);
    expect(botaoCopiar().textContent).toContain("#");
    await tocarEmCopiar();
    expect(copiar).toHaveBeenCalledTimes(1);
    expect(copiar.mock.calls[0]?.[0]).not.toBe(pedido.id);
    expect(String(copiar.mock.calls[0]?.[0]).length).toBeLessThan(
      pedido.id.length,
    );
    expect(botaoCopiar().textContent).toContain("Copiado!");
    expect(aviso.success).toHaveBeenCalledWith("Número do pedido copiado");
    expect(aviso.error).not.toHaveBeenCalled();
  });

  it("o 'Copiado!' volta ao número em 2 segundos: não some antes, não fica depois", async () => {
    copiar.mockResolvedValue(true);
    await tocarEmCopiar();
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(botaoCopiar().textContent).toContain("Copiado!");
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(botaoCopiar().textContent).not.toContain("Copiado!");
    expect(botaoCopiar().textContent).toContain("#");
  });

  it("não copiou: aviso de erro, sem 'Copiado!' e sem aviso de sucesso", async () => {
    copiar.mockResolvedValue(false);
    await tocarEmCopiar();
    expect(aviso.error).toHaveBeenCalledWith(
      "Não foi possível copiar. Selecione o texto e copie manualmente.",
    );
    expect(aviso.success).not.toHaveBeenCalled();
    expect(botaoCopiar().textContent).not.toContain("Copiado!");
  });

  it("tocar no número não abre o pedido; o botão 'Ver detalhes' abre", async () => {
    copiar.mockResolvedValue(true);
    await tocarEmCopiar();
    expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[data-testid="order-card-open"]')
        ?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("order-details", pedido.id);
  });
});
