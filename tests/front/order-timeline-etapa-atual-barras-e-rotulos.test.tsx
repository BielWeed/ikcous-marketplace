// @vitest-environment jsdom
//
// A linha do tempo do pedido (Perfil e ficha): qual etapa está concluída, qual
// é a atual e qual ainda não chegou, na versão compacta (quatro barras) e na
// completa (bolinhas e linha verde). Caça por mutação: trocar `<=` por `<` na
// barra preenchida, apagar a cor do rótulo da etapa atual, errar a largura da
// linha verde ou dar a uma etapa o nome de outra não derrubava teste nenhum.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrderTimeline } from "@/components/ui/custom/OrderTimeline";
import type { OrderStatus } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderTimeline", () => {
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

  function desenhar(
    status: OrderStatus | string,
    extras: { compacto?: boolean; retiradaNaLoja?: boolean } = {},
  ) {
    act(() => {
      raiz.render(<OrderTimeline status={status as OrderStatus} {...extras} />);
    });
  }

  const itens = () => [...host.querySelectorAll("li")];
  const rotulos = () =>
    itens().map(
      (li) =>
        li.querySelector(":scope > span:not(.sr-only)")?.textContent ?? "",
    );
  const leitor = () =>
    itens().map((li) => li.querySelector(".sr-only")?.textContent);
  const atual = () =>
    itens().map((li) => li.getAttribute("aria-current") === "step");

  describe("os quatro nomes, na ordem, e quem é o atual", () => {
    it.each([
      ["pending", 0],
      ["processing", 1],
      ["shipping", 2],
      ["delivered", 3],
    ])("%s é a etapa %i (compacta e completa)", (status, indice) => {
      for (const compacto of [true, false]) {
        desenhar(status, { compacto });
        expect(rotulos()).toEqual([
          "Recebido",
          "Em separação",
          "A caminho",
          "Entregue",
        ]);
        expect(atual()).toEqual([0, 1, 2, 3].map((i) => i === indice));
        expect(leitor()).toEqual(
          [0, 1, 2, 3].map((i) =>
            i < indice
              ? "etapa concluída"
              : i === indice
                ? "etapa atual"
                : "etapa ainda não alcançada",
          ),
        );
      }
    });

    it("status que o app não conhece cai na primeira etapa, sem quebrar", () => {
      desenhar("new", { compacto: true });
      expect(atual()).toEqual([true, false, false, false]);
      desenhar("new");
      expect(atual()).toEqual([true, false, false, false]);
    });

    it("cancelado mostra só o aviso, sem etapas", () => {
      desenhar("cancelled");
      expect(itens()).toHaveLength(0);
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "Pedido Cancelado",
      );
    });

    it("retirada: as etapas 3 e 4 mudam de nome em todos os estados", () => {
      for (const status of ["pending", "shipping", "delivered"]) {
        desenhar(status, { retiradaNaLoja: true });
        expect(rotulos()).toEqual([
          "Recebido",
          "Em separação",
          "Pronto para retirar",
          "Retirado",
        ]);
      }
    });
  });

  describe("versão compacta: barras e cor do texto", () => {
    const barras = () =>
      [...host.querySelectorAll("li > div.h-1")].map((b) =>
        b.className.includes("bg-foreground"),
      );
    const pesoDoTexto = () =>
      itens().map((li) => {
        const c = li.querySelector("span:not(.sr-only)")?.className ?? "";
        return c.includes("font-bold")
          ? "atual"
          : c.includes("text-muted-foreground")
            ? "futuro"
            : "passado";
      });

    it.each([
      [
        "pending",
        [true, false, false, false],
        ["atual", "futuro", "futuro", "futuro"],
      ],
      [
        "processing",
        [true, true, false, false],
        ["passado", "atual", "futuro", "futuro"],
      ],
      [
        "shipping",
        [true, true, true, false],
        ["passado", "passado", "atual", "futuro"],
      ],
      [
        "delivered",
        [true, true, true, true],
        ["passado", "passado", "passado", "atual"],
      ],
    ])("%s: barras %j, textos %j", (status, preenchidas, textos) => {
      desenhar(status, { compacto: true });
      expect(barras()).toEqual(preenchidas);
      expect(pesoDoTexto()).toEqual(textos);
    });
  });

  describe("versão completa: linha verde e cor dos rótulos", () => {
    const corDoRotulo = () =>
      itens().map((li) =>
        li
          .querySelector("span.text-center")
          ?.className.includes("text-zinc-900")
          ? "forte"
          : "apagado",
      );
    const larguraDaLinha = () =>
      host
        .querySelector<HTMLElement>("div.bg-emerald-500")
        ?.getAttribute("style") ?? "";

    it.each([
      ["pending", ["forte", "apagado", "apagado", "apagado"], 0],
      ["processing", ["forte", "forte", "apagado", "apagado"], 33.33],
      ["shipping", ["forte", "forte", "forte", "apagado"], 66.67],
      ["delivered", ["forte", "forte", "forte", "forte"], 100],
    ])("%s: rótulos %j e linha verde até %s%", (status, cores, porcento) => {
      desenhar(status);
      expect(corDoRotulo()).toEqual(cores);
      const largura = Number(
        /calc\(([\d.]+)%/.exec(larguraDaLinha())?.[1] ?? Number.NaN,
      );
      expect(largura).toBeCloseTo(porcento as number, 1);
    });
  });
});
