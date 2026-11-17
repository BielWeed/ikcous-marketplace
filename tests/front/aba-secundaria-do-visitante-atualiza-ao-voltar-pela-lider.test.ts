// @vitest-environment jsdom
//
// A ABA SECUNDÁRIA DO VISITANTE ATUALIZA O CATÁLOGO AO VOLTAR (achado da
// revisão Opus do commit "visitante sem login não abre canal de tempo real").
//
// O PROBLEMA: sem login a aba LÍDER não tem canal; ela só refaz o catálogo
// (catchUp) quando ELA mesma volta à aba, e só então repassa o resultado às
// secundárias pelo BroadcastChannel. A secundária não tinha ouvinte nenhum:
// visitante com a aba A (líder) na home e a aba B no produto, que sai de B e
// volta minutos depois, via preço, estoque, banner e configuração velhos.
//
// O CONSERTO: a secundária sem sessão não lê o banco; ao voltar à aba (ou ao
// voltar a rede) PEDE a rodada à líder pelo BroadcastChannel. A líder atende
// pela MESMA janela de 60 s e pelo MESMO timer de rodada final dos gatilhos
// dela: várias abas pedindo juntas viram uma leitura, não uma por aba.
//
// COMO ESTA SUÍTE SIMULA "ABAS": cada aba é uma cópia do módulo do motor
// (`vi.resetModules` + import), com o BroadcastChannel falso ligado por um
// barramento comum. O jsdom tem UM `document`, então a líder tem os próprios
// ouvintes de aba/online removidos depois do `start`: o que ela faz nos testes
// vem SÓ do pedido da secundária (uma aba escondida não vê o visibilitychange
// da outra, que é o caso real).
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

// Barramento comum: o que uma aba posta chega às OUTRAS (nunca a ela mesma),
// como no BroadcastChannel de verdade.
type Ouvinte = (evento: MessageEvent) => void;
const abasDoBarramento = new Set<CanalDoBarramento>();
const mensagensPostadas: Array<{ type?: string }> = [];

class CanalDoBarramento {
  private readonly ouvintes = new Set<Ouvinte>();
  readonly nome: string;
  constructor(nome: string) {
    this.nome = nome;
    abasDoBarramento.add(this);
  }
  addEventListener(tipo: string, ouvinte: Ouvinte) {
    if (tipo === "message") this.ouvintes.add(ouvinte);
  }
  removeEventListener(tipo: string, ouvinte: Ouvinte) {
    if (tipo === "message") this.ouvintes.delete(ouvinte);
  }
  postMessage(data: { type?: string }) {
    mensagensPostadas.push(data);
    for (const outra of abasDoBarramento) {
      if (outra === this || outra.nome !== this.nome) continue;
      // Assíncrono como o de verdade; o ouvinte vale o que estiver registrado
      // no momento da entrega.
      void Promise.resolve().then(() => {
        for (const ouvinte of [...outra.ouvintes]) {
          ouvinte({ data } as MessageEvent);
        }
      });
    }
  }
  close() {
    abasDoBarramento.delete(this);
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

async function carregarAba() {
  vi.resetModules();
  const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
  const espiao = vi
    .spyOn(RealtimeSyncEngine, "catchUp")
    .mockResolvedValue(undefined);
  return { engine: RealtimeSyncEngine, espiao };
}

type Aba = Awaited<ReturnType<typeof carregarAba>>;

// Toda aba subida é parada no `afterEach`, mesmo se o teste falhar no meio:
// ouvinte esquecido no `document` faria o teste seguinte falhar por outro.
const paradas: Array<() => void> = [];

/**
 * Sobe a LÍDER e tira dela os ouvintes de `visibilitychange`/`online`: no
 * jsdom há um `document` só, e a líder real está em outra aba (escondida),
 * que não vê o que acontece na aba da secundária.
 */
function subirLider(aba: Aba, comSessao: boolean) {
  const registrados: Array<[EventTarget, string, EventListener]> = [];
  const espiaDoc = vi.spyOn(document, "addEventListener");
  const espiaJanela = vi.spyOn(window, "addEventListener");
  const gravar = (alvo: EventTarget) => (tipo: string, fn: unknown) => {
    if (tipo === "visibilitychange" || tipo === "online") {
      registrados.push([alvo, tipo, fn as EventListener]);
    }
  };
  espiaDoc.mockImplementation(gravar(document));
  espiaJanela.mockImplementation(gravar(window));
  const parar = aba.engine.start(
    dubleDeCofreVazio() as any,
    true,
    false,
    comSessao,
  );
  espiaDoc.mockRestore();
  espiaJanela.mockRestore();
  // Os ouvintes foram só gravados (não chegaram ao document): nada a remover.
  expect(registrados.length).toBeGreaterThan(0);
  paradas.push(parar);
  return parar;
}

function subirSecundaria(
  aba: Aba,
  { comSessao = false, isAdmin = false } = {},
) {
  const parar = aba.engine.start(
    dubleDeCofreVazio() as any,
    false,
    isAdmin,
    comSessao,
  );
  paradas.push(parar);
  return parar;
}

const pedidosDeRodada = () =>
  mensagensPostadas.filter((m) => m.type === "pede_rodada").length;

describe("aba secundária do visitante pede a rodada à líder ao voltar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    canaisCriados.length = 0;
    mensagensPostadas.length = 0;
    abasDoBarramento.clear();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", CanalDoBarramento);
    defineVisibilidade("visible");
  });

