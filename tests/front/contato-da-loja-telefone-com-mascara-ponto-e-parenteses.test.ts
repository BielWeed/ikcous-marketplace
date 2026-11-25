// Caça por mutação (25/11/2026), números de WhatsApp da loja e do mototáxi.
// Os testes conferiam números já limpos. Telefone de verdade chega escrito de
// todo jeito: "(11) 91234-5678", "11.91234.5678", "+55 (11) 91234-5678". Tirar
// o ponto da lista de separadores aceitos, ou deixar de limpar TODOS os
// símbolos (só o primeiro), não derrubava nenhum teste.
import { describe, expect, it } from "vitest";

import {
  normalizarNumeroMototaxi,
  numeroComPais,
  soDigitos,
  validarWhatsappDaLoja,
} from "@/components/admin/minha-loja/contato";

describe("soDigitos: tira TODO símbolo, não só o primeiro", () => {
  it.each([
    ["(11) 91234-5678", "11912345678"],
    ["11.91234.5678", "11912345678"],
    ["+55 (11) 91234-5678", "5511912345678"],
    ["  11 9 1234 5678  ", "11912345678"],
    ["abc", ""],
    ["", ""],
  ])("%s => %s", (entrada, esperado) => {
    expect(soDigitos(entrada)).toBe(esperado);
  });

  it("nulo e ausente viram vazio", () => {
    expect(soDigitos(null)).toBe("");
    expect(soDigitos(undefined)).toBe("");
  });
});

describe("numeroComPais: número escrito com máscara ganha o 55 inteiro", () => {
  it("celular com máscara completa", () => {
    expect(numeroComPais("(11) 91234-5678")).toBe("5511912345678");
  });

  it("fixo com máscara completa", () => {
    expect(numeroComPais("(11) 3123-4567")).toBe("551131234567");
  });
});

describe("validarWhatsappDaLoja: número com máscara completa é aceito", () => {
  it.each(["(11) 91234-5678", "11.91234.5678", "11 91234 5678"])(
    "%s",
    (entrada) => {
      expect(validarWhatsappDaLoja(entrada)).toBeNull();
    },
  );
});

describe("normalizarNumeroMototaxi: separadores aceitos", () => {
  it.each([
    ["(11) 91234-5678", "5511912345678"],
    ["11.91234.5678", "5511912345678"],
    ["11 91234 5678", "5511912345678"],
    ["+55 (11) 91234-5678", "5511912345678"],
    ["+55.11.3123.4567", "551131234567"],
  ])("%s => %s", (entrada, esperado) => {
    expect(normalizarNumeroMototaxi(entrada)).toBe(esperado);
  });

  it.each([
    ["letra no meio", "11 91234-567a"],
    ["barra", "11/91234-5678"],
    ["vazio", ""],
  ])("recusa %s", (_nome, entrada) => {
    expect(normalizarNumeroMototaxi(entrada)).toBeNull();
  });
});
