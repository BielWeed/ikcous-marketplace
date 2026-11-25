// Lacunas de `traduzirFalha` e da espera depois de salvar em
// `src/components/admin/settings/email-da-loja-conteudo.ts`:
//  - só o 404 (e o 503 da consulta de estado) marca a função como INDISPONÍVEL
//    nesta loja; todo o resto é erro "da hora", não de loja sem a função;
//  - espera de 0 segundos (ou negativa) no 429 não é um número de espera válido;
//  - a tela segura o botão de teste por 60 s depois de salvar (o servidor deixa
//    1 tentativa por minuto).
import { describe, expect, it } from "vitest";

import {
  ESPERA_DEPOIS_DE_SALVAR_SEGUNDOS,
  MENSAGEM_INDISPONIVEL,
  traduzirFalha,
} from "@/components/admin/settings/email-da-loja-conteudo";

describe("traduzirFalha — quem é 'indisponível nesta loja'", () => {
  it("404: a função não existe nesta loja", () => {
    const t = traduzirFalha({ status: 404 }, "salvar");
    expect(t.indisponivel).toBe(true);
    expect(t.mensagem).toBe(MENSAGEM_INDISPONIVEL);
  });

  it("503 só indisponibiliza a CONSULTA de estado; salvar/testar/remover caem no recado do cofre", () => {
    expect(traduzirFalha({ status: 503 }, "status").indisponivel).toBe(true);
    for (const acao of ["salvar", "testar", "remover"] as const) {
      const t = traduzirFalha({ status: 503 }, acao);
      expect(t.indisponivel).toBe(false);
      expect(t.mensagem).not.toBe(MENSAGEM_INDISPONIVEL);
    }
  });

  it("os demais erros nunca marcam a função como indisponível", () => {
    const casos = [
      { semResposta: true },
      { semResposta: true, offline: true },
      { status: 401 },
      { status: 403 },
      { status: 400 },
      { status: 409 },
      { status: 500 },
      { status: 429, espereSegundos: 30 },
      { status: 500, motivo: "senha_recusada" },
      {},
    ];
    for (const falha of casos) {
      expect(traduzirFalha(falha, "salvar").indisponivel).toBe(false);
    }
  });
});

describe("traduzirFalha — 429 e o número de espera", () => {
  it("espera positiva e finita volta como número", () => {
    expect(
      traduzirFalha({ status: 429, espereSegundos: 42 }, "testar")
        .espereSegundos,
    ).toBe(42);
    expect(
      traduzirFalha({ status: 429, espereSegundos: 0.5 }, "testar")
        .espereSegundos,
    ).toBe(0.5);
  });

  it("zero, negativo, infinito, texto e ausente NÃO são espera válida", () => {
    for (const espereSegundos of [
      0,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "30",
      null,
    ]) {
      expect(
        traduzirFalha({ status: 429, espereSegundos }, "testar").espereSegundos,
      ).toBeUndefined();
    }
    expect(traduzirFalha({ status: 429 }, "testar").espereSegundos).toBe(
      undefined,
    );
  });
});

describe("espera depois de salvar", () => {
  it("o botão de teste fica preso 60 segundos (o limite do servidor é 1 por minuto)", () => {
    expect(ESPERA_DEPOIS_DE_SALVAR_SEGUNDOS).toBe(60);
  });
});
