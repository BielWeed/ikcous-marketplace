// O botão "Rastrear" do pedido apontava para linkrastreio.com, domínio morto
// (certificado vencido, estacionado "à venda"): o cliente caía numa tela de
// erro do navegador. UM lugar monta o endereço de rastreio agora, e as quatro
// telas passam por ele.
import {
  linkDeRastreio,
  normalizarCodigoDeRastreio,
} from "@/lib/link-de-rastreio";
import { describe, expect, it } from "vitest";

const BASE = "https://www.melhorrastreio.com.br/rastreio/";

describe("linkDeRastreio", () => {
  it("monta o endereço do Melhor Rastreio com o código", () => {
    expect(linkDeRastreio("AA123456789BR")).toBe(`${BASE}AA123456789BR`);
  });

  it("tira espaços do MEIO do código (digitado em blocos)", () => {
    expect(linkDeRastreio("AA 123 456 789 BR")).toBe(`${BASE}AA123456789BR`);
  });

  it("tira espaços das pontas, tabs e quebras de linha", () => {
    expect(linkDeRastreio("  AA123\t456\n789BR \r\n")).toBe(
      `${BASE}AA123456789BR`,
    );
  });

  it("código em minúsculas sai em maiúsculas", () => {
    expect(linkDeRastreio("aa123456789br")).toBe(`${BASE}AA123456789BR`);
  });

  it("caracteres especiais não escapam do caminho do endereço", () => {
    const link = linkDeRastreio("AB/12?x=1#y");
    expect(link.startsWith(BASE)).toBe(true);
    const depois = link.slice(BASE.length);
    expect(depois).not.toMatch(/[/?#=]/);
    expect(depois).toBe(encodeURIComponent("AB/12?X=1#Y"));
  });

  it("código vazio ou só espaços não vira link", () => {
    expect(linkDeRastreio("")).toBe("");
    expect(linkDeRastreio("   \n\t ")).toBe("");
  });

  it("valor ausente (banco devolveu null) não quebra", () => {
    expect(linkDeRastreio(null as unknown as string)).toBe("");
    expect(linkDeRastreio(undefined as unknown as string)).toBe("");
  });
});

// Lote 227: o código SALVO usa a mesma limpeza do link — a cliente copia o
// código da tela e o cola em outros sites de rastreio, que recusam espaços.
describe("normalizarCodigoDeRastreio", () => {
  it("tira espaços (inclusive do meio), tabs e quebras e põe em maiúsculas", () => {
    expect(normalizarCodigoDeRastreio("  br 123\t456\n789 br ")).toBe(
      "BR123456789BR",
    );
  });

  it("código já limpo não muda", () => {
    expect(normalizarCodigoDeRastreio("AA123456789BR")).toBe("AA123456789BR");
  });

  it("vazio, só espaços ou ausente viram texto vazio", () => {
    expect(normalizarCodigoDeRastreio("")).toBe("");
    expect(normalizarCodigoDeRastreio("  \n ")).toBe("");
    expect(normalizarCodigoDeRastreio(null as unknown as string)).toBe("");
    expect(normalizarCodigoDeRastreio(undefined as unknown as string)).toBe("");
  });

  it("o link e o código salvo concordam (mesma regra)", () => {
    const digitado = "ab 12 34 br";
    expect(linkDeRastreio(digitado)).toBe(
      `${BASE}${normalizarCodigoDeRastreio(digitado)}`,
    );
  });
});
