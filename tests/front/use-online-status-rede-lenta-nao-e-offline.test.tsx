// @vitest-environment jsdom
//
// `useOnlineStatus`: no 3G lento a sonda estourava o prazo (3,5 s) duas vezes
// seguidas e declarava "sem internet" — mas estourar o prazo prova LENTIDÃO,
// não falta de rede. A cliente digitava o CEP, via "Sem conexão com a
// internet." e a calculadora de frete nem chamava a função que talvez
// respondesse em 5-6 s. Offline de verdade é `navigator.onLine === false` ou
// a requisição REJEITAR por erro de rede (`TypeError: Failed to fetch`).
//
// O hook guarda estado no MÓDULO (fonte única por aba): cada teste importa
// uma cópia limpa, mesmo padrão de
// `online-status-uma-consulta-para-todas-as-telas.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function importarHookLimpo() {
  vi.resetModules();
  return import("@/hooks/useOnlineStatus");
}

/**
 * Rede lenta de verdade: a requisição fica pendente e só REJEITA quando o
 * `AbortController` do hook a aborta (é o que o `fetch` real faz).
 */
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

function falhaDeRede() {
  return new TypeError("Failed to fetch");
}

describe("useOnlineStatus — rede lenta não vira 'sem conexão'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function lido(id: string): string {
    return (document.querySelector(`[data-testid="${id}"]`) as HTMLElement)
      .textContent as string;
  }

  async function montar() {
    const { useConnectionDiagnostics, useOnlineStatus } =
      await importarHookLimpo();
    function Sonda() {
      const { isOffline, quality } = useConnectionDiagnostics();
      const legado = useOnlineStatus();
      return (
        <>
          <span data-testid="offline">{String(isOffline)}</span>
          <span data-testid="quality">{quality}</span>
          <span data-testid="legado">{String(legado)}</span>
        </>
      );
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("as duas tentativas estouram o prazo: fica 'lento', NÃO offline (a tela segue tentando)", async () => {
    const fetchMock = fetchPendenteAteAbortar();
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    // 1ª tentativa: prazo de 3,5 s.
    await avancar(3500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lido("offline")).toBe("false");
    // Re-sonda 1,5 s depois; também estoura o prazo.
    await avancar(1500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await avancar(3500);

    expect(lido("offline")).toBe("false");
    expect(lido("legado")).toBe("false");
    expect(lido("quality")).toBe("slow");
  });

  it("a requisição REJEITA por erro de rede nas duas tentativas: aí sim offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(falhaDeRede());
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(0);
    // A primeira falha de rede ainda espera a confirmação.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lido("offline")).toBe("false");

    await avancar(1500);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lido("offline")).toBe("true");
    expect(lido("legado")).toBe("true");
    expect(lido("quality")).toBe("offline");
  });

  it("lento na primeira, erro de rede REAL na confirmação: offline (a última evidência manda)", async () => {
    const pendente = fetchPendenteAteAbortar();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(pendente)
      .mockImplementationOnce(() => Promise.reject(falhaDeRede()));
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(3500);
    await avancar(1500);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lido("offline")).toBe("true");
  });

  it("navigator.onLine=false marca offline na hora, sem sonda nenhuma", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

    await montar();

    expect(lido("offline")).toBe("true");
    expect(lido("quality")).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("volta ao normal quando a sonda responde: o heartbeat de 15 s tira o 'lento'", async () => {
    const fetchMock = fetchPendenteAteAbortar();
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(3500 + 1500 + 3500);
    expect(lido("quality")).toBe("slow");

    // A rede melhorou: a próxima sonda (heartbeat em t=15 s) responde rápido.
    fetchMock.mockImplementation(() =>
      Promise.resolve({ status: 200 } as Response),
    );
    await avancar(15000 - (3500 + 1500 + 3500));
    await avancar(0);

    expect(lido("offline")).toBe("false");
    expect(lido("quality")).not.toBe("slow");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("o relógio de 15 s segue ligado em rede lenta e NADA fica pendente depois de desmontar", async () => {
    const fetchMock = fetchPendenteAteAbortar();
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(3500 + 1500 + 3500);
    expect(lido("quality")).toBe("slow");
    // Heartbeat ainda vivo: a sonda de t=15 s sai.
    const chamadasAntes = fetchMock.mock.calls.length;
    await avancar(15000 - (3500 + 1500 + 3500));
    expect(fetchMock.mock.calls.length).toBe(chamadasAntes + 1);

    await act(async () => {
      raiz.unmount();
    });
    // Sem relógio, sem re-sonda, sem prazo pendente.
    expect(vi.getTimerCount()).toBe(0);
    // E o que ainda estava em voo não escreve depois da parada.
    const chamadasAoSair = fetchMock.mock.calls.length;
    await avancar(60000);
    expect(fetchMock.mock.calls.length).toBe(chamadasAoSair);
  });
});
