import { pedidoDentroDoPrazo } from "@/lib/devolucao";
import { describe, expect, it } from "vitest";

// Caça por mutação em `pedidoDentroDoPrazo`. A função devolve TRÊS respostas:
// dentro (true), fora (false) e "não sei" (null, quando alguma das datas é
// ilegível). Os testes vizinhos só provam true e false; dois mutantes viravam
// "não sei" em "fora do prazo" sem nenhum teste cair:
//   - prazo que não é AAAA-MM-DD devolvia `false` em vez de `null`;
//   - data do pedido ilegível passava direto: "Invalid Date" > "2026-…" como
//     texto, então também saía `false` em vez de `null`.
// "fora do prazo" bloqueia a cliente; "não sei" deixa o servidor decidir.
// Datas literais, sem relógio da máquina.

describe("pedidoDentroDoPrazo — data ilegível é 'não sei', não 'fora do prazo'", () => {
  it("controle: dentro e fora do prazo (o dia do pedido é o da loja)", () => {
    // 01/10 21:30 em Brasília = 02/10 00:30 UTC.
    expect(pedidoDentroDoPrazo("2026-10-02T00:30:00.000Z", "2026-10-01")).toBe(
      true,
    );
    expect(pedidoDentroDoPrazo("2026-10-02T03:00:00.000Z", "2026-10-01")).toBe(
      false,
    );
  });

  it("prazo ilegível ou ausente devolve nulo", () => {
    expect(pedidoDentroDoPrazo("2026-10-02T00:30:00.000Z", "lixo")).toBeNull();
    expect(pedidoDentroDoPrazo("2026-10-02T00:30:00.000Z", "")).toBeNull();
    expect(
      pedidoDentroDoPrazo("2026-10-02T00:30:00.000Z", "2026-10-01T00:00:00Z"),
    ).toBeNull();
  });

  it("data do pedido ilegível devolve nulo", () => {
    expect(pedidoDentroDoPrazo("lixo", "2026-10-01")).toBeNull();
    expect(pedidoDentroDoPrazo("", "2026-10-01")).toBeNull();
  });
});
