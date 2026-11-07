// @vitest-environment jsdom
import { ShippingProgress } from "@/components/ui/custom/ShippingProgress";
import type { Product } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/utils/haptic", () => ({ haptic: { light() {}, medium() {} } }));

const produto = {
  id: "bola",
  name: "Bola",
  price: 50,
  images: [],
} as unknown as Product;

it.each(["Enter", " "])(
  "a tecla %j nos botões da meta não abre o produto",
  async (key) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const navegar = vi.fn();
    const adicionar = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ShippingProgress
            estado="meta"
            savings={0}
            progressPercent={50}
            amountToFree={50}
            isNearlyThere={false}
            freeShippingProducts={[produto]}
            onNavigate={navegar}
            onAddToCart={adicionar}
          />,
        ),
      );
      const [diminuir, aumentar, comprar] = Array.from(
        host.querySelectorAll("button"),
      );
      const ativar = async (botao: HTMLButtonElement) => {
        const evento = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        });
        await act(async () => {
          botao.dispatchEvent(evento);
        });
        expect(navegar).not.toHaveBeenCalled();
        expect(evento.defaultPrevented).toBe(false);
        // jsdom não executa a ativação nativa de botão pelo teclado.
        // O clique abaixo representa a ação padrão, somente se não cancelada.
        if (!evento.defaultPrevented) await act(async () => botao.click());
      };
      await ativar(aumentar);
      await ativar(comprar);
      expect(adicionar).toHaveBeenLastCalledWith(produto, 2);
      await ativar(diminuir);
      await ativar(comprar);
      expect(adicionar).toHaveBeenLastCalledWith(produto, 1);
      expect(navegar).not.toHaveBeenCalled();
      expect(aumentar.getAttribute("aria-label")).toBe(
        "Aumentar quantidade de Bola",
      );
      expect(diminuir.getAttribute("aria-label")).toBe(
        "Diminuir quantidade de Bola",
      );

      const card = host.querySelector('[role="button"]')!;
      await act(async () =>
        card.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(navegar).toHaveBeenLastCalledWith("product-detail", "bola");
      navegar.mockClear();
      await act(async () => (card as HTMLElement).click());
      expect(navegar).toHaveBeenCalledTimes(1);
      navegar.mockClear();
      await act(async () => aumentar.click());
      await act(async () => comprar.click());
      expect(adicionar).toHaveBeenLastCalledWith(produto, 2);
      expect(navegar).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
