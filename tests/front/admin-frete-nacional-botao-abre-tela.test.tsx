// @vitest-environment jsdom
// O antigo atalho de estratégia foi realocado para Frete grátis (abas).
// Este bloco agora é a única casa da cobertura: ligado = national.
import { FreteNacionalBloco } from "@/components/admin/shipping/FreteNacionalBloco";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("Fora da região — cobertura sem atalhos duplicados", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function montar(
    coverage: "local" | "national",
    onCoverage = vi.fn(),
    desabilitado = false,
  ) {
    act(() =>
      root.render(
        <FreteNacionalBloco
          coverage={coverage}
          onCoverage={onCoverage}
          desabilitado={desabilitado}
        >
          <p>Lista das transportadoras</p>
        </FreteNacionalBloco>,
      ),
    );
    return host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  }
  it("não repete os atalhos, o CEP nem o editor da regra grátis", () => {
    montar("national");
    expect(host.textContent).not.toMatch(
      /Estratégias do frete nacional|CEP da loja|Conectar transportadora/,
    );
    expect(host.textContent).toContain("Lista das transportadoras");
  });
  it("exibe nacional como ligado e local como desligado, inclusive ao reler", () => {
    expect(montar("national").getAttribute("aria-checked")).toBe("true");
    expect(montar("local").getAttribute("aria-checked")).toBe("false");
  });
  it("o clique para vender fora emite national, não o sentido antigo", () => {
    const gravar = vi.fn();
    const b = montar("local", gravar);
    act(() => b.click());
    expect(gravar).toHaveBeenCalledWith("national");
  });
  it("o clique para parar de vender fora emite local", () => {
    const gravar = vi.fn();
    const b = montar("national", gravar);
    act(() => b.click());
    expect(gravar).toHaveBeenCalledWith("local");
  });
  it("offline não altera a cobertura", () => {
    const gravar = vi.fn();
    const b = montar("national", gravar, true);
    act(() => b.click());
    expect(b.disabled).toBe(true);
    expect(gravar).not.toHaveBeenCalled();
  });
});
