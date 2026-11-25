// CONFIRMAÇÃO DO CARTÃO — resposta ausente ou de outro tipo, e erro sem
// mensagem. Achado por mutação em
// `src/components/checkout/confirmacao-do-cartao.ts`: tirar o
// `typeof resposta !== "object"` da primeira guarda não derrubava teste
// nenhum, porque o teste antigo só passa `null`, um texto e `{}` — e uma
// resposta `undefined` (a chamada à edge voltou sem corpo) LANÇARIA um erro
// dentro da cadência de consulta em vez de contar como "sem resposta".
import { describe, expect, it } from "vitest";

import {
  desfechoDaConsultaDoCartao,
  desfechoDoErroDaConsulta,
} from "@/components/checkout/confirmacao-do-cartao";

const comCerca = { cerca: "ORD-A" };
const semCerca = { cerca: null };

describe("desfechoDaConsultaDoCartao — resposta que não é um objeto", () => {
  it("undefined, número, booleano, texto e função contam como sem resposta e NUNCA lançam", () => {
    const respostas: unknown[] = [
      undefined,
      0,
      42,
      true,
      false,
      "",
      "pago",
      "em_analise",
      () => ({ verificacao: "pago" }),
    ];
    for (const resposta of respostas) {
      expect(() =>
        desfechoDaConsultaDoCartao(resposta, comCerca),
      ).not.toThrow();
      expect(desfechoDaConsultaDoCartao(resposta, comCerca)).toEqual({
        tipo: "sem-resposta",
      });
      expect(desfechoDaConsultaDoCartao(resposta, semCerca)).toEqual({
        tipo: "sem-resposta",
      });
    }
  });

  it("lista vazia e lista com objeto dentro também não dizem nada", () => {
    expect(desfechoDaConsultaDoCartao([], comCerca)).toEqual({
      tipo: "sem-resposta",
    });
    expect(
      desfechoDaConsultaDoCartao([{ verificacao: "pago" }], comCerca),
    ).toEqual({ tipo: "sem-resposta" });
  });

  it("controle: o objeto certo ainda é lido", () => {
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "pago" }, comCerca),
    ).toEqual({ tipo: "aprovado" });
  });
});

describe("desfechoDoErroDaConsulta — erro que não é Error", () => {
  it("undefined, texto e número não encerram a tela e não lançam", () => {
    for (const erro of [undefined, null, "terminal", 409, true]) {
      expect(() => desfechoDoErroDaConsulta(erro)).not.toThrow();
      expect(desfechoDoErroDaConsulta(erro)).toEqual({ tipo: "sem-resposta" });
    }
  });

  it("objeto terminal SEM mensagem (ou com mensagem que não é texto) usa a frase padrão", () => {
    for (const message of [undefined, null, 42, {}, true]) {
      expect(
        desfechoDoErroDaConsulta({ terminal: true, httpStatus: 409, message }),
      ).toEqual({
        tipo: "terminal",
        mensagem: "Este pedido não pode ser pago agora.",
      });
    }
    expect(
      desfechoDoErroDaConsulta({ terminal: true, httpStatus: 404 }),
    ).toEqual({
      tipo: "terminal",
      mensagem: "Este pedido não pode ser pago agora.",
    });
  });
});
