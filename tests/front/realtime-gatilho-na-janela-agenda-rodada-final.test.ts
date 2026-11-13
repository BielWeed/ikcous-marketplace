// @vitest-environment jsdom
//
// O GATILHO ADIADO NÃO PODE SE PERDER — irmão de
// tests/front/realtime-volta-a-aba-uma-rodada-so.test.ts (realtimeSyncEngine-317).
//
// O DEFEITO: os gatilhos `online` e `visibilitychange` têm uma janela mínima de
// 60s entre rodadas de catchUp. Dentro da janela o gatilho só devolvia, com o
// comentário "o catchUp do fim da janela cobre o resto" -- mas esse catchUp do
// fim da janela NUNCA existiu. Cenário real: uma rodada falha por oscilação de
// rede, o sinal volta em menos de um minuto, o evento `online` cai na janela e é
// ignorado; se o canal realtime não reconecta, nada mais atualiza o catálogo
// guardado (preço e estoque ficam velhos mesmo depois da internet voltar).
//
// O CONSERTO: gatilho dentro da janela agenda UMA rodada final para o fim dela
// (um só timer, nunca empilhado), cancelada pelo stop, e que não roda com a aba
// escondida. Fora da janela nada muda.
//
// O QUE ESTA SUÍTE TRAVA:
//   1. `online` dentro da janela -> uma rodada extra no fim da janela.
//   2. Cinco gatilhos dentro da janela -> UMA rodada extra, não cinco.
//   3. Aba escondida no fim da janela -> não roda; a volta seguinte roda.
//   4. `stop` cancela o timer pendente (nenhuma rodada depois dele).
//   5. Gatilho fora da janela roda na hora e não deixa timer.
//   6. A rodada final reabre a janela (gatilho logo depois não roda na hora).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
      consulta.then = (
        onOk: (v: { data: null; error: null }) => unknown,
        onErro: (e: unknown) => unknown,
      ) => Promise.resolve({ data: null, error: null }).then(onOk, onErro);
      return consulta;
    }),
    channel: vi.fn(() => {
      const canal: any = { on: vi.fn(() => canal), subscribe: vi.fn() };
      return canal;
    }),
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

function defineVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

function disparaVisibilidade(estado: "visible" | "hidden") {
  defineVisibilidade(estado);
  document.dispatchEvent(new Event("visibilitychange"));
}

function disparaOnline() {
  window.dispatchEvent(new Event("online"));
}

async function subirMotor() {
  vi.resetModules();
  const { RealtimeSyncEngine: engine } = await import(
    "@/lib/realtimeSyncEngine"
  );
  const espiao = vi.spyOn(engine, "catchUp").mockResolvedValue(undefined);
  const parar = engine.start(dubleDeCofreVazio() as any, true, true);
  return { espiao, parar };
}

describe("gatilho dentro da janela agenda a rodada final (realtimeSyncEngine-317)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalFalso);
    defineVisibilidade("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("`online` dentro da janela vira UMA rodada extra no fim da janela", async () => {
    const { espiao, parar } = await subirMotor();

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);

    // A rodada falhou, a rede volta 10s depois: cai na janela e é adiado.
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(1);

    // Falta 1ms para o fim da janela: ainda nada.
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS - 10_000 - 1);
    expect(espiao).toHaveBeenCalledTimes(1);

    // Fim da janela: a rodada que o comentário sempre prometeu.
    await vi.advanceTimersByTimeAsync(1);
    expect(espiao).toHaveBeenCalledTimes(2);

    // E é UMA só: o relógio andando mais não gera outra.
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS * 3);
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
    espiao.mockRestore();
  });

  it("cinco gatilhos dentro da janela custam UMA rodada extra, não cinco", async () => {
    const { espiao, parar } = await subirMotor();

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      if (i % 2 === 0) disparaOnline();
      else disparaVisibilidade("visible");
    }
    expect(espiao).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
    espiao.mockRestore();
  });

  it("aba escondida no fim da janela: não roda; a próxima volta roda na hora", async () => {
    const { espiao, parar } = await subirMotor();

    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(1);

    // O app foi para o fundo antes do fim da janela.
    disparaVisibilidade("hidden");
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    expect(espiao).toHaveBeenCalledTimes(1);

    // Quem cuida do resto é o visibilitychange seguinte: janela já passou.
    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
    espiao.mockRestore();
  });

  it("o stop cancela o timer pendente: nenhuma rodada depois dele", async () => {
    const { espiao, parar } = await subirMotor();

    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    parar();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS * 2);
    expect(espiao).toHaveBeenCalledTimes(1);

    espiao.mockRestore();
  });

  it("gatilho fora da janela roda na hora e não deixa timer", async () => {
    const { espiao, parar } = await subirMotor();
    const timersAntes = vi.getTimerCount();

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(timersAntes);

    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS + 1_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(timersAntes);

    // Sem rodada fantasma depois.
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS * 3);
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
    espiao.mockRestore();
  });

  it("a rodada final reabre a janela: gatilho logo depois é adiado de novo", async () => {
    const { espiao, parar } = await subirMotor();

    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline();
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS - 10_000);
    expect(espiao).toHaveBeenCalledTimes(2);

    // 5s depois da rodada final: dentro da janela nova, não roda na hora...
    await vi.advanceTimersByTimeAsync(5_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(2);

    // ...e vira uma rodada no fim dela.
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    expect(espiao).toHaveBeenCalledTimes(3);

    parar();
    espiao.mockRestore();
  });
});
