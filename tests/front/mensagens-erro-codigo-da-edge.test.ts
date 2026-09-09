import { codigoDoErroDeEdgeFunction } from "@/lib/mensagens-erro";
import { describe, expect, it, vi } from "vitest";

describe("codigoDoErroDeEdgeFunction", () => {
  it("lê o código sem consumir a resposta e permite ler novamente", async () => {
    const context = new Response(JSON.stringify({ codigo: "cep_invalido" }));
    const erro = { name: "FunctionsHttpError", context };

    expect(await codigoDoErroDeEdgeFunction(erro)).toBe("cep_invalido");
    expect(await codigoDoErroDeEdgeFunction(erro)).toBe("cep_invalido");
    expect(context.bodyUsed).toBe(false);
    expect(await context.json()).toEqual({ codigo: "cep_invalido" });
  });

  it.each([
    null,
    undefined,
    "erro",
    {},
    { name: "FunctionsHttpError" },
    { name: "FunctionsHttpError", context: { status: 400 } },
    {
      name: "FunctionsFetchError",
      context: new Response('{"codigo":"cep_invalido"}'),
    },
  ])("recusa erro fora do contrato: %j", async (erro) => {
    expect(await codigoDoErroDeEdgeFunction(erro)).toBeNull();
  });

  it.each([null, [], "cep_invalido", {}, { codigo: null }, { codigo: 400 }])(
    "recusa corpo sem código string: %j",
    async (corpo) => {
      expect(
        await codigoDoErroDeEdgeFunction({
          name: "FunctionsHttpError",
          context: new Response(JSON.stringify(corpo)),
        }),
      ).toBeNull();
    },
  );

  it("JSON inválido não escapa como rejeição", async () => {
    expect(
      await codigoDoErroDeEdgeFunction({
        name: "FunctionsHttpError",
        context: new Response("inválido"),
      }),
    ).toBeNull();
  });

  it("corpo já consumido não lança ao tentar clonar", async () => {
    const context = new Response('{"codigo":"cep_invalido"}');
    await context.json();
    expect(
      await codigoDoErroDeEdgeFunction({ name: "FunctionsHttpError", context }),
    ).toBeNull();
  });

  it("ambiente sem Response mantém o fallback sem lançar", async () => {
    const context = new Response('{"codigo":"cep_invalido"}');
    vi.stubGlobal("Response", undefined);
    try {
      expect(
        await codigoDoErroDeEdgeFunction({
          name: "FunctionsHttpError",
          context,
        }),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
