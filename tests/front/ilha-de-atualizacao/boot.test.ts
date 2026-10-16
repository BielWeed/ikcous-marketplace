// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aoIniciarAposAtualizacao } from "@/components/pwa/IlhaDeAtualizacao";
import {
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  CHAVE_ORIGEM_DE_ATUALIZACAO,
  gravaMotivoDeRecarga,
  gravaOrigemDeAtualizacao,
  gravaVersaoEsperadaDaAtualizacao,
} from "@/lib/motivo-de-recarga";
import { listarNovidades } from "@/lib/novidades/armazenamento-local";

function storageEmMemoria(): Storage {
  const dados = new Map<string, string>();
  return {
    get length() {
      return dados.size;
    },
    clear: () => dados.clear(),
    getItem: (chave) => dados.get(chave) ?? null,
    key: (indice) => [...dados.keys()][indice] ?? null,
    removeItem: (chave) => {
      dados.delete(chave);
    },
    setItem: (chave, valor) => {
      dados.set(chave, valor);
    },
  };
}

describe("boot após a atualização", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", storageEmMemoria());
    vi.stubGlobal("sessionStorage", storageEmMemoria());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    // A store de novidades relê a troca de storage antes de cada caso.
    listarNovidades();
  });

  afterEach(() => {
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
  });

  it("boot comum não anuncia, não registra e não devolve toast", () => {
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")).toBeNull();
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    expect(listarNovidades()).toEqual([]);
  });

  it("troca provada anuncia na ilha e registra as notas sem sufixo de build", () => {
    gravaOrigemDeAtualizacao("1.5.30-sha.origem");
    gravaMotivoDeRecarga("atualizacao-aplicada");
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")).toBeNull();
    expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
    expect(listarNovidades().map(({ versao }) => versao)).toEqual(["1.5.31"]);
    expect(sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBeNull();
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBeNull();
  });

  it("a evidência basta mesmo se o motivo de recarga não foi gravado", () => {
    gravaOrigemDeAtualizacao("1.5.30-sha.origem");
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")).toBeNull();
    expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
    expect(listarNovidades()).toHaveLength(1);
  });

  it.each([false, true])(
    "sem troca de build não anuncia nem registra notas (origem presente: %s)",
    (comOrigem) => {
      if (comOrigem) gravaOrigemDeAtualizacao("1.5.31-sha.igual");
      gravaMotivoDeRecarga("atualizacao-aplicada");
      const aviso = aoIniciarAposAtualizacao("1.5.31-sha.igual");
      expect(aviso?.tom).toBe("info");
      expect(aviso?.titulo).toBe("Aplicativo recarregado");
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
      expect(listarNovidades()).toEqual([]);
    },
  );

  it("um build abaixo do esperado não anuncia uma instalação concluída", () => {
    gravaOrigemDeAtualizacao("1.5.29-sha.origem");
    gravaVersaoEsperadaDaAtualizacao("1.5.32");
    gravaMotivoDeRecarga("atualizacao-aplicada");
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")?.tom).toBe("info");
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    expect(listarNovidades()).toEqual([]);
  });

  it("a segunda leitura do boot não anuncia outra vez nem duplica notas", () => {
    gravaOrigemDeAtualizacao("1.5.30-sha.origem");
    aoIniciarAposAtualizacao("1.5.31-sha.destino");
    definirEstadoDaAtualizacao({ fase: "nenhuma" });
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")).toBeNull();
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    expect(listarNovidades()).toHaveLength(1);
  });

  it("preserva o aviso de recuperação de erro, sem alegar atualização", () => {
    gravaMotivoDeRecarga("recuperacao-crash");
    const aviso = aoIniciarAposAtualizacao("1.5.31-sha.destino");
    expect(aviso?.tom).toBe("warning");
    expect(aviso?.titulo).toBe("O aplicativo se recuperou");
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    expect(listarNovidades()).toEqual([]);
  });

  it("um motivo legado sem prova também não ressuscita o toast de sucesso", () => {
    localStorage.setItem(
      CHAVE_MOTIVO_DE_RECARGA,
      "Sistema atualizado e otimizado.",
    );
    expect(aoIniciarAposAtualizacao("1.5.31-sha.destino")?.tom).toBe("info");
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    expect(listarNovidades()).toEqual([]);
  });
});
