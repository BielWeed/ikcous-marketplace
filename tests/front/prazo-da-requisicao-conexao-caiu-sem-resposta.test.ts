// A conexão que CAI no meio da gravação (iPhone trocando de app, Wi-Fi que
// some) não lança: o supabase-js devolve `{ error }`. A forma exata foi
// conferida em node_modules (2.117.2):
// - postgrest-js, `PostgrestBuilder.then` (.catch do fetch): objeto simples
//   `{ message: "TypeError: Failed to fetch", details: <stack>, hint: "",
//   code: "" }`;
// - postgrest-js, `toTransportFailure`: o mesmo texto dentro de um
//   `PostgrestError`, também com `code: ""`;
// - functions-js, `FunctionsClient.invoke`: o fetch que rejeita vira
//   `new FunctionsFetchError(fetchError)` (name "FunctionsFetchError").
import {
  CODIGO_CONSULTA_SEM_RESPOSTA,
  ehConexaoCaiuSemResposta,
} from "@/lib/prazo-da-requisicao";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/functions-js";
import { PostgrestError } from "@supabase/postgrest-js";
import { describe, expect, it } from "vitest";

const quedaDoPostgrest = (mensagemDoFetch: string) => ({
  message: `TypeError: ${mensagemDoFetch}`,
  details: `TypeError: ${mensagemDoFetch}\n    at fetch (stack)`,
  hint: "",
  code: "",
});

describe("ehConexaoCaiuSemResposta", () => {
  it.each([
    ["Chrome: Failed to fetch", quedaDoPostgrest("Failed to fetch")],
    ["iPhone/Safari: Load failed", quedaDoPostgrest("Load failed")],
    [
      "Firefox: NetworkError",
      quedaDoPostgrest("NetworkError when attempting to fetch resource."),
    ],
    [
      "PostgrestError de transporte",
      new PostgrestError({
        message: "TypeError: Load failed",
        details: "",
        hint: "",
        code: "",
      }),
    ],
    [
      "FunctionsFetchError",
      new FunctionsFetchError(new TypeError("Load failed")),
    ],
    ["FunctionsFetchError (objeto)", { name: "FunctionsFetchError" }],
  ])("%s → incerto", (_, erro) => {
    expect(ehConexaoCaiuSemResposta(erro)).toBe(true);
  });

  it.each([
    // Corpo HTTP sem código (gateway 502): o servidor RESPONDEU que falhou.
    [
      "HTTP com corpo e code vazio",
      { message: "Bad Gateway", details: "", hint: "", code: "" },
    ],
    [
      "PostgrestError com corpo",
      new PostgrestError({
        message: "upstream connect error",
        details: "",
        hint: "",
        code: "",
      }),
    ],
    [
      "texto de rede COM código do banco",
      { message: "TypeError: Failed to fetch", code: "23505" },
    ],
    ["código ausente (TypeError cru)", new TypeError("Failed to fetch")],
    ["recusa do banco", { message: "duplicate key", code: "23505" }],
    [
      "cancelada pelo app (AbortError)",
      {
        message: "AbortError: The user aborted a request.",
        details: "",
        hint: "",
        code: "",
      },
    ],
    [
      "prazo esgotado (tem classificador próprio)",
      { code: CODIGO_CONSULTA_SEM_RESPOSTA },
    ],
    [
      "FunctionsHttpError",
      new FunctionsHttpError(new Response("{}", { status: 500 })),
    ],
    [
      "FunctionsRelayError",
      new FunctionsRelayError(new Response("{}", { status: 502 })),
    ],
    ["null", null],
    ["undefined", undefined],
    ["string solta", "TypeError: Failed to fetch"],
  ])("%s → não é queda", (_, erro) => {
    expect(ehConexaoCaiuSemResposta(erro)).toBe(false);
  });
});
