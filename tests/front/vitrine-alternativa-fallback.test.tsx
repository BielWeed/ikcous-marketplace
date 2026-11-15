// @vitest-environment jsdom
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("@/components/ui/custom/OfertasCompactas", () => new Promise(() => {}));
vi.mock("@/components/ui/custom/OfertasLateral", () => new Promise(() => {}));
vi.mock(
  "@/components/ui/custom/OfertasLateralDuplo",
  () => new Promise(() => {}),
);
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it.each([
  ["compacto", 1, 392],
  ["lateral", 1, 226],
  ["lateral-duplo", 1, 206],
  ["lateral-duplo", 2, 318],
] as const)(
  "%s: %i produto(s) aguardam o módulo com reserva neutra de %ipx",
  async (layout, qtd, altura) => {
    await act(async () =>
      root.render(
        <PremiumOffers
          layout={layout}
          products={Array.from({ length: qtd }, () => ({}) as Product)}
          vitrineDeOfertas={false}
          title="Últimos Lançamentos"
          favorites={[]}
          onProductClick={() => {}}
          onToggleFavorite={() => {}}
        />,
      ),
    );
    const reserva = host.querySelector<HTMLElement>(
      '[data-testid="esqueleto-vitrine"]',
    )!;
    expect(reserva).not.toBeNull();
    expect(host.querySelector('[data-testid="esqueleto-ofertas"]')).toBeNull();
    if (layout === "compacto")
      expect(reserva.className).toContain(`min-h-[${altura}px]`);
    else expect(reserva.style.minHeight).toBe(`${altura}px`);
  },
);
