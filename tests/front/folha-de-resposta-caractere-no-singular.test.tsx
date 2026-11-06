// @vitest-environment jsdom
//
// O contador da folha "Responder pergunta" dizia "1 caracteres" com um único
// caractere digitado. No singular é "1 caractere".
import { FolhaDeResposta } from "@/components/admin/atendimento/FolhaDeResposta";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let raiz: Root;
let hospedeiro: HTMLDivElement;

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

async function abrirComResposta(resposta: string) {
  await act(async () => {
    raiz.render(
      <FolhaDeResposta
        aberta={true}
        aoFechar={vi.fn()}
        cliente="Maria"
        produto="Caneca"
        pergunta="Tem em azul?"
        resposta={resposta}
        aoMudarResposta={vi.fn()}
        aoPublicar={vi.fn()}
        enviando={false}
        semConexao={false}
      />,
    );
  });
}

describe("FolhaDeResposta — contador de caracteres", () => {
  it("um caractere: singular", async () => {
    await abrirComResposta("S");
    expect(document.body.textContent).toContain("1 caractere");
    expect(document.body.textContent).not.toContain("1 caracteres");
  });

  it("zero e vários: plural", async () => {
    await abrirComResposta("");
    expect(document.body.textContent).toContain("0 caracteres");
    await abrirComResposta("Sim, tem!");
    expect(document.body.textContent).toContain("9 caracteres");
  });
});
