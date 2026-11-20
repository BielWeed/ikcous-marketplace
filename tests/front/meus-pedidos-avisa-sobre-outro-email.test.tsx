// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { OrderList } from "@/components/ui/custom/OrderList";

it("conta sem pedidos orienta a entrar com o e-mail da compra e mantém a ida à vitrine", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tela = document.createElement("div");
  const raiz = createRoot(tela);
  const navegar = vi.fn();
  try {
    await act(async () => {
      raiz.render(
        <OrderList orders={[]} hasAnyOrders={false} onNavigate={navegar} />,
      );
    });
    expect(tela.textContent).toContain(
      "Você ainda não fez nenhum pedido. Que tal começar a comprar?",
    );
    const botao = [...tela.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Ver produtos",
    );
    expect(botao).toBeDefined();
    await act(async () => botao?.click());
    expect(navegar).toHaveBeenCalledWith("home");
    expect(tela.textContent).toContain(
      "Comprou com outro e-mail? Entre com o usado na compra.",
    );
  } finally {
    act(() => raiz.unmount());
    vi.unstubAllGlobals();
  }
});
