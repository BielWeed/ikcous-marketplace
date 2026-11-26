// "de", "da", "com", "para"... são ligações: quando há outra palavra na busca
// elas saem, porque quase nenhum nome de produto as repete ("camisa de" é uma
// busca que a cliente parou no meio de "camisa de algodão"). Os testes vizinhos
// provavam duas palavras úteis com ligação no meio ("bolsa de couro"); o caso
// de UMA palavra útil e UMA ligação -- o menor que a regra atende -- ficava solto:
// a ligação deixava de sair e virava exigência ("de" como palavra inteira).
import {
  palavrasDaBusca,
  pontuadorDaBusca,
  produtoCombinaComBusca,
} from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (name: string) => ({
  name,
  category: "Geral",
  description: null,
});

describe("uma palavra útil e uma ligação: só a palavra conta", () => {
  it.each([
    ["camisa de", "Camisa Azul"],
    ["camisa com", "Camisa Azul"],
    ["para camisa", "Camisa Azul"],
    ["a camisa", "Camisa Azul"],
  ])("'%s' acha %s", (busca, nome) => {
    expect(produtoCombinaComBusca(produto(nome), busca)).toBe(true);
  });

  it("a ligação sai da lista de palavras da busca", () => {
    const palavras = palavrasDaBusca("camisa de");
    expect(palavras).toHaveLength(1);
    expect(palavras[0].map((forma) => forma.texto)).toContain("camisa");
  });

  it("não é regra de aceitar tudo: a palavra útil continua obrigatória", () => {
    expect(produtoCombinaComBusca(produto("Bolsa Azul"), "camisa de")).toBe(
      false,
    );
  });

  it("a relevância também ignora a ligação sobrando", () => {
    const pontuar = pontuadorDaBusca("camisa de");
    const comPalavra = pontuar(produto("Camisa Azul"));
    const semPalavra = pontuar(produto("Bolsa Azul"));
    expect(comPalavra).toBeGreaterThan(semPalavra);
  });

  it("controle: só ligações mantém a busca antiga (a ligação vira a palavra)", () => {
    expect(palavrasDaBusca("de")).toHaveLength(1);
    expect(produtoCombinaComBusca(produto("Capa de Sofa"), "de")).toBe(true);
    expect(produtoCombinaComBusca(produto("Camisa Azul"), "de")).toBe(false);
  });
});
