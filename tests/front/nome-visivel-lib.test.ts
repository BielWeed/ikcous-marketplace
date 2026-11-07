import { nomeTemConteudoVisivel } from "@/lib/nome-visivel";
// Nome feito só de caracteres invisíveis: o `trim()` do JavaScript só tira
// espaços comuns, então um espaço de largura zero (U+200B), o espaço Braille em
// branco (U+2800) ou o preenchimento Hangul (U+3164) passavam como "nome" e
// deixavam o título do Perfil, as avaliações e as iniciais do avatar em branco.
// `nomeTemConteudoVisivel` é a régua única da tela de Ajustes da conta e do
// cadastro.
import { describe, expect, it } from "vitest";

describe("nomeTemConteudoVisivel", () => {
  it.each([
    ["vazio", ""],
    ["espaços comuns", "     "],
    ["tab e quebra de linha", "\t\n \r"],
    ["espaço de largura zero (U+200B)", "\u200B"],
    ["vários U+200B", "\u200B\u200B\u200B"],
    ["espaço Braille em branco (U+2800)", "\u2800"],
    ["preenchimento Hangul (U+3164)", "\u3164"],
    ["preenchimento Hangul de meia largura (U+FFA0)", "\uFFA0"],
    [
      "preenchimentos Hangul de vogal e consoante (U+115F, U+1160)",
      "\u115F\u1160",
    ],
    ["junção de largura zero (U+200D)", "\u200D"],
    ["marca de ordem de bytes (U+FEFF)", "\uFEFF"],
    ["espaço sem quebra (U+00A0)", "\u00A0"],
    ["espaço fino e ideográfico (U+2009, U+3000)", "\u2009\u3000"],
    ["separador de linha (U+2028)", "\u2028"],
    ["vogal inerente do khmer (U+17B4)", "\u17B4"],
    ["mistura de invisíveis e espaços", " \u200B\u2800\u3164 \u00A0 "],
  ])("recusa %s", (_descricao, texto) => {
    expect(nomeTemConteudoVisivel(texto)).toBe(false);
  });

  it.each([
    ["nome simples", "Maria"],
    ["nome com espaços e acento", " José da Conceição "],
    ["uma letra só", "M"],
    ["um número", "7"],
    ["emoji", "🦊"],
    ["nome com invisível no meio", "Ma\u200Bria"],
    ["nome com invisíveis nas pontas", "\u200B\u3164Maria\u2800"],
    ["nome em outro alfabeto", "山田"],
  ])("aceita %s", (_descricao, texto) => {
    expect(nomeTemConteudoVisivel(texto)).toBe(true);
  });
});
