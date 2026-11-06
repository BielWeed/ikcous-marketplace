// O motivo que a função de envio grava vem em inglês técnico; o painel o
// mostra em português. A mesma tradução serve Avisar clientes e o aviso de
// status do pedido.
import { describe, expect, it } from "vitest";

import { motivoDaFalhaEmPortugues } from "@/lib/motivo-da-falha-de-push";

describe("motivoDaFalhaEmPortugues", () => {
  it.each([
    [
      { status: 410, quantidade: 1 },
      "esse aparelho não recebe mais avisos (a inscrição venceu)",
    ],
    [
      { status: 404, quantidade: 3 },
      "esses aparelhos não recebem mais avisos (as inscrições venceram)",
    ],
    [{ status: 401 }, "o serviço de avisos recusou o envio"],
    [{ status: 403 }, "o serviço de avisos recusou o envio"],
    [{ status: 413 }, "mensagem grande demais"],
    [{ status: 429 }, "muitos envios, tente daqui a pouco"],
    [{ status: 503 }, "o serviço de avisos está fora do ar agora"],
  ])("traduz %j", (falha, esperado) => {
    expect(motivoDaFalhaEmPortugues(falha)).toBe(esperado);
  });

  it("sem o código numérico, lê o código do texto em inglês", () => {
    expect(
      motivoDaFalhaEmPortugues({ motivo: "push service respondeu 410 Gone" }),
    ).toBe("esse aparelho não recebe mais avisos (a inscrição venceu)");
  });

  it("motivo que não dá para ler vira 'motivo não identificado'", () => {
    expect(motivoDaFalhaEmPortugues({ motivo: "Aparelho não respondeu" })).toBe(
      "motivo não identificado",
    );
    expect(motivoDaFalhaEmPortugues({})).toBe("motivo não identificado");
  });
});
