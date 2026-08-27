// @vitest-environment jsdom
//
// `useOnlineStatus`: uma ÚNICA resposta 502/503/504 da sonda contra o
// Supabase bastava para marcar a loja inteira como "sem internet" — mesmo
// com a cliente perfeitamente online. É o SERVIDOR com problema, não a rede
// dela. E como o navegador nunca dispara o evento `online` (a rede real
// nunca caiu), a volta dependia do heartbeat de 15s.
//
// `createRoot` + `act` do React puro, sem `@testing-library/react` (não
// instalado neste projeto) — mesmo padrão de use-busca-cep.test.tsx.
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda() {
  const isOffline = useOnlineStatus();
  return <span data-testid="offline">{String(isOffline)}</span>;
}

describe("useOnlineStatus — um 502 isolado não é a internet da cliente caindo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // O hook lê `import.meta.env.VITE_SUPABASE_URL` direto (sem passar por
    // `@/lib/supabase`) e, se ela faltar, retorna sem chamar `fetch` — é
    // exatamente o caminho que o CI toma, porque `.env` não é versionado e o
    // job `test` não define essas variáveis. Sem o stub, este teste só passa
    // na máquina de quem já tem `.env` local; no CI reprova sozinho, mesmo
    // com o hook correto. Valor obviamente falso, nunca o do `.env` real.
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
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

  function offline(): string {
    return (document.querySelector('[data-testid="offline"]') as HTMLElement)
      .textContent as string;
  }

  async function montarEDeixarPrimeiraSondaResolver() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("502 isolado: NÃO marca offline sozinho, espera uma segunda sonda confirmar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 502 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    await montarEDeixarPrimeiraSondaResolver();

    // A primeira sonda voltou 502 — ainda não pode ter virado veredito.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(offline()).toBe("false");

    // Confirma com a segunda sonda.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(offline()).toBe("false");
  });

  it("502 confirmado por uma segunda sonda que também falha: aí sim marca offline (a detecção de gateway continua existindo)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 502 } as Response)
      .mockResolvedValueOnce({ status: 503 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    await montarEDeixarPrimeiraSondaResolver();
    expect(offline()).toBe("false");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(offline()).toBe("true");
  });

  it("controle negativo: quem está mesmo offline (navigator.onLine false) continua detectado na hora, sem sonda nenhuma", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(offline()).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
