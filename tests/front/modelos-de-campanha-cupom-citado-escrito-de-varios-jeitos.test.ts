// Achado por mutação, 25/11/2026, em `temMarcadorPendente` e `codigosDeCupomCitados`
// (o aviso de campanha lê o código do cupom que o texto cita e confere contra a
// loja). Onze mudanças de uma linha passavam todas verdes, porque os testes só
// tinham frases "bem comportadas" ("Use o cupom BEMVINDO"):
//   · texto colado de Mac/WhatsApp com acento decomposto (NFD) não era junto de
//     volta (`normalize("NFC")` removido), nos dois leitores: o "[CÓDIGO ...]" não
//     era visto e "CAFÉ10" virava "CAFE";
//   · a palavra "cupom" só em minúscula (a lojista escreve CUPOM no título);
//   · espaço duplo, tabulação ou espaço sem quebra depois de "cupom", e a falta
//     de espaço ("cupomVERAO10") passando por citação;
//   · "cupom" dentro de outra palavra ("megacupom") contando;
//   · código começando por número ("10OFF"), com hífen ou sublinhado no meio
//     ("BLACK-FRIDAY") ou com sobra de hífen/sublinhado no fim;
//   · palavra de 3 letras maiúsculas seguida de minúscula ("PIXel") contando.
// Resposta errada aqui faz o aviso dizer "o cupom X não existe" por um código
// que a lojista nunca escreveu, ou deixa passar um que ela escreveu.
import {
  codigosDeCupomCitados,
  temMarcadorPendente,
} from "@/lib/modelos-de-campanha";
import { describe, expect, it } from "vitest";

// Os caracteres invisíveis ficam em constantes com nome: um formatador ou editor
// que "arruma" o texto não consegue juntar o acento sem que o teste perceba.
const ACENTO_SOLTO = String.fromCharCode(0x301);
const CEDILHA_SOLTA = String.fromCharCode(0x327);
const TIL_SOLTO = String.fromCharCode(0x303);
const ESPACO_SEM_QUEBRA = String.fromCharCode(0xa0);

describe("temMarcadorPendente — acento decomposto (texto colado de Mac)", () => {
  it("vê o marcador com o Ó escrito como O + acento solto", () => {
    expect(temMarcadorPendente(`[CO${ACENTO_SOLTO}DIGO DO SEU CUPOM]`)).toBe(
      true,
    );
    expect(temMarcadorPendente(`Use o [Co${ACENTO_SOLTO}digo`)).toBe(true);
  });

  it("controle: texto sem marcador, com a mesma decomposição, não acusa", () => {
    expect(
      temMarcadorPendente(
        `Promoc${CEDILHA_SOLTA}a${TIL_SOLTO}o de ver${"a"}${TIL_SOLTO}o`,
      ),
    ).toBe(false);
  });
});

describe("codigosDeCupomCitados — jeitos de escrever a citação", () => {
  it("junta o acento decomposto antes de ler o código", () => {
    expect(codigosDeCupomCitados(`Use o cupom CAFE${ACENTO_SOLTO}10`)).toEqual([
      "CAFÉ10",
    ]);
  });

  it("a palavra cupom vale em qualquer caixa", () => {
    expect(codigosDeCupomCitados("Use o CUPOM BEMVINDO10")).toEqual([
      "BEMVINDO10",
    ]);
    expect(codigosDeCupomCitados("Cupom NATAL25")).toEqual(["NATAL25"]);
    expect(codigosDeCupomCitados("cUpOm VERAO10")).toEqual(["VERAO10"]);
  });

  it("qualquer espaço depois de cupom serve: duplo, tabulação, sem quebra", () => {
    expect(codigosDeCupomCitados("cupom  VERAO10")).toEqual(["VERAO10"]);
    expect(codigosDeCupomCitados("cupom\tVERAO10")).toEqual(["VERAO10"]);
    expect(codigosDeCupomCitados(`cupom${ESPACO_SEM_QUEBRA}VERAO10`)).toEqual([
      "VERAO10",
    ]);
  });

  it("sem espaço depois de cupom não é citação", () => {
    expect(codigosDeCupomCitados("cupomVERAO10")).toEqual([]);
  });

  it("cupom dentro de outra palavra não é citação", () => {
    expect(codigosDeCupomCitados("megacupom BEMVINDO10")).toEqual([]);
  });

  it("palavra de 3 letras maiúsculas seguida de minúscula não é código", () => {
    expect(codigosDeCupomCitados("Use o cupom PIXel")).toEqual([]);
    expect(codigosDeCupomCitados("Cupom SIMples")).toEqual([]);
  });

  it("o código pode começar por número e ter hífen ou sublinhado no meio", () => {
    expect(codigosDeCupomCitados("Use o cupom 10OFF")).toEqual(["10OFF"]);
    expect(codigosDeCupomCitados("cupom BLACK-FRIDAY")).toEqual([
      "BLACK-FRIDAY",
    ]);
    expect(codigosDeCupomCitados("cupom BLACK_FRIDAY")).toEqual([
      "BLACK_FRIDAY",
    ]);
  });

  it("hífen ou sublinhado sobrando no fim (pontuação) não faz parte do código", () => {
    expect(codigosDeCupomCitados("cupom PROMO10-")).toEqual(["PROMO10"]);
    expect(codigosDeCupomCitados("cupom PROMO10_")).toEqual(["PROMO10"]);
    expect(codigosDeCupomCitados("cupom PROMO10--")).toEqual(["PROMO10"]);
    expect(codigosDeCupomCitados("cupom PROMO10-_")).toEqual(["PROMO10"]);
  });
});
