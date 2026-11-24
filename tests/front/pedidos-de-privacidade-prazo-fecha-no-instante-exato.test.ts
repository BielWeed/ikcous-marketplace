import { PRAZO_DE_RESPOSTA_EM_DIAS } from "@/config/textos-de-privacidade";
import { prazoFinalDoPedido, prazoVencido } from "@/lib/pedidos-de-privacidade";
import { describe, expect, it } from "vitest";

// Caça por mutação no prazo de resposta do pedido de privacidade (o prazo que a
// loja prometeu à pessoa). Os testes vizinhos provam que o prazo existe e que
// data ilegível devolve nulo, mas deixavam passar duas trocas:
//   - o "dia" do prazo ter 23 h em vez de 24 h: o prazo final chegava uma hora
//     por dia antes (15 dias = 15 h cedo) e o pedido aparecia como "atrasado"
//     antes da hora;
//   - `>` virar `>=`: no instante exato em que o prazo acaba o pedido já era
//     marcado como vencido, ainda dentro do que foi prometido.
// Instantes literais em UTC; nada depende do fuso nem do relógio da máquina.

const CRIADO_EM = "2026-11-01T12:00:00.000Z";
const UM_DIA_EM_MS = 86_400_000;
const FIM = Date.parse(CRIADO_EM) + PRAZO_DE_RESPOSTA_EM_DIAS * UM_DIA_EM_MS;

describe("prazoFinalDoPedido — criação mais N dias de 24 horas", () => {
  it("cai exatamente N dias corridos depois da criação", () => {
    expect(prazoFinalDoPedido(CRIADO_EM)?.getTime()).toBe(FIM);
  });
});

describe("prazoVencido — só vence DEPOIS do instante final", () => {
  it("1 ms antes do fim, no fim exato e 1 ms depois", () => {
    expect(prazoVencido(CRIADO_EM, new Date(FIM - 1))).toBe(false);
    expect(prazoVencido(CRIADO_EM, new Date(FIM))).toBe(false);
    expect(prazoVencido(CRIADO_EM, new Date(FIM + 1))).toBe(true);
  });

  it("uma hora antes do fim ainda está no prazo (dia de 24 h)", () => {
    expect(prazoVencido(CRIADO_EM, new Date(FIM - 3_600_000))).toBe(false);
  });
});
