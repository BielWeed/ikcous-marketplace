// O aviso da ficha do pedido ("O código de rastreio salvo (“…”) não é válido")
// mostra o código gravado, mas corta os longos para não estourar o cartão: até
// 30 caracteres aparece inteiro; de 31 em diante, 29 + reticências. O teste
// do cartão só exercita 1 e 40 caracteres, então a fronteira (30/31) e a
// contagem por caractere inteiro (emoji = 1, não 2) ficavam soltas. Este
// arquivo prende as duas.
import { avisoDeRastreio } from "@/components/admin/orders/aviso-de-rastreio";
import { describe, expect, it } from "vitest";

const mensagem = (trecho: string) =>
  `O código de rastreio salvo (“${trecho}”) não é válido: a cliente não consegue rastrear. Corrija o código antes de avançar.`;

describe("avisoDeRastreio — corte do código inválido longo", () => {
  it("exatamente 30 caracteres aparece inteiro, sem reticências", () => {
    expect(avisoDeRastreio("-".repeat(30))).toBe(mensagem("-".repeat(30)));
  });

  it("31 caracteres vira 29 + reticências", () => {
    expect(avisoDeRastreio("-".repeat(31))).toBe(
      mensagem(`${"-".repeat(29)}…`),
    );
  });

  it("29 caracteres aparece inteiro", () => {
    expect(avisoDeRastreio("-".repeat(29))).toBe(mensagem("-".repeat(29)));
  });

  it("emoji conta como UM caractere: 30 emojis inteiros, 31 cortam em 29", () => {
    expect(avisoDeRastreio("😀".repeat(30))).toBe(mensagem("😀".repeat(30)));
    expect(avisoDeRastreio("😀".repeat(31))).toBe(
      mensagem(`${"😀".repeat(29)}…`),
    );
  });

  it("espaços nas pontas não gastam o limite de 30", () => {
    expect(avisoDeRastreio(`   ${"-".repeat(30)}   `)).toBe(
      mensagem("-".repeat(30)),
    );
  });

  it("nulo, ausente e só espaços caem no aviso de 'sem código salvo'", () => {
    const semCodigo = avisoDeRastreio("");
    expect(semCodigo).toContain("Sem código salvo");
    expect(avisoDeRastreio(null)).toBe(semCodigo);
    expect(avisoDeRastreio(undefined)).toBe(semCodigo);
    expect(avisoDeRastreio("  \n ")).toBe(semCodigo);
  });

  it("código que gera link não avisa nada", () => {
    expect(avisoDeRastreio("aa 123 456 789 br")).toBe("");
  });
});
