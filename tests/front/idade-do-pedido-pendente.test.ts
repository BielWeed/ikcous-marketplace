import { describe, expect, it } from "vitest";
import {
  fraseDeEsperaDoPedido,
  idadeDoPedidoPendente,
} from "../../src/lib/idade-do-pedido-pendente";

const AGORA = Date.parse("2026-09-01T12:00:00.000Z");
const diasAtras = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

describe("idadeDoPedidoPendente — o fantasma da 'na entrega' mostra a idade (laudo #2, L-8)", () => {
  it("pedido pendente há 6 dias: 6", () => {
    expect(idadeDoPedidoPendente(diasAtras(6), "pending", AGORA)).toBe(6);
  });

  it("pedido de hoje: 0 dias (mesmo pendente, sem aviso de esperança vazia)", () => {
    expect(idadeDoPedidoPendente(diasAtras(0), "pending", AGORA)).toBe(0);
  });

  it.each([
    ["2 dias e 12 horas", 2.5 * 86_400_000, 2, null],
    ["1 ms antes de 3 dias", 3 * 86_400_000 - 1, 2, null],
    [
      "exatamente 3 dias",
      3 * 86_400_000,
      3,
      "Este pedido espera você há 3 dias.",
    ],
  ])(
    "%s: conta dias completos e respeita o início do aviso",
    (_, idadeMs, dias, frase) => {
      const criadoEm = new Date(AGORA - idadeMs).toISOString();
      const idade = idadeDoPedidoPendente(criadoEm, "pending", AGORA);

      expect(idade).toBe(dias);
      expect(fraseDeEsperaDoPedido(idade)).toBe(frase);
    },
  );

  it("status avançado NUNCA tem idade de espera (o lojista já agiu)", () => {
    for (const status of ["processing", "shipped", "delivered", "cancelled"]) {
      expect(idadeDoPedidoPendente(diasAtras(30), status, AGORA)).toBeNull();
    }
  });

  it("sem data ou data inválida: null, não NaN", () => {
    expect(idadeDoPedidoPendente(null, "pending", AGORA)).toBeNull();
    expect(idadeDoPedidoPendente("não-é-data", "pending", AGORA)).toBeNull();
  });
});

describe("fraseDeEsperaDoPedido — o aviso só existe quando vale mostrar", () => {
  it("abaixo de 3 dias: sem aviso (não é o incômodo que o laudo descreve)", () => {
    expect(fraseDeEsperaDoPedido(null)).toBeNull();
    expect(fraseDeEsperaDoPedido(0)).toBeNull();
    expect(fraseDeEsperaDoPedido(2)).toBeNull();
  });

  it("a partir de 3 dias: a frase diz há quanto tempo — em dias cheios", () => {
    expect(fraseDeEsperaDoPedido(3)).toBe("Este pedido espera você há 3 dias.");
    expect(fraseDeEsperaDoPedido(15)).toBe(
      "Este pedido espera você há 15 dias.",
    );
  });
});
