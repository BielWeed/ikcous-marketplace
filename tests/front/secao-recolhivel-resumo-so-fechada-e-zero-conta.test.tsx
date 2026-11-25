// @vitest-environment jsdom
//
// Seção recolhível do painel (formulário de produto, ajustes): o RESUMO é o
// que a lojista lê com a seção fechada ("3 fotos", "Ativo"). Ele some quando
// a seção abre (senão o mesmo dado aparece duas vezes) e volta ao fechar; o
// número 0 é um resumo válido ("0 fotos"), não "ausência de resumo"; e o
// botão do cabeçalho aponta para o conteúdo certo (caça por mutação,
// 24/11/2026).
import { SecaoRecolhivel } from "@/components/admin/primitivos/SecaoRecolhivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar(props: {
  resumo?: React.ReactNode;
  abertaInicial?: boolean;
  temErro?: boolean;
}) {
  await act(async () => {
    raiz.render(
      <SecaoRecolhivel titulo="Fotos" {...props}>
        <p id="miolo">conteúdo</p>
      </SecaoRecolhivel>,
    );
  });
}

const cabecalho = () => hospedeiro.querySelector("button") as HTMLButtonElement;
const miolo = () => document.getElementById("miolo") as HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("SecaoRecolhivel: o resumo", () => {
  it("aparece com a seção fechada, some ao abrir e volta ao fechar", async () => {
    await montar({ resumo: "3 fotos" });
    expect(cabecalho().getAttribute("aria-expanded")).toBe("false");
    expect(hospedeiro.textContent).toContain("3 fotos");

    await act(async () => cabecalho().click());
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.querySelector("section")?.textContent).not.toContain(
      "3 fotos",
    );

    await act(async () => cabecalho().click());
    expect(hospedeiro.textContent).toContain("3 fotos");
  });

  it("o número 0 é resumo válido e aparece fechado", async () => {
    await montar({ resumo: 0 });
    expect(cabecalho().textContent).toBe("Fotos0");
  });

  it("sem resumo, o cabeçalho só tem o título", async () => {
    await montar({});
    expect(cabecalho().textContent).toBe("Fotos");
  });
});

describe("SecaoRecolhivel: abertura e ligação com o conteúdo", () => {
  it("o botão controla o conteúdo e o conteúdo fica escondido, não desmontado", async () => {
    await montar({});
    const idDoConteudo = cabecalho().getAttribute("aria-controls");
    expect(idDoConteudo).toBeTruthy();
    const caixa = document.getElementById(idDoConteudo as string);
    expect(caixa?.contains(miolo())).toBe(true);
    expect(caixa?.hidden).toBe(true);

    await act(async () => cabecalho().click());
    expect(caixa?.hidden).toBe(false);
  });

  it("abertaInicial abre de cara; erro também abre, mesmo sem abertaInicial", async () => {
    await montar({ abertaInicial: true, resumo: "3 fotos" });
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.querySelector("section")?.textContent).not.toContain(
      "3 fotos",
    );

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar({ temErro: true });
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
    expect(miolo().closest("[hidden]")).toBeNull();
  });
});
