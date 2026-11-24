// A regra de cor da loja tem dois juízes no mesmo arquivo: `validaCorDaLoja`
// (o que a lojista pode GRAVAR) e `corPrimariaEfetiva` (o que a vitrine LÊ).
// Os testes de tela dublam a regra ou só passam cores comportadas; aqui a regra
// é chamada direto, com os valores que a lojista realmente digita ou cola:
// espaço em volta, maiúscula, "#abc", "#RRGGBBAA", sem "#". Cor aceita errada
// vai para o banco, e preto no banco é recusado pela leitura.
import { corPrimariaEfetiva, validaCorDaLoja } from "@/config/cor-da-loja";
import type { StoreConfig } from "@/types";
import { describe, expect, it } from "vitest";

describe("validaCorDaLoja — o que a lojista pode gravar", () => {
  it("aceita #RRGGBB e devolve a forma canônica em minúsculas", () => {
    expect(validaCorDaLoja("#1a2b3c")).toEqual({ ok: true, cor: "#1a2b3c" });
    expect(validaCorDaLoja("#ABCDEF")).toEqual({ ok: true, cor: "#abcdef" });
    expect(validaCorDaLoja("#FfAa00")).toEqual({ ok: true, cor: "#ffaa00" });
  });

  it("tira o espaço de quem colou a cor com sobra antes e depois", () => {
    expect(validaCorDaLoja("  #1a2b3c  ")).toEqual({
      ok: true,
      cor: "#1a2b3c",
    });
    expect(validaCorDaLoja("\t#ABCDEF\n")).toEqual({
      ok: true,
      cor: "#abcdef",
    });
  });

  it("aceita branco e cores claras (a regra de contraste cuida delas depois)", () => {
    expect(validaCorDaLoja("#ffffff")).toEqual({ ok: true, cor: "#ffffff" });
    expect(validaCorDaLoja("#000001")).toEqual({ ok: true, cor: "#000001" });
  });

  it("recusa o formato curto #abc: o valor gravado tem de ser sempre #RRGGBB", () => {
    for (const curto of ["#abc", "#fff", "#12", "#1234", "#12345"]) {
      expect(validaCorDaLoja(curto)).toEqual({ ok: false, motivo: "formato" });
    }
  });

  it("recusa o formato longo #RRGGBBAA e o excesso de dígitos", () => {
    for (const longo of ["#1a2b3c4d", "#1a2b3c0", "#1a2b3cff"]) {
      expect(validaCorDaLoja(longo)).toEqual({ ok: false, motivo: "formato" });
    }
  });

  it("recusa o que não é hexadecimal, sem '#' ou vazio", () => {
    for (const ruim of [
      "",
      "   ",
      "1a2b3c",
      "#gggggg",
      "#1a2b3z",
      "#1a 2b3c",
      "rgb(1,2,3)",
      "red",
      "##1a2b3c",
      "#1a2b3c;",
    ]) {
      expect(validaCorDaLoja(ruim)).toEqual({ ok: false, motivo: "formato" });
    }
  });

  it("recusa preto com o motivo 'preto', em qualquer caixa e com espaço em volta", () => {
    for (const preto of ["#000000", " #000000 ", "#000000\n"]) {
      expect(validaCorDaLoja(preto)).toEqual({ ok: false, motivo: "preto" });
    }
  });

  it("preto com formato errado cai em 'formato', não em 'preto'", () => {
    expect(validaCorDaLoja("#000")).toEqual({ ok: false, motivo: "formato" });
    expect(validaCorDaLoja("#00000000")).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("quase-preto é cor legítima (a recusa é só do #000000 exato)", () => {
    expect(validaCorDaLoja("#000100")).toEqual({ ok: true, cor: "#000100" });
    expect(validaCorDaLoja("#010000")).toEqual({ ok: true, cor: "#010000" });
  });
});

describe("corPrimariaEfetiva — o que a vitrine lê do banco", () => {
  const comCor = (primaryColor: string | undefined): StoreConfig =>
    ({ primaryColor }) as StoreConfig;

  it("sem config, sem cor ou cor vazia: não há cor da loja (fica a semente do build)", () => {
    expect(corPrimariaEfetiva(null)).toBeNull();
    expect(corPrimariaEfetiva(comCor(undefined))).toBeNull();
    expect(corPrimariaEfetiva(comCor(""))).toBeNull();
  });

  it("preto exato vindo do banco é resíduo de fábrica: não vale como cor da loja", () => {
    expect(corPrimariaEfetiva(comCor("#000000"))).toBeNull();
  });

  it("cor de verdade passa como está, inclusive quase-preto e branco", () => {
    expect(corPrimariaEfetiva(comCor("#1a2b3c"))).toBe("#1a2b3c");
    expect(corPrimariaEfetiva(comCor("#000001"))).toBe("#000001");
    expect(corPrimariaEfetiva(comCor("#ffffff"))).toBe("#ffffff");
  });
});
