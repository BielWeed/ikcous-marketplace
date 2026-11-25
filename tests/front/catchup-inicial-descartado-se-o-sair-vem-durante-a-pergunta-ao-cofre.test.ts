// @vitest-environment jsdom
//
// A rodada inicial do `catchUp` (aparelho sem canal de catálogo) pergunta ao
// cofre "quando sincronizei os produtos pela última vez?" ANTES de decidir se
// lê o servidor. Se o "Sair" (ou a parada do motor) chega DURANTE essa
// pergunta, a rodada é de uma sessão que acabou: não pode seguir adiante e
// consultar o servidor com a conta nova ou sem conta — mesmo que o carimbo
// respondido seja antigo (o que, sem a conferência, mandaria ler tudo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabelasConsultadas = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/supabase", () => {
  const builder = (): any => {
    const consulta: any = {};
    for (const metodo of ["is", "in", "order", "limit", "eq", "gt", "select"]) {
      // eslint-disable-next-line security/detect-object-injection -- chave de um mapa fixo do próprio teste
      consulta[metodo] = vi.fn(() => consulta);
    }
    consulta.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
    consulta.then = (
      onOk: (v: { data: unknown[]; error: null }) => unknown,
      onErro: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(onOk, onErro);
    return consulta;
  };
  return {
    supabase: {
      from: vi.fn((tabela: string) => {
        tabelasConsultadas.push(tabela);
        return builder();
      }),
      channel: vi.fn(() => {
        const c: any = { on: vi.fn(() => c), subscribe: vi.fn() };
        return c;
      }),
      removeChannel: vi.fn(() => Promise.resolve()),
    },
  };
});

function dubleDeCofre(getLastSync: (loja: string) => Promise<number>) {
  return {
    isClosed: () => false,
    getAllOrThrow: vi.fn(async () => [] as unknown[]),
    getById: vi.fn(),
    put: vi.fn(),
    putMany: vi.fn(async () => {}),
    deleteById: vi.fn(async () => {}),
    setLastSync: vi.fn(),
    replaceAll: vi.fn(async () => {}),
    getByIndex: vi.fn(async () => [] as unknown[]),
    getLastSync: vi.fn(getLastSync),
  };
}

async function carregar() {
  vi.resetModules();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
  const { invalidarGravacoesEmVoo } = await import("@/lib/geracao-do-cofre");
  return { engine: RealtimeSyncEngine, invalidarGravacoesEmVoo };
}

const soltar = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rodada inicial — o Sair durante a pergunta ao cofre", () => {
  beforeEach(() => {
    tabelasConsultadas.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o carimbo volta ANTIGO depois do Sair: a rodada é descartada e nada é lido do servidor", async () => {
    const { engine, invalidarGravacoesEmVoo } = await carregar();
    // A pergunta é feita para duas gavetas (produtos e configuração).
    const respostas: Array<(carimbo: number) => void> = [];
    const vault = dubleDeCofre(
      () =>
        new Promise<number>((resolve) => {
          respostas.push(resolve);
        }),
    );

    const rodada = engine.catchUp(vault as any, false, { rodadaInicial: true });
    await soltar();
    expect(vault.getLastSync).toHaveBeenCalled();

    // O "Sair" esquece o cofre enquanto a pergunta está no ar.
    invalidarGravacoesEmVoo();
    // Carimbo 0 = nunca sincronizado: sem a conferência, mandaria ler tudo.
    for (const responder of respostas) responder(0);
    await rodada;

    expect(tabelasConsultadas).toEqual([]);
    expect(vault.replaceAll).not.toHaveBeenCalled();
    expect(vault.putMany).not.toHaveBeenCalled();
  });

  it("controle: sem o Sair no meio, o MESMO carimbo antigo manda ler o servidor", async () => {
    const { engine } = await carregar();
    const vault = dubleDeCofre(async () => 0);

    await engine.catchUp(vault as any, false, { rodadaInicial: true });

    expect(tabelasConsultadas.length).toBeGreaterThan(0);
  });
});
