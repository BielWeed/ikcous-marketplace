// Os Termos e a Privacidade mostram "Versão N, atualizada em DD/MM/AAAA" no
// topo. Esse rótulo só vale se for VERDADE: texto-base que muda sem a versão e a
// data mudarem juntas faz a cliente ler uma data velha em cima de um texto novo.
//
// A TRAVA: a "impressão" (um hash estável) do texto-base completo de Termos e
// Privacidade, montado com dados FIXOS de teste (nada da loja entra: razão
// social, CNPJ e endereço variam por loja e ficam de fora), fica guardada em
// `VERSAO_DOS_TEXTOS.impressaoDoTexto`. Mudou uma vírgula do texto-base? Este
// teste reprova e diz o que fazer.
import { describe, expect, it } from "vitest";

import {
  VERSAO_DOS_TEXTOS,
  montarPolitica,
  rotuloDaVersao,
  textoCorrido,
} from "@/lib/textos-das-politicas";

/** FNV-1a de 32 bits, em JS puro: determinístico, sem dependência. */
function impressaoDoTexto(texto: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const LOJA_DE_TESTE = { nome: "Loja de Teste" };

function textoBaseDosDoisTextos(): string {
  return (["termos", "privacidade"] as const)
    .map((tipo) => textoCorrido(montarPolitica(tipo, LOJA_DE_TESTE, null)))
    .join("\n=====\n");
}

describe("a versão dos textos acompanha o texto-base", () => {
  it("a impressão guardada é a do texto-base de hoje (mudou o texto? aumente a versão)", () => {
    const atual = impressaoDoTexto(textoBaseDosDoisTextos());
    expect(
      VERSAO_DOS_TEXTOS?.impressaoDoTexto,
      `O texto dos Termos/Privacidade mudou: aumente a versão, atualize a data e a impressão em VERSAO_DOS_TEXTOS. A impressão atual do texto é "${atual}".`,
    ).toBe(atual);
  });

  it("a impressão enxerga uma palavra trocada (a trava não é cega)", () => {
    const base = textoBaseDosDoisTextos();
    expect(base).toContain("Mercado Pago");
    expect(
      impressaoDoTexto(base.replace("Mercado Pago", "Mercado Livre")),
    ).not.toBe(impressaoDoTexto(base));
  });

  it("a impressão é tirada SEM os dados da loja: responsável e endereço mudam o texto de cada loja, não o texto-base", () => {
    const dosDois = (loja: Parameters<typeof montarPolitica>[1]) =>
      (["termos", "privacidade"] as const)
        .map((tipo) => textoCorrido(montarPolitica(tipo, loja, null)))
        .join("\n=====\n");
    const semDados = textoBaseDosDoisTextos();
    expect(semDados).not.toContain("Responsável:");
    expect(semDados).not.toContain("Rua das Flores");
    // Prova de que os dados da loja MEXERIAM na impressão se entrassem nela:
    const comDados = dosDois({
      ...LOJA_DE_TESTE,
      responsavel: "Responsável: Loja Ltda — CNPJ 11.222.333/0001-81",
      endereco: "Rua das Flores, 10 - Centro, Alfenas/MG, CEP 37130-000",
    });
    expect(comDados).toContain("Rua das Flores");
    expect(impressaoDoTexto(comDados)).not.toBe(impressaoDoTexto(semDados));
  });

  it("versão é um inteiro a partir de 1 e a data é um dia de verdade em AAAA-MM-DD", () => {
    expect(Number.isInteger(VERSAO_DOS_TEXTOS?.versao)).toBe(true);
    expect(VERSAO_DOS_TEXTOS?.versao).toBeGreaterThanOrEqual(1);
    const data = VERSAO_DOS_TEXTOS?.atualizadoEm ?? "";
    expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 2026-02-31 passaria no formato; o dia tem de existir no calendário.
    expect(new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10)).toBe(data);
  });
});

describe("rotuloDaVersao", () => {
  it("sem argumento, diz a versão publicada: 'Versão N, atualizada em DD/MM/AAAA'", () => {
    expect(rotuloDaVersao()).toMatch(
      /^Versão \d+, atualizada em \d{2}\/\d{2}\/\d{4}$/,
    );
    expect(rotuloDaVersao()).toBe(rotuloDaVersao(VERSAO_DOS_TEXTOS));
  });

  it("formata a data a partir do texto AAAA-MM-DD, sem depender do fuso do aparelho", () => {
    expect(
      rotuloDaVersao({
        versao: 2,
        atualizadoEm: "2027-01-01",
        impressaoDoTexto: "x",
      }),
    ).toBe("Versão 2, atualizada em 01/01/2027");
    expect(
      rotuloDaVersao({
        versao: 10,
        atualizadoEm: "2026-12-31",
        impressaoDoTexto: "x",
      }),
    ).toBe("Versão 10, atualizada em 31/12/2026");
  });
});
