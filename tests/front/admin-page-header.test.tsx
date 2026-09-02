// @vitest-environment jsdom
//
// Onda 2 da missão visual (02/09): o título de página do painel admin vive
// em UM lugar. Antes, cada tela copiava à mão o "Elite Header"
// (text-2xl font-black uppercase tracking-tighter) e as cópias divergiam.
// Mesmo padrão da casa: jsdom + createRoot + act.
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function montar(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return container;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AdminPageHeader", () => {
  it("renderiza o título e manda as ações para o lado direito da linha", () => {
    const tela = montar(
      <AdminPageHeader
        titulo="Pedidos"
        acoes={<button type="button">Novo Produto</button>}
      />,
    );
    const h1 = tela.querySelector("h1")!;
    expect(h1.textContent).toBe("Pedidos");
    expect(h1.className).toContain("tracking-tighter");
    // O slot fica FORA do h1 (lado direito), no wrapper dominante das listas.
    const acoes = tela.querySelector("h1 + div")!;
    expect(acoes.className).toBe("flex shrink-0 items-center gap-3");
    expect(acoes.textContent).toBe("Novo Produto");
  });

  it("guarda os vizinhos dentro do h1 e, sem ações, o slot nem nasce", () => {
    const tela = montar(
      <AdminPageHeader titulo="Clientes">
        <span data-testid="vizinho-do-titulo" />
      </AdminPageHeader>,
    );
    const h1 = tela.querySelector("h1")!;
    expect(h1.textContent).toContain("Clientes");
    expect(h1.querySelector("[data-testid='vizinho-do-titulo']")).not.toBeNull();
    expect(tela.querySelector("h1 + div")).toBeNull();
  });
});
