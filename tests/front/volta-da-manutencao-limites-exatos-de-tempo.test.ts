// @vitest-environment jsdom
//
// Bordas de TEMPO da volta da manutenção que o teste de lógica vizinho cobre
// só com folga larga:
//  - o prazo da pergunta "a loja voltou?" é de 5 s (4 999 ms ainda espera,
//    5 000 ms aborta a requisição e a resposta é "não", sem lançar);
//  - o prazo da limpeza do cache é de 2 s: a navegação só acontece aos 2 000 ms
//    (aos 1 999 ms ainda espera a limpeza);
//  - a pergunta, tenha dado certo ou errado, não deixa o relógio do prazo
//    pendurado;
//  - uma recarga anotada há EXATOS 30 minutos já saiu da janela (a borda é
//    exclusiva), então a terceira recarga volta a ser permitida.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navegar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recuperacao-chunk", () => ({
  navegarPreservandoEndereco: navegar,
}));

import {
  lojaSaiuDaManutencao,
  podeRecarregarSozinha,
  recarregarComPaginaNova,
  registrarRecargaSozinha,
} from "@/lib/volta-da-manutencao";

function fetchPendenteAteAbortar() {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

describe("volta da manutenção — limites exatos de tempo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navegar.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("a pergunta tem prazo de 5 s: aos 4 999 ms espera, aos 5 000 ms aborta e responde 'não'", async () => {
    const buscar = fetchPendenteAteAbortar();
    vi.stubGlobal("fetch", buscar);

    const resposta = lojaSaiuDaManutencao();
    const sinal = buscar.mock.calls[0]?.[1]?.signal as AbortSignal;

    await vi.advanceTimersByTimeAsync(4_999);
    expect(sinal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(sinal.aborted).toBe(true);
    await expect(resposta).resolves.toBe(false);
  });

  it.each([
    [
      "resposta boa",
      () =>
        ({ ok: true, json: async () => ({ configuracao: {} }) }) as Response,
    ],
    ["resposta 503", () => ({ ok: false, status: 503 }) as Response],
  ])("%s: o relógio do prazo é desarmado", async (_, montar) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => montar()),
    );

    await lojaSaiuDaManutencao();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("a requisição que rejeita também desarma o relógio do prazo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(lojaSaiuDaManutencao()).resolves.toBe(false);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("a limpeza do cache trava: a navegação só acontece aos 2 000 ms, não antes", async () => {
    vi.stubGlobal("location", {
      origin: "https://loja.exemplo.com",
      pathname: "/",
      search: "",
      hash: "",
      href: "https://loja.exemplo.com/",
    });
    vi.stubGlobal("caches", {
      keys: vi.fn(() => new Promise(() => {})),
      open: vi.fn(),
    });

    const pronto = recarregarComPaginaNova();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(navegar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pronto;
    expect(navegar).toHaveBeenCalledTimes(1);
  });

  it("a recarga mais antiga anotada há EXATOS 30 minutos já saiu da janela: a terceira volta a ser permitida", () => {
    const T0 = 1_800_000_000_000;
    registrarRecargaSozinha(T0);
    registrarRecargaSozinha(T0 + 100_000);
    registrarRecargaSozinha(T0 + 200_000);

    expect(podeRecarregarSozinha(T0 + 30 * 60_000 - 1)).toBe(false);
    expect(podeRecarregarSozinha(T0 + 30 * 60_000)).toBe(true);
  });
});
