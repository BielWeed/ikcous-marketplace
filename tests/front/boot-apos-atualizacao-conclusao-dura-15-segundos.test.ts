// @vitest-environment jsdom
//
// O boot de um build novo anuncia "atualização concluída" e a reserva fica de pé
// por 15 s (`PRAZO_DE_RESERVA_DO_BOOT_MS` em
// `src/components/pwa/ao-iniciar-apos-atualizacao.ts`): a ilha é carregada sob
// demanda e precisa de tempo para montar e mostrar o aviso. O teste do boot só
// olha a fase logo depois; aqui o relógio anda até a fronteira exata.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRAZO_DE_RESERVA_DO_BOOT_MS,
  aoIniciarAposAtualizacao,
} from "@/components/pwa/ao-iniciar-apos-atualizacao";
import {
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import {
  gravaMotivoDeRecarga,
  gravaOrigemDeAtualizacao,
} from "@/lib/motivo-de-recarga";

function storageEmMemoria(): Storage {
  const dados = new Map<string, string>();
  return {
    get length() {
      return dados.size;
    },
    clear: () => dados.clear(),
    getItem: (chave) => dados.get(chave) ?? null,
    key: (indice) => [...dados.keys()].at(indice) ?? null,
    removeItem: (chave) => {
      dados.delete(chave);
    },
    setItem: (chave, valor) => {
      dados.set(chave, valor);
    },
  };
}

describe("boot após a atualização — quanto tempo a conclusão fica anunciada", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", storageEmMemoria());
    vi.stubGlobal("sessionStorage", storageEmMemoria());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
  });

  afterEach(() => {
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a reserva do boot é de 15 segundos", () => {
    expect(PRAZO_DE_RESERVA_DO_BOOT_MS).toBe(15_000);
  });

  it("troca provada: 'concluída' dura exatamente 15 s e depois volta a 'nenhuma'", () => {
    gravaOrigemDeAtualizacao("1.5.30-sha.origem");
    gravaMotivoDeRecarga("atualizacao-aplicada");
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")).toBeNull();
    expect(obterEstadoDaAtualizacao().fase).toBe("concluida");

    vi.advanceTimersByTime(14_999);
    expect(obterEstadoDaAtualizacao().fase).toBe("concluida");

    vi.advanceTimersByTime(1);
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
  });

  it("boot de build igual (sem troca) não anuncia nada, nem arma relógio", () => {
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")).toBeNull();
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    expect(vi.getTimerCount()).toBe(0);
  });
});
