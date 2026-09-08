// @vitest-environment jsdom
//
// `useOnlineStatus`/`useConnectionDiagnostics` disparavam UM relógio de 15s e
// UMA consulta ao banco POR INSTÂNCIA do hook. Com 22 consumidores no app, o
// painel do lojista chegava a ter 2-4 instâncias montadas ao mesmo tempo:
// 8-16 consultas por minuto, o dia inteiro, e cada instância podia discordar
// da outra sobre estar online (uma pisca "sem conexão", a outra não).
//
// Este arquivo prova a fonte ÚNICA por aba: N instâncias montadas viram UMA
// consulta e UM relógio; o último assinante a sair desliga tudo (sem
// `setInterval`/`setTimeout` pendente escrevendo depois); uma montagem nova
// depois de tudo parado volta a ligar a fonte.
//
// `createRoot` + `act` do React puro, sem `@testing-library/react` (não
// instalado neste projeto) — mesmo padrão de
// `use-online-status-502-isolado-nao-marca-offline.test.tsx`.
//
// Este arquivo usa `vi.resetModules()` + `import()` dinâmico em CADA teste
// (mesmo padrão de `use-online-status-usa-chave-publishable-quando-legada-falta.test.tsx`)
// porque o estado da fonte agora vive no MÓDULO (singleton por aba) — sem
// isolar, o teste anterior vazaria assinante/relógio para o próximo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function importarHookLimpo() {
  vi.resetModules();
  return import("@/hooks/useOnlineStatus");
}

describe("useOnlineStatus/useConnectionDiagnostics — fonte única por aba", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  function textoDaSonda(id: string): string {
    return (document.querySelector(`[data-testid="${id}"]`) as HTMLElement)
      .textContent as string;
  }

  it("duas instâncias montadas ao mesmo tempo geram UMA consulta, não duas", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function Sonda({ id }: { id: string }) {
      const offline = useOnlineStatus();
      return <span data-testid={id}>{String(offline)}</span>;
    }

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    // A primeira instância monta sozinha e a consulta inicial resolve por
    // completo (o guard `isChecking` já volta a false). Isso separa o
    // efeito da CONTAGEM de assinantes do efeito incidental do guard de
    // corrida `isChecking` — se as duas montagens acontecessem no mesmo
    // tick síncrono, o `isChecking` sozinho bloquearia a segunda consulta
    // mesmo sem nenhuma lógica de contagem, mascarando a mutação.
    await act(async () => {
      raiz.render(<Sonda id="a" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Segunda instância entra com a fonte JÁ rodando (isChecking livre): tem
    // de receber o instantâneo corrente, sem disparar consulta nova.
    await act(async () => {
      raiz.render(
        <>
          <Sonda id="a" />
          <Sonda id="b" />
        </>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(textoDaSonda("a")).toBe("false");
    expect(textoDaSonda("b")).toBe("false");
  });

  it("evento online faz TODAS as instâncias montadas dizerem online na mesma rodada", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function DuasSondasEmComponentesSeparados() {
      return (
        <>
          <SondaFilha id="x" useOnlineStatus={useOnlineStatus} />
          <SondaFilha id="y" useOnlineStatus={useOnlineStatus} />
        </>
      );
    }
    function SondaFilha({
      id,
      useOnlineStatus,
    }: {
      id: string;
      useOnlineStatus: () => boolean;
    }) {
      const offline = useOnlineStatus();
      return <span data-testid={id}>{String(offline)}</span>;
    }

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      raiz.render(<DuasSondasEmComponentesSeparados />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textoDaSonda("x")).toBe("false");
    expect(textoDaSonda("y")).toBe("false");

    // O evento "offline" da janela marca offline na hora, sem rede — as
    // DUAS instâncias precisam refletir isso juntas.
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(textoDaSonda("x")).toBe("true");
    expect(textoDaSonda("y")).toBe("true");

    // O evento "online" dispara UMA verificação (não uma por instância) e
    // as DUAS instâncias voltam a dizer online na mesma rodada.
    const chamadasAntesDeReconectar = fetchMock.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(textoDaSonda("x")).toBe("false");
    expect(textoDaSonda("y")).toBe("false");
    expect(fetchMock.mock.calls.length).toBe(chamadasAntesDeReconectar + 1);
  });

  it("aba escondida: o relógio de 15s não consulta", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function Sonda() {
      const offline = useOnlineStatus();
      return <span data-testid="offline">{String(offline)}</span>;
    }

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.useFakeTimers();

    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const chamadasAntesDoRelogio = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchMock.mock.calls.length).toBe(chamadasAntesDoRelogio);
  });

  it("última instância desmonta limpa o setInterval; montagem nova depois volta a consultar", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function Sonda() {
      const offline = useOnlineStatus();
      return <span data-testid="offline">{String(offline)}</span>;
    }

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Última (e única) instância desmonta.
    await act(async () => {
      raiz.unmount();
    });

    expect(clearIntervalSpy).toHaveBeenCalled();

    // Montagem nova, depois de tudo ter parado: volta a ligar a fonte e
    // consultar de novo.
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("o formato do retorno não muda: chaves e tipos de useConnectionDiagnostics(), e useOnlineStatus() devolve boolean", async () => {
    const { useConnectionDiagnostics, useOnlineStatus } =
      await importarHookLimpo();

    // Renderiza os dois retornos como JSON no próprio DOM (em vez de
    // reatribuir uma variável externa durante o render, que o
    // `react-hooks/globals` do eslint reprova como efeito colateral impuro).
    function Sonda() {
      const diagnostics = useConnectionDiagnostics();
      const isOffline = useOnlineStatus();
      return (
        <>
          <span data-testid="diagnostics">{JSON.stringify(diagnostics)}</span>
          <span data-testid="tipo-online-status">{typeof isOffline}</span>
        </>
      );
    }

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const d = JSON.parse(textoDaSonda("diagnostics")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(d).sort()).toEqual(["isOffline", "latency", "quality"]);
    expect(typeof d.isOffline).toBe("boolean");
    expect(typeof d.latency).toBe("number");
    expect(["excellent", "good", "slow", "offline"]).toContain(d.quality);
    expect(textoDaSonda("tipo-online-status")).toBe("boolean");
  });
});
