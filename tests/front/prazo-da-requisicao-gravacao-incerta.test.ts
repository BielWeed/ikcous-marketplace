import { ehGravacaoIncerta } from "@/lib/prazo-da-requisicao";
import { describe, expect, it } from "vitest";

describe("ehGravacaoIncerta", () => {
  it.each([
    ["code vazio", { code: "" }, true],
    ["code ausente", { message: "Failed to fetch" }, true],
    ["prazo esgotado", { code: "CONSULTA_SEM_RESPOSTA" }, true],
    ["rejeição Postgres", { code: "23505" }, false],
    ["rejeição PostgREST", { code: "PGRST116" }, false],
    ["TypeError", new TypeError("Failed to fetch"), true],
    ["Error", new Error("Bad Gateway"), true],
    ["code não textual", { code: 502 }, true],
    ["null", null, false],
    ["string solta", "Failed to fetch", false],
    ["undefined", undefined, false],
    [
      "banner indisponível",
      Object.assign(new Error("Removido"), { name: "BannerIndisponivel" }),
      false,
    ],
    ["objeto banner indisponível", { name: "BannerIndisponivel" }, false],
  ])("%s → %s", (_, erro, esperado) => {
    expect(ehGravacaoIncerta(erro)).toBe(esperado);
  });
});
