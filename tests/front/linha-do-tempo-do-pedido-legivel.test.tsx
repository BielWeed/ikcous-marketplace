// @vitest-environment jsdom
//
// Defeito (B8, laudo de acessibilidade da loja, item 49): a linha do tempo do
// pedido (`OrderTimeline`) era só desenho -- um `<div>` com `<div>`s dentro,
// sem papel de lista nem marcação da etapa atual. Leitor de tela não anunciava
// nada de útil sobre o andamento do pedido. Ao mesmo tempo o rótulo de cada
// etapa usava `text-[8px]` (ilegível) e `text-zinc-300` nas etapas futuras
// (1,48:1 de contraste sobre branco, reprova o mínimo AA de 4,5:1).
//
// Escopo: só `OrderTimeline.tsx`. O desenho (círculos, linha, ícones,
// animação) não muda -- só semântica (`<ol>`/`<li>`/`aria-current`/
// `role="status"`) e o tamanho/cor do rótulo.
//
// POR QUE RENDER DE VERDADE: a marcação (tag, atributo aria, classe) vive no
// elemento renderizado, não em dado estático -- mesmo raciocínio do fixture
// de contraste de ProductCard.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrderTimeline } from "@/components/ui/custom/OrderTimeline";
import type { OrderStatus } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderTimeline -- lista ordenada com etapa atual anunciada e rótulos legíveis", () => {
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

  async function renderizar(status: OrderStatus) {
    await act(async () => {
      raiz.render(<OrderTimeline status={status} />);
    });
  }

  // `display: contents` some da árvore de acessibilidade (MDN, seção Accessibility de
  // Web/CSS/display-box) e, em algumas versões de navegador, arrasta os <li> e o
  // sr-only junto. jsdom não calcula estilo computado, então este teste não vê o
  // efeito visual -- ele trava a DECISÃO (a classe não pode estar na marcação).
  it("o <ol> não usa display:contents (some da árvore de acessibilidade)", async () => {
    await renderizar("processing");

    const lista = hospedeiro.querySelector("ol");
    expect(lista?.className).not.toMatch(/\bcontents\b/);
  });

  // `list-style: none` sem `role="list"` explícito faz o VoiceOver (Safari) parar de
  // anunciar "lista, N itens" -- comportamento conhecido do WebKit.
  it('o <ol> tem role="list" explícito (Safari/VoiceOver ignora lista com list-none)', async () => {
    await renderizar("processing");

    const lista = hospedeiro.querySelector("ol");
    expect(lista?.getAttribute("role")).toBe("list");
  });

  it("status 'processing' (etapa 1 de 4): lista ordenada de 4 itens, etapa atual com aria-current=step", async () => {
    await renderizar("processing");

    const lista = hospedeiro.querySelector("ol");
    expect(lista).not.toBeNull();

    const itens = Array.from(hospedeiro.querySelectorAll("li"));
    expect(itens).toHaveLength(4);

    // pending (index 0) já passou: concluído
    expect(itens[0]?.getAttribute("aria-current")).toBeNull();
    expect(itens[0]?.textContent?.toLowerCase()).toContain("conclu");

    // processing (index 1) é a etapa atual
    expect(itens[1]?.getAttribute("aria-current")).toBe("step");

    // shipping e delivered (index 2 e 3) ainda não chegaram
    expect(itens[2]?.getAttribute("aria-current")).toBeNull();
    expect(itens[3]?.getAttribute("aria-current")).toBeNull();
  });

  it("status 'pending' (primeira etapa): item 0 é a etapa atual, os demais são pendentes", async () => {
    await renderizar("pending");

    const itens = Array.from(hospedeiro.querySelectorAll("li"));
    expect(itens).toHaveLength(4);
    expect(itens[0]?.getAttribute("aria-current")).toBe("step");
    expect(itens[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("status 'delivered' (última etapa): as três primeiras estão concluídas, a última é a atual", async () => {
    await renderizar("delivered");

    const itens = Array.from(hospedeiro.querySelectorAll("li"));
    expect(itens[0]?.textContent?.toLowerCase()).toContain("conclu");
    expect(itens[1]?.textContent?.toLowerCase()).toContain("conclu");
    expect(itens[2]?.textContent?.toLowerCase()).toContain("conclu");
    expect(itens[3]?.getAttribute("aria-current")).toBe("step");
  });

  it("status 'cancelled': não renderiza a lista; renderiza role=status com 'Pedido Cancelado'", async () => {
    await renderizar("cancelled");

    expect(hospedeiro.querySelector("ol")).toBeNull();
    expect(hospedeiro.querySelectorAll("li")).toHaveLength(0);

    const aviso = hospedeiro.querySelector('[role="status"]');
    expect(aviso).not.toBeNull();
    expect(aviso?.textContent).toContain("Pedido Cancelado");
  });

  it("status desconhecido (cast forçado): cai na etapa 0 sem quebrar", async () => {
    await renderizar("qualquer-coisa-invalida" as OrderStatus);

    const itens = Array.from(hospedeiro.querySelectorAll("li"));
    expect(itens).toHaveLength(4);
    expect(itens[0]?.getAttribute("aria-current")).toBe("step");
  });

  it("rótulos: nenhuma classe de fonte minúscula (8/9/10px) nem text-zinc-300", async () => {
    await renderizar("pending");

    const rotulos = Array.from(hospedeiro.querySelectorAll("li span")).filter(
      (el) =>
        el.textContent &&
        el.textContent.trim().length > 0 &&
        !el.className.includes("sr-only"),
    );
    expect(rotulos.length).toBeGreaterThan(0);

    for (const rotulo of rotulos) {
      expect(rotulo.className).not.toMatch(/text-\[8px\]/);
      expect(rotulo.className).not.toMatch(/text-\[9px\]/);
      expect(rotulo.className).not.toMatch(/text-\[10px\]/);
      expect(rotulo.className).not.toMatch(/text-zinc-300/);
    }
  });
});
