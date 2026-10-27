// @vitest-environment jsdom
//
// Lote 222 (C3): campo de valor em reais precisa de teclado com vírgula
// (inputMode="decimal"); "numeric" no iPhone só tem 0-9.
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

const modo = (id: string) =>
  host.querySelector<HTMLInputElement>(`#${id}`)?.inputMode;

const nacional = (
  p: Partial<Parameters<typeof EstrategiaNacionalBloco>[0]>,
) => (
  <EstrategiaNacionalBloco
    estrategia="acima_de_valor"
    minimo={100}
    tipoDesconto={null}
    valorDesconto={0}
    alcance="mais_barata"
    onEscolherEstrategia={vi.fn()}
    onMinimo={vi.fn()}
    onTipoDesconto={vi.fn()}
    onValorDesconto={vi.fn()}
    onAlcance={vi.fn()}
    {...p}
  />
);

describe("lote 222 — campos de reais aceitam vírgula", () => {
  it("frete grátis local: 'Acima de' usa teclado decimal", () => {
    act(() =>
      raiz.render(
        <FreteGratisBloco
          preset="acima_de_valor"
          acimaDe={99}
          onEscolher={vi.fn()}
          onAcimaDe={vi.fn()}
        />,
      ),
    );
    expect(modo("frete-gratis-acima-de")).toBe("decimal");
  });

  it("nacional: valor mínimo usa teclado decimal", () => {
    act(() => raiz.render(nacional({})));
    expect(modo("frete-nacional-minimo")).toBe("decimal");
  });

  it("nacional: desconto fixo em R$ decimal; percentual segue numérico", () => {
    act(() =>
      raiz.render(
        nacional({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "fixo",
          valorDesconto: 0.5,
        }),
      ),
    );
    expect(modo("frete-nacional-valor-desconto")).toBe("decimal");
    act(() =>
      raiz.render(
        nacional({
          estrategia: "desconto_na_mais_barata",
          tipoDesconto: "percentual",
          valorDesconto: 10,
        }),
      ),
    );
    expect(modo("frete-nacional-valor-desconto")).toBe("numeric");
  });
});
