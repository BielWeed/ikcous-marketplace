// A variação que a lojista EXCLUIU antes de sair sem salvar tem de continuar
// excluída quando ela restaura o rascunho.
//
// O defeito: a lista de exclusões (`deletedVariantIds`) é só memória da tela e
// não entra no rascunho. Rascunho [A, B] com o banco ainda em [A, B, C]: ao
// Restaurar e Salvar nada ia para `p_apagar`, a C seguia à venda e o estoque
// gravado era a soma SEM ela. Quem diz que foi a lojista e não outro aparelho
// é o produto-base que o próprio rascunho guarda (`baseDoRascunho`): o que
// estava na base, não está no rascunho e ainda existe no banco de hoje foi
// excluído por ela. O que existe no banco e nunca esteve nem na base nem no
// rascunho (criada em outro aparelho) ela nunca viu: fica, não se apaga.
import { variacoesExcluidasNoRascunho } from "@/lib/rascunho-do-produto";
import { describe, expect, it } from "vitest";

const variacao = (id: string, valor: string, estoque = 1) => ({
  id,
  productId: "p",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: true,
});

const [A, B, C, D] = [
  variacao("va", "A"),
  variacao("vb", "B"),
  variacao("vc", "C"),
  variacao("vd", "D"),
];

describe("variacoesExcluidasNoRascunho", () => {
  it("rascunho [A,B], base [A,B,C], banco [A,B,C]: a C foi excluída por ela", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C],
    );
    expect(r.apagar).toEqual(["vc"]);
    expect(r.manter).toEqual([]);
  });

  it("variação criada em OUTRO aparelho (banco [A,B,C,D]): a C sai, a D é mantida e nunca apagada", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C, D],
    );
    expect(r.apagar).toEqual(["vc"]);
    expect(r.manter).toEqual([D]);
  });

  it("rascunho sem base (anterior à regra): não deriva nada", () => {
    const r = variacoesExcluidasNoRascunho({ variants: [A, B] }, [A, B, C]);
    expect(r).toEqual({ apagar: [], manter: [] });
  });

  it("base sem lista de variações: não deriva nada", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { name: "x" } },
      [A, B, C],
    );
    expect(r).toEqual({ apagar: [], manter: [] });
  });

  it("rascunho sem lista de variações: não deriva nada (o formulário volta com as do banco)", () => {
    const r = variacoesExcluidasNoRascunho(
      { baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C],
    );
    expect(r).toEqual({ apagar: [], manter: [] });
  });

  it("a da base que já sumiu do banco (outro aparelho a apagou) não vira exclusão", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, C] } },
      [A, B],
    );
    expect(r).toEqual({ apagar: [], manter: [] });
  });

  it("rascunho igual à base: nada excluído, nada a manter", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B, C], baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C],
    );
    expect(r).toEqual({ apagar: [], manter: [] });
  });

  it("lojista excluiu TODAS: as três vão para apagar", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [], baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C],
    );
    expect(r.apagar).toEqual(["va", "vb", "vc"]);
  });

  it("variação nova do rascunho (temp-…) nunca vira exclusão nem se confunde com a do banco", () => {
    const nova = variacao("temp-1", "Verde");
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, nova], baseDoRascunho: { variants: [A, B] } },
      [A, B],
    );
    expect(r.apagar).toEqual(["vb"]);
    expect(r.manter).toEqual([]);
  });

  it("a variação que ela manteve (está no rascunho) nunca é apagada nem 'mantida' duas vezes", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B, D], baseDoRascunho: { variants: [A, B] } },
      [A, B, D],
    );
    expect(r).toEqual({ apagar: [], manter: [] });
  });
});
