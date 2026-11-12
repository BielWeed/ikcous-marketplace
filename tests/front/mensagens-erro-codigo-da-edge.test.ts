import { codigoDoErroDeEdgeFunction } from "@/lib/mensagens-erro";
import { PRAZO_DE_LER_O_CORPO_DO_ERRO_MS } from "@/lib/prazo-da-requisicao";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  // Resposta HTTP de erro cujos cabeçalhos chegaram, mas o CORPO nunca termina
  // (rede pendurada no meio do envio). Sem prazo, quem aguarda o código ficava
  // preso para sempre e o checkout permanecia em "cotando".
  describe("corpo do erro que nunca termina", () => {
    function respostaComCorpoPendurado(): Response {
      return new Response(
        new ReadableStream({
          start() {
            // nunca enfileira nem fecha
          },
        }),
        { status: 500 },
      );
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("solta a espera no prazo e devolve null (código desconhecido)", async () => {
      vi.useFakeTimers();
      let resolvido = false;
      const espera = codigoDoErroDeEdgeFunction({
        name: "FunctionsHttpError",
        context: respostaComCorpoPendurado(),
      }).then((codigo) => {
        resolvido = true;
        return codigo;
      });

      await vi.advanceTimersByTimeAsync(PRAZO_DE_LER_O_CORPO_DO_ERRO_MS - 1);
      expect(resolvido).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolvido).toBe(true);
      expect(await espera).toBeNull();
    });

    it("controle: corpo que chega dentro do prazo continua devolvendo o código", async () => {
      vi.useFakeTimers();
      const espera = codigoDoErroDeEdgeFunction({
        name: "FunctionsHttpError",
        context: new Response(JSON.stringify({ codigo: "fora_da_area" })),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(await espera).toBe("fora_da_area");
    });
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
