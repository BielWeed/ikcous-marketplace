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
    // Precisa ligar o timer falso ANTES da primeira montagem: o
    // `setInterval` do batimento nasce dentro de `start()`, na montagem. Se
    // o fake timer entrasse só depois, o `clearInterval` de `stop()`
    // chamaria a versão FALSA sobre um id de timer REAL — não limparia nada
    // de verdade, e o `advanceTimersByTimeAsync` abaixo não teria como
    // provar que o relógio parou.
    vi.useFakeTimers();
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

    // `clearInterval` ter sido CHAMADO não prova que o batimento PAROU (ele
    // passaria mesmo se o id chamado fosse o errado). A asserção que
    // corresponde ao título do teste é: avançar os 15s inteiros do relógio e
    // conferir que nenhum `fetch` novo aconteceu.
    expect(clearIntervalSpy).toHaveBeenCalled();
    const chamadasAntesDeAvancar = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetchMock.mock.calls.length).toBe(chamadasAntesDeAvancar);
    vi.useRealTimers();

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

  // ── RESSALVA 2 do laudo Opus (correção de corretude) ──────────────────
  //
  // `verifyConnection` só invalida uma sonda de geração morta DEPOIS do
  // fetch resolver (`if (gen !== generation) return;`). Antes da correção
  // esse `return` estava dentro do `try`, então passava pelo `finally` e
  // liberava o `isChecking` (um `boolean` solto) — que a essa altura já
  // pertencia à sonda da geração NOVA, ainda em voo. Este teste reproduz a
  // sequência exata do laudo (sonda A em voo → stop() → sonda B nasce →
  // fetch A resolve tarde → um gatilho novo chega) e cai CONTRA O CÓDIGO
  // ATUAL sem a correção: duas sondas simultâneas para a MESMA geração viva
  // (3 chamadas de fetch — A, B e uma C indevida — em vez de 2).
  it("[R2] fetch de uma geração já morta não libera o mutex da geração viva (não abre duas sondas simultâneas)", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function Sonda() {
      const offline = useOnlineStatus();
      return <span data-testid="offline">{String(offline)}</span>;
    }

    let resolveFetchA!: (value: Response) => void;
    let resolveFetchB!: (value: Response) => void;
    let resolveFetchC!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetchA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetchB = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetchC = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    // Sonda A monta sozinha: dispara o fetch A, que fica em voo (a Promise
    // dele nunca é resolvida aqui).
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Último assinante (A) desmonta: `stop()` roda, a geração vira 1. O
    // fetch A continua em voo — é a "geração morta" da sequência do laudo.
    await act(async () => {
      raiz.unmount();
    });

    // Assinante novo monta: liga a fonte de novo (geração 1) e dispara o
    // fetch B, que também fica em voo.
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

    // O fetch A (geração morta) resolve agora, com o fetch B ainda em voo.
    // Sem a correção, o `finally` da sonda A libera o mutex que pertence à
    // sonda B.
    await act(async () => {
      resolveFetchA({ status: 200 } as Response);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Um gatilho novo chega (evento "online") enquanto B ainda está em voo.
    // Com o mutex vazado, ele passaria pela guarda e dispararia uma
    // TERCEIRA sonda concorrente com B — duas consultas simultâneas ao
    // banco para a MESMA geração viva, a invariante que este commit existe
    // para proteger.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Limpeza: libera as Promises pendentes de B (e C, se a mutação a
    // criou) para não deixar rastro entre testes.
    await act(async () => {
      resolveFetchB({ status: 200 } as Response);
      resolveFetchC?.({ status: 200 } as Response);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  // ── RESSALVA 1 do laudo Opus (cobertura zero do mecanismo de `generation`) ──
  //
  // O revisor apagou o mecanismo de geração de três formas e a suíte antiga
  // ficou verde nas três. Os três testes abaixo fecham essa lacuna — cada um
  // morre contra a mutação correspondente (provado no relatório da tarefa).

  it("[R1-a] start() recomputa o instantâneo ao religar: offline guardado do módulo não vaza para a próxima sessão de assinantes", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function Sonda() {
      const offline = useOnlineStatus();
      return <span data-testid="offline">{String(offline)}</span>;
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
    expect(textoDaSonda("offline")).toBe("false");

    // Evento "offline" marca offline sem rede — o estado fica guardado no
    // MÓDULO (não no componente).
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(textoDaSonda("offline")).toBe("true");

    // Último assinante desmonta com o módulo em "offline: true" guardado.
    await act(async () => {
      raiz.unmount();
    });

    // Nesta segunda sessão o fetch fica deliberadamente EM VOO — a Promise
    // nunca resolve durante o teste. Assim a asserção abaixo só pode
    // refletir o que `start()` fez de SÍNCRONO ao religar (o recompute);
    // sem essa trava, um fetch que resolvesse "false" mascararia a mutação
    // ao chegar na mesma resposta por um caminho diferente.
    const fetchMockNuncaResolve = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMockNuncaResolve);

    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(textoDaSonda("offline")).toBe("false");
  });

  it("[R1-b] fetch de uma geração já morta resolve depois e não publica por cima da geração viva", async () => {
    const { useConnectionDiagnostics } = await importarHookLimpo();

    function Sonda() {
      const diag = useConnectionDiagnostics();
      return <span data-testid="diag">{JSON.stringify(diag)}</span>;
    }

    vi.useFakeTimers();

    let resolveFetchA!: (value: Response) => void;
    let resolveFetchB!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetchA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetchB = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);

    // Sonda A monta sozinha: dispara o fetch A, que fica em voo.
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 400ms se passam com o fetch A ainda em voo (dá à latência de A um
    // valor bem distinto do instantâneo inicial, para o teste conseguir
    // observar se A publicou por cima).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    // Último assinante desmonta: `stop()` roda, a geração vira 1. O fetch A
    // (geração 0) segue em voo — é a "geração morta" da sequência do laudo.
    await act(async () => {
      raiz.unmount();
    });

    // Assinante novo monta: liga a fonte de novo (geração 1) e dispara o
    // fetch B.
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const antes = textoDaSonda("diag");
    expect(JSON.parse(antes)).toEqual({
      isOffline: false,
      latency: 0,
      quality: "excellent",
    });

    // O fetch A (geração morta) resolve agora, 400ms depois de ter
    // começado — se publicasse, a latência dele (~400ms) marcaria "slow".
    // Uma geração morta não pode publicar por cima do instantâneo da
    // geração viva, que ainda está esperando o fetch B.
    await act(async () => {
      resolveFetchA({ status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(textoDaSonda("diag")).toBe(antes);

    // O fetch B (geração viva) resolve — só ele pode publicar.
    await act(async () => {
      resolveFetchB({ status: 200 } as Response);
      await vi.advanceTimersByTimeAsync(0);
    });

    const depois = JSON.parse(textoDaSonda("diag"));
    expect(depois.isOffline).toBe(false);

    vi.useRealTimers();
  });

  it("[R1-c] retryTimeoutId pendente de uma re-sonda 502 não dispara depois de stop()", async () => {
    const { useOnlineStatus } = await importarHookLimpo();

    function Sonda() {
      const offline = useOnlineStatus();
      return <span data-testid="offline">{String(offline)}</span>;
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 502 } as Response) // dispara a re-sonda em 1500ms
      .mockResolvedValue({ status: 200 } as Response); // não deveria ser chamado neste teste
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // O 502 isolado agendou a re-sonda em 1500ms via `retryTimeoutId` —
    // ainda não disparou. Último (e único) assinante desmonta agora.
    await act(async () => {
      raiz.unmount();
    });

    // Passam os 1500ms inteiros DEPOIS da desmontagem: se `stop()` não
    // tivesse limpado o `retryTimeoutId` pendente, a re-sonda dispararia
    // mesmo sem assinante nenhum.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
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
