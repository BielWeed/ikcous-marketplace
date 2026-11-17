// @vitest-environment jsdom
//
// VISITANTE SEM LOGIN NÃO ABRE CANAL DE TEMPO REAL (preparação da Black Friday
// de 27/11/2026).
//
// O PROBLEMA: o plano do Supabase tem teto de conexões de tempo real
// simultâneas (Free = 200, Pro = 500) e toda visita à vitrine, mesmo sem
// login, abria o canal "datavault-sync" (produtos, categorias, banners,
// configuração). Passando do teto, o painel do lojista pode ficar sem vaga e
// deixar de ver o pedido novo.
//
// A REGRA: tempo real só para o painel e para a cliente logada. Visitante sem
// login atualiza ao VOLTAR À ABA, com intervalo mínimo entre rodadas.
//
// O QUE ESTA SUÍTE TRAVA (motor da vitrine, src/lib/realtimeSyncEngine.ts):
//   (a) sem sessão nenhum `channel()` é criado;
//   (b) com sessão o canal nasce como antes (e `start` sem o 4o argumento
//       continua abrindo o canal: nada que já funcionava muda);
//   (c) sem sessão, voltar à aba refaz a busca (catchUp), mas não duas vezes
//       dentro da janela mínima;
//   (d) sem sessão a primeira rodada de reconciliação acontece na subida (era
//       o SUBSCRIBED do canal que a disparava);
//   (e) borda: um segundo `start` com o primeiro ainda de pé é barrado (sem
//       canal não havia mais `_channel` para o guarda enxergar), e `parar()`
//       solta os ouvintes de aba.
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

const canaisCriados: string[] = [];

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
    channel: vi.fn((nome: string) => {
      canaisCriados.push(nome);
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

function disparaVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function carregarMotor() {
  vi.resetModules();
  const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
  const espiao = vi
    .spyOn(RealtimeSyncEngine, "catchUp")
    .mockResolvedValue(undefined);
  return { engine: RealtimeSyncEngine, espiao };
}

describe("motor da vitrine — visitante sem login não abre canal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    canaisCriados.length = 0;
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalFalso);
    disparaVisibilidade("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("(a) sem sessão nenhum channel() é criado", async () => {
    const { engine, espiao } = await carregarMotor();
    const parar = engine.start(dubleDeCofreVazio() as any, true, false, false);

    expect(canaisCriados).toEqual([]);

    parar();
    espiao.mockRestore();
  });

  it("(b) com sessão o canal é criado como antes", async () => {
    const { engine, espiao } = await carregarMotor();
    const parar = engine.start(dubleDeCofreVazio() as any, true, false, true);

    expect(canaisCriados).toEqual(["datavault-sync"]);

    parar();
    espiao.mockRestore();
  });

  it("(b) sem o 4o argumento (chamada antiga) o canal continua abrindo", async () => {
    const { engine, espiao } = await carregarMotor();
    const parar = engine.start(dubleDeCofreVazio() as any, true, true);

    parar();
    espiao.mockRestore();
  });

  it("(d) sem sessão a primeira rodada de reconciliação roda na subida", async () => {
    const { engine, espiao } = await carregarMotor();
    const parar = engine.start(dubleDeCofreVazio() as any, true, false, false);

    expect(espiao).toHaveBeenCalledTimes(1);

    parar();
    espiao.mockRestore();
  });

  it("(c) sem sessão, voltar à aba refaz a busca, mas não duas vezes dentro da janela", async () => {
    const { engine, espiao } = await carregarMotor();
    const parar = engine.start(dubleDeCofreVazio() as any, true, false, false);
    expect(espiao).toHaveBeenCalledTimes(1); // a da subida

    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(2); // voltou à aba: refez

    // 30s depois, voltou de novo: dentro da janela, não martela o banco.
    await vi.advanceTimersByTimeAsync(30_000);
    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(2);

    // Passada a janela, a volta seguinte refaz.
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    disparaVisibilidade("visible");
    expect(espiao.mock.calls.length).toBeGreaterThanOrEqual(3);

    parar();
    espiao.mockRestore();
  });

  it("(e) um segundo start com o primeiro de pé é barrado, e parar() solta os ouvintes", async () => {
    const { engine, espiao } = await carregarMotor();
    const parar = engine.start(dubleDeCofreVazio() as any, true, false, false);
    const rodadasDaSubida = espiao.mock.calls.length;

    // Sem canal não havia `_channel` para o guarda de "já está rodando" ver:
    // sem barrar, o segundo start empilharia ouvintes de aba e rodada.
    const pararDeNovo = engine.start(
      dubleDeCofreVazio() as any,
      true,
      false,
      false,
    );
    expect(espiao).toHaveBeenCalledTimes(rodadasDaSubida);

    parar();
    pararDeNovo();

    // Depois de parar, voltar à aba não dispara mais nada.
    const antes = espiao.mock.calls.length;
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS + 1_000);
    disparaVisibilidade("visible");
    expect(espiao).toHaveBeenCalledTimes(antes);
    expect(canaisCriados).toEqual([]);

    espiao.mockRestore();
  });
});
