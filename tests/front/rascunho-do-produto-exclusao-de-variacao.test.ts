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
import {
  avisoDeVariacoesAlteradasEmOutroAparelho,
  variacoesExcluidasNoRascunho,
} from "@/lib/rascunho-do-produto";
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
    expect(r).toEqual({ apagar: [], manter: [], alteradas: [] });
  });

  it("base sem lista de variações: não deriva nada", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { name: "x" } },
      [A, B, C],
    );
    expect(r).toEqual({ apagar: [], manter: [], alteradas: [] });
  });

  it("rascunho sem lista de variações: não deriva nada (o formulário volta com as do banco)", () => {
    const r = variacoesExcluidasNoRascunho(
      { baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C],
    );
    expect(r).toEqual({ apagar: [], manter: [], alteradas: [] });
  });

  it("a da base que já sumiu do banco (outro aparelho a apagou) não vira exclusão", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, C] } },
      [A, B],
    );
    expect(r).toEqual({ apagar: [], manter: [], alteradas: [] });
  });

  it("rascunho igual à base: nada excluído, nada a manter", () => {
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B, C], baseDoRascunho: { variants: [A, B, C] } },
      [A, B, C],
    );
    expect(r).toEqual({ apagar: [], manter: [], alteradas: [] });
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
    expect(r).toEqual({ apagar: [], manter: [], alteradas: [] });
  });
});

describe("variacoesExcluidasNoRascunho — a excluída que outro aparelho mexeu", () => {
  const Cdesligada = { ...C, active: false, stockIncrement: 0 };

  it("a C estava desligada na base e hoje está ligada com 10 peças: NÃO vai para apagar, volta ao formulário", () => {
    const hoje = { ...C, active: true, stockIncrement: 10 };
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, Cdesligada] } },
      [A, B, hoje],
    );
    expect(r.apagar).toEqual([]);
    expect(r.manter).toEqual([hoje]);
    expect(r.alteradas).toEqual([hoje]);
  });

  it.each([
    ["nome", { name: "Tamanho" }],
    ["valor", { value: "C2" }],
    ["estoque", { stockIncrement: 99 }],
    ["preço próprio", { priceOverride: 12 }],
    ["ligada", { active: false }],
    ["código", { sku: "NOVO" }],
    ["código de barras", { codigoBarras: "789" }],
    ["foto", { imageUrl: "https://x/y.jpg" }],
  ])("mudança só em %s também conta como alterada", (_campo, mudanca) => {
    const hoje = { ...C, ...mudanca };
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, C] } },
      [A, B, hoje],
    );
    expect(r.apagar).toEqual([]);
    expect(r.alteradas).toEqual([hoje]);
  });

  it("vazio e nulo contam como o mesmo valor: não é alteração", () => {
    const daBase = { ...C, sku: "", imageUrl: null };
    const hoje = { ...C, sku: null, imageUrl: "" };
    const r = variacoesExcluidasNoRascunho(
      { variants: [A, B], baseDoRascunho: { variants: [A, B, daBase] } },
      [A, B, hoje],
    );
    expect(r.apagar).toEqual(["vc"]);
    expect(r.alteradas).toEqual([]);
  });

  it("base sem os campos da linha (rascunho antigo): na dúvida NÃO apaga, volta com aviso", () => {
    const r = variacoesExcluidasNoRascunho(
      {
        variants: [A, B],
        baseDoRascunho: { variants: [A, B, { id: "vc" }] },
      },
      [A, B, C],
    );
    expect(r.apagar).toEqual([]);
    expect(r.alteradas).toEqual([C]);
  });

  it("mistura: a que ninguém mexeu é apagada, a mexida volta, a nova de outro aparelho também volta sem aviso de alteração", () => {
    const dMexida = { ...D, active: false };
    const E = variacao("ve", "E");
    const r = variacoesExcluidasNoRascunho(
      { variants: [A], baseDoRascunho: { variants: [A, B, D] } },
      [A, B, dMexida, E],
    );
    expect(r.apagar).toEqual(["vb"]);
    expect(r.alteradas).toEqual([dMexida]);
    expect(r.manter).toEqual([dMexida, E]);
  });
});

describe("avisoDeVariacoesAlteradasEmOutroAparelho", () => {
  it("nenhuma: sem aviso", () => {
    expect(avisoDeVariacoesAlteradasEmOutroAparelho([])).toBeNull();
  });

  it("uma, no singular", () => {
    expect(avisoDeVariacoesAlteradasEmOutroAparelho([C])).toBe(
      "A variação Cor C foi alterada em outro aparelho e voltou para a lista; revise antes de excluir.",
    );
  });

  it("duas, no plural, ligadas por 'e'", () => {
    expect(avisoDeVariacoesAlteradasEmOutroAparelho([C, D])).toBe(
      "As variações Cor C e Cor D foram alteradas em outro aparelho e voltaram para a lista; revise antes de excluir.",
    );
  });

  it("três: vírgulas e 'e' no fim; combinação aparece com o nome de cada atributo", () => {
    const comb = {
      ...A,
      name: "Cor / Tamanho",
      value: "Azul / M",
    };
    expect(avisoDeVariacoesAlteradasEmOutroAparelho([comb, C, D])).toBe(
      "As variações Cor Azul · Tamanho M, Cor C e Cor D foram alteradas em outro aparelho e voltaram para a lista; revise antes de excluir.",
    );
  });
});
