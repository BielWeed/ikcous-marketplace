// Lacunas que o teste do redesenho do cartão deixava em
// `src/components/checkout/mensagens-do-cartao.ts`: a orientação específica de
// "parcelamento" e "cartão desabilitado" (que o servidor ainda agrupa em
// "outra"), o prazo da reserva com fração longa em AMBOS os fusos, e as duas
// frases que prometem algo à cliente ("nenhum valor foi cobrado" e "não pague
// de novo").
import { describe, expect, it } from "vitest";

import {
  FRASES_DO_SERVIDOR_POR_CATEGORIA,
  TEXTOS_DO_CARTAO,
  categoriaDaRecusa,
  categoriaDoServidor,
  lerPrazoEmMs,
} from "@/components/checkout/mensagens-do-cartao";

describe("categoriaDaRecusa — cada frase curada do servidor tem a sua categoria", () => {
  it("as seis frases exatas caem nas categorias de sempre", () => {
    expect(
      FRASES_DO_SERVIDOR_POR_CATEGORIA.map(([frase]) =>
        categoriaDaRecusa(frase),
      ),
    ).toEqual([
      "dados",
      "dados",
      "sem-limite",
      "desabilitado",
      "parcelamento",
      "autorizacao",
    ]);
  });

  it("espaço em volta da frase não atrapalha; frase diferente ou não-texto cai em geral", () => {
    expect(
      categoriaDaRecusa("  Cartão desabilitado. Fale com o seu banco.\n"),
    ).toBe("desabilitado");
    expect(categoriaDaRecusa("Cartão desabilitado.")).toBe("geral");
    expect(categoriaDaRecusa(undefined)).toBe("geral");
    expect(categoriaDaRecusa(null)).toBe("geral");
    expect(categoriaDaRecusa(42)).toBe("geral");
    expect(categoriaDaRecusa("")).toBe("geral");
  });
});

describe("categoriaDoServidor — 'outra' separa pela frase curada exata", () => {
  it("'outra' com a frase de cartão desabilitado vira 'desabilitado'", () => {
    expect(
      categoriaDoServidor(
        "outra",
        "Cartão desabilitado. Fale com o seu banco.",
      ),
    ).toBe("desabilitado");
  });

  it("'outra' com a frase de parcelamento vira 'parcelamento'", () => {
    expect(
      categoriaDoServidor(
        "outra",
        "Esse parcelamento não está disponível para este cartão.",
      ),
    ).toBe("parcelamento");
  });

  it("'outra' sem frase conhecida (ou sem frase) fica em geral", () => {
    expect(categoriaDoServidor("outra", "Qualquer coisa do banco")).toBe(
      "geral",
    );
    expect(categoriaDoServidor("outra")).toBe("geral");
  });

  it("categoria do servidor fora do conjunto devolve null, e a frase NÃO é consultada", () => {
    expect(
      categoriaDoServidor(
        "inventada",
        "Cartão desabilitado. Fale com o seu banco.",
      ),
    ).toBeNull();
    expect(categoriaDoServidor(undefined)).toBeNull();
  });
});

describe("lerPrazoEmMs — fração de 4 a 6 dígitos do Postgres, nos dois fusos", () => {
  it("fração longa com Z: trunca em milissegundos sem mudar o instante", () => {
    expect(lerPrazoEmMs("2026-11-24T12:00:00.123456Z")).toBe(
      Date.parse("2026-11-24T12:00:00.123Z"),
    );
  });

  it("fração longa com deslocamento de fuso: trunca e mantém o fuso", () => {
    expect(lerPrazoEmMs("2026-11-24T09:00:00.123456-03:00")).toBe(
      Date.parse("2026-11-24T12:00:00.123Z"),
    );
    expect(lerPrazoEmMs("2026-11-24T17:30:00.987654+05:30")).toBe(
      Date.parse("2026-11-24T12:00:00.987Z"),
    );
  });

  it("fração curta é completada com zeros, com Z e com fuso", () => {
    expect(lerPrazoEmMs("2026-11-24T12:00:00.5Z")).toBe(
      Date.parse("2026-11-24T12:00:00.500Z"),
    );
    expect(lerPrazoEmMs("2026-11-24T09:00:00.5-03:00")).toBe(
      Date.parse("2026-11-24T12:00:00.500Z"),
    );
  });

  it("vazio, só espaço, não-texto e texto ilegível devolvem null (nunca inventa horário)", () => {
    for (const ruim of [
      "",
      "   ",
      "amanhã",
      undefined,
      null,
      1_700_000_000_000,
      {},
    ]) {
      expect(lerPrazoEmMs(ruim)).toBeNull();
    }
  });
});

describe("as duas promessas que a tela faz à cliente", () => {
  it("recusa geral: nenhum valor foi cobrado", () => {
    expect(TEXTOS_DO_CARTAO.recusaGeral).toContain("Nenhum valor foi cobrado");
  });

  it("em análise: pede para NÃO pagar de novo", () => {
    expect(TEXTOS_DO_CARTAO.emAnalise).toContain("Não pague de novo.");
  });
});
