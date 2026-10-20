// EXCLUSÃO MÚTUA DA INSTALAÇÃO — só uma aba por vez instala. A reserva é
// gravada em localStorage, lida de volta, e expira em 30 s.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_DA_RESERVA_DE_INSTALACAO,
  VALIDADE_DA_RESERVA_MS,
  soltarReservaDeInstalacao,
  tomarReservaDeInstalacao,
} from "@/lib/atualizacao/exclusao-de-instalacao";
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";

const local = new Map<string, string>();
const stub = () => ({
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => {
    local.set(k, String(v));
  },
  removeItem: (k: string) => {
    local.delete(k);
  },
});

describe("exclusão mútua da instalação", () => {
  beforeEach(() => {
    local.clear();
    vi.stubGlobal("localStorage", stub());
  });

  it("a chave sobrevive à purga (pwa_)", () => {
    expect(chaveSobreviveAPurga(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBe(true);
  });

  it("a primeira aba toma a reserva; a segunda, dentro de 30 s, NÃO", () => {
    expect(tomarReservaDeInstalacao("aba-A", 1_000)).toBe(true);
    expect(tomarReservaDeInstalacao("aba-B", 1_000 + 5_000)).toBe(false);
    // a dona continua dona
    expect(tomarReservaDeInstalacao("aba-A", 1_000 + 6_000)).toBe(true);
  });

  it("a reserva EXPIRA em 30 s (aba que morreu no meio não prende ninguém)", () => {
    expect(tomarReservaDeInstalacao("aba-A", 1_000)).toBe(true);
    expect(
      tomarReservaDeInstalacao("aba-B", 1_000 + VALIDADE_DA_RESERVA_MS - 1),
    ).toBe(false);
    expect(
      tomarReservaDeInstalacao("aba-B", 1_000 + VALIDADE_DA_RESERVA_MS),
    ).toBe(true);
  });

  it("soltar libera para a outra — mas só a dona solta (nunca apaga a reserva alheia)", () => {
    tomarReservaDeInstalacao("aba-A", 1_000);
    soltarReservaDeInstalacao("aba-B");
    expect(tomarReservaDeInstalacao("aba-B", 2_000)).toBe(false);
    soltarReservaDeInstalacao("aba-A");
    expect(tomarReservaDeInstalacao("aba-B", 2_000)).toBe(true);
  });

  it("reserva corrompida no storage vale como ausente (não trava para sempre)", () => {
    local.set(CHAVE_DA_RESERVA_DE_INSTALACAO, "{lixo");
    expect(tomarReservaDeInstalacao("aba-A", 1_000)).toBe(true);
  });

  it("storage LANÇANDO: não toma a reserva (lado seguro) e não derruba", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(tomarReservaDeInstalacao("aba-A", 1_000)).toBe(false);
    expect(() => soltarReservaDeInstalacao("aba-A")).not.toThrow();
  });

  it("escrita que não pega (leitura de volta diferente): não toma", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    expect(tomarReservaDeInstalacao("aba-A", 1_000)).toBe(false);
  });

  it("outra aba sobrescreveu no mesmo instante (leu o id dela de volta): perde", () => {
    let gravado: string | null = null;
    vi.stubGlobal("localStorage", {
      getItem: () => gravado,
      setItem: () => {
        gravado = JSON.stringify({ id: "aba-B", em: 1_000 });
      },
      removeItem: () => {},
    });
    expect(tomarReservaDeInstalacao("aba-A", 1_000)).toBe(false);
  });
});
