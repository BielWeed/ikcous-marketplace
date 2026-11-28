// Trocar o VALOR de uma opção já gravada ("M" -> "GG") cria uma opção NOVA no
// salvar; corrigir só a grafia ("m" -> "M", "médio" -> "Medio") segue editando a
// mesma linha (decisão de produto, 27/11/2026). Função pura — ambiente node.
import { describe, expect, it } from "vitest";

import type { ProductVariant } from "@/types";
import {
  fraseDaTrocaGuardada,
  normalizarValorDaOpcao,
  trocasDeValorComoOpcaoNova,
} from "@/utils/troca-de-valor-da-variacao";

const variacao = (
  id: string,
  value: string,
  extras: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "p-1",
  name: "Tamanho",
  value,
  stockIncrement: 3,
  active: true,
  ...extras,
});

describe("normalizarValorDaOpcao", () => {
  it("ignora maiúscula, acento e espaço nas pontas ou repetido", () => {
    expect(normalizarValorDaOpcao("m")).toBe(normalizarValorDaOpcao("M"));
    expect(normalizarValorDaOpcao("médio")).toBe(
      normalizarValorDaOpcao("Medio"),
    );
    expect(normalizarValorDaOpcao("  Azul   Bebê ")).toBe("azul bebe");
    expect(normalizarValorDaOpcao("Ç")).toBe("c");
  });

  it("palavra diferente continua diferente", () => {
    expect(normalizarValorDaOpcao("M")).not.toBe(normalizarValorDaOpcao("GG"));
    expect(normalizarValorDaOpcao("P")).not.toBe(
      normalizarValorDaOpcao("Pequeno"),
    );
    // Espaço NO MEIO não some: "Azul Bebe" não é "AzulBebe".
    expect(normalizarValorDaOpcao("Azul Bebe")).not.toBe(
      normalizarValorDaOpcao("AzulBebe"),
    );
  });

  it("BORDA: vazio e só espaço normalizam para vazio", () => {
    expect(normalizarValorDaOpcao("")).toBe("");
    expect(normalizarValorDaOpcao("   ")).toBe("");
  });
});

describe("trocasDeValorComoOpcaoNova", () => {
  const gravadas = [
    variacao("v1", "P", { sku: "CAM-P", stockIncrement: 4 }),
    variacao("v2", "M", {
      sku: "CAM-M",
      codigoBarras: "7890000000002",
      stockIncrement: 7,
      priceOverride: 62.5,
      imageUrl: "https://x/m.jpg",
    }),
  ];

  it("troca de verdade: a antiga vai para apagar E desligada sem códigos, ANTES da nova; a nova vai sem id com códigos, estoque e preço da linha", () => {
    const naTela = [
      gravadas[0],
      { ...gravadas[1], value: "GG", priceOverride: 70 },
    ];
    // O estoque não foi mexido: o envio chega SEM `stockIncrement`.
    const { stockIncrement: _semEstoque, ...semEstoque } = naTela[1];
    const r = trocasDeValorComoOpcaoNova([semEstoque], naTela, gravadas);

    expect(r.apagar).toEqual(["v2"]);
    expect(r.trocas).toEqual([
      { idAntigo: "v2", valorAntigo: "M", valorNovo: "GG" },
    ]);
    expect(r.variantes).toHaveLength(2);
    const [antiga, nova] = r.variantes;
    expect(antiga).toEqual({
      id: "v2",
      productId: "p-1",
      name: "Tamanho",
      value: "M",
      sku: undefined,
      codigoBarras: undefined,
      priceOverride: 62.5,
      active: false,
      imageUrl: "https://x/m.jpg",
    });
    // Sem `stockIncrement`: o estoque guardado da antiga fica como está.
    expect(antiga).not.toHaveProperty("stockIncrement");
    expect(nova.id).toMatch(/^temp-/);
    expect(nova).toMatchObject({
      name: "Tamanho",
      value: "GG",
      sku: "CAM-M",
      codigoBarras: "7890000000002",
      stockIncrement: 7,
      priceOverride: 70,
      active: true,
    });
  });

  it("só correção de grafia: a MESMA linha, o mesmo id, nada para apagar", () => {
    const naTela = [{ ...gravadas[0], value: "p" }, gravadas[1]];
    const r = trocasDeValorComoOpcaoNova([naTela[0]], naTela, gravadas);
    expect(r.apagar).toEqual([]);
    expect(r.trocas).toEqual([]);
    expect(r.variantes).toEqual([naTela[0]]);
  });

  it("ordem: TODAS as antigas vão na frente de qualquer outra linha (o código liberado antes de alguém o pegar)", () => {
    const nova = variacao("temp-1", "XG", { sku: "CAM-XG" });
    const naTela = [
      { ...gravadas[0], priceOverride: 10 },
      { ...gravadas[1], value: "G" },
      nova,
    ];
    const r = trocasDeValorComoOpcaoNova(naTela, naTela, gravadas);
    expect(r.variantes.map((v) => [v.id.startsWith("temp-"), v.value])).toEqual(
      [
        [false, "M"],
        [false, "P"],
        [true, "G"],
        [true, "XG"],
      ],
    );
  });

  it("variação nova (temp-) e variação que a tela não leu ao abrir nunca são troca", () => {
    const naTela = [variacao("temp-9", "GG"), variacao("v-fora", "Único")];
    const r = trocasDeValorComoOpcaoNova(naTela, naTela, gravadas);
    expect(r.apagar).toEqual([]);
    expect(r.variantes).toEqual(naTela);
  });

  it("BORDA: lista vazia devolve tudo vazio", () => {
    expect(trocasDeValorComoOpcaoNova([], [], gravadas)).toEqual({
      variantes: [],
      apagar: [],
      trocas: [],
    });
  });

  it("renomear só o TIPO não é troca; trocar tipo e valor juntos é, e a antiga leva o tipo novo", () => {
    const soTipo = [{ ...gravadas[0], name: "Tam" }];
    expect(trocasDeValorComoOpcaoNova(soTipo, soTipo, gravadas).apagar).toEqual(
      [],
    );
    const tipoEValor = [{ ...gravadas[0], name: "Tam", value: "Mini" }];
    const r = trocasDeValorComoOpcaoNova(tipoEValor, tipoEValor, gravadas);
    expect(r.apagar).toEqual(["v1"]);
    // Um grupo só por produto: a desligada segue o tipo das irmãs.
    expect(r.variantes[0]).toMatchObject({ id: "v1", name: "Tam", value: "P" });
  });
});

describe("fraseDaTrocaGuardada", () => {
  it("usa os valores reais", () => {
    expect(
      fraseDaTrocaGuardada({
        idAntigo: "v2",
        valorAntigo: "M",
        valorNovo: "GG",
      }),
    ).toBe(
      'O "M" já foi vendido, então guardamos ele desligado para os pedidos antigos e criamos o "GG" como opção nova. Confira o estoque das duas linhas.',
    );
  });
});
