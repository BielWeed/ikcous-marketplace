// @vitest-environment jsdom
//
// mensagemAmigavelErroEdgeFunction — quando o navegador NÃO consegue dizer se
// está online (`navigator.onLine` que lança, como em alguns WebViews). O que
// protege: sem esse sinal o tradutor trata como ONLINE, então um fetch error
// com `mensagemServicoInativo` ligado fala de "serviço fora do ar" (a causa
// medida na peça 20: função não publicada) e NÃO de "sem internet". O contrário
// mandaria a pessoa conferir uma internet que está perfeita.
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { afterEach, describe, expect, it } from "vitest";

const GENERICA = "Não foi possível falar com o servidor. Tente de novo.";
const INATIVO = "Este serviço não está ativo nesta loja.";
const SEM_CONEXAO =
  "Sem conexão com o servidor. Verifique sua internet e tente novamente.";

const erroDeFetch = { name: "FunctionsFetchError", message: "Failed to fetch" };

const onLineOriginal = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(navigator),
  "onLine",
);

afterEach(() => {
  // Remove o override da instância; o getter do protótipo volta a valer.
  Reflect.deleteProperty(navigator, "onLine");
  if (onLineOriginal) {
    Object.defineProperty(
      Object.getPrototypeOf(navigator),
      "onLine",
      onLineOriginal,
    );
  }
});

function definirOnLine(leitura: () => boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: leitura,
  });
}

describe("mensagemAmigavelErroEdgeFunction — fetch error e o sinal de rede do navegador", () => {
  it("onLine que lança conta como online: diz serviço inativo, não 'sem internet'", () => {
    definirOnLine(() => {
      throw new Error("onLine indisponível neste WebView");
    });

    expect(
      mensagemAmigavelErroEdgeFunction(erroDeFetch, {
        mensagemGenerica: GENERICA,
        mensagemServicoInativo: INATIVO,
      }),
    ).toBe(INATIVO);
  });

  it("controle: onLine=false (rede caída de verdade) continua dizendo 'sem conexão'", () => {
    definirOnLine(() => false);

    expect(
      mensagemAmigavelErroEdgeFunction(erroDeFetch, {
        mensagemGenerica: GENERICA,
        mensagemServicoInativo: INATIVO,
      }),
    ).toBe(SEM_CONEXAO);
  });

  it("controle: onLine=true diz serviço inativo", () => {
    definirOnLine(() => true);

    expect(
      mensagemAmigavelErroEdgeFunction(erroDeFetch, {
        mensagemGenerica: GENERICA,
        mensagemServicoInativo: INATIVO,
      }),
    ).toBe(INATIVO);
  });
});
