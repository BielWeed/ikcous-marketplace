// Aviso de estoque: nao mostra a data de cadastro do produto (nao e' quando o
// estoque baixou) e a ordem dentro do tipo e' por urgencia — o que zerou vem
// antes do que "esta acabando", mesmo que o produto seja mais antigo.

import { describe, expect, it } from "vitest";

import { type EntradaDeAvisos, montarAvisos } from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

function produto(id: string, stock: number, created_at: string) {
  return { id, name: `Produto ${id}`, stock, estoqueMinimo: null, created_at };
}

describe("montarAvisos — avisos de estoque", () => {
  it("nao carrega a data de cadastro do produto como se fosse a do aviso", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        produto("a", 0, "2026-01-01T10:00:00.000Z"),
        produto("b", 2, "2026-08-01T10:00:00.000Z"),
      ],
    });

    expect(avisos).toHaveLength(2);
    expect(avisos.every((a) => a.quando === "")).toBe(true);
  });

  it("o que acabou vem antes do que esta acabando, mesmo sendo mais antigo", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        produto("b", 2, "2026-08-01T10:00:00.000Z"),
        produto("a", 0, "2026-01-01T10:00:00.000Z"),
      ],
    });

    expect(avisos.map((a) => a.destino.id)).toEqual(["a", "b"]);
  });

  it("depois do que zerou, vem o de menor estoque primeiro", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        produto("quatro", 4, "2026-08-03T10:00:00.000Z"),
        produto("um", 1, "2026-01-02T10:00:00.000Z"),
        produto("zero", 0, "2026-01-01T10:00:00.000Z"),
        produto("dois", 2, "2026-08-02T10:00:00.000Z"),
      ],
    });

    expect(avisos.map((a) => a.destino.id)).toEqual([
      "zero",
      "um",
      "dois",
      "quatro",
    ]);
  });

  it("estoque igual mantem a ordem em que os produtos chegaram", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        produto("x", 1, "2026-08-03T10:00:00.000Z"),
        produto("y", 1, "2026-01-02T10:00:00.000Z"),
        produto("z", 1, "2026-05-02T10:00:00.000Z"),
      ],
    });

    expect(avisos.map((a) => a.destino.id)).toEqual(["x", "y", "z"]);
  });

  it("nao muda a entrada de quem chamou", () => {
    const produtos = [
      produto("b", 2, "2026-08-01T10:00:00.000Z"),
      produto("a", 0, "2026-01-01T10:00:00.000Z"),
    ];
    montarAvisos({ ...VAZIO, produtos });

    expect(produtos.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("estoque continua depois dos outros tipos", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      perguntasPendentes: 1,
      produtos: [produto("a", 0, "2026-01-01T10:00:00.000Z")],
    });

    expect(avisos.map((a) => a.tipo)).toEqual(["pergunta", "estoque"]);
  });
});
