// CATÁLOGO EM TRÂNSITO — o prazo PADRÃO de 8 s e a promessa de "sem nada em
// voo, nenhum relógio". As suítes do motor (catchup-*) passam sempre o prazo
// por fora ou só observam o resultado; nenhuma trava o número do código nem
// o relógio que não pode existir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRAZO_DE_ESPERA_DO_CATALOGO_MS,
  abrirCatalogoEmVoo,
  catalogoEmVoo,
  esperarCatalogoEmVoo,
} from "@/lib/deposito-do-catalogo";

const abertos: Array<() => void> = [];

function abrir(): () => void {
  const fechar = abrirCatalogoEmVoo();
  abertos.push(fechar);
  return fechar;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Estado do módulo é global: fecha o que o teste abriu, na ordem inversa.
  while (abertos.length > 0) abertos.pop()?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("esperarCatalogoEmVoo — prazo padrão", () => {
  it("o prazo padrão é de 8000 ms", () => {
    expect(PRAZO_DE_ESPERA_DO_CATALOGO_MS).toBe(8000);
  });

  it("consulta que nunca fecha: sem argumento, espera 8000 ms inteiros e libera exatamente ali", async () => {
    abrir();
    let liberou = false;
    const espera = esperarCatalogoEmVoo().then(() => {
      liberou = true;
    });

    await vi.advanceTimersByTimeAsync(7999);
    expect(liberou).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(liberou).toBe(true);
    await espera;
  });

  it("consulta que fecha antes do prazo libera na hora, sem esperar o relógio", async () => {
    const fechar = abrir();
    let liberou = false;
    const espera = esperarCatalogoEmVoo().then(() => {
      liberou = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(liberou).toBe(false);

    fechar();
    await vi.advanceTimersByTimeAsync(0);
    expect(liberou).toBe(true);
    await espera;
    // e o relógio de 8 s foi desarmado: nada pendente depois da liberação
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("esperarCatalogoEmVoo — sem nada registrado", () => {
  it("volta na hora e NÃO cria relógio nenhum", async () => {
    const relogio = vi.spyOn(globalThis, "setTimeout");
    expect(catalogoEmVoo()).toBe(false);

    await esperarCatalogoEmVoo();

    expect(relogio).not.toHaveBeenCalled();
  });

  it("depois que a única consulta fecha, também não há mais nada em voo nem relógio", async () => {
    const fechar = abrir();
    expect(catalogoEmVoo()).toBe(true);
    fechar();
    expect(catalogoEmVoo()).toBe(false);

    const relogio = vi.spyOn(globalThis, "setTimeout");
    await esperarCatalogoEmVoo();
    expect(relogio).not.toHaveBeenCalled();
  });
});
