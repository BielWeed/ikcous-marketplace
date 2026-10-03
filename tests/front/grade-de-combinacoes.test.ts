// A1 da peça 21 — o util da grade de combinações (`grade-de-combinacoes.ts`).
//
// O que o dono aprovou (14/09/2026) e este arquivo prova, ponto a ponto do
// despacho: 2 × 5 gera 10; três atributos; exatamente 60 aceito e excesso
// recusado; quarto atributo recusado; valores vazios/duplicados e "/" são
// tratados; repetir a mesma grade não cria duplicata; completar a grade
// acrescenta SÓ as linhas faltantes. Mais o SKU com sufixo e a colisão dele
// com SKU que já existe (crítica 1.4 do estudo: SKU repetido derruba o lote).
//
// Teste de função pura — ambiente node, mesmo padrão de
// admin-shipping-frases-da-regra.test.ts.
import { describe, expect, it } from "vitest";

import {
  MAX_ATRIBUTOS_DA_GRADE,
  MAX_LINHAS_DA_GRADE,
  type AtributoDaGrade,
  gerarGrade,
  primeiroSkuEmColisao,
  skusDaGrade,
} from "@/utils/grade-de-combinacoes";
import { SEPARADOR_DE_ATRIBUTOS } from "@/utils/variante-composta";

const atributo = (name: string, ...valores: string[]): AtributoDaGrade => ({
  name,
  valores,
});

const valoresGerados = (resultado: ReturnType<typeof gerarGrade>): string[] =>
  resultado.linhas.map((linha) => linha.value);

describe("gerarGrade — o produto cartesiano", () => {
  it("2 × 5 gera exatamente 10 combinações, primeiro atributo variando devagar", () => {
    const { linhas, erro } = gerarGrade(
      [
        atributo("Cor", "Amarela", "Verde"),
        atributo("Tamanho", "PP", "P", "M", "G", "GG"),
      ],
      [],
    );
    expect(erro).toBeNull();
    expect(linhas).toHaveLength(10);
    expect(valoresGerados({ linhas, erro })).toEqual([
      "Amarela / PP",
      "Amarela / P",
      "Amarela / M",
      "Amarela / G",
      "Amarela / GG",
      "Verde / PP",
      "Verde / P",
      "Verde / M",
      "Verde / G",
      "Verde / GG",
    ]);
    // O name composto é o grupo inteiro, no formato da peça 19.
    expect(linhas[0].name).toBe("Cor / Tamanho");
  });

  it("três atributos combinam as três dimensões", () => {
    const { linhas, erro } = gerarGrade(
      [
        atributo("Cor", "Branca"),
        atributo("Tamanho", "P", "M"),
        atributo("Estampa", "Lisa", "Listrada"),
      ],
      [],
    );
    expect(erro).toBeNull();
    expect(linhas).toHaveLength(4);
    expect(valoresGerados({ linhas, erro })).toEqual([
      "Branca / P / Lisa",
      "Branca / P / Listrada",
      "Branca / M / Lisa",
      "Branca / M / Listrada",
    ]);
    expect(linhas[0].name).toBe("Cor / Tamanho / Estampa");
  });

  it("um atributo só sai CRU, sem separador nenhum (caso simples da casa)", () => {
    const { linhas, erro } = gerarGrade(
      [atributo("Cor", "Azul", "Amarela")],
      [],
    );
    expect(erro).toBeNull();
    expect(linhas).toEqual([
      { name: "Cor", value: "Azul" },
      { name: "Cor", value: "Amarela" },
    ]);
    expect(SEPARADOR_DE_ATRIBUTOS).not.toContain("Azul");
  });
});

