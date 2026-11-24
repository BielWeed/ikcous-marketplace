// Protege a CONTA do dígito verificador do CNPJ nas fronteiras do resto da
// divisão por 11 — onde a regra da Receita muda de forma: resto 0 ou 1 vira
// dígito 0, resto 2 em diante vira 11 menos o resto (resto 2 = dígito 9, o
// primeiro valor que NÃO é zero). Os CNPJs de "aceita" do arquivo vizinho
// (`identidade-legal-da-loja.test.ts`) não caem nessas fronteiras: um `< 2`
// virando `<= 2` (ou `< 1`) passava despercebido, e a vitrine passaria a
// recusar — ou a aceitar — o CNPJ de uma loja de verdade.
//
// Os números abaixo são sintéticos (gerados por uma conta independente da do
// app), não são de nenhuma empresa. Cada linha diz o resto que ela exercita
// no 1º e no 2º dígito.
import { describe, expect, it } from "vitest";

import {
  documentoValido,
  identidadeLegalDaLoja,
} from "@/lib/identidade-legal-da-loja";

describe("CNPJ — dígito verificador nas fronteiras do resto da divisão por 11", () => {
  it.each([
    // [documento, o que ele exercita]
    ["62.819.482/1993-00", "resto 0 no 1º dígito e resto 1 no 2º"],
    ["83.417.047/1874-01", "resto 1 no 1º dígito"],
    ["36.671.276/8426-97", "resto 2 no 1º dígito"],
    ["52.601.815/9083-69", "resto 2 no 2º dígito"],
    ["76.018.955/5979-40", "resto 0 no 2º dígito"],
  ])("aceita %s (%s)", (documento) => {
    expect(documentoValido(documento)).toBe("cnpj");
  });

  it("resto 2 gera dígito 9 (e NÃO zero): trocar o 9 por 0 reprova", () => {
    expect(documentoValido("36.671.276/8426-97")).toBe("cnpj");
    expect(documentoValido("36.671.276/8426-07")).toBeNull();
    expect(documentoValido("52.601.815/9083-69")).toBe("cnpj");
    expect(documentoValido("52.601.815/9083-60")).toBeNull();
  });

  it("resto 0 e resto 1 geram dígito 0 (e NÃO 10 nem 11): só o zero vale", () => {
    expect(documentoValido("62.819.482/1993-00")).toBe("cnpj");
    expect(documentoValido("83.417.047/1874-01")).toBe("cnpj");
    expect(documentoValido("83.417.047/1874-11")).toBeNull();
    expect(documentoValido("62.819.482/1993-10")).toBeNull();
  });

  it("a vitrine mostra o CNPJ de resto 2 com a máscara certa", () => {
    expect(
      identidadeLegalDaLoja({ storeLegalDocument: "36671276842697" }),
    ).toEqual({
      razaoSocial: null,
      tipoDoDocumento: "cnpj",
      documento: "36.671.276/8426-97",
      email: null,
    });
  });
});
