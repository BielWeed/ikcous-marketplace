// Bordas da escolha de opções (folha "Escolher opções" do card e página do
// produto) que as mutações mostraram sem teste:
//
//   - "Última unidade!" só aparece com EXATAMENTE 1 unidade, quando a escolha
//     está COMPLETA e a combinação é única (com 2 unidades o aviso mentiria);
//   - só um eixo chamado Cor/Cores/Color/Estampa é "cor" para a pré-escolha
//     ("Corte" ou "Colorido" não são, e nunca entram marcados sozinhos);
//   - a escolha que a cliente já fez vence a pré-escolha de cor e a de opção
//     única: nada é trocado por baixo dela;
//   - escolher um valor sem estoque nenhum não o marca;
//   - cadastro antigo (cor e tamanho em grupos separados): se UM dos grupos
//     marcados está esgotado, a linha NÃO resolve -- senão só o outro grupo
//     iria ao carrinho, e a cliente compraria o tamanho sem a cor.
//
// Mutações medidas (cada uma deixava todos os testes anteriores verdes):
// `stockIncrement === 1` -> `<= 2`; tirar a exigência de escolha completa;
// tirar a exigência de uma linha só; tirar as âncoras `^...$` do regex de cor;
// tirar o `depois.has(...)` de `preselecionarCor` e de `preselecionarOpcaoUnica`;
// tirar a checagem de disponibilidade de `escolherValorDoEixo`; tirar a
// checagem "um grupo sem linha derruba a resolução" de `resolverSelecaoDosEixos`.
import type { ProductVariant } from "@/types";
import {
  criarEixosDaVariacao,
  disponibilidadeDoValor,
  escolherValorDoEixo,
  preselecionarCor,
  preselecionarOpcaoUnica,
  resolverSelecaoDosEixos,
} from "@/utils/eixos-da-variacao";
import { describe, expect, it } from "vitest";

const variante = (
  value: string,
  stockIncrement: number,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id: value,
  productId: "teste",
  name: "Cor / Tamanho",
  value,
  stockIncrement,
  active: true,
  ...extra,
});

const chaveDe = (
  modelo: ReturnType<typeof criarEixosDaVariacao>,
  nome: string,
) => {
  const eixo = modelo.eixos.find((e) => e.nome === nome);
  if (!eixo) throw new Error(`eixo ${nome} não existe no modelo de teste`);
  return eixo.chave;
};

describe("disponibilidadeDoValor: 'última unidade' só com uma unidade, escolha completa e combinação única", () => {
  const modelo = criarEixosDaVariacao([
    variante("Azul / M", 2),
    variante("Azul / G", 1),
    variante("Verde / M", 1),
  ]);
  const cor = chaveDe(modelo, "Cor");
  const tamanho = chaveDe(modelo, "Tamanho");

  it("uma unidade, cor escolhida: é a última", () => {
    const r = disponibilidadeDoValor(
      modelo,
      new Map([[cor, "Azul"]]),
      tamanho,
      "G",
    );
    expect(r).toMatchObject({ existe: true, disponivel: true, ultima: true });
  });

  it("duas unidades NÃO são a última: o aviso não mente", () => {
    const r = disponibilidadeDoValor(
      modelo,
      new Map([[cor, "Azul"]]),
      tamanho,
      "M",
    );
    expect(r).toMatchObject({ disponivel: true, ultima: false });
  });

  it("uma unidade só, mas com a cor ainda por escolher: não anuncia a última", () => {
    // Só existe uma linha de tamanho G (Azul, 1 unidade). Sem a cor marcada a
    // cliente não escolheu essa combinação ainda.
    const r = disponibilidadeDoValor(modelo, new Map(), tamanho, "G");
    expect(r).toMatchObject({ existe: true, disponivel: true, ultima: false });
  });

  it("duas linhas para a mesma combinação (cadastro duplicado) somam: não é a última", () => {
    const duplicado = criarEixosDaVariacao([
      variante("Azul / M", 1, { id: "azul-m-1" }),
      variante("Azul / M", 5, { id: "azul-m-2" }),
    ]);
    const r = disponibilidadeDoValor(
      duplicado,
      new Map([[chaveDe(duplicado, "Cor"), "Azul"]]),
      chaveDe(duplicado, "Tamanho"),
      "M",
    );
    expect(r).toMatchObject({ disponivel: true, ultima: false });
  });
});

