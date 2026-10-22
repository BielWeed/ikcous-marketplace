import { readFileSync } from "node:fs";
import { CartFooterSummary } from "@/components/ui/custom/CartFooterSummary";
import { CouponInput } from "@/components/ui/custom/CouponInput";
import { medirRodapeCliente } from "@/lib/medir-rodape-cliente";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const css = readFileSync("src/index.css", "utf8");
// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("trocar de tela não apaga a reserva da nova barra", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const antiga = document.createElement("div");
  const nova = document.createElement("div");
  vi.spyOn(antiga, "offsetHeight", "get").mockReturnValue(180);
  vi.spyOn(nova, "offsetHeight", "get").mockReturnValue(120);
  const limparAntiga = medirRodapeCliente(antiga)!;
  const limparNova = medirRodapeCliente(nova)!;
  const estilo = document.documentElement.style;
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("180px");
  limparAntiga();
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("120px");
  limparNova();
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("");
});

it("todos os rodapés fixos medem a própria altura, sem bottom divergente", () => {
  for (const caminho of [
    "src/components/ui/custom/CartFooterSummary.tsx",
    "src/views/customer/CheckoutView.tsx",
    "src/views/customer/ProductView.tsx",
    "src/views/customer/FavoritesView.tsx",
  ]) {
    const fonte = readFileSync(caminho, "utf8");
    expect(fonte).toContain("ref={medirRodapeCliente}");
    expect(fonte).not.toMatch(/md:bottom-\[(?:88|104)px\]/);
  }
  const checkout = readFileSync("src/views/customer/CheckoutView.tsx", "utf8");
  expect(checkout).not.toContain("264px");
  expect(checkout).not.toContain("268px");
});

it("cupom: o campo cede espaço e Aplicar não encolhe nem sai do fluxo", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<CouponInput onApply={vi.fn()} onRemove={vi.fn()} />));
  const campo = container.querySelector("input")!;
  const botao = container.querySelector("button")!;
  expect(campo.className).toContain("min-w-0");
  expect(campo.className).toContain("flex-1");
  expect(botao.className).toContain("shrink-0");
  expect(botao.className).not.toContain("absolute");
  act(() => root.unmount());
});

it("uma conta única: navegação + área segura + rodapé medido + 16px, sem números por modo", () => {
  expect(css).toContain("--nav-height: 64px");
  expect(css).toContain(".checkout-values");
  // O valor do Total alinha pela borda esquerda do rótulo, não no canto direito.
  expect(css).toMatch(/\.checkout-values p:last-child \{\s*@apply text-left /);
  expect(css).toContain(".checkout-finalizar:disabled");
  expect(css).toContain("var(--customer-footer-height, 0px)");
  expect(css.match(/--customer-pb:/g)).toHaveLength(1);
  expect(css).toMatch(/--customer-pb:[\s\S]*?16px/);
  expect(css).toContain("--customer-pb-summary: var(--customer-pb)");
});

it("o próprio rodapé atualiza sua altura real e libera a reserva ao desmontar", () => {
  let altura = 80;
  let redimensionar = () => {};
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    () => altura,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        redimensionar = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <CartFooterSummary
        cartCount={1}
        shipping={10}
        total={50}
        onNavigate={vi.fn()}
      />,
    ),
  );
  const estilo = document.documentElement.style;
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("80px");
  altura = 160;
  act(() => redimensionar());
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("160px");
  // display:none no desktop deve deixar de reservar um rodapé invisível.
  altura = 0;
  act(() => redimensionar());
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("0px");
  act(() => root.unmount());
  expect(disconnect).toHaveBeenCalled();
  expect(estilo.getPropertyValue("--customer-footer-height")).toBe("");
  container.remove();
  vi.unstubAllGlobals();
});
