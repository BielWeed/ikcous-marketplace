// A calculadora de frete montada SEM o StoreProvider (ou num teste que troca o
// StoreContext inteiro por um dublê) lê o contexto da loja pelo gancho
// `useContextoDoFreteDaLoja`. O que ela recebe tem de ser o carimbo de uma loja
// "sem config" — o mesmo que `contextoDaLojaParaFrete(undefined)` — e não texto
// vazio: o envelope do cache do navegador é comparado com este texto, e vazio
// invalidaria (ou, pior, casaria com) o cache de quem nunca teve config.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ContextoDoFreteDaLoja,
  contextoDaLojaParaFrete,
  useContextoDoFreteDaLoja,
} from "@/contexts/ContextoDoFreteDaLoja";

function Leitor() {
  return createElement("i", null, useContextoDoFreteDaLoja());
}

/** O que a tela escreveria para um texto qualquer (já com o escape do HTML). */
function comoMarcacao(texto: string): string {
  return renderToStaticMarkup(createElement("i", null, texto));
}

describe("useContextoDoFreteDaLoja", () => {
  it("sem provider vale o carimbo de uma loja sem config, nunca texto vazio", () => {
    const semProvider = renderToStaticMarkup(createElement(Leitor));
    expect(semProvider).not.toBe(comoMarcacao(""));
    expect(semProvider).toBe(comoMarcacao(contextoDaLojaParaFrete(undefined)));
    expect(semProvider).toBe(comoMarcacao(contextoDaLojaParaFrete(null)));
  });

  it("com provider vale o texto que o provider entrega", () => {
    const comProvider = renderToStaticMarkup(
      createElement(
        ContextoDoFreteDaLoja.Provider,
        { value: "carimbo-da-loja" },
        createElement(Leitor),
      ),
    );
    expect(comProvider).toBe(comoMarcacao("carimbo-da-loja"));
  });
});
