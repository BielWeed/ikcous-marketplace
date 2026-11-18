// LOTE 210 (r210-d) — o Financeiro agrupa na mesma origem (`venda_entrega`) todo
// pedido pago FORA do app e fora do balcão: o dinheiro que troca de mão na
// entrega E na retirada na loja (ver a migration 20261391200000). O lançamento
// não carrega o jeito de receber, então o rótulo não pode afirmar só "entrega":
// quem retirou na loja lia "Venda na entrega" no extrato.
import { describe, expect, it } from "vitest";

import { rotuloDaOrigem } from "@/lib/financeiro";

describe("rotuloDaOrigem — venda_entrega", () => {
  it("diz 'entrega ou retirada', porque a origem cobre as duas", () => {
    expect(rotuloDaOrigem("venda_entrega")).toBe(
      "Venda na entrega ou retirada",
    );
  });

  it("controle: as outras origens de venda não mudam", () => {
    expect(rotuloDaOrigem("venda_online")).toBe("Venda online");
    expect(rotuloDaOrigem("venda_balcao")).toBe("Venda no balcão");
  });
});
