// @vitest-environment jsdom
import { SeletorDeAtributo } from "@/components/admin/products/SeletorDeAtributo";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  [[], "nenhuma selecionada"],
  [["110V"], "1 selecionada"],
] as const)("Voltagem concorda com %j", async (selecionados, esperado) => {
  const hospedeiro = document.createElement("div");
  const raiz = createRoot(hospedeiro);
  try {
    await act(async () =>
      raiz.render(
        <SeletorDeAtributo
          modo="multiplo"
          numero={1}
          idDoNome="nome"
          idDoValor="valor"
          nome="Voltagem"
          onNome={() => {}}
          selecionados={[...selecionados]}
          chips={[]}
          onAlternar={() => {}}
          rascunho=""
          onRascunho={() => {}}
          onAdicionar={() => {}}
          onLimpar={() => {}}
        />,
      ),
    );
    expect(
      hospedeiro.querySelector('[data-testid="contagem-do-atributo"]')
        ?.textContent,
    ).toBe(esperado);
  } finally {
    act(() => raiz.unmount());
  }
});
