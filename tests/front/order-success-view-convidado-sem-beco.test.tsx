// @vitest-environment jsdom
//
// CheckoutView-3301: mesma classe de defeito que a tela de sucesso do
// CheckoutView (ver checkout-convidado-sai-do-beco-na-tela-de-sucesso.
// test.tsx) também existe aqui — o botão "Meus Pedidos" navegava para
// "orders" (OrderSearch) sem olhar se há sessão, mas OrderSearch exige
// e-mail (OrderSearch.tsx:63-66) que o convidado nunca informou. Esta view
// (rota "order-success") não recebe `orderId` — nenhuma tela do app navega
// para ela hoje (grep confirma: só o registro da rota em App.tsx/rotas.ts) —
// por isso a correção possível aqui, sem mudar a assinatura do componente
// nem App.tsx (fora do escopo desta tarefa), é não oferecer ao convidado um
// botão que promete um recurso que não existe para ele. O texto já é
// honesto desde o laudo de 30/08; só o botão ficou para trás.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
let mockUser: { id: string } | null = null;
let mockWhatsappNumber: string | undefined = "34999998888";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { whatsappNumber: mockWhatsappNumber },
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("OrderSuccessView — sem botão-beco para convidado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    onNavigate.mockClear();
    mockUser = null;
    mockWhatsappNumber = "34999998888";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("convidado (sem sessão): 'Meus Pedidos' não aparece — o botão levaria a uma busca que exige e-mail que ele nunca informou", async () => {
    const { OrderSuccessView } = await import(
      "@/views/customer/OrderSuccessView"
    );

    await act(async () => {
      raiz.render(<OrderSuccessView onNavigate={onNavigate} />);
    });

    expect(localizarBotaoPorTexto(hospedeiro, "Meus Pedidos")).toBeUndefined();
    // "Voltar para Início" continua existindo — não é o botão em questão.
    expect(hospedeiro.textContent).toContain("Voltar para Início");
  });

  it("cliente com conta: 'Meus Pedidos' continua existindo e leva para 'orders' — este caminho já funciona e não muda", async () => {
    mockUser = { id: "user-1" };
    const { OrderSuccessView } = await import(
      "@/views/customer/OrderSuccessView"
    );

    await act(async () => {
      raiz.render(<OrderSuccessView onNavigate={onNavigate} />);
    });

    const botao = localizarBotaoPorTexto(hospedeiro, "Meus Pedidos");
    expect(botao).not.toBeUndefined();

    await act(async () => {
      botao!.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("orders");
  });
});
