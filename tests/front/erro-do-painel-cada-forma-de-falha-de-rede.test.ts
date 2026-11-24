// Erro amigável único do painel (src/lib/erro-do-painel.ts): cada navegador
// escreve a falha de rede de um jeito, e todos precisam virar a MESMA frase de
// "sem conexão" — senão a lojista lê "Não foi possível concluir agora" e tenta
// de novo sem saber que a internet caiu. O teste irmão cobre "Failed to fetch"
// (Chrome) e "Load failed" (Safari); aqui ficam as outras três formas e a
// regra de que a comparação ignora maiúsculas.
import { mensagemDeErroDoPainel } from "@/lib/erro-do-painel";
import { describe, expect, it } from "vitest";

const SEM_CONEXAO = "Sem conexão — confira a internet e tente de novo.";

describe("mensagemDeErroDoPainel — formas de falha de rede", () => {
  it.each([
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["Node/undici", "fetch failed"],
    ["Safari antigo / React Native", "Network request failed"],
    ["Chrome em maiúsculas", "FAILED TO FETCH"],
    ["texto com espaços nas pontas", "  Load failed  "],
  ])("%s vira a frase de sem conexão", (_origem, message) => {
    expect(mensagemDeErroDoPainel(new TypeError(message), "carregar")).toBe(
      SEM_CONEXAO,
    );
    expect(mensagemDeErroDoPainel({ message }, "carregar")).toBe(SEM_CONEXAO);
  });

  it("a falha de rede vence o código do erro quando os dois aparecem", () => {
    // 22023 sozinho passaria o texto; com texto de rede, quem manda é a rede.
    expect(
      mensagemDeErroDoPainel(
        { code: "22023", message: "fetch failed" },
        "carregar",
      ),
    ).toBe(SEM_CONEXAO);
  });

  it("erro que só PARECE rede (sem a frase do navegador) não vira sem conexão", () => {
    expect(
      mensagemDeErroDoPainel(
        new Error("Request failed with status 500"),
        "salvar",
      ),
    ).toBe("Não foi possível salvar agora. Tente de novo em instantes.");
  });
});
