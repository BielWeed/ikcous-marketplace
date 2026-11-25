// scripts/validarPortaoDeTamanho.cjs — a conferência FAIL-CLOSED que o
// `.size-limit.cjs` roda antes de medir o tamanho do que vai para o cliente.
// Se ela aprovar o que devia reprovar, um chunk fica fora dos dois tetos
// (cliente e painel) e o `npm run size` passa sem medir aquele arquivo.
//
// tests/front/portao-dividido-classificacao.test.ts prova o caminho feliz e as
// divergências mais comuns. Uma caça por mutação (plantar um defeito de uma
// linha no validador) achou guardas sem nenhum teste: classificação nula,
// lista que não é lista, item que não é texto, repetido só num dos grupos e
// arquivo repetido na lista do disco. Cada caso abaixo cai se a guarda sair.
import { describe, expect, it } from "vitest";
import { validarClassificacaoContraDisco } from "../../scripts/validarPortaoDeTamanho.cjs";

const BOA = {
  versao: 1,
  cliente: ["assets/a.js"],
  painel: ["assets/b.js"],
};
const DISCO = ["assets/a.js", "assets/b.js"];

function validar(classificacao: unknown, disco: readonly string[] = DISCO) {
  return validarClassificacaoContraDisco(classificacao, disco);
}

describe("validarClassificacaoContraDisco — bordas do fail-closed", () => {
  it("controle: classificação que bate com o disco passa e devolve os dois grupos", () => {
    expect(validar(BOA)).toEqual({
      cliente: ["assets/a.js"],
      painel: ["assets/b.js"],
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["texto", "texto"],
    ["número", 3],
    ["lista", []],
    ["objeto vazio", {}],
    ["versão 2", { ...BOA, versao: 2 }],
    ["cliente que não é lista", { ...BOA, cliente: "assets/a.js" }],
    ["painel que não é lista", { ...BOA, painel: "assets/b.js" }],
    ["cliente sem painel", { versao: 1, cliente: [] }],
    ["item numérico no cliente", { ...BOA, cliente: [1] }],
    ["texto E número no cliente", { ...BOA, cliente: ["assets/a.js", 1] }],
    ["texto E nulo no painel", { ...BOA, painel: ["assets/b.js", null] }],
  ])(
    "recusa formato inválido (%s) com a mensagem do portão, nunca com erro solto",
    (_nome, entrada) => {
      expect(() => validar(entrada)).toThrowError(
        /^PORTAO_TAMANHO: classificação ausente, ou com formato diferente de/,
      );
    },
  );

  it("recusa arquivo repetido dentro de UM só dos grupos (cada grupo conta o seu)", () => {
    expect(() =>
      validar({ ...BOA, cliente: ["assets/a.js", "assets/a.js"] }, DISCO),
    ).toThrowError(/repetido dentro do mesmo grupo/);
    expect(() =>
      validar({ ...BOA, painel: ["assets/b.js", "assets/b.js"] }, DISCO),
    ).toThrowError(/repetido dentro do mesmo grupo/);
  });

  it("recusa arquivo que está nos DOIS grupos, nomeando o arquivo", () => {
    expect(() =>
      validar({ versao: 1, cliente: ["assets/a.js"], painel: ["assets/a.js"] }),
    ).toThrowError(/não são disjuntos — em comum: \["assets\/a\.js"\]/);
  });

  it("recusa lista do disco com arquivo repetido (não deixa a duplicata sumir num Set)", () => {
    expect(() =>
      validar(BOA, ["assets/a.js", "assets/b.js", "assets/a.js"]),
    ).toThrowError(/lista de arquivos em disco tem duplicata/);
  });

  it("recusa classificação desatualizada nos dois sentidos e diz o que sobra de cada lado", () => {
    expect(() => validar(BOA, [...DISCO, "assets/c.js"])).toThrowError(
      /só no disco: \["assets\/c\.js"\]; só na classificação: \[\]/,
    );
    expect(() => validar(BOA, ["assets/a.js"])).toThrowError(
      /só no disco: \[\]; só na classificação: \["assets\/b\.js"\]/,
    );
  });
});
