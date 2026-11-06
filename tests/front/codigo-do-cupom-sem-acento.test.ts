// O servidor compara o código do cupom sem ignorar acento: "VERÃO10" criado
// no painel nunca casava com "VERAO10" digitado pela cliente ("Cupom inválido
// ou expirado"). O painel agora grava o código já sem acento.
import {
  codigoDoCupomParaSalvar,
  ehRecusaDeCupomInexistente,
  normalizarCodigoDoCupom,
} from "@/lib/codigo-do-cupom";
import { describe, expect, it } from "vitest";

// A frase vem de validate_coupon_secure_v2 (migration 20261397000000): é a
// MESMA para "não existe", "inativo" e "exclusivo de outra conta".
describe("ehRecusaDeCupomInexistente", () => {
  it("reconhece a recusa de código que o servidor não conhece", () => {
    expect(ehRecusaDeCupomInexistente("Cupom inválido ou expirado.")).toBe(
      true,
    );
    expect(ehRecusaDeCupomInexistente(" cupom inválido ou expirado ")).toBe(
      true,
    );
  });

  it("não confunde com as recusas de um cupom que EXISTE", () => {
    for (const frase of [
      "Este cupom expirou.",
      "Cupom atingiu o limite de uso.",
      "Faltam R$ 10,00 em produtos para usar este cupom (mínimo de R$ 100,00).",
      "Os cupons estão desativados nesta loja.",
      "A conexão está lenta. Tente aplicar o cupom de novo.",
      "Erro ao validar cupom",
      "",
    ]) {
      expect(ehRecusaDeCupomInexistente(frase), frase).toBe(false);
    }
    expect(ehRecusaDeCupomInexistente(undefined)).toBe(false);
    expect(ehRecusaDeCupomInexistente(null)).toBe(false);
  });
});

describe("normalizarCodigoDoCupom", () => {
  it("tira acento e põe em maiúsculas", () => {
    expect(normalizarCodigoDoCupom("verão10")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("VERÃO10")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("Promoção Ç é")).toBe("PROMOCAOCE");
  });

  it("tira espaços de qualquer lugar, como antes", () => {
    expect(normalizarCodigoDoCupom("  ver ao 10 ")).toBe("VERAO10");
  });

  it("código sem acento fica igual", () => {
    expect(normalizarCodigoDoCupom("BEMVINDO10")).toBe("BEMVINDO10");
    expect(normalizarCodigoDoCupom("")).toBe("");
  });
});

describe("codigoDoCupomParaSalvar", () => {
  it("cupom existente com o código intacto: devolve o original com acento", () => {
    expect(codigoDoCupomParaSalvar("VERÃO10", "VERÃO10")).toBe("VERÃO10");
  });

  it("código alterado ou cupom novo: normaliza", () => {
    expect(codigoDoCupomParaSalvar("verão20", "VERÃO10")).toBe("VERAO20");
    expect(codigoDoCupomParaSalvar("verão10", "")).toBe("VERAO10");
    expect(codigoDoCupomParaSalvar("verão10", undefined)).toBe("VERAO10");
  });
});
