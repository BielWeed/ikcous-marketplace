// @vitest-environment jsdom
// Sem pedido guardado (o caso de TODA abertura normal do checkout) a leitura
// devolve `null` — o valor que o checkout confere com `=== null` — e nunca
// `undefined`. O mesmo vale quando o armazenamento da aba está bloqueado: abrir o
// checkout não quebra.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerPedidoSemResposta } from "@/lib/pedido-sem-resposta";

describe("lerPedidoSemResposta: nada guardado", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("armazenamento vazio devolve null", () => {
    expect(lerPedidoSemResposta(null)).toBeNull();
  });

  it("armazenamento com texto vazio devolve null", () => {
    sessionStorage.setItem("ikcous-pedido-sem-resposta-v1", "");

    expect(lerPedidoSemResposta(null)).toBeNull();
  });

  it("armazenamento bloqueado pelo navegador devolve null, sem lançar erro", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });

    expect(lerPedidoSemResposta(null)).toBeNull();
  });
});