describe("gerarGrade — os limites aprovados (3 atributos, 60 linhas por produto)", () => {
  it("recusa o quarto atributo", () => {
    const { linhas, erro } = gerarGrade(
      [
        atributo("Cor", "Azul"),
        atributo("Tamanho", "P"),
        atributo("Estampa", "Lisa"),
        atributo("Material", "Algodão"),
      ],
      [],
    );
    expect(linhas).toEqual([]);
    expect(erro).toContain("no máximo 3 atributos");
    expect(MAX_ATRIBUTOS_DA_GRADE).toBe(3);
  });

  it("aceita exatamente 60 linhas num produto vazio", () => {
    // 60 valores em uma dimensão: 60 linhas — dentro do teto por produto.
    const sessenta = Array.from({ length: 60 }, (_, i) => `V${i + 1}`);
    const { linhas, erro } = gerarGrade([atributo("Tamanho", ...sessenta)], []);
    expect(erro).toBeNull();
    expect(linhas).toHaveLength(60);
    expect(MAX_LINHAS_DA_GRADE).toBe(60);
  });

  it("recusa a linha 61", () => {
    const sessentaEUma = Array.from({ length: 61 }, (_, i) => `V${i + 1}`);
    const { linhas, erro } = gerarGrade(
      [atributo("Tamanho", ...sessentaEUma)],
      [],
    );
    expect(linhas).toEqual([]);
    expect(erro).toContain("passaria de 60 variantes");
  });

  it("o teto é POR PRODUTO: 55 existentes só deixam nascer 5 novas", () => {
    const existentes = Array.from({ length: 55 }, (_, i) => ({
      name: "Tamanho",
      value: `V${i + 1}`,
    }));
    // 10 valores pedidos: 55 + 5 cabem, a 6ª nova estoura o teto de 60.
    const { linhas, erro } = gerarGrade(
      [atributo("Tamanho", "V1", "V2", "N1", "N2", "N3", "N4", "N5", "N6")],
      existentes,
    );
    expect(linhas).toEqual([]);
    expect(erro).toContain("já tem 55");
  });
});

describe("gerarGrade — valores vazios, duplicados e com /", () => {
  it("funde duplicado (caixa e espaço à parte) e ignora vazio", () => {
    const { linhas, erro } = gerarGrade(
      [atributo("Tamanho", "PP", " pp ", "PP ", "", "P")],
      [],
    );
    expect(erro).toBeNull();
    expect(linhas).toEqual([
      { name: "Tamanho", value: "PP" },
      { name: "Tamanho", value: "P" },
    ]);
  });

  it("recusa atributo que ficou sem valor nenhum", () => {
    const { linhas, erro } = gerarGrade([atributo("Cor", "  ", "")], []);
    expect(linhas).toEqual([]);
    expect(erro).toContain('valor para "Cor"');
  });

  it("recusa valor com / — ele é o separador da casa", () => {
    const { linhas, erro } = gerarGrade(
      [atributo("Cor", "Preto/Branco")],
      [],
    );
    expect(linhas).toEqual([]);
    expect(erro).toContain('"/"');
  });

  it("recusa atributo sem nome e atributo repetido", () => {
    const semNome = gerarGrade([atributo("  ", "Azul")], []);
    expect(semNome.erro).toContain("nome do atributo");

    const repetido = gerarGrade(
      [atributo("Cor", "Azul"), atributo(" cor ", "Verde")],
      [],
    );
    // A mensagem mostra o nome da ocorrência repetida, já aparado.
    expect(repetido.erro).toContain('"cor" está repetido');
  });

  it("recusa grade sem atributo nenhum", () => {
    const { erro } = gerarGrade([], []);
    expect(erro).toContain("Escolha os atributos");
  });
});

