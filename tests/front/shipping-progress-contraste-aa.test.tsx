// @vitest-environment jsdom
//
// Defeito: quatro pontos verdes do card de frete (ShippingProgress) reprovam
// o mínimo AA (4,5:1) do WCAG para texto normal. Medido sobre o fundo claro
// do componente (Tailwind v3):
//   text-emerald-600/70  ->  2,40      text-emerald-700/70  ->  2,99
//   text-emerald-800/70  ->  3,65      text-emerald-900/70  ->  4,16
//   text-emerald-700 (sem /70)  ->  5,21
// Nenhum tom passa enquanto a opacidade /70 estiver presente -- por isso as
// duas linhas com /70 (subtítulo e rótulo "Economia") precisam perder a
// opacidade, não só trocar de tom.
//
// Escopo: SÓ os 4 pontos deste arquivo, medidos pela auditoria que originou
// este trabalho. Os outros 10 pontos do mesmo defeito (`text-emerald-600` em
// ProductCard, CartView, CheckoutView, NotificationsView, OrderDetailsView,
// ProductView, UserProfileView) são de outra frente/tarefa.
//
// POR QUE RENDER DE VERDADE: mesmo motivo de order-list-contraste-do-card --
// a classe de cor vive no elemento renderizado, não em dado estático.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Nenhuma classe emerald com opacidade /70, seja qual for o tom (600,
 * 700, 800...) -- é a opacidade que reprova o contraste, não o tom sozinho. */
function possuiEmeraldComOpacidade70(el: Element): boolean {
  return Array.from(el.classList).some(
    (c) => c.startsWith("text-emerald") && c.endsWith("/70"),
  );
}

describe("ShippingProgress — contraste do verde (WCAG AA)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar() {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          shipping={0}
          savings={12.34}
          progressPercent={82}
          amountToFree={0}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
  }

  it("subtítulo 'Premium Service Ativado' (l.94): usa text-emerald-700 sem opacidade /70, não mais text-emerald-600/70", async () => {
    await renderizar();

    const subtitulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (el) => el.textContent === "Premium Service Ativado",
    );
    expect(subtitulo).not.toBeUndefined();
    expect(subtitulo?.classList.contains("text-emerald-700")).toBe(true);
    // A trava real: nenhuma classe emerald pode carregar /70, mesmo que o
    // tom já seja o escuro certo -- text-emerald-700/70 continua reprovando.
    expect(possuiEmeraldComOpacidade70(subtitulo!)).toBe(false);
  });

  it("rótulo 'Economia' (l.103): usa text-emerald-700 sem opacidade /70, não mais text-emerald-600/70", async () => {
    await renderizar();

    const rotulo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (el) => el.textContent === "Economia",
    );
    expect(rotulo).not.toBeUndefined();
    expect(rotulo?.classList.contains("text-emerald-700")).toBe(true);
    expect(possuiEmeraldComOpacidade70(rotulo!)).toBe(false);
  });

  it("valor da economia '+ R$ ...' (l.106): usa text-emerald-700, não mais text-emerald-600", async () => {
    await renderizar();

    const valor = Array.from(hospedeiro.querySelectorAll("span")).find((el) =>
      el.textContent?.startsWith("+"),
    );
    expect(valor).not.toBeUndefined();
    expect(valor?.classList.contains("text-emerald-700")).toBe(true);
    expect(valor?.classList.contains("text-emerald-600")).toBe(false);
  });

  it("percentual da barra de progresso '82%' (l.119): usa text-emerald-700, não mais text-emerald-600", async () => {
    await renderizar();

    const percentual = Array.from(hospedeiro.querySelectorAll("span")).find(
      (el) => el.textContent === "82%",
    );
    expect(percentual).not.toBeUndefined();
    expect(percentual?.classList.contains("text-emerald-700")).toBe(true);
    expect(percentual?.classList.contains("text-emerald-600")).toBe(false);
  });
});
