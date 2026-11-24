// @vitest-environment jsdom
//
// Folhas das Vitrines (Nova vitrine, Editar vitrine, busca de produtos): o
// teclado do celular se SOBREPÕE à página, e o botão principal do rodapé ficava
// escondido atrás dele. A folha sobe acima do teclado por VARIÁVEIS CSS lidas só
// nas classes do celular — nada de `bottom`/`max-height` inline, que venceriam
// o `lg:bottom-auto` e deslocariam a gaveta do computador. Sem teclado, nenhuma
// variável nasce e a folha é a de sempre.
import { FolhaInferior } from "@/components/admin/vitrines/FolhaInferior";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let estadoDoTeclado = { altura: 0, alturaVisivel: 0 };
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => estadoDoTeclado,
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  estadoDoTeclado = { altura: 0, alturaVisivel: 0 };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const montar = () =>
  act(async () => {
    raiz.render(
      <FolhaInferior
        titulo="Nova vitrine"
        descricao="Escolha o nome"
        aoFechar={vi.fn()}
        rodape={<button type="button">Criar vitrine</button>}
      >
        <input aria-label="Nome da vitrine" />
      </FolhaInferior>,
    );
  });
const folha = () =>
  document.querySelector<HTMLElement>("[data-folha-inferior]")!;

describe("FolhaInferior — teclado do celular", () => {
  it("sem teclado: nenhuma variável, e as classes leem a variável com fallback (a folha é a de sempre)", async () => {
    await montar();
    expect(folha().style.getPropertyValue("--teclado-da-folha")).toBe("");
    expect(folha().style.bottom).toBe("");
    expect(folha().style.maxHeight).toBe("");
    expect(folha().className).toContain("bottom-[var(--teclado-da-folha,0px)]");
    expect(folha().className).toContain(
      "max-h-[min(92dvh,var(--altura-da-folha,92dvh))]",
    );
  });

  it("com teclado: publica a altura dele e a área visível por variável, nunca por bottom/max-height inline", async () => {
    estadoDoTeclado = { altura: 310, alturaVisivel: 500 };
    await montar();
    expect(folha().style.getPropertyValue("--teclado-da-folha")).toBe("310px");
    expect(folha().style.getPropertyValue("--altura-da-folha")).toBe(
      "calc(500px - 1rem)",
    );
    // inline venceria o `lg:bottom-auto` da gaveta do computador
    expect(folha().style.bottom).toBe("");
    expect(folha().style.maxHeight).toBe("");
  });

  it("a gaveta do computador não é tocada: o bottom do `lg:` do Sheet continua na lista de classes", async () => {
    await montar();
    expect(folha().className).toContain("lg:bottom-auto");
    expect(folha().className).toContain("lg:max-h-none");
  });

  it("focar um campo da folha traz ele à vista (scrollIntoView depois de 150ms)", async () => {
    vi.useFakeTimers();
    await montar();
    const campo = document.querySelector<HTMLInputElement>("input")!;
    const rolar = vi.fn();
    campo.scrollIntoView = rolar;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(rolar).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("campo FORA da folha não é rolado por ela", async () => {
    vi.useFakeTimers();
    await montar();
    const fora = document.createElement("input");
    document.body.appendChild(fora);
    const rolar = vi.fn();
    fora.scrollIntoView = rolar;
    await act(async () => {
      fora.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      vi.advanceTimersByTime(300);
    });
    expect(rolar).not.toHaveBeenCalled();
  });

  it("o teclado abrindo DEPOIS do foco refaz a rolagem do campo focado", async () => {
    await montar();
    const campo = document.querySelector<HTMLInputElement>("input")!;
    const rolar = vi.fn();
    campo.scrollIntoView = rolar;
    campo.focus();
    estadoDoTeclado = { altura: 300, alturaVisivel: 500 };
    await montar();
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });
});
