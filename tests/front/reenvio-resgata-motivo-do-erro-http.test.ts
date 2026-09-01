// Laudo 0109 (B2) — achado da revisão adversária da onda 3:
// `functions.invoke` transforma status >= 400 em `FunctionsHttpError` e
// DESCARTA o corpo. A edge function devolve `sem_remetente` com HTTP 502
// (montarResposta), então sem resgatar o `motivo` do corpo do erro o ramo
// honesto da tela ("a loja ainda não configurou o envio de e-mails") era
// código morto — o cliente veria "tente de novo em instantes" para um
// problema que retentativa nenhuma resolve. Este arquivo prende a costura
// REAL (função de módulo `desfechoDoReenvio`), não o dublê do hook.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

import { desfechoDoReenvio } from "@/hooks/useOrders";

describe("desfechoDoReenvio — o motivo do 502 não pode se perder no caminho", () => {
  it("sem erro: devolve o corpo como veio", async () => {
    expect(await desfechoDoReenvio({ ok: true }, null)).toEqual({ ok: true });
    expect(await desfechoDoReenvio({ ok: false, motivo: "ja_enviado" }, null)).toEqual(
      { ok: false, motivo: "ja_enviado" },
    );
  });

  it("erro HTTP com corpo JSON: resgata o motivo — sem_remetente é alcançável", async () => {
    const erroHttp = {
      context: { json: async () => ({ ok: false, motivo: "sem_remetente" }) },
    };
    expect(await desfechoDoReenvio(null, erroHttp)).toEqual({
      ok: false,
      motivo: "sem_remetente",
    });
  });

  it("erro sem corpo utilizável (ou corpo não-JSON): desfecho genérico", async () => {
    expect(await desfechoDoReenvio(null, new Error("rede caiu"))).toEqual({
      ok: false,
      motivo: "envio_falhou",
    });
    const corpoNaoJson = {
      context: {
        json: async () => {
          throw new Error("corpo não é JSON");
        },
      },
    };
    expect(await desfechoDoReenvio(null, corpoNaoJson)).toEqual({
      ok: false,
      motivo: "envio_falhou",
    });
  });
});
