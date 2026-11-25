// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), OrderTimeline completa (a das bolinhas). Três
// buracos que o teste vizinho (order-timeline-etapa-atual-barras-e-rotulos) deixava:
//  - a linha verde nunca passa do último centro: tem teto de `100% - 60px` (sem ele,
//    com o pedido entregue ela ultrapassa a última bolinha);
//  - etapa concluída mostra o "check"; a etapa atual mostra o ícone PRÓPRIO dela,
//    pulsando; a etapa futura mostra o ícone dela, parado;
//  - os mesmos três papéis valem na retirada na loja (mesma régua, outro ícone).
// Sem rede e sem relógio; só leitura do que está na tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrderTimeline } from "@/components/ui/custom/OrderTimeline";
import type { OrderStatus } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderTimeline completa: teto da linha verde e ícone de cada etapa", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  function desenhar(status: OrderStatus, retiradaNaLoja = false) {
    act(() => {
      raiz.render(
        <OrderTimeline status={status} retiradaNaLoja={retiradaNaLoja} />,
      );
    });
  }

  const iconeDe = (indice: number) =>
    [...host.querySelectorAll("li")]
      .at(indice)
      ?.querySelector('div[aria-hidden="true"] svg') ?? null;
  const ehCheck = (svg: Element | null) =>
    svg?.classList.contains("lucide-check") ?? false;
  const pulsa = (svg: Element | null) =>
    svg?.classList.contains("animate-pulse") ?? false;

  it.each([
    ["pending", "0%"],
    ["processing", "33.33"],
    ["shipping", "66.66"],
    ["delivered", "100%"],
  ] as const)(
    "%s: a linha verde mede %s da trilha e nunca passa do teto de 100% - 60px",
    (status, largura) => {
      desenhar(status);
      const linha = host.querySelector<HTMLElement>('[style*="max-width"]');
      expect(linha).not.toBeNull();
      expect(linha?.style.maxWidth).toBe("calc(100% - 60px)");
      expect(linha?.style.width).toContain(largura);
    },
  );

  it.each([
    ["pending", [true, false, false, false]],
    ["processing", [true, false, false, false]],
    ["shipping", [true, true, false, false]],
    ["delivered", [true, true, true, false]],
  ] as const)(
    "%s: o check aparece nas etapas cumpridas (a 1ª usa o check como ícone próprio)",
    (status, concluidas) => {
      desenhar(status);
      expect([0, 1, 2, 3].map((i) => ehCheck(iconeDe(i)))).toEqual(
        concluidas as unknown as boolean[],
      );
    },
  );

  it.each([
    ["pending", 0],
    ["processing", 1],
    ["shipping", 2],
    ["delivered", 3],
  ] as const)("%s: só o ícone da etapa atual pulsa", (status, atual) => {
    for (const retirada of [false, true]) {
      desenhar(status, retirada);
      expect([0, 1, 2, 3].map((i) => pulsa(iconeDe(i)))).toEqual(
        [0, 1, 2, 3].map((i) => i === atual),
      );
    }
  });

  it("a etapa atual mostra o ícone próprio (não o check) e a futura também", () => {
    desenhar("processing");
    expect(ehCheck(iconeDe(1))).toBe(false);
    expect(iconeDe(1)).not.toBeNull();
    expect(ehCheck(iconeDe(2))).toBe(false);
    expect(iconeDe(2)).not.toBeNull();
  });
});
