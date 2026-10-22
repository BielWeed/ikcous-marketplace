import type { ProductVariant } from "@/types";
import { corDaVariacao } from "@/utils/cor-da-variacao";
import { fileirasDeVariacao } from "@/utils/fileiras-de-variacao";
import { describe, expect, it } from "vitest";

const linha = (
  id: string,
  value: string,
  stockIncrement = 2,
  name = "Cor / Tamanho",
  active = true,
): ProductVariant => ({
  id,
  productId: "produto",
  name,
  value,
  stockIncrement,
  active,
});

describe("fileiras da variação sem mudar a identidade da linha", () => {
  const variantes = [
    linha("azul-p", "Azul / P", 2),
    linha("azul-m", "Azul / M", 0),
    linha("preto-m", "Preto / M", 5),
    linha("desligada", "Vermelho / G", 10, "Cor / Tamanho", false),
  ];

  it("produto sem variação ou com todas desligadas não tem fileiras", () => {
    expect(fileirasDeVariacao().fileiras).toEqual([]);
    expect(fileirasDeVariacao([variantes[3]]).fileiras).toEqual([]);
  });
  it("uma dimensão mantém valores e id da linha, inclusive preço zero", () => {
    const unica = { ...linha("p", "P", 3, "Tamanho"), priceOverride: 0 };
    const resultado = fileirasDeVariacao([unica], { Tamanho: "P" });
    expect(resultado.fileiras[0].nome).toBe("Tamanho");
    expect(resultado.fileiras[0].valores[0]).toEqual({
      valor: "P",
      estoque: 3,
      disponivel: true,
    });
    expect(resultado.variante).toBe(unica);
  });
  it("abre duas dimensões em ordem e oculta linhas desligadas", () => {
    const resultado = fileirasDeVariacao(variantes);
    expect(resultado.fileiras.map((f) => f.nome)).toEqual(["Cor", "Tamanho"]);
    expect(resultado.fileiras[0].valores.map((v) => v.valor)).toEqual([
      "Azul",
      "Preto",
    ]);
    expect(resultado.fileiras[1].valores.map((v) => v.valor)).toEqual([
      "P",
      "M",
    ]);
    expect(resultado.variante).toBeUndefined();
  });
  it("tamanho depende da cor, mas cor com algum tamanho em estoque continua disponível", () => {
    const resultado = fileirasDeVariacao(variantes, {
      Cor: "Azul",
      Tamanho: "P",
    });
    expect(resultado.fileiras[1].valores.map((v) => v.disponivel)).toEqual([
      true,
      false,
    ]);
    expect(resultado.fileiras[0].valores.map((v) => v.disponivel)).toEqual([
      true,
      true,
    ]);
    expect(resultado.variante?.id).toBe("azul-p");
  });
  it("combinação ausente, desligada, incompleta ou esgotada nunca vira id comprável", () => {
    for (const escolha of [
      { Cor: "Preto", Tamanho: "P" },
      { Cor: "Azul", Tamanho: "M" },
      { Cor: "Vermelho", Tamanho: "G" },
      { Cor: "Azul" },
    ] as Record<string, string>[]) {
      expect(fileirasDeVariacao(variantes, escolha).variante).toBeUndefined();
    }
  });
  it("três dimensões conferem todas as outras seleções", () => {
    const linhas = [
      linha("a", "Azul / P / Algodão", 4, "Cor / Tamanho / Tecido"),
      linha("b", "Azul / M / Seda", 3, "Cor / Tamanho / Tecido"),
    ];
    const resultado = fileirasDeVariacao(linhas, {
      Cor: "Azul",
      Tamanho: "P",
      Tecido: "Algodão",
    });
    expect(resultado.fileiras.map((f) => f.nome)).toEqual([
      "Cor",
      "Tamanho",
      "Tecido",
    ]);
    expect(resultado.fileiras[2].valores.map((v) => v.disponivel)).toEqual([
      true,
      false,
    ]);
    expect(resultado.variante?.id).toBe("a");
  });
  it("contagens legadas diferentes usam uma fileira com texto cru, sem perder id", () => {
    const legada = linha("legado", "Azul / P / Extra");
    const resultado = fileirasDeVariacao([legada], {
      "Cor / Tamanho": legada.value,
    });
    expect(resultado.fileiras.map((f) => f.nome)).toEqual(["Cor / Tamanho"]);
    expect(resultado.fileiras[0].valores[0].valor).toBe(legada.value);
    expect(resultado.variante).toBe(legada);
  });
  it("uma linha malformada faz todo o grupo voltar ao modo cru", () => {
    const resultado = fileirasDeVariacao([
      ...variantes,
      linha("legado", "Cru"),
    ]);
    expect(resultado.fileiras.map((f) => f.nome)).toEqual(["Cor / Tamanho"]);
  });
});

describe("cor da variação", () => {
  it("aceita somente hex RGB/RRGGBB válido, com precedência sobre o nome", () => {
    expect(corDaVariacao("Azul", "#abc")).toBe("#abc");
    expect(corDaVariacao("Desconhecida", "#123456")).toBe("#123456");
    expect(corDaVariacao("Azul", "red")).toBe("#2563eb");
    expect(corDaVariacao("Desconhecida", "#12345")).toBeNull();
    expect(corDaVariacao("Desconhecida", "#aabbccdd")).toBeNull();
  });
  it("normaliza acentos, espaços e caixa e não inventa cor desconhecida", () => {
    expect(corDaVariacao("  AZUL BEBÊ ")).toBe(corDaVariacao("azul bebe"));
    expect(corDaVariacao("  AZUL BEBÊ ")).not.toBeNull();
    expect(corDaVariacao("Bordô")).toBe(corDaVariacao("bordo"));
    expect(corDaVariacao("estampa espacial")).toBeNull();
  });
  it("cobre os nomes comuns de moda", () => {
    for (const nome of "branco,preto,cinza,chumbo,grafite,azul,azul marinho,marinho,azul bebê,celeste,azul royal,verde,verde militar,musgo,oliva,menta,vermelho,vinho,bordô,rosa,rosa pink,pink,nude,bege,areia,creme,off white,marrom,caramelo,café,amarelo,mostarda,laranja,roxo,lilás,lavanda,dourado,prata,jeans,terracota".split(
      ",",
    )) {
      expect(corDaVariacao(nome), nome).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
