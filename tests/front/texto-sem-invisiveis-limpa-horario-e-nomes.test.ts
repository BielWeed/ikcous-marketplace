// `semInvisiveis` limpa o que a lojista cola nos campos de texto da loja (o
// horário de atendimento, por exemplo) ANTES de gravar: caractere de largura
// zero, espaço não separável e espaço duplicado entram quando se copia do
// WhatsApp ou de um site. Os testes de tela só provam o caso "só invisível vira
// vazio"; aqui a função é chamada direto, com cada tipo de sujeira e com os
// emojis compostos que NÃO podem ser quebrados.
import { semInvisiveis } from "@/lib/texto-sem-invisiveis";
import { describe, expect, it } from "vitest";

const ZWSP = "\u{200b}";
const ZWNJ = "\u{200c}";
const WORD_JOINER = "\u{2060}";
const BOM = "\u{feff}";
const ZWJ = "\u{200d}";
const NBSP = "\u{00a0}";

describe("semInvisiveis — o que sai", () => {
  it("texto limpo passa igual (acento, pontuação e emoji simples)", () => {
    expect(semInvisiveis("Ter a Sáb, 9h às 18h")).toBe("Ter a Sáb, 9h às 18h");
    expect(semInvisiveis("Aberto 🌸 todos os dias")).toBe(
      "Aberto 🌸 todos os dias",
    );
  });

  it("tira cada caractere de largura zero, um a um", () => {
    for (const invisivel of [ZWSP, ZWNJ, WORD_JOINER, BOM]) {
      expect(semInvisiveis(`Seg${invisivel}a${invisivel}Sex`)).toBe("SegaSex");
    }
  });

  it("espaço não separável (NBSP) vira espaço comum", () => {
    expect(semInvisiveis(`9h${NBSP}às${NBSP}18h`)).toBe("9h às 18h");
  });

  it("NBSP colado nas pontas também é aparado (vira espaço e sai)", () => {
    expect(semInvisiveis(`${NBSP}Seg a Sex${NBSP}`)).toBe("Seg a Sex");
  });

  it("espaços e tabs repetidos viram um espaço só", () => {
    expect(semInvisiveis("Seg   a\t\tSex")).toBe("Seg a Sex");
    expect(semInvisiveis(`Seg ${NBSP} ${NBSP}a Sex`)).toBe("Seg a Sex");
  });

  it("espaço duplicado nas duas pontas some por inteiro", () => {
    expect(semInvisiveis("   Seg a Sex   ")).toBe("Seg a Sex");
    expect(semInvisiveis("\t Seg a Sex \t")).toBe("Seg a Sex");
  });

  it("quebra de linha é preservada (horário em duas linhas continua em duas)", () => {
    expect(semInvisiveis("Seg a Sex: 9h às 18h\nSáb: 9h às 13h")).toBe(
      "Seg a Sex: 9h às 18h\nSáb: 9h às 13h",
    );
    expect(semInvisiveis("Seg\r\nSex")).toBe("Seg\r\nSex");
  });

  it("só invisíveis e espaços vira texto vazio", () => {
    expect(semInvisiveis(`${ZWSP}${BOM}${NBSP} ${ZWNJ}`)).toBe("");
    expect(semInvisiveis("")).toBe("");
    expect(semInvisiveis("   ")).toBe("");
  });

  it("é idempotente: limpar de novo não muda nada", () => {
    const sujo = `  ${ZWSP}Seg${NBSP}${NBSP}a${BOM} Sex  `;
    const uma = semInvisiveis(sujo);
    expect(semInvisiveis(uma)).toBe(uma);
  });
});

describe("semInvisiveis — o joiner (U+200D) só fica onde cola dois emojis", () => {
  it("joiner solto entre letras sai", () => {
    expect(semInvisiveis(`Se${ZWJ}g${ZWJ}`)).toBe("Seg");
  });

  it("joiner no começo ou no fim do texto sai", () => {
    expect(semInvisiveis(`${ZWJ}Seg`)).toBe("Seg");
    expect(semInvisiveis(`Seg${ZWJ}`)).toBe("Seg");
    expect(semInvisiveis(`🌸${ZWJ}`)).toBe("🌸");
  });

  it("joiner entre emoji e letra, ou entre letra e emoji, sai", () => {
    expect(semInvisiveis(`👨${ZWJ}A`)).toBe("👨A");
    expect(semInvisiveis(`A${ZWJ}👨`)).toBe("A👨");
  });

  it("emoji composto por joiner continua inteiro (família)", () => {
    const familia = `👨${ZWJ}👩${ZWJ}👧`;
    expect(semInvisiveis(familia)).toBe(familia);
    expect(semInvisiveis(`Loja ${familia}`)).toBe(`Loja ${familia}`);
  });

  it("emoji com variante (coração em chamas) e com tom de pele continuam inteiros", () => {
    const coracaoEmChamas = `\u{2764}\u{fe0f}${ZWJ}🔥`;
    const mulherNoComputador = `👩\u{1f3fd}${ZWJ}💻`;
    expect(semInvisiveis(coracaoEmChamas)).toBe(coracaoEmChamas);
    expect(semInvisiveis(mulherNoComputador)).toBe(mulherNoComputador);
  });

  it("joiner sobrando DENTRO de um texto com emoji composto sai só o solto", () => {
    const familia = `👨${ZWJ}👩`;
    expect(semInvisiveis(`${ZWJ}${familia}${ZWJ}`)).toBe(familia);
  });
});
