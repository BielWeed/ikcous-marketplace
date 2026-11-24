// Protege: `sessaoAindaEhDoDono` é a trava que impede a fila offline de sair
// com o login de OUTRA pessoa (tablet de balcão que troca de conta no meio da
// passada). O contrato é "não sei" nunca vira "pode enviar": se a leitura da
// sessão LANÇA (armazenamento bloqueado, exceção do cliente, promessa
// rejeitada), a resposta é `false` — e NÃO é o aviso de "sem internet", porque
// não se sabe que foi a rede. Os casos de rede/sessão ausente já têm teste no
// vizinho (`sessao-ainda-e-do-dono-distingue-rede-de-sessao`); o ramo `catch`
// não tinha.
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => h.getSession(...args),
    },
  },
}));

import { sessaoAindaEhDoDono } from "@/lib/sessao-ainda-e-do-dono";

describe("sessaoAindaEhDoDono — leitura da sessão que falha nunca libera o envio", () => {
  let aoFalharPorRede: Mock<() => void>;

  beforeEach(() => {
    h.getSession.mockReset();
    aoFalharPorRede = vi.fn<() => void>();
  });

  it("getSession lança na hora: false, sem avisar 'sem internet'", async () => {
    h.getSession.mockImplementation(() => {
      throw new Error("armazenamento bloqueado");
    });
    expect(await sessaoAindaEhDoDono("user-1", aoFalharPorRede)).toBe(false);
    expect(aoFalharPorRede).not.toHaveBeenCalled();
  });

  it("getSession rejeita a promessa: false, sem avisar 'sem internet'", async () => {
    h.getSession.mockRejectedValue(new Error("falha qualquer"));
    expect(await sessaoAindaEhDoDono("user-1", aoFalharPorRede)).toBe(false);
    expect(aoFalharPorRede).not.toHaveBeenCalled();
  });

  it("sem o segundo parâmetro a falha também devolve só false", async () => {
    h.getSession.mockRejectedValue(new Error("falha qualquer"));
    expect(await sessaoAindaEhDoDono("user-1")).toBe(false);
  });

  it("controle: com a sessão do dono o mesmo dublê devolve true", async () => {
    h.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    expect(await sessaoAindaEhDoDono("user-1", aoFalharPorRede)).toBe(true);
  });
});
