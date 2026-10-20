// @vitest-environment jsdom
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

it.each([true, false])(
  "dois toques no mesmo evento contam uma vez; resultado %s",
  async (sucesso) => {
    let concluir!: (valor: boolean) => void;
    const aguardar = new Promise<boolean>((resolve) => {
      concluir = resolve;
    });
    const enviar = vi.fn(() => aguardar);
    function Sonda() {
      const [helpful, setHelpful] = useState(0);
      return (
        <ReviewCard
          review={{
            id: "a",
            productId: "p",
            customerName: "Ana",
            rating: 5,
            comment: "",
            helpful,
            verified: true,
            createdAt: "2026-10-01T12:00:00Z",
          }}
          onHelpful={async () => {
            const valeu = await enviar();
            if (valeu) setHelpful(1); // Valor confirmado pela releitura.
            return valeu;
          }}
        />
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    const botao = host.querySelector("button")!;
    await act(async () => {
      botao.click();
      botao.click();
    });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(botao.textContent).toContain("Útil (0)");
    expect(botao.disabled).toBe(true);
    await act(async () => {
      concluir(sucesso);
    });
    expect(botao.disabled).toBe(sucesso);
    expect(botao.textContent).toContain(sucesso ? "Útil (1)" : "Útil (0)");
    if (!sucesso) {
      await act(async () => {
        botao.click();
      });
      expect(enviar).toHaveBeenCalledTimes(2);
    }
  },
);
