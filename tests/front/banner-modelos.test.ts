import {
  CORES_DO_MODELO,
  INFO_DOS_MODELOS,
  MODELOS_DE_BANNER,
  dividirTitulo,
  modeloDoBanner,
  templateTypeDoModelo,
  tintaSobre,
} from "@/lib/banner-modelos";
import { describe, expect, it } from "vitest";

describe("catálogo de banners prontos", () => {
  it.each([
    "destaque",
    "claro",
    "vitrine",
    "promocao",
    "lancamento",
    "foto",
  ] as const)("%s volta do valor salvo sem perder o modelo", (modelo) => {
    expect(templateTypeDoModelo(modelo)).toBe(`pronto_${modelo}`);
    expect(modeloDoBanner(`pronto_${modelo}`)).toBe(modelo);
  });
  it.each([
    null,
    undefined,
    "glassmorphic",
    "qualquer",
    "pronto_kit",
    "pronto_",
  ])("%s continua no desenho antigo", (tipo) =>
    expect(modeloDoBanner(tipo)).toBeNull(),
  );
  it("cada modelo tem informação e cada cor é hex utilizável", () => {
    expect(MODELOS_DE_BANNER).toHaveLength(6);
    expect(INFO_DOS_MODELOS.map((info) => info.id)).toEqual([
      ...MODELOS_DE_BANNER,
    ]);
    for (const info of INFO_DOS_MODELOS) {
      expect(info.nome.trim()).not.toBe("");
      expect(info.descricao.trim()).not.toBe("");
      expect(["promocao", "lancamento", "simples"]).toContain(info.grupo);
    }
    expect(CORES_DO_MODELO.length).toBeGreaterThanOrEqual(4);
    for (const cor of CORES_DO_MODELO) {
      expect(cor.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(cor.rotulo.trim()).not.toBe("");
    }
  });
});

describe("tinta pela luminância", () => {
  it.each([
    ["#0E0E11", "claro"],
    ["#2A2A31", "claro"],
    ["#EDEDF0", "escuro"],
    ["#8E8E98", "escuro"],
    ["#fff", "escuro"],
    ["#FFF", "escuro"],
    ["#ABCDEF", "escuro"],
    ["#000", "claro"],
    ["inválido", "claro"],
    ["#gggggg", "claro"],
    ["", "claro"],
  ])("%s pede texto %s", (hex, tinta) => expect(tintaSobre(hex)).toBe(tinta));
});

describe("título em duas linhas por palavras", () => {
  it.each([
    ["Verão", ["Verão", ""]],
    ["Coleção nova", ["Coleção", "nova"]],
    ["Coleção de verão", ["Coleção de", "verão"]],
    [
      "Uma nova coleção para este verão",
      ["Uma nova coleção", "para este verão"],
    ],
    ["", ["", ""]],
    ["   Coleção   de   verão  ", ["Coleção de", "verão"]],
  ])("%s", (titulo, linhas) =>
    expect(dividirTitulo(titulo as string)).toEqual(linhas),
  );
});
