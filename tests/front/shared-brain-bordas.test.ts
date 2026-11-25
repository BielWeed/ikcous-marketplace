/**
 * O `shared-brain` (src/shared-brain.ts) é um SharedWorker: uma só "central"
 * para todas as abas, que conta quantas se conectaram e repassa o recado de
 * uma aba às OUTRAS. Nenhum teste o abria: aqui ele é carregado com um `self`
 * falso e cada aba é uma porta falsa.
 *
 * Mutantes equivalentes (sem teste possível, anotados de propósito): os
 * `console.log` de diagnóstico, que são só texto; e `event.ports[0]` por
 * `event.ports[event.ports.length - 1]` — o `connect` de um SharedWorker traz
 * sempre UMA porta, então o primeiro e o último índice são o mesmo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mensagem = { type: string; payload?: unknown };
type Porta = {
  onmessage?: (e: { data: Mensagem }) => void;
  postMessage: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
};
let central: { onconnect?: (e: { ports: Porta[] }) => void };

function novaAba(): Porta {
  const porta: Porta = { postMessage: vi.fn(), start: vi.fn() };
  central.onconnect?.({ ports: [porta] });
  return porta;
}

function dizer(porta: Porta, type: string, payload?: unknown) {
  porta.onmessage?.({ data: { type, payload } });
}

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
  central = {};
  vi.stubGlobal("self", central);
  await import("@/shared-brain");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared-brain — conexão das abas", () => {
  it("cada aba que conecta é ligada (start) e passa a ser ouvida", () => {
    const a = novaAba();
    expect(a.start).toHaveBeenCalledTimes(1);
    expect(typeof a.onmessage).toBe("function");
  });

  it("a central conta as abas: SYNC_STATE devolve quantas há, só para quem perguntou", () => {
    const a = novaAba();
    const b = novaAba();
    novaAba();
    dizer(a, "SYNC_STATE");
    expect(a.postMessage).toHaveBeenCalledTimes(1);
    const resposta = a.postMessage.mock.calls[0][0];
    expect(resposta.type).toBe("STATE_SYNCED");
    expect(resposta.payload.instances).toBe(3);
    expect(typeof resposta.payload.lastUpdate).toBe("number");
    expect(b.postMessage).not.toHaveBeenCalled();
  });

  it("a primeira aba vê 1 antes de qualquer outra chegar", () => {
    const a = novaAba();
    dizer(a, "SYNC_STATE");
    expect(a.postMessage.mock.calls[0][0].payload.instances).toBe(1);
  });
});

describe("shared-brain — recado entre abas", () => {
  it("BROADCAST chega a todas as OUTRAS abas e NÃO volta para quem mandou", () => {
    const a = novaAba();
    const b = novaAba();
    const c = novaAba();
    dizer(b, "BROADCAST", { carrinho: "mudou" });
    const sinal = { type: "EXTERNAL_SIGNAL", payload: { carrinho: "mudou" } };
    expect(a.postMessage).toHaveBeenCalledWith(sinal);
    expect(c.postMessage).toHaveBeenCalledWith(sinal);
    expect(a.postMessage).toHaveBeenCalledTimes(1);
    expect(c.postMessage).toHaveBeenCalledTimes(1);
    expect(b.postMessage).not.toHaveBeenCalled();
  });

  it("aba sozinha: BROADCAST não vai para ninguém (nem para ela mesma)", () => {
    const a = novaAba();
    dizer(a, "BROADCAST", 1);
    expect(a.postMessage).not.toHaveBeenCalled();
  });

  it("aba que conecta DEPOIS também recebe os recados seguintes", () => {
    const a = novaAba();
    const b = novaAba();
    dizer(a, "BROADCAST", "oi");
    expect(b.postMessage).toHaveBeenCalledWith({
      type: "EXTERNAL_SIGNAL",
      payload: "oi",
    });
  });

  it("mensagem desconhecida é ignorada: ninguém recebe nada", () => {
    const a = novaAba();
    const b = novaAba();
    dizer(a, "QUALQUER_COISA", 1);
    expect(a.postMessage).not.toHaveBeenCalled();
    expect(b.postMessage).not.toHaveBeenCalled();
  });
});
