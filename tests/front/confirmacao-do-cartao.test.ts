// Tradução da consulta SEM COBRANÇA (`verificar`) na tela do cartão — ver
// `src/components/checkout/confirmacao-do-cartao.ts`. Toda dúvida cai num
// desfecho que não promete nada; recusa só com o token de cerca.
import { describe, expect, it } from "vitest";

import {
  desfechoDaConsultaDoCartao,
  desfechoDoErroDaConsulta,
} from "@/components/checkout/confirmacao-do-cartao";

const AGORA = Date.parse("2026-10-03T23:00:00.000Z");
const FUTURO = "2026-10-03T23:30:00.000Z";
const PASSADO = "2026-10-03T22:30:00.000Z";
const CERCA = "ORD-A";
const comCerca = { cerca: CERCA, agoraMs: AGORA };
const semCerca = { cerca: null, agoraMs: AGORA };

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
    ).toEqual({
      tipo: "aprovado",
    });
    expect(
      desfechoDaConsultaDoCartao({ verificacao: "pago" }, semCerca),
    ).toEqual({
      tipo: "aprovado",
    });
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

  it("vaga solta: encerrada dentro do prazo, prazo-acabou fora dele — e NUNCA sem cerca", () => {
    for (const verificacao of ["recusado", "livre"]) {
      expect(
        desfechoDaConsultaDoCartao({ verificacao, expiraEm: FUTURO }, comCerca)
          .tipo,
      ).toBe("encerrada");
      expect(
        desfechoDaConsultaDoCartao({ verificacao, expiraEm: PASSADO }, comCerca)
          .tipo,
      ).toBe("prazo-acabou");
      expect(
        desfechoDaConsultaDoCartao({ verificacao, expiraEm: FUTURO }, semCerca)
          .tipo,
      ).toBe("indefinida");
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
  it("só `terminal: true` literal é terminal, com a frase da edge", () => {
    expect(
      desfechoDoErroDaConsulta(
        Object.assign(new Error("O prazo para pagar este pedido acabou."), {
          terminal: true,
        }),
      ),
    ).toEqual({
      tipo: "terminal",
      mensagem: "O prazo para pagar este pedido acabou.",
    });
    expect(
      desfechoDoErroDaConsulta(
        Object.assign(new Error(""), { terminal: true }),
      ),
    ).toEqual({
      tipo: "terminal",
      mensagem: "Este pedido não pode ser pago agora.",
    });
  });

  it("rede, 503, tempo limite e `terminal` que não é booleano true: sem resposta", () => {
    expect(desfechoDoErroDaConsulta(new Error("Failed to fetch")).tipo).toBe(
      "sem-resposta",
    );
    expect(
      desfechoDoErroDaConsulta(
        Object.assign(new Error("x"), { terminal: "true" }),
      ).tipo,
    ).toBe("sem-resposta");
    expect(desfechoDoErroDaConsulta(null).tipo).toBe("sem-resposta");
  });
});
