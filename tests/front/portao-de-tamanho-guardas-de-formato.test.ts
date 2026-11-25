// Guardas de FORMATO de `validarClassificacaoContraDisco`
// (scripts/validarPortaoDeTamanho.cjs).
//
// O teste vizinho (portao-dividido-classificacao.test.ts) confere que a função
// LANÇA, mas só com `toThrow(/PORTAO_TAMANHO/)` em poucos casos. Mutar um `||`
// da guarda inicial para `&&` troca o erro de formato por um TypeError
// (`null.versao`, `undefined.every`) — que ainda é uma exceção e ainda casa
// com "lançou algo". Só que o `size-limit` imprime a mensagem para o dono ler:
// uma pilha de TypeError no lugar de "classificação ausente ou com formato
// diferente" é o portão falhando fechado pelo motivo errado. Aqui cada forma
// inválida confere a MENSAGEM de formato, uma por uma, e cada ramo de
// duplicidade confere o seu texto.
import { describe, expect, it } from "vitest";
import { validarClassificacaoContraDisco } from "../../scripts/validarPortaoDeTamanho.cjs";

const FORMATO = /classificação ausente, ou com formato diferente de/;

describe("validarClassificacaoContraDisco — guarda de formato", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["número", 7],
    ["texto", "{}"],
    ["lista", [1]],
    ["versão 2", { versao: 2, cliente: [], painel: [] }],
    ["versão 0", { versao: 0, cliente: [], painel: [] }],
    ["sem versão", { cliente: [], painel: [] }],
    ["cliente ausente", { versao: 1, painel: [] }],
    ["cliente não é lista", { versao: 1, cliente: "a.js", painel: [] }],
    ["painel ausente", { versao: 1, cliente: [] }],
    ["painel não é lista", { versao: 1, cliente: [], painel: { a: 1 } }],
    [
      "cliente com item não-texto (o resto é texto)",
      { versao: 1, cliente: ["a.js", 5], painel: [] },
    ],
    [
      "painel com item não-texto (o resto é texto)",
      { versao: 1, cliente: [], painel: ["b.js", null] },
    ],
  ])("recusa com a mensagem de FORMATO: %s", (_nome, entrada) => {
    expect(() => validarClassificacaoContraDisco(entrada, [])).toThrow(FORMATO);
  });

  it("a mensagem de formato diz qual é o formato esperado (versao:1)", () => {
    expect(() => validarClassificacaoContraDisco(null, [])).toThrow(
      "{versao:1, cliente:[], painel:[]}",
    );
  });

  it("aceita lista vazia nos dois lados quando o disco também está vazio", () => {
    expect(
      validarClassificacaoContraDisco(
        { versao: 1, cliente: [], painel: [] },
        [],
      ),
    ).toEqual({ cliente: [], painel: [] });
  });
});

describe("validarClassificacaoContraDisco — duplicidade", () => {
  it("repetido SÓ no cliente (painel limpo) é recusado com o texto de repetição", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { versao: 1, cliente: ["a.js", "a.js"], painel: ["b.js"] },
        ["a.js", "b.js"],
      ),
    ).toThrow(/arquivo repetido dentro do mesmo grupo/);
  });

  it("repetido SÓ no painel (cliente limpo) é recusado com o texto de repetição", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { versao: 1, cliente: ["a.js"], painel: ["b.js", "b.js"] },
        ["a.js", "b.js"],
      ),
    ).toThrow(/arquivo repetido dentro do mesmo grupo/);
  });

  it("duplicata na lista de disco é recusada com o texto de disco", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { versao: 1, cliente: ["a.js"], painel: [] },
        ["a.js", "a.js"],
      ),
    ).toThrow(/lista de arquivos em disco tem duplicata/);
  });

  it("devolve as listas da classificação na ordem original (não a do Set)", () => {
    const r = validarClassificacaoContraDisco(
      { versao: 1, cliente: ["z.js", "a.js"], painel: ["m.js"] },
      ["a.js", "m.js", "z.js"],
    );
    expect(r.cliente).toEqual(["z.js", "a.js"]);
    expect(r.painel).toEqual(["m.js"]);
  });

  it("a mensagem de divergência nomeia o lado do disco E o da classificação", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { versao: 1, cliente: ["velho.js"], painel: [] },
        ["novo.js"],
      ),
    ).toThrow(
      /só no disco: \["novo\.js"\]; só na classificação: \["velho\.js"\]/,
    );
  });
});