describe("gerarGrade — deduplicação contra o que o produto já tem", () => {
  const gradeBranca = [
    atributo("Cor", "Branca"),
    atributo("Tamanho", "PP", "P", "M"),
  ];

  it("repetir a MESMA grade não cria duplicata nenhuma", () => {
    const primeira = gerarGrade(gradeBranca, []);
    expect(primeira.linhas).toHaveLength(3);

    // A segunda rodada recebe o resultado da primeira como existentes.
    const segunda = gerarGrade(gradeBranca, primeira.linhas);
    expect(segunda.erro).toBeNull();
    expect(segunda.linhas).toEqual([]);
  });

  it("a comparação é por pares normalizados: caixa do nome e do valor não enganam", () => {
    // Mesma grade gravada em caixa diferente: já existe — nada a criar.
    const existentes = [{ name: "COR / TAMANHO", value: "BRANCA / PP" }];
    const { linhas, erro } = gerarGrade(
      [atributo("Cor", "Branca"), atributo("Tamanho", "PP")],
      existentes,
    );
    expect(erro).toBeNull();
    expect(linhas).toEqual([]);
  });

  it("separador sem espaço NÃO desmonta: é identidade distinta, igual ao editor", () => {
    // "Branca/PP" (sem espaço no separador) é linha que o `dividirEmAtributos`
    // não desmonta — abre como par bruto. A grade trata do mesmo jeito: não
    // declara igualdade que o editor não sustentaria na reabertura.
    const existentes = [{ name: "Cor / Tamanho", value: "Branca/PP" }];
    const { linhas, erro } = gerarGrade(
      [atributo("Cor", "Branca"), atributo("Tamanho", "PP")],
      existentes,
    );
    expect(erro).toBeNull();
    expect(linhas).toEqual([{ name: "Cor / Tamanho", value: "Branca / PP" }]);
  });

  it("completar a grade acrescenta SÓ as combinações faltantes", () => {
    const existentes = [
      { name: "Cor / Tamanho", value: "Branca / PP" },
      { name: "Cor / Tamanho", value: "Branca / P" },
    ];
    const { linhas, erro } = gerarGrade(gradeBranca, existentes);
    expect(erro).toBeNull();
    expect(valoresGerados({ linhas, erro })).toEqual(["Branca / M"]);
  });

  it("linha DESATIVADA continua existindo: não recria nem reativa", () => {
    // A desativada entra nas existentes pela identidade (name/value) — a
    // grade não a recria em dobro nem a reativa por trás do lojista.
    const { linhas, erro } = gerarGrade([atributo("Cor", "Branca", "Preta")], [
      { name: "Cor", value: "Branca" }, // active = false no produto
    ]);
    expect(erro).toBeNull();
    expect(valoresGerados({ linhas, erro })).toEqual(["Preta"]);
  });

  it("linha legada de um atributo conta como existente da grade de um atributo", () => {
    const existentes = [{ name: "Cor", value: "Azul" }];
    const { linhas, erro } = gerarGrade(
      [atributo("Cor", "Azul", "Amarela")],
      existentes,
    );
    expect(erro).toBeNull();
    expect(valoresGerados({ linhas, erro })).toEqual(["Amarela"]);
  });
});

describe("skusDaGrade — base + sufixo por valor, único no lote", () => {
  it("junta base e os 3 primeiros caracteres de cada valor", () => {
    const skus = skusDaGrade(
      "blu tsh",
      [
        { name: "Cor / Tamanho", value: "Amarela / P" },
        { name: "Cor / Tamanho", value: "Verde / GG" },
      ],
    );
    expect(skus).toEqual(["BLU-TSH-AMA-P", "BLU-TSH-VER-GG"]);
  });

  it("base vazia = linha sem SKU (vira NULL no upsert, igual ao unitário)", () => {
    const skus = skusDaGrade("", [{ name: "Cor", value: "Azul" }]);
    expect(skus).toEqual([""]);
  });

  it("SKU repetido DENTRO do lote ganha sufixo numérico em vez de derrubar o upsert", () => {
    // "A B" e "A-B" sanitizam igual — o segundo precisa nascer diferente.
    const skus = skusDaGrade("BLU", [
      { name: "Cor", value: "A B" },
      { name: "Cor", value: "A-B" },
      { name: "Cor", value: "A B " },
    ]);
    expect(skus).toEqual(["BLU-A-B", "BLU-A-B-2", "BLU-A-B-3"]);
  });
});

describe("primeiroSkuEmColisao — o SKU que já existe fora do lote", () => {
  it("aponta o primeiro SKU ocupado, sem caixa enganar", () => {
    const colisao = primeiroSkuEmColisao(
      ["BLU-AMA-P", "BLU-VER-GG"],
      ["outra-blama", "blu-ver-gg"],
    );
    expect(colisao).toBe("BLU-VER-GG");
  });

  it("lote sem colisão devolve null", () => {
    expect(
      primeiroSkuEmColisao(["BLU-A", "BLU-B"], ["BLU-C"]),
    ).toBeNull();
  });
});
