// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) em `situacaoDaResposta` (e nos ajudantes
// `textoNaoVazio`, `dataEHora`, `pixOferecido`) de VerificacaoDoPagamento.tsx.
// O corpo da consulta chega como DESCONHECIDO: cada campo é lido com cuidado e
// a falha cai no "indisponível" (nunca num estado que promete algo à cliente).
// Os testes da tela cobrem os caminhos felizes; aqui ficam as bordas que
// defeitos de UMA linha atravessavam:
//   - corpo que nem objeto é (null, texto, número);
//   - `paymentId` só de espaços ou que não é texto (não é "order confirmada");
//   - a data do cancelamento automático: dia/mês de um dígito, ano de quatro,
//     data ilegível, e a frase "às";
//   - o PIX do desafio exige prazo que seja TEXTO e que seja data;
//   - o desafio com `desafio3ds` nulo ou de outro tipo cai em "sem página".
import { describe, expect, it, vi } from "vitest";

import { situacaoDaResposta } from "@/components/checkout/VerificacaoDoPagamento";

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const URL_DO_DESAFIO = "https://www.mercadopago.com.br/3ds/desafio?x=1";
const PRAZO = "2999-01-01T00:00:00.000Z";

describe("situacaoDaResposta — corpo que não é uma resposta", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["texto", "pago"],
    ["número", 42],
    ["booleano", true],
  ])("%s cai em indisponível (nunca quebra)", (_rotulo, corpo) => {
    expect(situacaoDaResposta(corpo)).toEqual({ tipo: "indisponivel" });
  });

  it.each([
    ["objeto vazio", {}],
    ["lista", ["pago"]],
    ["status desconhecido", { verificacao: "aprovado" }],
    ["status com outra caixa", { verificacao: "PAGO" }],
    ["status que não é texto", { verificacao: 1 }],
  ])("%s cai em indisponível", (_rotulo, corpo) => {
    expect(situacaoDaResposta(corpo)).toEqual({ tipo: "indisponivel" });
  });
});

describe("situacaoDaResposta — pago e em análise", () => {
  it("pago decide pelo STATUS: com ou sem paymentId, e ignora o resto do corpo", () => {
    expect(situacaoDaResposta({ verificacao: "pago" })).toEqual({
      tipo: "pago",
    });
    expect(
      situacaoDaResposta({
        verificacao: "pago",
        paymentId: "ORD-1",
        expiraEm: PRAZO,
      }),
    ).toEqual({ tipo: "pago" });
  });

  it("em análise só com order confirmada (paymentId em texto com algo escrito)", () => {
    expect(
      situacaoDaResposta({ verificacao: "em_analise", paymentId: "ORD-2" }),
    ).toEqual({ tipo: "em_analise" });
  });

  it.each([
    ["sem paymentId", undefined],
    ["paymentId nulo", null],
    ["paymentId vazio", ""],
    ["paymentId só de espaços", "   "],
    ["paymentId que é número", 123456789],
  ])("em análise com %s NUNCA promete 'em análise': indisponível", (_r, id) => {
    expect(
      situacaoDaResposta({ verificacao: "em_analise", paymentId: id }),
    ).toEqual({ tipo: "indisponivel" });
  });
});

describe("situacaoDaResposta — sem registro e a data do cancelamento", () => {
  it("sem data: a tela mostra a frase sem inventar um horário", () => {
    expect(situacaoDaResposta({ verificacao: "sem_registro" })).toEqual({
      tipo: "sem_registro",
      cancelamento: null,
    });
  });

  it.each([
    ["texto que não é data", "ontem à tarde"],
    ["texto vazio", ""],
    ["só espaços", "   "],
    ["número", 1893456000000],
    ["nulo", null],
  ])("data ilegível (%s) vira null — nunca 'Invalid Date'", (_r, valor) => {
    expect(
      situacaoDaResposta({
        verificacao: "sem_registro",
        canceladoAutomaticamenteAte: valor,
      }),
    ).toEqual({ tipo: "sem_registro", cancelamento: null });
  });

  it("a data sai como 'dd/mm/aaaa às hh:mm' — dia e mês com dois dígitos, ano com quatro", () => {
    // Meio-dia UTC: o mesmo dia civil em qualquer fuso de -11 a +11.
    const situacao = situacaoDaResposta({
      verificacao: "sem_registro",
      canceladoAutomaticamenteAte: "2026-03-05T12:00:00.000Z",
    });

    expect(situacao).toMatchObject({ tipo: "sem_registro" });
    expect((situacao as { cancelamento: string }).cancelamento).toMatch(
      /^05\/03\/2026 às \d{2}:\d{2}$/,
    );
  });
});

