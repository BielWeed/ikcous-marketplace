import { describe, expect, it } from "vitest";

import { corpoDoErroDaEdge, mensagemDoErroDaEdge } from "@/lib/devolucao";

const CORPO = {
  error: "Compra do Melhor Envio indeterminada",
  resgate: true,
  me_reverse_id: "abc",
};

const erroComResposta = () => ({
  context: new Response(JSON.stringify(CORPO), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  }),
});

describe("corpo do erro da edge com Response real", () => {
  it("lê o corpo de resgate pelo json herdado da Response", async () => {
    expect(await corpoDoErroDaEdge(erroComResposta())).toEqual(CORPO);
  });

  it("mostra a mensagem do servidor em vez da genérica", async () => {
    expect(await mensagemDoErroDaEdge(erroComResposta(), "genérica")).toBe(
      CORPO.error,
    );
  });

  it("corpo que não é JSON retorna null e mensagem genérica sem lançar", async () => {
    expect(
      await corpoDoErroDaEdge({ context: new Response("não é JSON") }),
    ).toBeNull();
    expect(
      await mensagemDoErroDaEdge(
        { context: new Response("não é JSON") },
        "genérica",
      ),
    ).toBe("genérica");
  });

  it("erro sem context retorna null", async () => {
    expect(await corpoDoErroDaEdge({})).toBeNull();
  });
});
