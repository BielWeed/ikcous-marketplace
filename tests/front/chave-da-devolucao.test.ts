// @vitest-environment jsdom
//
// A chave da devolução (src/lib/chave-da-devolucao.ts): a mesma intenção (pedido + valor em centavos) leva a
// mesma chave por até 30 min; outra intenção, chave nova; encerrar só apaga a chave que ainda é a da intenção;
// registro vencido, malformado ou com validade absurda não vale; sem localStorage a chave ainda vale na aba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRAZO_MS = 30 * 60_000;
const PREFIXO = "ikcous-chave-da-devolucao:";

async function carregar() {
  vi.resetModules();
  return import("@/lib/chave-da-devolucao");
}

// Navegador que recusa o storage (cota cheia, modo privado). O espião vai no
// PRÓPRIO objeto `localStorage`, não em `Storage.prototype`: no Node 25 o setup
// (tests/front/setup-build-identity.ts) troca o global por um storage de
// reserva que não herda de `Storage`, e o espião no protótipo não pegaria nada.
let recusas = 0;
function storageQueRecusa(): void {
  const recusar = () => {
    recusas += 1;
    throw new DOMException("cota", "QuotaExceededError");
  };
  vi.spyOn(localStorage, "getItem").mockImplementation(recusar);
  vi.spyOn(localStorage, "setItem").mockImplementation(recusar);
  vi.spyOn(localStorage, "removeItem").mockImplementation(recusar);
}

beforeEach(() => {
  recusas = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("chaveDaDevolucao", () => {
  it("mesma intenção, mesma chave; outro valor ou outro pedido, chave nova", async () => {
    const { chaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    expect(chaveDaDevolucao("p1", 50, 2_000)).toBe(a);
    expect(chaveDaDevolucao("p1", 50.0, 3_000)).toBe(a);
    const b = chaveDaDevolucao("p1", 49.99, 4_000);
    expect(b).not.toBe(a);
    // a intenção de 50 foi trocada pela de 49,99: voltar a 50 é intenção nova
    expect(chaveDaDevolucao("p1", 50, 5_000)).not.toBe(a);
    expect(chaveDaDevolucao("p2", 50, 5_000)).not.toBe(
      chaveDaDevolucao("p1", 50, 5_000),
    );
  });

  it("vence em 30 min contados da criação (nunca estendidos pelo uso)", async () => {
    const { chaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 0);
    expect(chaveDaDevolucao("p1", 50, PRAZO_MS - 1)).toBe(a);
    expect(chaveDaDevolucao("p1", 50, PRAZO_MS)).not.toBe(a);
  });

  it("vale entre montagens e recargas: mora no localStorage", async () => {
    const primeira = await carregar();
    const a = primeira.chaveDaDevolucao("p1", 50, 1_000);
    const segunda = await carregar(); // módulo novo = página recarregada
    expect(segunda.chaveDaDevolucao("p1", 50, 2_000)).toBe(a);
  });

  it("registro malformado ou com validade além do prazo não vale", async () => {
    const { chaveDaDevolucao } = await carregar();
    for (const cru of [
      "{",
      JSON.stringify({ centavos: 5000, chave: 1, expiraEm: 10_000 }),
      JSON.stringify({ centavos: 50.5, chave: "x", expiraEm: 10_000 }),
      JSON.stringify({ centavos: 5000, chave: "x", expiraEm: 10 * PRAZO_MS }),
    ]) {
      localStorage.setItem(`${PREFIXO}p1`, cru);
      expect(chaveDaDevolucao("p1", 50, 1_000)).not.toBe("x");
    }
  });

  it("sem localStorage (getItem/setItem recusam), a chave ainda vale na aba", async () => {
    storageQueRecusa();
    const { chaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    // guarda: o storage recusou de verdade (o dublê foi chamado)
    expect(recusas).toBeGreaterThan(0);
    expect(chaveDaDevolucao("p1", 50, 2_000)).toBe(a);
  });
});

describe("encerrarChaveDaDevolucao", () => {
  it("encerra a intenção: a próxima de igual valor tem chave nova", async () => {
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    encerrarChaveDaDevolucao("p1", a);
    expect(localStorage.getItem(`${PREFIXO}p1`)).toBeNull();
    expect(chaveDaDevolucao("p1", 50, 2_000)).not.toBe(a);
  });

  it("a chave de uma intenção ANTIGA não apaga a da intenção em curso", async () => {
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    const antiga = chaveDaDevolucao("p1", 50, 1_000);
    const emCurso = chaveDaDevolucao("p1", 30, 2_000);
    encerrarChaveDaDevolucao("p1", antiga);
    expect(chaveDaDevolucao("p1", 30, 3_000)).toBe(emCurso);
  });

  it("sem localStorage, encerra na memória da aba", async () => {
    storageQueRecusa();
    const { chaveDaDevolucao, encerrarChaveDaDevolucao } = await carregar();
    const a = chaveDaDevolucao("p1", 50, 1_000);
    // guarda: o storage recusou de verdade (a chave só existe na memória)
    expect(recusas).toBeGreaterThan(0);
    encerrarChaveDaDevolucao("p1", a);
    expect(chaveDaDevolucao("p1", 50, 2_000)).not.toBe(a);
  });
});