describe("preselecionarCor: só eixo de cor, e a escolha já feita vence", () => {
  it("eixo 'Corte' (começa com 'cor' mas não é cor) não é pré-marcado", () => {
    const modelo = criarEixosDaVariacao([
      variante("Slim / Algodão", 2, { name: "Corte / Material" }),
      variante("Reto / Algodão", 2, { name: "Corte / Material" }),
    ]);
    expect([...preselecionarCor(modelo, new Map()).values()]).toEqual([]);
  });

  it("eixo 'Colorido' também não", () => {
    const modelo = criarEixosDaVariacao([
      variante("Sim / Algodão", 2, { name: "Colorido / Material" }),
      variante("Não / Algodão", 2, { name: "Colorido / Material" }),
    ]);
    expect([...preselecionarCor(modelo, new Map()).values()]).toEqual([]);
  });

  it("cor já escolhida pela cliente não é trocada pela primeira cor com estoque", () => {
    const modelo = criarEixosDaVariacao([
      variante("Azul / Algodão", 2, { name: "Cor / Material" }),
      variante("Verde / Algodão", 2, { name: "Cor / Material" }),
    ]);
    const cor = chaveDe(modelo, "Cor");
    const antes = new Map([[cor, "Verde"]]);
    const depois = preselecionarCor(modelo, antes);
    expect(depois.get(cor)).toBe("Verde");
    expect([...antes]).toEqual([[cor, "Verde"]]);
  });

  it("sem escolha, a primeira cor com estoque entra marcada (controle)", () => {
    const modelo = criarEixosDaVariacao([
      variante("Azul / Algodão", 0, { name: "Cor / Material" }),
      variante("Verde / Algodão", 2, { name: "Cor / Material" }),
    ]);
    expect([...preselecionarCor(modelo, new Map()).values()]).toEqual([
      "Verde",
    ]);
  });
});

describe("preselecionarOpcaoUnica: a escolha já feita não é trocada", () => {
  it("valor já marcado no eixo (mesmo antigo, fora da lista) segue como está", () => {
    const modelo = criarEixosDaVariacao([
      variante("M", 3, { name: "Tamanho" }),
    ]);
    const tamanho = chaveDe(modelo, "Tamanho");
    // A lojista renomeou a opção com a folha aberta: a marcação velha ("P")
    // não vale mais, mas quem a limpa é a validação da escolha, nunca esta
    // pré-escolha trocando "P" por "M" por baixo da cliente.
    const antes = new Map([[tamanho, "P"]]);
    expect(preselecionarOpcaoUnica(modelo, antes).get(tamanho)).toBe("P");
  });

  it("sem marcação, a opção única com estoque entra marcada (controle)", () => {
    const modelo = criarEixosDaVariacao([
      variante("M", 3, { name: "Tamanho" }),
    ]);
    const tamanho = chaveDe(modelo, "Tamanho");
    expect(preselecionarOpcaoUnica(modelo, new Map()).get(tamanho)).toBe("M");
  });
});

describe("escolherValorDoEixo: valor sem estoque nenhum não é marcado", () => {
  const modelo = criarEixosDaVariacao([
    variante("Azul / M", 3),
    variante("Azul / GG", 0),
  ]);
  const tamanho = chaveDe(modelo, "Tamanho");

  it("tamanho esgotado em todas as cores fica sem marcação", () => {
    expect(escolherValorDoEixo(modelo, new Map(), tamanho, "GG").size).toBe(0);
  });

  it("valor que o produto não tem também não é marcado", () => {
    expect(escolherValorDoEixo(modelo, new Map(), tamanho, "XG").size).toBe(0);
  });

  it("tamanho com estoque é marcado (controle)", () => {
    expect(
      escolherValorDoEixo(modelo, new Map(), tamanho, "M").get(tamanho),
    ).toBe("M");
  });
});

describe("resolverSelecaoDosEixos: grupo esgotado derruba a linha toda", () => {
  const modelo = criarEixosDaVariacao([
    variante("Azul", 0, { name: "Cor" }),
    variante("M", 3, { name: "Tamanho" }),
  ]);
  const cor = chaveDe(modelo, "Cor");
  const tamanho = chaveDe(modelo, "Tamanho");

  it("cor esgotada + tamanho com estoque: não resolve nada (nem só o tamanho)", () => {
    const escolhas = new Map([
      [cor, "Azul"],
      [tamanho, "M"],
    ]);
    expect([...resolverSelecaoDosEixos(modelo, escolhas)]).toEqual([]);
  });

  it("com a cor em estoque resolve os dois grupos (controle)", () => {
    const comEstoque = criarEixosDaVariacao([
      variante("Azul", 2, { name: "Cor" }),
      variante("M", 3, { name: "Tamanho" }),
    ]);
    const escolhas = new Map([
      [chaveDe(comEstoque, "Cor"), "Azul"],
      [chaveDe(comEstoque, "Tamanho"), "M"],
    ]);
    expect([...resolverSelecaoDosEixos(comEstoque, escolhas)]).toEqual([
      ["Cor", "Azul"],
      ["Tamanho", "M"],
    ]);
  });
});
