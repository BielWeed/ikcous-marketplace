// CONFIRMAÇÃO DO CARTÃO — bordas da tradução da consulta sem cobrança que o
// teste `confirmacao-do-cartao.test.ts` deixava passar (achadas por mutação em
// `src/components/checkout/confirmacao-do-cartao.ts`):
//
//  1. texto só de espaços não é order nem frase: `paymentId: "   "` vale como
//     AUSENTE, e a mensagem do erro terminal em branco cai na frase padrão —
//     sem isso a tela mostraria um painel de erro VAZIO;
//  2. o `paymentId` chega aparado ("  ORD-A " é a order ORD-A) — se não
//     chegasse, a comparação com o token de cerca falharia por causa de um
//     espaço e a tela trataria a MESMA tentativa como "outra order";
//  3. `desafio3ds` sem order é "sem resposta" (não "aguardando o banco"): a
//     tela nunca promete espera sobre uma cobrança que não sabe se existe;
//  4. a cadência da consulta automática: a primeira rodada manual é IMEDIATA
//     (o toque em "Verificar de novo" consulta já) e a soma das esperas
//     automáticas cabe nos 3 minutos que o comentário do módulo promete.
import { describe, expect, it } from "vitest";

import {
  ESPERAS_DA_CONFIRMACAO_MS,
  ESPERAS_DA_RODADA_MANUAL_MS,
  desfechoDaConsultaDoCartao,
  desfechoDoErroDaConsulta,
} from "@/components/checkout/confirmacao-do-cartao";

const comCerca = { cerca: "ORD-A" };
const semCerca = { cerca: null };

describe("texto em branco não é order", () => {
  it("paymentId só com espaços (ou tab/quebra) vale como ausente em em_analise e em desafio3ds", () => {
    for (const paymentId of ["   ", "\t", " \n "]) {
      for (const verificacao of ["em_analise", "desafio3ds"]) {
        expect(
          desfechoDaConsultaDoCartao({ verificacao, paymentId }, comCerca).tipo,
        ).toBe("sem-resposta");
        expect(
          desfechoDaConsultaDoCartao({ verificacao, paymentId }, semCerca).tipo,
        ).toBe("sem-resposta");
      }
    }
  });

  it("paymentId com espaços em volta chega aparado — e ainda é a MESMA order da cerca", () => {
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "em_analise", paymentId: "  ORD-A " },
        comCerca,
      ),
    ).toEqual({ tipo: "em-analise", paymentId: "ORD-A" });
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "desafio3ds", paymentId: " ORD-A\n" },
        comCerca,
      ).tipo,
    ).toBe("aguardando-banco");
  });

  it("paymentId que não é texto (número, objeto, nulo) vale como ausente", () => {
    for (const paymentId of [42, {}, null, undefined, true]) {
      expect(
        desfechoDaConsultaDoCartao(
          { verificacao: "em_analise", paymentId },
          comCerca,
        ).tipo,
      ).toBe("sem-resposta");
    }
  });

  it("erro terminal com mensagem em branco usa a frase padrão — nunca um painel vazio", () => {
    for (const message of ["   ", "\n", "\t "]) {
      const erro = Object.assign(new Error(message), {
        terminal: true,
        httpStatus: 409,
      });
      expect(desfechoDoErroDaConsulta(erro)).toEqual({
        tipo: "terminal",
        mensagem: "Este pedido não pode ser pago agora.",
      });
    }
  });

  it("erro terminal com a frase da edge cercada de espaços entrega a frase aparada", () => {
    const erro = Object.assign(new Error("  Este pedido foi cancelado.  "), {
      terminal: true,
      httpStatus: 409,
    });
    expect(desfechoDoErroDaConsulta(erro)).toEqual({
      tipo: "terminal",
      mensagem: "Este pedido foi cancelado.",
    });
  });
});

describe("desafio 3DS sem order", () => {
  it("sem paymentId, com ou sem cerca: sem resposta (não promete espera por uma cobrança incerta)", () => {
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "desafio3ds" }, comCerca),
    ).toEqual({ tipo: "sem-resposta" });
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "desafio3ds" }, semCerca),
    ).toEqual({ tipo: "sem-resposta" });
  });
});

describe("cadência da consulta", () => {
  it("a primeira rodada manual é imediata e as seguintes esperam, em ordem crescente", () => {
    expect(ESPERAS_DA_RODADA_MANUAL_MS[0]).toBe(0);
    const resto = ESPERAS_DA_RODADA_MANUAL_MS.slice(1);
    expect(resto.length).toBeGreaterThan(0);
    for (let i = 0; i < resto.length; i++) {
      expect(resto.at(i)).toBeGreaterThan(i === 0 ? 0 : (resto.at(i - 1) ?? 0));
    }
  });

  it("a soma das esperas automáticas fica abaixo de 3 minutos (antes disso a tela não oferece outra saída)", () => {
    const soma = ESPERAS_DA_CONFIRMACAO_MS.reduce((a, b) => a + b, 0);
    expect(soma).toBeLessThan(180_000);
    // Toda espera automática é positiva: nenhuma rajada de consultas coladas.
    for (const espera of ESPERAS_DA_CONFIRMACAO_MS) {
      expect(espera).toBeGreaterThan(0);
    }
  });
});
