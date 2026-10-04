// Tradução da consulta SEM COBRANÇA (`verificar`) na tela do cartão — ver
// `src/components/checkout/confirmacao-do-cartao.ts`. Toda dúvida cai num
// desfecho que não promete nada; recusa só com o token de cerca; terminal só
// quando fala do PEDIDO (409/404).
import { describe, expect, it } from "vitest";

import {
  desfechoDaConsultaDoCartao,
  desfechoDoErroDaConsulta,
} from "@/components/checkout/confirmacao-do-cartao";

const FUTURO = "2999-01-01T00:00:00.000Z";
const PASSADO = "2000-01-01T00:00:00.000Z";
const CERCA = "ORD-A";
const comCerca = { cerca: CERCA };
const semCerca = { cerca: null };

function erroDaEdge(
  mensagem: string,
  campos: Record<string, unknown>,
): Error & Record<string, unknown> {
  return Object.assign(new Error(mensagem), campos);
}

describe("desfechoDaConsultaDoCartao", () => {
  it("corpo ilegível ou status desconhecido: sem resposta (a cadência segue)", () => {
    expect(desfechoDaConsultaDoCartao(null, comCerca).tipo).toBe(
      "sem-resposta",
    );
    expect(desfechoDaConsultaDoCartao("pago", comCerca).tipo).toBe(
      "sem-resposta",
    );
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "PAGO" }, comCerca).tipo,
    ).toBe("sem-resposta");
    expect(desfechoDaConsultaDoCartao({}, comCerca).tipo).toBe("sem-resposta");
  });

  it("pago: aprovado, com ou sem cerca", () => {
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "pago" }, comCerca),
    ).toEqual({ tipo: "aprovado" });
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "pago" }, semCerca),
    ).toEqual({ tipo: "aprovado" });
  });

  it("em análise e desafio: só com order; order de OUTRA tentativa vira indefinida", () => {
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "em_analise", paymentId: CERCA },
        comCerca,
      ),
    ).toEqual({ tipo: "em-analise", paymentId: CERCA });
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "em_analise", paymentId: "" },
        comCerca,
      ).tipo,
    ).toBe("sem-resposta");
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "em_analise", paymentId: "ORD-B" },
        comCerca,
      ).tipo,
    ).toBe("indefinida");
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "desafio3ds", paymentId: CERCA },
        comCerca,
      ).tipo,
    ).toBe("aguardando-banco");
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "desafio3ds", paymentId: "ORD-B" },
        comCerca,
      ).tipo,
    ).toBe("indefinida");
    // Sem cerca não há como comparar: a order existe, segue esperando.
    expect(
      desfechoDaConsultaDoCartao(
        { verificacao: "desafio3ds", paymentId: "ORD-B" },
        semCerca,
      ).tipo,
    ).toBe("aguardando-banco");
  });

  it("vaga solta: encerrada com cerca (o prazo NÃO é decidido pelo relógio do aparelho) — e NUNCA sem cerca", () => {
    for (const verificacao of ["recusado", "livre"]) {
      for (const expiraEm of [FUTURO, PASSADO, undefined]) {
        expect(
          desfechoDaConsultaDoCartao({ verificacao, expiraEm }, comCerca).tipo,
        ).toBe("encerrada");
        expect(
          desfechoDaConsultaDoCartao({ verificacao, expiraEm }, semCerca).tipo,
        ).toBe("indefinida");
      }
    }
  });

  it("PIX ou sentinela na vaga: indefinida (esta tela não fala daquela cobrança)", () => {
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "pix" }, comCerca).tipo,
    ).toBe("indefinida");
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "sem_registro" }, comCerca)
        .tipo,
    ).toBe("indefinida");
  });
});

describe("desfechoDoErroDaConsulta", () => {
  it("terminal só com `terminal: true` E 409/404 — a frase da edge vai para a tela", () => {
    expect(
      desfechoDoErroDaConsulta(
        erroDaEdge("Este pedido não está aguardando pagamento.", {
          terminal: true,
          httpStatus: 409,
        }),
      ),
    ).toEqual({
      tipo: "terminal",
      mensagem: "Este pedido não está aguardando pagamento.",
    });
    expect(
      desfechoDoErroDaConsulta(
        erroDaEdge("Pedido não encontrado.", {
          terminal: true,
          httpStatus: 404,
        }),
      ),
    ).toEqual({ tipo: "terminal", mensagem: "Pedido não encontrado." });
    expect(
      desfechoDoErroDaConsulta(
        erroDaEdge("", { terminal: true, httpStatus: 409 }),
      ),
    ).toEqual({
      tipo: "terminal",
      mensagem: "Este pedido não pode ser pago agora.",
    });
  });

  it("achado M1: o 503 'Pagamento indisponível.' marcado terminal NÃO encerra a tela", () => {
    expect(
      desfechoDoErroDaConsulta(
        erroDaEdge("Pagamento indisponível.", {
          terminal: true,
          httpStatus: 503,
        }),
      ).tipo,
    ).toBe("sem-resposta");
    // Status ausente: falha fechada para o lado que não afirma nada.
    expect(
      desfechoDoErroDaConsulta(
        erroDaEdge("Este pedido foi cancelado.", { terminal: true }),
      ).tipo,
    ).toBe("sem-resposta");
  });

  it("rede, tempo limite e `terminal` que não é booleano true: sem resposta", () => {
    expect(desfechoDoErroDaConsulta(new Error("Failed to fetch")).tipo).toBe(
      "sem-resposta",
    );
    expect(
      desfechoDoErroDaConsulta(
        erroDaEdge("x", { terminal: "true", httpStatus: 409 }),
      ).tipo,
    ).toBe("sem-resposta");
    expect(desfechoDoErroDaConsulta(null).tipo).toBe("sem-resposta");
  });
});
