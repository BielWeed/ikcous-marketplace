// @vitest-environment jsdom
//
// Bordas do gatilho com janela mínima de 60 s (realtimeSyncEngine-317) que os
// testes vizinhos (`realtime-gatilho-na-janela-agenda-rodada-final.test.ts`,
// `aba-secundaria-do-visitante-atualiza-ao-voltar-pela-lider.test.ts`) deixam
// sem prova:
//  - o limite da janela é EXATO: faltando 1 ms ainda adia; no ms do fim já roda
//    na hora (sem timer de 0 ms);
//  - gatilho que chega depois do fim da janela, ANTES de o timer de uma rodada
//    adiada disparar (timer atrasado, aba em segundo plano): roda na hora e
//    cancela o timer — senão sairiam DUAS rodadas;
//  - o "pedido de aba irmã" (a secundária olhando a tela pede a rodada, e a
//    líder escondida deve atender mesmo assim) vale UMA vez: depois que a
//    rodada final roda, ou que o gatilho roda na hora, o pedido está atendido e
//    a próxima rodada adiada, com a líder escondida, volta a não rodar;
//  - uma segunda subida da líder sem canal de catálogo avisa "já está rodando",
//    não repete a rodada inicial e não empilha ouvintes.
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
      Object.assign(
        consulta,
        Object.fromEntries(
          ["is", "in", "order", "eq", "limit", "gt", "select"].map((metodo) => [
            metodo,
            vi.fn(() => consulta),
          ]),
        ),
      );
      consulta.single = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
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

// Canal de abas que guarda quem escuta, para o teste "ser" a aba irmã.
const ouvintesDoCanal = new Set<(evento: MessageEvent) => void>();
class CanalCapturador {
  addEventListener(tipo: string, ouvinte: (evento: MessageEvent) => void) {
    if (tipo === "message") ouvintesDoCanal.add(ouvinte);
  }
  removeEventListener(tipo: string, ouvinte: (evento: MessageEvent) => void) {
    if (tipo === "message") ouvintesDoCanal.delete(ouvinte);
  }
  postMessage() {}
  close() {}
}

function pedirRodadaComoAbaIrma() {
  for (const ouvinte of [...ouvintesDoCanal]) {
    ouvinte({ data: { type: "pede_rodada" } } as MessageEvent);
  }
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

/** Líder: com canal de catálogo (lojista) ou sem (visitante/cliente). */
async function subirMotor({ comCanal }: { comCanal: boolean }) {
  vi.resetModules();
  const { RealtimeSyncEngine: engine } = await import(
    "@/lib/realtimeSyncEngine"
  );
  const espiao = vi.spyOn(engine, "catchUp").mockResolvedValue(undefined);
  const parar = engine.start(
    dubleDeCofreVazio() as any,
    true,
    comCanal,
    comCanal,
  );
  return { engine, espiao, parar };
}

describe("gatilho com janela de 60 s — bordas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ouvintesDoCanal.clear();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalCapturador);
    defineVisibilidade("visible");
    // O motor narra tudo no console; aqui só interessa o que o teste confere.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("faltando 1 ms para o fim da janela o gatilho ainda é adiado; no ms do fim roda na hora", async () => {
    const { espiao, parar } = await subirMotor({ comCanal: true });

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS - 1);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // A rodada adiada sai exatamente no fim da janela.
    await vi.advanceTimersByTimeAsync(1);
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
  });

  it("exatamente 60 s depois da última rodada: o gatilho roda NA HORA, sem timer", async () => {
    const { espiao, parar } = await subirMotor({ comCanal: true });

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(1);
    const timersAntes = vi.getTimerCount();

    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    disparaOnline();

    expect(espiao).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(timersAntes);

    parar();
  });

  it("gatilho depois do fim da janela com o timer ainda pendente (timer atrasado): roda na hora e cancela o timer, sem rodada dupla", async () => {
    const { espiao, parar } = await subirMotor({ comCanal: true });

    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline(); // adiado: timer para o fim da janela
    expect(espiao).toHaveBeenCalledTimes(1);

    // O relógio do aparelho anda além do fim da janela sem o timer disparar
    // (aba em segundo plano com timers estrangulados).
    vi.setSystemTime(Date.now() + JANELA_MINIMA_MS + 1_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS * 3);
    expect(espiao).toHaveBeenCalledTimes(2);

    parar();
  });
});

describe("pedido de aba irmã — vale uma vez", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ouvintesDoCanal.clear();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalCapturador);
    defineVisibilidade("visible");
    // O motor narra tudo no console; aqui só interessa o que o teste confere.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Líder sem canal de catálogo, com a primeira rodada de gatilho já feita. */
  async function liderComRodadaFeita() {
    const motor = await subirMotor({ comCanal: false });
    // A subida chama a rodada inicial uma vez.
    expect(motor.espiao).toHaveBeenCalledTimes(1);
    disparaVisibilidade("visible");
    expect(motor.espiao).toHaveBeenCalledTimes(2);
    expect(ouvintesDoCanal.size).toBe(1);
    return motor;
  }

  it("a líder ESCONDIDA atende o pedido da irmã no fim da janela, e só aquele: a próxima rodada adiada, com a líder escondida, não roda", async () => {
    const { espiao, parar } = await liderComRodadaFeita();

    await vi.advanceTimersByTimeAsync(10_000);
    pedirRodadaComoAbaIrma();
    disparaVisibilidade("hidden");
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    // Atendido mesmo com a líder escondida.
    expect(espiao).toHaveBeenCalledTimes(3);

    // O pedido foi atendido: um gatilho comum agora, com a aba ainda escondida,
    // é adiado e, no fim da janela, NÃO roda.
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline();
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    expect(espiao).toHaveBeenCalledTimes(3);

    parar();
  });

  it("pedido de irmã seguido de gatilho que roda NA HORA: o pedido foi atendido junto, e o próximo adiado escondido não roda", async () => {
    const { espiao, parar } = await liderComRodadaFeita();

    await vi.advanceTimersByTimeAsync(10_000);
    pedirRodadaComoAbaIrma();
    expect(espiao).toHaveBeenCalledTimes(2);

    // O relógio passa do fim da janela sem o timer disparar: o gatilho seguinte
    // roda na hora (e leva o pedido junto).
    vi.setSystemTime(Date.now() + JANELA_MINIMA_MS + 1_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(3);

    disparaVisibilidade("hidden");
    await vi.advanceTimersByTimeAsync(10_000);
    disparaOnline();
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS * 2);
    expect(espiao).toHaveBeenCalledTimes(3);

    parar();
  });
});

describe("segunda subida da líder sem canal de catálogo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ouvintesDoCanal.clear();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalCapturador);
    defineVisibilidade("visible");
    // O motor narra tudo no console; aqui só interessa o que o teste confere.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("avisa 'já está rodando', não repete a rodada inicial e não empilha ouvintes", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, espiao, parar } = await subirMotor({ comCanal: false });
    expect(espiao).toHaveBeenCalledTimes(1);
    const ouvintesAntes = ouvintesDoCanal.size;

    const pararDeNovo = engine.start(
      dubleDeCofreVazio() as any,
      true,
      false,
      false,
    );

    expect(aviso).toHaveBeenCalledWith(
      "[RealtimeSyncEngine] Already running. Call stop() first.",
    );
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(ouvintesDoCanal.size).toBe(ouvintesAntes);

    // Um gatilho depois: UMA rodada, não duas.
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS + 1_000);
    disparaOnline();
    expect(espiao).toHaveBeenCalledTimes(2);

    pararDeNovo();
    parar();
  });
});
