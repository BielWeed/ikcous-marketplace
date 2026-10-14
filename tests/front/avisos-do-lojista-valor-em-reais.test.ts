import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/utils";
import { type EntradaDeAvisos, montarAvisos } from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

// O formatador do app separa "R$" do valor com espaco sem quebra (U+00A0);
// o teste compara com espaco comum para o texto esperado ficar legivel.
const ESPACO_SEM_QUEBRA = String.fromCodePoint(160);
const legivel = (texto: string) => texto.replaceAll(ESPACO_SEM_QUEBRA, " ");

function detalheDoPedido(total: number | null): string {
  const avisos = montarAvisos({
    ...VAZIO,
    pedidos: [
      {
        id: "p1",
        customer_name: "Maria",
        total,
        created_at: "2026-10-14T10:00:00.000Z",
      },
    ] as EntradaDeAvisos["pedidos"],
  });
  return avisos[0].detalhe;
}

// O aviso do pedido (sino e WhatsApp da lojista) mostrava "R$ 1234,50" enquanto
// o resto do app mostra "R$ 1.234,50": o valor tem de sair do formatador unico.
describe("aviso do pedido — o valor tem o ponto de milhar do resto do app", () => {
  it("1234,5 vira R$ 1.234,50", () => {
    expect(detalheDoPedido(1234.5)).toBe(formatCurrency(1234.5));
    expect(legivel(detalheDoPedido(1234.5))).toBe("R$ 1.234,50");
  });

  it("zero e nulo viram R$ 0,00", () => {
    expect(legivel(detalheDoPedido(0))).toBe("R$ 0,00");
    expect(legivel(detalheDoPedido(null))).toBe("R$ 0,00");
  });

  it("12,3 vira R$ 12,30", () => {
    expect(legivel(detalheDoPedido(12.3))).toBe("R$ 12,30");
  });

  it("um milhao vira R$ 1.000.000,00", () => {
    expect(legivel(detalheDoPedido(1000000))).toBe("R$ 1.000.000,00");
  });
});
