// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território ui/custom: a linha do tempo do
// pedido ("Pedido recebido, Separado, A caminho, Entregue") fala com o leitor
// de tela por três marcas que nenhum teste vigiava — plantado o defeito, tudo
// continuava verde:
//  - a lista se chamar "Andamento do pedido" e ser lista (o Safari tira o
//    papel de lista quando o estilo apaga os marcadores);
//  - as barras e linhas de enfeite ficarem escondidas do leitor de tela;
//  - cada etapa dizer "concluída", "atual" ou "ainda não alcançada".
// Vale para os dois desenhos: o completo (ícones) e o compacto (barras finas
// do Perfil).
import { OrderTimeline } from "@/components/ui/custom/OrderTimeline";
import type { OrderStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

function montar(status: OrderStatus, compacto: boolean) {
  act(() => {
    raiz.render(<OrderTimeline status={status} compacto={compacto} />);
  });
  return hospedeiro.querySelector("ol") as HTMLOListElement;
}

describe.each([
  ["desenho completo", false],
  ["desenho compacto (Perfil)", true],
])("OrderTimeline — %s", (_nome, compacto) => {
  it("a lista tem nome e papel de lista explícito", () => {
    const lista = montar("processing", compacto);
    expect(lista.getAttribute("aria-label")).toBe("Andamento do pedido");
    expect(lista.getAttribute("role")).toBe("list");
    expect(lista.querySelectorAll("li").length).toBe(4);
  });

  it("só a etapa atual é aria-current=step, e cada etapa diz onde está", () => {
    const lista = montar("shipping", compacto);
    const etapas = Array.from(lista.querySelectorAll("li"));
    expect(etapas.map((li) => li.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "step",
      null,
    ]);
    expect(
      etapas.map((li) => li.querySelector(".sr-only")?.textContent),
    ).toEqual([
      "etapa concluída",
      "etapa concluída",
      "etapa atual",
      "etapa ainda não alcançada",
    ]);
  });

  it("a primeira etapa (pedido recém-feito) é a atual e nenhuma está concluída", () => {
    const lista = montar("pending", compacto);
    const ditos = Array.from(lista.querySelectorAll("li .sr-only")).map(
      (s) => s.textContent,
    );
    expect(ditos).toEqual([
      "etapa atual",
      "etapa ainda não alcançada",
      "etapa ainda não alcançada",
      "etapa ainda não alcançada",
    ]);
  });

  it("status que a linha não conhece cai na primeira etapa, sem quebrar", () => {
    const lista = montar("status-novo-do-futuro" as OrderStatus, compacto);
    expect(lista.querySelectorAll("li")[0]?.getAttribute("aria-current")).toBe(
      "step",
    );
  });
});

describe("OrderTimeline — enfeites escondidos do leitor de tela", () => {
  it("compacto: a barrinha de cada etapa é decorativa", () => {
    const lista = montar("processing", true);
    const barras = Array.from(lista.querySelectorAll("li > div"));
    expect(barras.length).toBe(4);
    for (const barra of barras) {
      expect(barra.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("completo: a linha de fundo, a linha andada e as bolas dos ícones são decorativas", () => {
    montar("processing", false);
    const raizDoDesenho = hospedeiro.firstElementChild as HTMLElement;
    const [fundo, andada] = Array.from(raizDoDesenho.children);
    expect(fundo?.getAttribute("aria-hidden")).toBe("true");
    expect(andada?.getAttribute("aria-hidden")).toBe("true");
    const bolas = Array.from(hospedeiro.querySelectorAll("li > div"));
    expect(bolas.length).toBe(4);
    for (const bola of bolas) {
      expect(bola.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("completo: só a etapa atual leva o ponto pulsante (as outras ficam sem)", () => {
    for (const status of ["pending", "processing", "shipping", "delivered"]) {
      const lista = montar(status as OrderStatus, false);
      const pulsos = Array.from(lista.querySelectorAll(".animate-ping"));
      expect(pulsos.length, status).toBe(1);
      expect(pulsos[0]?.closest("li")?.getAttribute("aria-current")).toBe(
        "step",
      );
    }
  });

  it("pedido cancelado: aviso de status e ícone decorativo, sem a lista de etapas", () => {
    act(() => {
      raiz.render(<OrderTimeline status="cancelled" />);
    });
    expect(hospedeiro.querySelector("ol")).toBeNull();
    const aviso = hospedeiro.querySelector('[role="status"]') as HTMLElement;
    expect(aviso.textContent).toBe("Pedido Cancelado");
    expect(aviso.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
