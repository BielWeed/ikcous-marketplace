// @vitest-environment jsdom
/**
 * Bordas do `initSentinel` (src/pwa-sentinel.ts): o relógio de 30 s que decide
 * entre "mandar o ping", "não fazer nada" e "recuperar o pulso perdido".
 *
 * Os testes vizinhos provam só o primeiro ping e a recuperação em si; aqui se
 * prova QUANDO ela dispara e, principalmente, quando NÃO pode disparar (aba
 * escondida, aba suspensa, sem service worker no controle, ACK recente) —
 * cada um desses é um motivo de recarregar/desregistrar sem necessidade na
 * cara da cliente.
 *
 * Mutantes equivalentes (sem teste possível, anotados de propósito):
 *  - `lastCheck = now` antes dos `return` da aba oculta/suspensa: o valor é
 *    reatribuído a cada tick, então trocar a ordem não muda nada observável.
 *  - `console.log`/`console.error` de diagnóstico: só texto de log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aposta = vi.hoisted(() => ({
  assumir: vi.fn(async (_opcoes: unknown) => true),
}));

// A recuperação em si já tem testes próprios (recuperacao-chunk-canais-e-
// sentinela, vetos-de-atualizacao). Aqui ela é só o "alarme" a observar.
vi.mock("@/lib/recuperacao-chunk", () => ({
  assumirServiceWorkerNovoERecarregar: aposta.assumir,
  pedirRecargaSubordinada: () => true,
}));
vi.mock("@/lib/atualizacao/veto-de-recarga", () => ({
  momentoSeguroAgora: () => true,
  recarregarSeSeguro: vi.fn(),
}));
vi.mock("@/lib/motivo-de-recarga", () => ({ gravaMotivoDeRecarga: vi.fn() }));

import { initSentinel } from "@/pwa-sentinel";

const T0 = 1_000_000;
const TRINTA_S = 30_000;
const CINCO_MIN = 300_000;

type Mensagem = { data: unknown };
let ouvintesDoSW: Array<(e: Mensagem) => void>;
let canais: Array<{ onmessage: ((e: Mensagem) => void) | null }>;
let postMessage: ReturnType<typeof vi.fn>;
let getRegistrations: ReturnType<typeof vi.fn>;
let visibilidade: "visible" | "hidden";

function instalarServiceWorker(comControle = true) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      addEventListener: (_tipo: string, fn: (e: Mensagem) => void) => {
        ouvintesDoSW.push(fn);
      },
      getRegistrations,
      controller: comControle ? { postMessage } : null,
    },
  });
}

const pings = () =>
  postMessage.mock.calls.filter((c) => c[0] === "HEARTBEAT_PING").length;
const recuperacoes = () => aposta.assumir.mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  aposta.assumir.mockClear();
  ouvintesDoSW = [];
  canais = [];
  postMessage = vi.fn();
  getRegistrations = vi.fn().mockResolvedValue([]);
  visibilidade = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibilidade,
  );
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage: ((e: Mensagem) => void) | null = null;
      constructor() {
        canais.push(this);
      }
      postMessage() {}
      close() {}
    },
  );
  instalarServiceWorker();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("initSentinel — o relógio de 30 s", () => {
  it("manda um ping por tick de 30 s, nem a mais nem a menos", async () => {
    initSentinel();
    await vi.advanceTimersByTimeAsync(TRINTA_S - 1);
    expect(pings()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pings()).toBe(1);
    await vi.advanceTimersByTimeAsync(TRINTA_S * 2);
    expect(pings()).toBe(3);
    expect(recuperacoes()).toBe(0);
  });

  it("sem service worker no navegador não lança e não agenda relógio nenhum", () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    expect(() => initSentinel()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("initSentinel — pulso perdido só depois de MAIS de 5 minutos", () => {
  it("em exatos 5 min ainda só pinga; no tick seguinte (5,5 min) recupera", async () => {
    initSentinel();
    await vi.advanceTimersByTimeAsync(CINCO_MIN);
    expect(pings()).toBe(10);
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(recuperacoes()).toBe(0);

    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(recuperacoes()).toBe(1);
    expect(aposta.assumir).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: "recuperacao-sentinela" }),
    );
    // Na hora da recuperação NÃO se manda ping (é um ou outro).
    expect(pings()).toBe(10);
  });

  it("o ACK pelo canal entre abas renova a janela de 5 min", async () => {
    initSentinel();
    await vi.advanceTimersByTimeAsync(240_000);
    canais[0].onmessage?.({ data: "HEARTBEAT_ACK" });
    // 240 s + 5 min = 540 s: ainda sem recuperar. 570 s: recupera.
    await vi.advanceTimersByTimeAsync(CINCO_MIN);
    expect(recuperacoes()).toBe(0);
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(recuperacoes()).toBe(1);
  });

  it("o ACK direto do service worker também renova a janela", async () => {
    initSentinel();
    await vi.advanceTimersByTimeAsync(240_000);
    for (const ouvinte of ouvintesDoSW) ouvinte({ data: "HEARTBEAT_ACK" });
    await vi.advanceTimersByTimeAsync(CINCO_MIN);
    expect(recuperacoes()).toBe(0);
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(recuperacoes()).toBe(1);
  });

  it("mensagem que NÃO é o ACK (outro texto, objeto, vazio) não renova nada", async () => {
    initSentinel();
    await vi.advanceTimersByTimeAsync(240_000);
    for (const data of ["HEARTBEAT_PING", "heartbeat_ack", { a: 1 }, null]) {
      canais[0].onmessage?.({ data });
      for (const ouvinte of ouvintesDoSW) ouvinte({ data });
    }
    // Sem renovação, a recuperação vem no tick de 330 s (90 s adiante).
    await vi.advanceTimersByTimeAsync(90_000);
    expect(recuperacoes()).toBe(1);
  });
});

describe("initSentinel — quando o silêncio NÃO é pulso perdido", () => {
  it("aba escondida por muito tempo: não pinga, não recupera, e a janela recomeça ao voltar", async () => {
    visibilidade = "hidden";
    initSentinel();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(pings()).toBe(0);
    expect(recuperacoes()).toBe(0);
    expect(getRegistrations).not.toHaveBeenCalled();

    visibilidade = "visible";
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    // A janela recomeçou no último tick escondido: o primeiro tick visível
    // vê 30 s de silêncio (ping), não 10 min (recuperação).
    expect(pings()).toBe(1);
    expect(recuperacoes()).toBe(0);
  });

  it("aba suspensa (timer atrasado além de 45 s): zera a janela e não pinga", async () => {
    initSentinel();
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(pings()).toBe(1);

    // O celular dormiu 10 min com a aba aberta.
    vi.setSystemTime(Date.now() + 600_000);
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(recuperacoes()).toBe(0);
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(pings()).toBe(1);

    // E a janela recomeçou: o tick seguinte já volta a pingar normalmente.
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(pings()).toBe(2);
  });

  it("atraso de EXATOS 45 s não conta como suspensão (a fronteira é estrita)", async () => {
    initSentinel();
    vi.setSystemTime(Date.now() + 15_000);
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    // 15 s de salto + 30 s de espera = 45 s entre os dois ticks.
    expect(pings()).toBe(1);
  });

  it("atraso de 45,001 s conta como suspensão", async () => {
    initSentinel();
    vi.setSystemTime(Date.now() + 15_001);
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(pings()).toBe(0);
  });

  it("sem service worker no controle da página: nada de ping e nada de recuperação, mesmo após 10 min", async () => {
    instalarServiceWorker(false);
    initSentinel();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(pings()).toBe(0);
    expect(recuperacoes()).toBe(0);
    expect(getRegistrations).not.toHaveBeenCalled();

    // Quando o service worker assume o controle, a janela de 5 min recomeça
    // do último tick sem controle — o primeiro tick só pinga.
    instalarServiceWorker(true);
    await vi.advanceTimersByTimeAsync(TRINTA_S);
    expect(pings()).toBe(1);
    expect(recuperacoes()).toBe(0);
  });

  it("a recuperação passa os registros que o navegador devolveu", async () => {
    const registro = { unregister: vi.fn() };
    getRegistrations.mockResolvedValue([registro]);
    initSentinel();
    await vi.advanceTimersByTimeAsync(CINCO_MIN + TRINTA_S);
    expect(getRegistrations).toHaveBeenCalledTimes(1);
    // Com o worker novo assumindo (mock: true), nada é desregistrado.
    expect(registro.unregister).not.toHaveBeenCalled();
  });
});