describe("situacaoDaResposta — desafio 3DS e a saída pelo PIX", () => {
  const base = {
    verificacao: "desafio3ds",
    paymentId: "ORD-3DS-1",
    desafio3ds: { url: URL_DO_DESAFIO },
  };

  it("com order, URL do Mercado Pago e prazo legível: abre o quadro e oferece o PIX", () => {
    expect(situacaoDaResposta({ ...base, expiraEm: PRAZO })).toEqual({
      tipo: "desafio",
      url: URL_DO_DESAFIO,
      pix: true,
    });
  });

  it.each([
    ["paymentId ausente", { paymentId: undefined }],
    ["paymentId vazio", { paymentId: "" }],
    ["paymentId só de espaços", { paymentId: "   " }],
    ["paymentId que é número", { paymentId: 99 }],
  ])(
    "desafio com %s: indisponível (sem order confirmada não se promete nada)",
    (_r, troca) => {
      expect(
        situacaoDaResposta({ ...base, ...troca, expiraEm: PRAZO }),
      ).toEqual({ tipo: "indisponivel" });
    },
  );

  it.each([
    ["desafio3ds nulo", { desafio3ds: null }],
    ["desafio3ds ausente", { desafio3ds: undefined }],
    ["desafio3ds que é texto", { desafio3ds: URL_DO_DESAFIO }],
    ["url ausente", { desafio3ds: {} }],
    ["url vazia", { desafio3ds: { url: "" } }],
    [
      "url de outro site",
      { desafio3ds: { url: "https://exemplo.invalid/3ds" } },
    ],
    ["url que não é URL", { desafio3ds: { url: "isto-nao-e-url" } }],
  ])(
    "desafio com %s: não monta quadro, mas mantém o PIX (a order existe)",
    (_r, troca) => {
      expect(
        situacaoDaResposta({ ...base, ...troca, expiraEm: PRAZO }),
      ).toEqual({ tipo: "desafio-sem-pagina", pix: true });
    },
  );

  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["só espaços", "   "],
    ["não é data", "amanhã"],
    ["é número (não é texto)", 32503680000000],
    // `Date.parse("2026")` é uma data válida: só o "tem de ser TEXTO" barra.
    ["é número que, virado em texto, parece um ano", 2026],
    ["nulo", null],
  ])(
    "prazo %s: o PIX NÃO é oferecido (falha fechada em dado)",
    (_r, expiraEm) => {
      expect(situacaoDaResposta({ ...base, expiraEm })).toEqual({
        tipo: "desafio",
        url: URL_DO_DESAFIO,
        pix: false,
      });
      expect(
        situacaoDaResposta({
          ...base,
          desafio3ds: null,
          expiraEm,
        }),
      ).toEqual({ tipo: "desafio-sem-pagina", pix: false });
    },
  );
});

describe("situacaoDaResposta — vaga liberada", () => {
  it.each(["livre", "recusado", "pix"] as const)(
    "%s libera a retomada e diz QUAL foi o desfecho",
    (verificacao) => {
      expect(situacaoDaResposta({ verificacao })).toEqual({
        tipo: "liberada",
        verificacao,
      });
      expect(
        situacaoDaResposta({
          verificacao,
          paymentId: "ORD-9",
          expiraEm: PRAZO,
        }),
      ).toEqual({ tipo: "liberada", verificacao });
    },
  );
});
