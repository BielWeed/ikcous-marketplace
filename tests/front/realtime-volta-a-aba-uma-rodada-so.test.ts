// @vitest-environment jsdom
//
// UMA RODADA SÓ POR VOLTA À ABA — frente pwa, tarefa realtimeSyncEngine-317
// (docs/superpowers/passagem/2026-09-17-super-atualizacao/frentes/pwa.json).
//
// O DEFEITO: cada volta à aba disparava trabalho de rede em cascata — o motor
// rodava um catchUp completo a CADA evento de visibilitychange sem janela
// mínima nenhuma (o único freio era o mutex `_isCatchingUp`), e o hook de
// liderança RENUNCIAVA após 3s de aba escondida; como o efeito que sobe o
// motor depende de `isLeader`, a renúncia derrubava e reabria o websocket.
// Rotina de balcão: alternar app/WhatsApp cinco vezes em um minuto = cinco
// derrubadas de websocket e cinco catchUps completos, sem nada ter mudado.
//
// O CONSERTO (instrução da tarefa): o gatilho de "voltou à aba" ganha uma
// JANELA MÍNIMA — disparou há menos de 60s, adia (o realtime de verdade não
// passa por aqui; quem muda o dado continua chegando pelo websocket), e o
// hook de liderança NÃO solta/retoma a liderança só por visibilidade: quem
// entrega a vaga de verdade é o beforeunload; quem reclama vaga expirada é o
// heartbeat (TTL).
//
// O QUE ESTA SUÍTE TRAVA:
//   1. Duas voltas à aba em seguida custam UMA rodada de catchUp.
//   2. Passada a janela mínima, a próxima volta volta a rodar (o adiamento
//      não é proibição).
//   3. `online` e `visibilitychange` em sequência custam UMA rodada (mesma
//      janela, dois gatilhos — é a coalescência do reconectador).
//   4. O líder permanece líder com a aba escondida — sem renúncia aos 3s.
//
// localStorage e BroadcastChannel são dublês Map/no-op (vi.stubGlobal) — o
// localStorage experimental do Node 25 substitui o do jsdom sem clear/
// removeItem, então nenhum teste novo da casa depende do de verdade.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em lider-nao-duplica-quando-abas-seguidoras-correm-pela-vaga.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JANELA_MINIMA_MS = 60_000;

function dubleDeCofreVazio() {
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async () => []),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async () => {}),
    deleteById: vi.fn(),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(),
    getByIndex: vi.fn(async () => []),
  };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const consulta: any = {};
      consulta.is = vi.fn(() => consulta);
      consulta.in = vi.fn(() => consulta);
      consulta.order = vi.fn(() => consulta);
      consulta.eq = vi.fn(() => consulta);
      consulta.limit = vi.fn(() => consulta);
      consulta.single = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      consulta.select = vi.fn(() => consulta);
      consulta.then = (
        onOk: (v: { data: null; error: null }) => unknown,
        onErro: (e: unknown) => unknown,
      ) => Promise.resolve({ data: null, error: null }).then(onOk, onErro);
      return consulta;
    }),
    channel: vi.fn(() => {
      // start() chama .on() num LAÇO (uma inscrição por tabela monitorada):
      // o .on tem que devolver o próprio canal, senão a segunda iteração
      // esbarra em "channel.on is not a function".
      const canal: any = { on: vi.fn(() => canal), subscribe: vi.fn() };
      return canal;
    }),
    // stop() chama removeChannel(_channel).catch(...) — devolva promessa.
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

class CanalFalso {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
}

function storageFalso() {
  const memoria = new Map<string, string>();
  return {
    getItem: (chave: string) => memoria.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void memoria.set(chave, valor),
    removeItem: (chave: string) => void memoria.delete(chave),
    clear: () => void memoria.clear(),
  };
}

function disparaVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("voltar à aba custa UMA rodada (realtimeSyncEngine-317)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalFalso);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("duas voltas à aba em menos de um minuto custam uma rodada de catchUp", async () => {
    vi.resetModules();
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const espiao = vi
      .spyOn(engine, "catchUp")
      .mockResolvedValue(undefined);
    const parar = engine.start(dubleDeCofreVazio() as any, true, true);

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);

    // Segunda volta à aba 30s depois: dentro da janela, adia.
    await vi.advanceTimersByTimeAsync(30_000);
    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);

    parar();
    espiao.mockRestore();
  });

  it("passada a janela mínima, a próxima volta à aba volta a rodar", async () => {
    vi.resetModules();
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const espiao = vi.spyOn(engine, "catchUp").mockResolvedValue(undefined);
    const parar = engine.start(dubleDeCofreVazio() as any, true, true);

    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS + 1_000);
    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
    espiao.mockRestore();
  });

  it("`online` logo depois de `visible` não abre segunda rodada", async () => {
    vi.resetModules();
    const { RealtimeSyncEngine: engine } = await import(
      "@/lib/realtimeSyncEngine"
    );
    const espiao = vi.spyOn(engine, "catchUp").mockResolvedValue(undefined);
    const parar = engine.start(dubleDeCofreVazio() as any, true, true);

    disparaVisibilidade("visible");
    window.dispatchEvent(new Event("online"));
    expect(espiao).toHaveBeenCalledTimes(1);

    parar();
    espiao.mockRestore();
  });
});

describe("a liderança não solta com a aba escondida (realtimeSyncEngine-317)", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalFalso);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("líder segue líder após 4s de aba escondida (sem a renúncia dos 3s)", async () => {
    vi.resetModules();
    const { useLeaderElection } = await import("@/hooks/useLeaderElection");
    const React = (await import("react")).default;
    // PUSH em array de fora (mutação por método), e não reatribuição de
    // variável no render: a regra react-hooks/globals reprova reatribuição
    // (erro novo estoura o teto) — mesmo molde do teste irmão
    // lider-nao-duplica-quando-abas-seguidoras-correm-pela-vaga.test.tsx.
    const estados: boolean[] = [];
    function Sonda() {
      const { isLeader } = useLeaderElection();
      estados.push(isLeader);
      return null;
    }

    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    root = createRoot(alvo);
    await act(async () => {
      root?.render(React.createElement(Sonda));
    });

    // Eleição: 120ms de espera por LEADER_ALIVE + janela do sorteio + folga.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(estados.at(-1)).toBe(true);

    // O cenário que derrubava o websocket: aba escondida além dos 3s da
    // renúncia. A liderança tem que atravessar.
    disparaVisibilidade("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(estados.at(-1)).toBe(true);
  });
});
