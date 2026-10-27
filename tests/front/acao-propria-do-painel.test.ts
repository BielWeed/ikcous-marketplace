import { beforeEach, describe, expect, it } from "vitest";

import {
  JANELA_DA_ACAO_PROPRIA_MS,
  eAcaoPropriaDoPedido,
  esquecerAcaoPropriaDoPedido,
  marcarAcaoPropriaDoPedido,
} from "../../src/lib/acao-propria-do-painel";

// Caça 9, item 5: o aviso "Pedido #N atualizado para…" do realtime não deve
// repetir o que a própria lojista acabou de fazer (o "Status atualizado com
// sucesso" já falou). A memória é curta, por pedido E por destino.
describe("acao-propria-do-painel — a lojista acabou de avançar este pedido", () => {
  beforeEach(() => {
    for (const id of ["p1", "p2"]) esquecerAcaoPropriaDoPedido(id);
  });

  it("marcado, o mesmo pedido com o mesmo destino conta como ação própria", () => {
    marcarAcaoPropriaDoPedido("p1", "shipping", 1_000);
    expect(eAcaoPropriaDoPedido("p1", "shipping", 1_500)).toBe(true);
  });

  it("outro destino do mesmo pedido NÃO é ação própria (outra pessoa mudou para outra coisa)", () => {
    marcarAcaoPropriaDoPedido("p1", "shipping", 1_000);
    expect(eAcaoPropriaDoPedido("p1", "cancelled", 1_500)).toBe(false);
  });

  it("outro pedido NÃO é ação própria", () => {
    marcarAcaoPropriaDoPedido("p1", "shipping", 1_000);
    expect(eAcaoPropriaDoPedido("p2", "shipping", 1_500)).toBe(false);
  });

  it("passada a janela deixa de valer (a marca não silencia o pedido para sempre)", () => {
    marcarAcaoPropriaDoPedido("p1", "shipping", 1_000);
    expect(
      eAcaoPropriaDoPedido(
        "p1",
        "shipping",
        1_000 + JANELA_DA_ACAO_PROPRIA_MS - 1,
      ),
    ).toBe(true);
    expect(
      eAcaoPropriaDoPedido("p1", "shipping", 1_000 + JANELA_DA_ACAO_PROPRIA_MS),
    ).toBe(false);
  });

  it("esquecer (a gravação falhou) tira a marca na hora", () => {
    marcarAcaoPropriaDoPedido("p1", "shipping", 1_000);
    esquecerAcaoPropriaDoPedido("p1");
    expect(eAcaoPropriaDoPedido("p1", "shipping", 1_100)).toBe(false);
  });

  it("sem marca nenhuma, nada é ação própria", () => {
    expect(eAcaoPropriaDoPedido("p1", "shipping", 1_000)).toBe(false);
  });
});
