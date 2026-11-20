// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { OrderSearch } from "@/components/ui/custom/OrderSearch";

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp: async () => true }),
}));
vi.mock("@/utils/haptic", () => ({ haptic: { light: () => {} } }));

it("depois de enviar o código, explica onde procurar e como pedir outro sem esconder o botão Voltar", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tela = document.createElement("div");
  document.body.appendChild(tela);
  const raiz = createRoot(tela);
  const botao = (texto: string) =>
    [...tela.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
  try {
    await act(async () => {
      raiz.render(<OrderSearch abrirNoRastreio onNavigate={vi.fn()} />);
    });
    await act(async () => {
      for (const [placeholder, valor] of [
        ["SEU E-MAIL", "pessoa@example.com"],
        ["SEU WHATSAPP", "11999999999"],
        ["6 FINAIS DO ID DO PEDIDO", "abcdef"],
      ]) {
        const campo = tela.querySelector(`[placeholder="${placeholder}"]`);
        if (!campo) throw new Error(`Campo não encontrado: ${placeholder}`);
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => botao("Enviar Código")?.click());
    expect(tela.textContent).toContain(
      "Código enviado para pessoa@example.com",
    );
    expect(botao("Voltar")).toBeDefined();
    expect(tela.textContent).toContain(
      "Não chegou? Confira o spam ou lixo eletrônico. Para pedir outro código, toque em Voltar e depois em Enviar Código. Pode ser preciso esperar até 1 minuto.",
    );
    await act(async () => botao("Voltar")?.click());
    expect(botao("Enviar Código")).toBeDefined();
  } finally {
    act(() => raiz.unmount());
    tela.remove();
    vi.unstubAllGlobals();
  }
});
