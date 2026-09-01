import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  descreveMotivoDeRecarga,
  gravaMotivoDeRecarga,
  limpaMotivoDeRecarga,
} from "../../src/lib/motivo-de-recarga";

// jsdom desta árvore não traz localStorage (ver _REGRAS): stub mínimo honesto.
const memoria = new Map<string, string>();

describe("motivo-de-recarga — o toast do boot diz a verdade (laudo #2, P-1)", () => {
  beforeEach(() => {
    memoria.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memoria.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memoria.set(k, String(v));
      },
      removeItem: (k: string) => {
        memoria.delete(k);
      },
      clear: () => {
        memoria.clear();
      },
    });
  });

  afterEach(() => {
    memoria.clear();
    vi.unstubAllGlobals();
  });

  it("update real: título honesto de atualização com tom de sucesso", () => {
    const d = descreveMotivoDeRecarga("atualizacao-aplicada");
    expect(d).toEqual({
      titulo: "Sistema Atualizado",
      descricao: "A loja foi atualizada para a versão mais recente.",
      tom: "success",
    });
  });

  it("erro de módulo recuperado: NÃO diz que atualizou — info, com o fato", () => {
    const d = descreveMotivoDeRecarga("recuperacao-erro-modulo");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
    expect(d?.tom).toBe("info");
    expect(d?.descricao).toContain("Nenhuma versão nova foi instalada");
  });

  it("crash recuperado: warning, sem disfarce de atualização", () => {
    const d = descreveMotivoDeRecarga("recuperacao-crash");
    expect(d?.titulo).toBe("O aplicativo se recuperou");
    expect(d?.tom).toBe("warning");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
  });

  it("sentinela reiniciou o app: info honesta", () => {
    const d = descreveMotivoDeRecarga("recuperacao-sentinela");
    expect(d?.tom).toBe("info");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
  });

  it("legado 'Sistema atualizado e otimizado.' (era gravado só por update real) continua virando atualização", () => {
    const d = descreveMotivoDeRecarga("Sistema atualizado e otimizado.");
    expect(d?.tom).toBe("success");
    expect(d?.titulo).toBe("Sistema Atualizado");
  });

  it("legados de recuperação (texto cru pré-conserto) deixam de fingir atualização", () => {
    expect(
      descreveMotivoDeRecarga("Auto-recuperação (Erro de Módulo)")?.tom,
    ).toBe("info");
    expect(
      descreveMotivoDeRecarga("Failed to fetch dynamically imported module")
        ?.tom,
    ).toBe("info");
    expect(
      descreveMotivoDeRecarga("Fatal Crash: Cannot read properties of undef")
        ?.tom,
    ).toBe("warning");
    expect(
      descreveMotivoDeRecarga("Sentinel Recovery: Pulse loss (301234ms)")?.tom,
    ).toBe("info");
    // nenhum legado de recuperação vira "Sistema Atualizado"
    for (const legado of [
      "Auto-recuperação (Erro de Módulo)",
      "Failed to fetch dynamically imported module",
      "Fatal Crash: x",
      "Sentinel Recovery: Pulse loss (1ms)",
    ]) {
      expect(descreveMotivoDeRecarga(legado)?.titulo).not.toBe(
        "Sistema Atualizado",
      );
    }
  });

  it("motivo desconhecido: recarregado, sem inventar atualização", () => {
    const d = descreveMotivoDeRecarga("motivo-que-nao-existe");
    expect(d?.titulo).not.toBe("Sistema Atualizado");
    expect(d?.tom).toBe("info");
    expect(d?.descricao).toBe("motivo-que-nao-existe");
  });

  it("sem motivo gravado: nada a exibir", () => {
    expect(descreveMotivoDeRecarga(null)).toBeNull();
  });

  it("grava/limpa usa a chave do protocolo", () => {
    gravaMotivoDeRecarga("recuperacao-crash");
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBe(
      "recuperacao-crash",
    );
    limpaMotivoDeRecarga();
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBeNull();
  });
});
