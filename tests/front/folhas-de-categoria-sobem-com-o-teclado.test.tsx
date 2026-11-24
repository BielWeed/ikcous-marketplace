// @vitest-environment jsdom
//
// "Nova categoria" (campo de nome) e a busca de "Escolher categoria": o teclado
// do celular se SOBREPÕE à página e cobria o botão principal (Criar categoria)
// ou as categorias de baixo. As duas folhas sobem acima dele pelas MESMAS
// variáveis CSS da folha das Vitrines (`--teclado-da-folha`/`--altura-da-folha`),
// lidas só nas classes do celular — nada de `bottom`/`max-height` inline, que
// venceriam o `lg:bottom-auto` da gaveta do computador.
import { CampoDeCategoria } from "@/components/admin/products/CampoDeCategoria";
import { FolhaDeNovaCategoria } from "@/components/admin/products/FolhaDeNovaCategoria";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let estadoDoTeclado = { altura: 0, alturaVisivel: 0 };
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => estadoDoTeclado,
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-1"),
  },
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  estadoDoTeclado = { altura: 0, alturaVisivel: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const folha = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-content"]') as
    | HTMLElement
    | undefined;

const montarNovaCategoria = () =>
  act(async () => {
    raiz.render(
      <FolhaDeNovaCategoria
        categoriasDaLoja={[]}
        adicionar={vi.fn()}
        atualizarIcone={vi.fn()}
        aoCriada={vi.fn()}
        aoFechar={vi.fn()}
      />,
    );
  });

const NOMES = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i}`,
  nome: `Categoria ${i}`,
}));
const montarCampo = async () => {
  await act(async () => {
    raiz.render(
      <CampoDeCategoria
        valor=""
        nomes={NOMES}
        aoEscolher={vi.fn()}
        aoCriar={vi.fn()}
        aoGerenciar={vi.fn()}
        categoriaDoRascunhoQueSumiu={null}
      />,
    );
  });
  await act(async () => {
    document.getElementById("product-category")?.click();
  });
};

describe("Nova categoria — teclado do celular", () => {
  it("sem teclado: nenhuma variável, e as classes leem a variável com fallback", async () => {
    await montarNovaCategoria();
    expect(folha()?.style.getPropertyValue("--teclado-da-folha")).toBe("");
    expect(folha()?.style.bottom).toBe("");
    expect(folha()?.className).toContain(
      "bottom-[var(--teclado-da-folha,0px)]",
    );
    expect(folha()?.className).toContain(
      "max-h-[min(92dvh,var(--altura-da-folha,92dvh))]",
    );
    // A gaveta do computador segue com as classes `lg:` do Sheet.
    expect(folha()?.className).toContain("lg:bottom-auto");
  });

  it("com teclado: publica a altura dele e a área visível por variável, nunca inline", async () => {
    estadoDoTeclado = { altura: 310, alturaVisivel: 500 };
    await montarNovaCategoria();
    expect(folha()?.style.getPropertyValue("--teclado-da-folha")).toBe("310px");
    expect(folha()?.style.getPropertyValue("--altura-da-folha")).toBe(
      "calc(500px - 1rem)",
    );
    expect(folha()?.style.bottom).toBe("");
    expect(folha()?.style.maxHeight).toBe("");
  });

  it("focar o nome traz o campo à vista (scrollIntoView depois de 150 ms)", async () => {
    vi.useFakeTimers();
    await montarNovaCategoria();
    const campo = document.getElementById("cat-name") as HTMLInputElement;
    const rolar = vi.fn();
    campo.scrollIntoView = rolar;
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(rolar).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("o teclado abrindo DEPOIS do foco refaz a rolagem do campo focado", async () => {
    await montarNovaCategoria();
    const campo = document.getElementById("cat-name") as HTMLInputElement;
    const rolar = vi.fn();
    campo.scrollIntoView = rolar;
    campo.focus();
    estadoDoTeclado = { altura: 300, alturaVisivel: 500 };
    await montarNovaCategoria();
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });
});

describe("Escolher categoria (busca) — teclado do celular", () => {
  it("sem teclado: nenhuma variável, e as classes leem a variável com fallback", async () => {
    await montarCampo();
    expect(folha()?.style.getPropertyValue("--teclado-da-folha")).toBe("");
    expect(folha()?.className).toContain(
      "bottom-[var(--teclado-da-folha,0px)]",
    );
    expect(folha()?.className).toContain(
      "max-h-[min(85dvh,var(--altura-da-folha,85dvh))]",
    );
  });

  it("com teclado: publica as variáveis, nunca bottom/max-height inline", async () => {
    estadoDoTeclado = { altura: 310, alturaVisivel: 500 };
    await montarCampo();
    expect(folha()?.style.getPropertyValue("--teclado-da-folha")).toBe("310px");
    expect(folha()?.style.getPropertyValue("--altura-da-folha")).toBe(
      "calc(500px - 1rem)",
    );
    expect(folha()?.style.bottom).toBe("");
    expect(folha()?.style.maxHeight).toBe("");
  });

  it("focar a busca traz o campo à vista", async () => {
    await montarCampo();
    vi.useFakeTimers();
    const busca = document.querySelector<HTMLInputElement>(
      'input[aria-label="Buscar categoria"]',
    ) as HTMLInputElement;
    const rolar = vi.fn();
    busca.scrollIntoView = rolar;
    await act(async () => {
      busca.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("campo FORA da folha não é rolado por ela", async () => {
    await montarCampo();
    vi.useFakeTimers();
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
});
