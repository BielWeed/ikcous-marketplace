// @vitest-environment jsdom
//
// Dois detalhes visuais dos primitivos do painel que carregam significado e que
// as provas vizinhas não conferem:
//  - `VariacaoComSeta`: valor positivo desenha a seta PARA CIMA, negativo PARA
//    BAIXO, zero não desenha seta (uma seta trocada diria o contrário do número);
//  - `SecaoRecolhivel`: o chevron só gira (rotate-180) com a seção ABERTA.
import { VariacaoComSeta } from "@/components/admin/primitivos/EstadoComPonto";
import { SecaoRecolhivel } from "@/components/admin/primitivos/SecaoRecolhivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SETA_PARA_CIMA = "M4 1 8 7H0z";
const SETA_PARA_BAIXO = "M4 7 0 1h8z";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("VariacaoComSeta — direção da seta", () => {
  async function seta(valor: number) {
    await act(async () =>
      root.render(<VariacaoComSeta valor={valor} texto="+12%" />),
    );
    return host.querySelector("svg path")?.getAttribute("d") ?? null;
  }

  it("valor positivo: seta para cima", async () => {
    expect(await seta(12)).toBe(SETA_PARA_CIMA);
  });

  it("valor negativo: seta para baixo", async () => {
    expect(await seta(-3)).toBe(SETA_PARA_BAIXO);
  });

  it("zero: sem seta, só o texto", async () => {
    expect(await seta(0)).toBeNull();
    expect(host.textContent).toBe("+12%");
  });

  it("a seta é decorativa (aria-hidden) e o texto fica legível", async () => {
    await seta(5);
    expect(host.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.textContent).toBe("+12%");
  });
});

describe("SecaoRecolhivel — giro do chevron", () => {
  const chevron = () => host.querySelector("button svg")?.getAttribute("class");

  it("fechada: o chevron não gira; ao abrir gira; ao fechar volta", async () => {
    await act(async () =>
      root.render(
        <SecaoRecolhivel titulo="Avançado">
          <p>conteúdo</p>
        </SecaoRecolhivel>,
      ),
    );
    expect(chevron()).not.toContain("rotate-180");
    await act(async () => host.querySelector("button")?.click());
    expect(chevron()).toContain("rotate-180");
    await act(async () => host.querySelector("button")?.click());
    expect(chevron()).not.toContain("rotate-180");
  });

  it("aberta desde o início: o chevron já nasce girado", async () => {
    await act(async () =>
      root.render(
        <SecaoRecolhivel titulo="Avançado" abertaInicial>
          <p>conteúdo</p>
        </SecaoRecolhivel>,
      ),
    );
    expect(chevron()).toContain("rotate-180");
  });
});
