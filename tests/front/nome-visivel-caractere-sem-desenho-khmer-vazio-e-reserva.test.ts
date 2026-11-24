// O que este teste protege, em `@/lib/nome-visivel`:
//  - `caractereSemDesenho` reconhece as DUAS vogais inerentes do khmer
//    (U+17B4 e U+17B5) por conta própria. `nomeTemConteudoVisivel` também as
//    barra pela regra das marcas combinantes, então o teste vizinho não
//    notaria a lista perdê-las; mas `codigo-do-cupom` usa só
//    `caractereSemDesenho`, e sem elas um código de cupom ficaria com um
//    caractere que não aparece;
//  - texto vazio não é "sem desenho" (não há caractere nenhum);
//  - `nomeOuReserva` entrega a reserva (nunca o nome invisível) quando o nome
//    não tem nada visível, e o nome aparado e com espaços juntados quando tem.
// Os caracteres invisíveis são montados por código (não escritos no arquivo)
// para o aviso de caractere invisível do lint não disparar.
import { describe, expect, it } from "vitest";

import {
  caractereSemDesenho,
  nomeOuReserva,
  nomeTemConteudoVisivel,
} from "@/lib/nome-visivel";

const KHMER_17B4 = String.fromCodePoint(0x17b4);
const KHMER_17B5 = String.fromCodePoint(0x17b5);
const BRAILLE_EM_BRANCO = String.fromCodePoint(0x2800);
const HANGUL_PREENCHIMENTO = String.fromCodePoint(0x3164);
const LARGURA_ZERO = String.fromCodePoint(0x200b);

describe("caractereSemDesenho", () => {
  it.each([
    ["vogal inerente do khmer U+17B4", KHMER_17B4],
    ["vogal inerente do khmer U+17B5", KHMER_17B5],
    ["Braille em branco U+2800", BRAILLE_EM_BRANCO],
    ["Hangul preenchimento U+3164", HANGUL_PREENCHIMENTO],
    ["espaço de largura zero U+200B", LARGURA_ZERO],
    ["espaço comum", " "],
  ])("%s não desenha nada", (_nome, caractere) => {
    expect(caractereSemDesenho(caractere)).toBe(true);
  });

  it.each(["a", "Z", "7", "é", "😀"])("%s desenha", (caractere) => {
    expect(caractereSemDesenho(caractere)).toBe(false);
  });

  it("texto vazio não conta como caractere sem desenho", () => {
    expect(caractereSemDesenho("")).toBe(false);
  });
});

describe("nomeTemConteudoVisivel — entrada ausente", () => {
  it.each([null, undefined, ""])("%j não tem conteúdo visível", (nome) => {
    expect(nomeTemConteudoVisivel(nome)).toBe(false);
  });
});

describe("nomeOuReserva", () => {
  it.each([
    ["só espaços", "   "],
    ["só caractere invisível", LARGURA_ZERO + HANGUL_PREENCHIMENTO],
    ["vazio", ""],
    ["nulo", null],
    ["ausente", undefined],
  ])("nome %s entrega a reserva", (_nome, nome) => {
    expect(nomeOuReserva(nome, "Cliente")).toBe("Cliente");
  });

  it("nome com conteúdo vem aparado e com os espaços do meio juntados", () => {
    expect(nomeOuReserva("  Maria   da  Silva ", "Cliente")).toBe(
      "Maria da Silva",
    );
  });

  it("quebra de linha e tabulação no meio também viram um espaço só", () => {
    expect(nomeOuReserva("Maria\n\tSilva", "Cliente")).toBe("Maria Silva");
  });
});
