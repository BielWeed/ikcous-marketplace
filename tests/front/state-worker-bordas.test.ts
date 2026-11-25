/**
 * O `state-worker` (src/state-worker.ts) é um Web Worker que filtra produtos e
 * soma o carrinho FORA da tela principal. Nenhum teste o abria: aqui ele é
 * carregado com um `self` falso e conversa só por mensagens, como no navegador.
 *
 * Mutante equivalente (sem teste possível, anotado de propósito): os
 * `console.log` de diagnóstico, que são só texto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mensagem = { type: string; payload?: unknown };
let enviadas: Mensagem[];
let eu: { onmessage?: (e: { data: Mensagem }) => void; postMessage: unknown };

function mandar(type: string, payload?: unknown) {
  eu.onmessage?.({ data: { type, payload } });
}

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
  enviadas = [];
  eu = { postMessage: (m: Mensagem) => enviadas.push(m) };
  vi.stubGlobal("self", eu);
  await import("@/state-worker");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const produtos = [
  { id: "1", name: "Camiseta Azul" },
  { id: "2", name: "Calça AZUL escura" },
  { id: "3", name: "Boné Vermelho" },
];

describe("state-worker — filtro por nome", () => {
  it("instala o ouvinte de mensagens ao carregar", () => {
    expect(typeof eu.onmessage).toBe("function");
  });

  it("acha pelo trecho do nome sem ligar para maiúsculas, de qualquer lado", () => {
    mandar("INIT_PRODUCTS", produtos);
    mandar("PROCESS_FILTERS", { query: "azul" });
    mandar("PROCESS_FILTERS", { query: "AZUL" });
    expect(enviadas).toEqual([
      { type: "FILTERS_PROCESSED", payload: [produtos[0], produtos[1]] },
      { type: "FILTERS_PROCESSED", payload: [produtos[0], produtos[1]] },
    ]);
  });

  it("busca sem resultado devolve lista vazia (e responde, não fica calado)", () => {
    mandar("INIT_PRODUCTS", produtos);
    mandar("PROCESS_FILTERS", { query: "sapato" });
    expect(enviadas).toEqual([{ type: "FILTERS_PROCESSED", payload: [] }]);
  });

  it("texto vazio acha tudo, na ordem original", () => {
    mandar("INIT_PRODUCTS", produtos);
    mandar("PROCESS_FILTERS", { query: "" });
    expect(enviadas[0].payload).toEqual(produtos);
  });

  it("antes de qualquer carga o filtro devolve vazio", () => {
    mandar("PROCESS_FILTERS", { query: "a" });
    expect(enviadas).toEqual([{ type: "FILTERS_PROCESSED", payload: [] }]);
  });

  it("uma carga nova SUBSTITUI a anterior (não acumula)", () => {
    mandar("INIT_PRODUCTS", produtos);
    mandar("INIT_PRODUCTS", [{ id: "9", name: "Meia azul" }]);
    mandar("PROCESS_FILTERS", { query: "azul" });
    expect(enviadas[0].payload).toEqual([{ id: "9", name: "Meia azul" }]);
  });

  it("a carga em si não responde nada", () => {
    mandar("INIT_PRODUCTS", produtos);
    expect(enviadas).toEqual([]);
  });
});

describe("state-worker — total do carrinho", () => {
  it("soma preço x quantidade de cada linha", () => {
    mandar("CALC_TOTALS", [
      { price: 10.5, quantity: 2 },
      { price: 3, quantity: 4 },
    ]);
    expect(enviadas).toEqual([{ type: "TOTALS_CALCULATED", payload: 33 }]);
  });

  it("carrinho vazio soma zero (e responde)", () => {
    mandar("CALC_TOTALS", []);
    expect(enviadas).toEqual([{ type: "TOTALS_CALCULATED", payload: 0 }]);
  });

  it("uma linha só vale preço x quantidade, sem o 'zero' inicial atrapalhar", () => {
    mandar("CALC_TOTALS", [{ price: 7, quantity: 3 }]);
    expect(enviadas[0].payload).toBe(21);
  });

  it("o total não depende do que foi carregado antes (carrinho e produtos são estados à parte)", () => {
    mandar("INIT_PRODUCTS", produtos);
    mandar("CALC_TOTALS", [{ price: 2, quantity: 2 }]);
    expect(enviadas).toEqual([{ type: "TOTALS_CALCULATED", payload: 4 }]);
  });
});

describe("state-worker — mensagem que ele não conhece", () => {
  it("é ignorada em silêncio: sem resposta e sem mexer no que já tinha", () => {
    mandar("INIT_PRODUCTS", produtos);
    mandar("OUTRA_COISA", { query: "azul" });
    mandar("PROCESS_FILTERS", { query: "boné" });
    expect(enviadas).toEqual([
      { type: "FILTERS_PROCESSED", payload: [produtos[2]] },
    ]);
  });
});
