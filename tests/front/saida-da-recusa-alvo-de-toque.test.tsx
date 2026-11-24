// @vitest-environment jsdom
//
// O "Fechar o aviso" do painel de recusa do checkout era um `p-1` em volta de um
// ícone `size-4`: 24x24 px, bem abaixo dos 44 px de um dedo no celular. A correção
// é o mesmo padrão do `dialog.tsx` (padding maior + margem negativa que devolve o
// espaço): o ALVO passa de 44 px sem empurrar o desenho em volta.
//
// jsdom não tem layout, então a medida é calculada das classes de espaçamento do
// Tailwind (4 px por unidade) — o que o navegador vai somar.
import { SaidaDaRecusa } from "@/components/ui/custom/SaidaDaRecusa";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros arquivos de `tests/front/` que montam com `createRoot`.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Número de unidades Tailwind de uma classe `prefixo-N` (ex.: `p-3.5` -> 3.5).
const unidades = (classes: string, prefixo: string): number | null => {
  const token = classes
    .split(/\s+/)
    .find(
      (c) =>
        c.startsWith(`${prefixo}-`) &&
        !Number.isNaN(Number(c.slice(prefixo.length + 1))),
    );
  return token ? Number(token.slice(prefixo.length + 1)) : null;
};

describe("SaidaDaRecusa — alvo de toque do Fechar o aviso", () => {
  it("o botão mede pelo menos 44 px e a margem devolve o espaço extra", () => {
    act(() => {
      root.render(
        <SaidaDaRecusa
          recusa={{
            acao: "ajustar_estoque",
            mensagem: "Só restam 2 unidades.",
            produto: "Camiseta Exemplo",
            disponivel: 2,
          }}
          onAgir={() => {}}
          onFechar={() => {}}
        />,
      );
    });
    const fechar = container.querySelector(
      'button[aria-label="Fechar o aviso"]',
    ) as HTMLElement;
    const icone = fechar.querySelector("svg") as SVGElement;
    const lado = (unidades(icone.getAttribute("class") ?? "", "size") ?? 0) * 4;
    const pad = (unidades(fechar.className, "p") ?? 0) * 4;
    const margem = (unidades(fechar.className, "-m") ?? 0) * 4;

    // alvo = ícone + padding dos dois lados.
    expect(lado + 2 * pad).toBeGreaterThanOrEqual(44);
    // Na linha ele continua ocupando o que ocupava (24 px): o desenho não anda.
    expect(lado + 2 * pad - 2 * margem).toBeLessThanOrEqual(24);
  });
});