  afterEach(() => {
    for (const parar of paradas.splice(0)) parar();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    abasDoBarramento.clear();
  });

  it("(1) secundária sem sessão volta à aba depois de >60 s: a líder roda exatamente 1 catchUp", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria);
    expect(lider.espiao).toHaveBeenCalledTimes(1); // a da subida

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible"); // o visitante voltou à aba B
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(1);
    expect(lider.espiao).toHaveBeenCalledTimes(2); // subida + 1 do pedido
    // A secundária NÃO lê o banco: quem lê é a líder.
    expect(secundaria.espiao).not.toHaveBeenCalled();
    expect(canaisCriados).toEqual([]);

    pararSecundaria();
    pararLider();
  });

  it("(1b) a rede que volta (online) também pede a rodada", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria);

    await vi.advanceTimersByTimeAsync(120_000);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(lider.espiao).toHaveBeenCalledTimes(2);
    expect(secundaria.espiao).not.toHaveBeenCalled();

    pararSecundaria();
    pararLider();
  });

  it("(1c) a aba que ESCONDE não pede nada: só a volta pede", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria);

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("hidden");
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(0);
    expect(lider.espiao).toHaveBeenCalledTimes(1);

    pararSecundaria();
    pararLider();
  });

  it("(2) 3 secundárias voltando juntas: 1 leitura imediata e 1 só rodada final da janela", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundarias = [
      await carregarAba(),
      await carregarAba(),
      await carregarAba(),
    ];
    const pararTodas = secundarias.map((aba) => subirSecundaria(aba));

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible"); // as 3 abas voltam juntas
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(3);
    // Subida + UMA leitura, não uma por aba.
    expect(lider.espiao).toHaveBeenCalledTimes(2);

    // Dentro da janela nada novo; ao fim dela, UMA rodada final (um só timer).
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS - 1_000);
    expect(lider.espiao).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(lider.espiao).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5 * JANELA_MINIMA_MS);
    expect(lider.espiao).toHaveBeenCalledTimes(3);
    for (const secundaria of secundarias) {
      expect(secundaria.espiao).not.toHaveBeenCalled();
    }

    for (const parar of pararTodas) parar();
    pararLider();
  });

  it("(2b) líder em aba ESCONDIDA ainda atende o pedido que caiu na janela", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria);

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(lider.espiao).toHaveBeenCalledTimes(2);

    // 10 s depois o visitante sai e volta a B: cai na janela e fica adiado.
    await vi.advanceTimersByTimeAsync(10_000);
    disparaVisibilidade("hidden");
    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(lider.espiao).toHaveBeenCalledTimes(2);

    // Quando o timer da líder dispara, a aba DELA está escondida (o visitante
    // está em B): quem pediu foi a outra aba, então a rodada roda mesmo assim.
    defineVisibilidade("hidden");
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS);
    expect(lider.espiao).toHaveBeenCalledTimes(3);

    pararSecundaria();
    pararLider();
  });

  it("(3) stop() da secundária solta os ouvintes: depois dele ninguém pede", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria);
    pararSecundaria();

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(0);
    expect(lider.espiao).toHaveBeenCalledTimes(1);

    pararLider();
  });

  it("(3b) stop() da líder solta o atendimento: pedido que chega depois é ignorado", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria);
    pararLider();

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS + 1_000);

    expect(lider.espiao).toHaveBeenCalledTimes(1); // só a da subida

    pararSecundaria();
  });

  it("(3c) start, stop e start de novo não empilham ouvintes: 1 pedido, 1 leitura", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    subirSecundaria(secundaria)();
    const pararSecundaria = subirSecundaria(secundaria);

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(1);
    expect(lider.espiao).toHaveBeenCalledTimes(2);

    pararSecundaria();
    pararLider();
  });

  it("(4) com sessão a secundária NÃO pede nada (a líder tem canal e repassa ao vivo)", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria, { comSessao: true });

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(0);
    expect(lider.espiao).toHaveBeenCalledTimes(1);

    pararSecundaria();
    pararLider();
  });

  it("(4b) painel (admin com sessão) também não pede", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, false);
    const secundaria = await carregarAba();
    const pararSecundaria = subirSecundaria(secundaria, {
      comSessao: true,
      isAdmin: true,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(0);

    expect(pedidosDeRodada()).toBe(0);
    expect(lider.espiao).toHaveBeenCalledTimes(1);

    pararSecundaria();
    pararLider();
  });

  it("(4c) líder COM sessão (tem canal) não atende pedido nenhum", async () => {
    const lider = await carregarAba();
    const pararLider = subirLider(lider, true);
    expect(canaisCriados).toEqual(["datavault-sync"]);
    const intrusa = await carregarAba();
    const pararIntrusa = subirSecundaria(intrusa); // sem sessão, pede

    await vi.advanceTimersByTimeAsync(120_000);
    disparaVisibilidade("visible");
    await vi.advanceTimersByTimeAsync(JANELA_MINIMA_MS + 1_000);

    expect(pedidosDeRodada()).toBe(1);
    // O canal abriu com SUBSCRIBED (dublê não o dispara): nenhuma rodada saiu.
    expect(lider.espiao).not.toHaveBeenCalled();

    pararIntrusa();
    pararLider();
  });

  it("(5) sem BroadcastChannel a secundária não registra ouvinte nenhum (comportamento antigo)", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", storageFalso());
    vi.stubGlobal("BroadcastChannel", undefined);
    const espiaDoc = vi.spyOn(document, "addEventListener");
    const espiaJanela = vi.spyOn(window, "addEventListener");
    const secundaria = await carregarAba();

    const parar = subirSecundaria(secundaria);

    const tipos = [
      ...espiaDoc.mock.calls.map((c) => c[0]),
      ...espiaJanela.mock.calls.map((c) => c[0]),
    ];
    expect(tipos).not.toContain("visibilitychange");
    expect(tipos).not.toContain("online");
    disparaVisibilidade("visible");
    expect(mensagensPostadas).toEqual([]);

    parar();
    espiaDoc.mockRestore();
    espiaJanela.mockRestore();
  });
});
