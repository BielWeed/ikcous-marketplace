// @vitest-environment jsdom
//
// `useConnectionDiagnostics`: os NÚMEROS exatos da sonda de conexão. Os testes
// vizinhos provam o desenho (um 502 isolado espera confirmação, rede lenta não
// é offline, fonte única por aba) com folga larga de tempo. Aqui ficam as
// bordas que decidem o que a cliente lê na tela e que ninguém media:
//  - o prazo da sonda é de 3,5 s (3499 ms ainda espera, 3500 ms aborta);
//  - latência até 150 ms é "excelente", até 350 ms "boa", acima "lenta"
//    (a borda é exclusiva: exatamente 150 ainda é excelente);
//  - 502, 503 e 504 são "gateway" (confirmam com 2ª sonda); 500, 501 e 505 NÃO;
//  - a re-sonda sai em 1,5 s (nem antes, nem depois), nos dois caminhos
//    (status de gateway e requisição que rejeita);
//  - o relógio de reconsulta é de 15 s;
//  - voltar à aba (visibilitychange) consulta; esconder a aba não;
//  - uma tela que sai NÃO desliga a fonte das que continuam montadas;
//  - a última tela que sai não deixa timer de re-sonda pendurado;
//  - a sonda pede sem cache e com GET; a latência publicada em rede lenta é o
//    prazo da sonda.
//
// O hook guarda estado no MÓDULO: cada teste importa uma cópia limpa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function importarHookLimpo() {
  vi.resetModules();
  return import("@/hooks/useOnlineStatus");
}

/** Resposta do banco depois de `ms` milissegundos do relógio falso. */
function respostaDepoisDe(ms: number, status: number) {
  return vi.fn(
    (_url: unknown, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        setTimeout(() => resolve({ status } as Response), ms);
      }),
  );
}

/** Requisição pendurada: só rejeita quando o prazo da sonda a aborta. */
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

describe("useConnectionDiagnostics — limites exatos de tempo e de status", () => {
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

  async function montar(copias = 1) {
    const { useConnectionDiagnostics } = await importarHookLimpo();
    function Sonda() {
      const { isOffline, quality, latency } = useConnectionDiagnostics();
      return (
        <>
          <span data-testid="offline">{String(isOffline)}</span>
          <span data-testid="quality">{quality}</span>
          <span data-testid="latency">{String(latency)}</span>
        </>
      );
    }
    function Secundaria() {
      useConnectionDiagnostics();
      return null;
    }
    const renderizar = async (total: number) => {
      await act(async () => {
        raiz.render(
          <>
            <Sonda />
            {["a", "b", "c"].slice(0, total - 1).map((id) => (
              <Secundaria key={id} />
            ))}
          </>,
        );
      });
    };
    await renderizar(copias);
    return renderizar;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("o prazo da sonda é de 3,5 s: aos 3499 ms ainda espera, aos 3500 ms aborta", async () => {
    const fetchMock = fetchPendenteAteAbortar();
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    const sinal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(sinal.aborted).toBe(false);

    await avancar(3499);
    expect(sinal.aborted).toBe(false);

    await avancar(1);
    expect(sinal.aborted).toBe(true);
  });

  it("a sonda pede sem cache, com GET, e em rede lenta o 'lento' publica o prazo como latência", async () => {
    const fetchMock = fetchPendenteAteAbortar();
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.cache).toBe("no-store");
    expect(init.method).toBe("GET");

    // 1ª tentativa estoura (3,5 s), re-sonda em 1,5 s, a 2ª também estoura.
    await avancar(3500 + 1500 + 3500);
    expect(lido("quality")).toBe("slow");
    expect(lido("offline")).toBe("false");
    expect(lido("latency")).toBe("3500");
  });

  it.each([
    [0, "excellent"],
    [150, "excellent"],
    [151, "good"],
    [350, "good"],
    [351, "slow"],
  ])(
    "resposta 200 em %i ms: qualidade '%s' (150 e 350 são bordas exclusivas)",
    async (ms, esperada) => {
      vi.stubGlobal("fetch", respostaDepoisDe(ms, 200));

      await montar();
      await avancar(ms);

      expect(lido("offline")).toBe("false");
      expect(lido("quality")).toBe(esperada);
      expect(lido("latency")).toBe(String(ms));
    },
  );

  it.each([[502], [503], [504]])(
    "status %i é de gateway: espera a 2ª sonda; confirmado, vira offline",
    async (status) => {
      const fetchMock = respostaDepoisDe(0, status);
      vi.stubGlobal("fetch", fetchMock);

      await montar();
      await avancar(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lido("offline")).toBe("false");

      await avancar(1500);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // A resposta da 2ª sonda chega no relógio falso logo depois da saída.
      await avancar(10);
      expect(lido("offline")).toBe("true");
      expect(lido("quality")).toBe("offline");
    },
  );

  it.each([[500], [501], [505], [404]])(
    "status %i NÃO é de gateway: nenhuma re-sonda e a cliente segue online",
    async (status) => {
      const fetchMock = respostaDepoisDe(0, status);
      vi.stubGlobal("fetch", fetchMock);

      await montar();
      await avancar(0);
      await avancar(1500);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lido("offline")).toBe("false");
      expect(lido("quality")).toBe("excellent");
    },
  );

  it("a re-sonda depois de um status de gateway sai em 1500 ms: aos 1499 ainda não, aos 1500 sim", async () => {
    const fetchMock = respostaDepoisDe(0, 503);
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await avancar(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await avancar(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a re-sonda depois de uma requisição que rejeita também sai em 1500 ms exatos", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await avancar(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await avancar(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("o relógio de reconsulta é de 15 s: aos 14999 ms não consulta, aos 15000 ms sim", async () => {
    const fetchMock = respostaDepoisDe(0, 200);
    vi.stubGlobal("fetch", fetchMock);

    await montar();
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await avancar(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await avancar(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("voltar à aba (visível) consulta na hora; esconder a aba não consulta", async () => {
    const fetchMock = respostaDepoisDe(0, 200);
    vi.stubGlobal("fetch", fetchMock);
    const visibilidade = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");

    await montar();
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibilidade.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    visibilidade.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uma tela sai e a outra continua montada: a fonte segue ligada (relógio e evento de offline)", async () => {
    const fetchMock = respostaDepoisDe(0, 200);
    vi.stubGlobal("fetch", fetchMock);

    const renderizar = await montar(2);
    await avancar(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Sai a segunda tela; a primeira (que lê o estado) fica.
    await renderizar(1);

    await avancar(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(lido("offline")).toBe("true");
  });

  it("a última tela sai com uma re-sonda pendente: nenhum timer fica pendurado", async () => {
    // Linha de base: quantos timers o próprio React deixa depois de desmontar
    // uma tela cuja sonda respondeu 200 (nenhuma re-sonda em jogo).
    vi.stubGlobal("fetch", respostaDepoisDe(0, 200));
    await montar();
    await avancar(0);
    await act(async () => {
      raiz.unmount();
    });
    const base = vi.getTimerCount();

    // Agora com um 503 isolado: a re-sonda de 1,5 s está agendada.
    raiz = createRoot(hospedeiro);
    vi.stubGlobal("fetch", respostaDepoisDe(0, 503));
    await montar();
    await avancar(0);
    await act(async () => {
      raiz.unmount();
    });

    expect(vi.getTimerCount()).toBe(base);
  });
});
