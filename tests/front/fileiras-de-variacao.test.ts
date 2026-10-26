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
  it("abre duas dimensões com o tamanho primeiro, mesmo gravado como Cor / Tamanho, e oculta linhas desligadas", () => {
    const resultado = fileirasDeVariacao(variantes);
    expect(resultado.fileiras.map((f) => f.nome)).toEqual(["Tamanho", "Cor"]);
    expect(resultado.fileiras[0].valores.map((v) => v.valor)).toEqual([
      "P",
      "M",
    ]);
    expect(resultado.fileiras[1].valores.map((v) => v.valor)).toEqual([
      "Azul",
      "Preto",
    ]);
    expect(resultado.variante).toBeUndefined();
  });
  it("a linha comprável e o nome gravado não mudam com a ordem das fileiras", () => {
    const resultado = fileirasDeVariacao(variantes, {
      Tamanho: "P",
      Cor: "Azul",
    });
    expect(resultado.variante).toBe(variantes[0]);
    expect(resultado.variante?.name).toBe("Cor / Tamanho");
    expect(resultado.variante?.value).toBe("Azul / P");
  });
  it("escolher o tamanho apaga as cores sem estoque nele", () => {
    const resultado = fileirasDeVariacao(variantes, { Tamanho: "M" });
    const cores = resultado.fileiras.find((f) => f.nome === "Cor");
    expect(cores?.valores.map((v) => [v.valor, v.disponivel])).toEqual([
      ["Azul", false],
      ["Preto", true],
    ]);
    expect(resultado.variante).toBeUndefined();
  });
  it("sem escolha nenhuma, tamanho e cor aparecem pelo estoque total de cada valor", () => {
    const resultado = fileirasDeVariacao(variantes);
    const dispo = (nome: string) =>
      resultado.fileiras
        .find((f) => f.nome === nome)
        ?.valores.map((v) => [v.valor, v.estoque, v.disponivel]);
    expect(dispo("Tamanho")).toEqual([
      ["P", 2, true],
      ["M", 5, true],
    ]);
    expect(dispo("Cor")).toEqual([
      ["Azul", 2, true],
      ["Preto", 5, true],
    ]);
  });
  it("escolher a cor apaga os tamanhos sem estoque nela, e a cor também se apaga pelo tamanho", () => {
    const soCor = fileirasDeVariacao(variantes, { Cor: "Azul" });
    expect(
      soCor.fileiras[0].valores.map((v) => [v.valor, v.disponivel]),
    ).toEqual([
      ["P", true],
      ["M", false],
    ]);
    const resultado = fileirasDeVariacao(variantes, {
      Cor: "Azul",
      Tamanho: "P",
    });
    expect(resultado.fileiras[0].valores.map((v) => v.disponivel)).toEqual([
      true,
      false,
    ]);
    // Antes a cor ignorava o tamanho: Preto aparecia disponível com o P
    // escolhido, embora não exista Preto / P.
    expect(resultado.fileiras[1].valores.map((v) => v.disponivel)).toEqual([
      true,
      false,
    ]);
    expect(resultado.variante?.id).toBe("azul-p");
  });
  it("sem beco sem saída: qualquer sequência de toques em valores disponíveis termina numa linha com estoque", () => {
    const [primeira, segunda] = fileirasDeVariacao(variantes).fileiras;
    for (const [a, b] of [
      [primeira, segunda],
      [segunda, primeira],
    ]) {
      for (const va of a.valores) {
        const depoisDoPrimeiro = fileirasDeVariacao(variantes, {});
        const livre = depoisDoPrimeiro.fileiras
          .find((f) => f.nome === a.nome)
          ?.valores.find((v) => v.valor === va.valor);
        if (!livre?.disponivel) continue;
        const meio = fileirasDeVariacao(variantes, { [a.nome]: va.valor });
        const aindaHa = meio.fileiras
          .find((f) => f.nome === b.nome)
          ?.valores.filter((v) => v.disponivel);
        // Escolheu um valor disponível: sempre sobra pelo menos uma saída.
        expect(aindaHa?.length, `${a.nome}=${va.valor}`).toBeGreaterThan(0);
        for (const vb of aindaHa ?? []) {
          const fim = fileirasDeVariacao(variantes, {
            [a.nome]: va.valor,
            [b.nome]: vb.valor,
          });
          expect(fim.variante?.stockIncrement).toBeGreaterThan(0);
        }
      }
    }
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
      "Tamanho",
      "Cor",
      "Tecido",
    ]);
    expect(resultado.fileiras[2].valores.map((v) => v.disponivel)).toEqual([
      true,
      false,
    ]);
    expect(resultado.variante?.id).toBe("a");
  });
  it("três dimensões: Tamanho, Cor e depois os outros na ordem em que foram gravados", () => {
    const nomesDe = (name: string, value: string) =>
      fileirasDeVariacao([linha("x", value, 1, name)]).fileiras.map(
        (f) => f.nome,
      );
    expect(nomesDe("Tecido / Cor / Tamanho", "Seda / Azul / P")).toEqual([
      "Tamanho",
      "Cor",
      "Tecido",
    ]);
    expect(nomesDe("Material / Cor / Estampa", "Seda / Azul / Lisa")).toEqual([
      "Cor",
      "Material",
      "Estampa",
    ]);
    expect(nomesDe("Estampa / Material / Cor", "Lisa / Seda / Azul")).toEqual([
      "Cor",
      "Estampa",
      "Material",
    ]);
  });
  it("tamanho em três dimensões apaga a cor e o outro atributo que não existem nele", () => {
    const linhas = [
      linha("a", "Azul / P / Algodão", 4, "Cor / Tamanho / Tecido"),
      linha("b", "Preto / M / Seda", 3, "Cor / Tamanho / Tecido"),
    ];
    const resultado = fileirasDeVariacao(linhas, { Tamanho: "P" });
    const dispo = (nome: string) =>
      resultado.fileiras
        .find((f) => f.nome === nome)
        ?.valores.map((v) => [v.valor, v.disponivel]);
    expect(dispo("Cor")).toEqual([
      ["Azul", true],
      ["Preto", false],
    ]);
    expect(dispo("Tecido")).toEqual([
      ["Algodão", true],
      ["Seda", false],
    ]);
  });
  it("produto só com cor, só com tamanho ou só com voltagem mantém a única fileira", () => {
    const so = (name: string, valor: string) =>
      fileirasDeVariacao([linha("x", valor, 1, name)], { [name]: valor });
    for (const [name, valor] of [
      ["Cor", "Azul"],
      ["Tamanho", "P"],
      ["Voltagem", "220V"],
    ]) {
      const r = so(name, valor);
      expect(r.fileiras.map((f) => f.nome)).toEqual([name]);
      expect(r.variante?.id).toBe("x");
    }
  });
  it("voltagem também vem antes da cor", () => {
    const r = fileirasDeVariacao([
      linha("v", "Preto / 220V", 2, "Cor / Voltagem"),
    ]);
    expect(r.fileiras.map((f) => f.nome)).toEqual(["Voltagem", "Cor"]);
  });
  it("capacidade vem antes da cor (o cliente escolhe os 128 GB e vê as cores que existem nele); material fica depois", () => {
    const nomesDe = (name: string, value: string) =>
      fileirasDeVariacao([linha("x", value, 1, name)]).fileiras.map(
        (f) => f.nome,
      );
    expect(nomesDe("Cor / Capacidade", "Preto / 128 GB")).toEqual([
      "Capacidade",
      "Cor",
    ]);
    // Os apelidos que o lojista já grava valem o mesmo, e o nome é mantido.
    expect(nomesDe("Cor / armazenamento", "Preto / 128 GB")).toEqual([
      "armazenamento",
      "Cor",
    ]);
    expect(nomesDe("Material / Cor", "Couro / Preto")).toEqual([
      "Cor",
      "Material",
    ]);
    expect(
      nomesDe("Material / Cor / Capacidade", "Couro / Preto / 1 L"),
    ).toEqual(["Capacidade", "Cor", "Material"]);
  });
  it("produto só com capacidade ou só com material continua comprável pela linha inteira", () => {
    for (const [name, valor] of [
      ["Capacidade", "64 GB"],
      ["Memória", "16 GB"],
      ["Material", "Algodão"],
    ]) {
      const r = fileirasDeVariacao([linha("x", valor, 2, name)], {
        [name]: valor,
      });
      expect(r.fileiras.map((f) => f.nome)).toEqual([name]);
      expect(r.variante?.id).toBe("x");
    }
  });
  it("nomes legados em caixa, acento e espaço diferentes são reconhecidos, e o nome gravado é mantido", () => {
    for (const [nome, esperado] of [
      ["COR / tamanho", ["tamanho", "COR"]],
      ["Côr / TAMANHO", ["TAMANHO", "Côr"]],
      [" cor / Tamanho ", ["Tamanho ", " cor"]],
      ["cor / voltagem", ["voltagem", "cor"]],
    ] as [string, string[]][]) {
      const partes = nome.split(" / ");
      const r = fileirasDeVariacao([
        linha("x", partes.map(() => "v").join(" / "), 1, nome),
      ]);
      expect(
        r.fileiras.map((f) => f.nome),
        nome,
      ).toEqual(esperado);
    }
  });
  it("linhas independentes (um nome por linha, grade antiga) também mostram o tamanho antes da cor", () => {
    const r = fileirasDeVariacao([
      linha("c", "Azul", 2, "Cor"),
      linha("t", "P", 2, "Tamanho"),
    ]);
    expect(r.fileiras.map((f) => f.nome)).toEqual(["Tamanho", "Cor"]);
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
