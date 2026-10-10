// @vitest-environment jsdom
//
// A MECÂNICA do apply da versão nova, extraída do useUpdateCheck.handleUpdate
// na peça de 14/09 (defeito B): o instalador tinha de CONCLUIR sozinho —
// controllerchange recarrega uma vez e, no pior caso (SW preso, client não
// controlado, acionar rejeitando), o prazo de segurança recarrega do mesmo
// jeito. Antes do prazo de segurança, era exatamente esse caminho que
// pendurava o instalador.
//
// Por que aqui e não montando o hook: o hook importa `virtual:pwa-register/
// react`, que não resolve neste runner (ver cabeçalho de
// portao-de-versao-fail-open.test.ts). A mecânica agora vive em
// @/lib/recuperacao-chunk e é provada por comportamento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_MOTIVO_DE_RECARGA,
  CHAVE_ORIGEM_DE_ATUALIZACAO,
} from "@/lib/motivo-de-recarga";
import {
  PRAZO_APLICACAO_UPDATE_MS,
  aplicarAtualizacaoPendenteERecarregar,
} from "@/lib/recuperacao-chunk";

// Mesmo literal do módulo, duplicado de propósito: se o prazo mudar, este
// teste quebra e avisa.
const PRAZO = PRAZO_APLICACAO_UPDATE_MS;

// jsdom desta árvore não traz localStorage utilizável: stub Map-based, mesmo
// padrão de motivo-de-recarga-honesto.test.ts. A suíte lê os MOTIVOS que o
// apply grava — a honestidade do toast do boot é comportamento desta peça.
// A evidência de origem mora em sessionStorage (achado 1 da revisão: por aba,
// invisível às irmãs), então as duas superfícies precisam de stub.
const memoria = new Map<string, string>();
const memoriaDeSessao = new Map<string, string>();

describe("aplicarAtualizacaoPendenteERecarregar — instala e recarrega sozinho", () => {
  let recarregar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    recarregar = vi.fn();
    memoria.clear();
    memoriaDeSessao.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memoria.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memoria.set(k, String(v));
      },
      removeItem: (k: string) => {
        memoria.delete(k);
      },
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => memoriaDeSessao.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memoriaDeSessao.set(k, String(v));
      },
      removeItem: (k: string) => {
        memoriaDeSessao.delete(k);
      },
    });
    // `window.location.reload` não é redefinível via vi.spyOn no jsdom
    // (propriedade não-configurável) — troca o `location` inteiro, mesmo
    // contorno do global-error-boundary-recovery-preserva-sessao-e-carrinho.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: recarregar },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function comServiceWorker(
    manipular: (sw: {
      ouvir: ReturnType<typeof vi.fn>;
      esquecer: ReturnType<typeof vi.fn>;
      avisarAssumiu: () => void;
    }) => void,
  ) {
    const ouvidores = new Map<string, () => void>();
    const ouvir = vi.fn((evento: string, aoAssumir: () => void) => {
      ouvidores.set(evento, aoAssumir);
    });
    const esquecer = vi.fn((evento: string) => {
      ouvidores.delete(evento);
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        addEventListener: ouvir,
        removeEventListener: esquecer,
      },
    });
    manipular({
      ouvir,
      esquecer,
      avisarAssumiu: () => ouvidores.get("controllerchange")?.(),
    });
  }

  it("caminho feliz: o SW assume (controllerchange) → recarrega UMA vez, na hora", () => {
    comServiceWorker(({ ouvir, avisarAssumiu }) => {
      const acionar = vi.fn(async () => {});
      aplicarAtualizacaoPendenteERecarregar({
        acionar,
        motivo: "atualizacao-aplicada",
        prazoMs: PRAZO,
      });

      expect(ouvir).toHaveBeenCalledWith(
        "controllerchange",
        expect.any(Function),
      );
      avisarAssumiu();
      expect(recarregar).toHaveBeenCalledTimes(1);

      // O prazo chega depois: nada de segunda recarga.
      vi.advanceTimersByTime(PRAZO + 1);
      expect(recarregar).toHaveBeenCalledTimes(1);
    });
  });

  it("PIOR CASO: controllerchange que nunca chega → o prazo recarrega sozinho", async () => {
    vi.stubGlobal("navigator", {});
    const acionar = vi.fn(async () => {});
    aplicarAtualizacaoPendenteERecarregar({
      acionar,
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO,
    });

    await vi.advanceTimersByTimeAsync(PRAZO - 1);
    expect(recarregar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("acionar que REJEITA não pula o prazo de segurança", async () => {
    vi.stubGlobal("navigator", {});
    const acionar = vi.fn(async () => {
      throw new Error("SW preso em install falhando");
    });
    aplicarAtualizacaoPendenteERecarregar({
      acionar,
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO,
    });

    await vi.advanceTimersByTimeAsync(PRAZO + 1);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("sem serviceWorker nenhum (jsdom puro), o prazo segue valendo", async () => {
    const acionar = vi.fn(async () => {});
    aplicarAtualizacaoPendenteERecarregar({
      acionar,
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO,
    });

    await vi.advanceTimersByTimeAsync(PRAZO + 1);
    expect(acionar).toHaveBeenCalledWith(true);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  // ── Peça 22/09: prazo independente do settlement + motivo por evidência ──

  it("acionar PENDENTE para sempre (nunca resolve): o prazo nasce do mesmo jeito e recarrega UMA vez", async () => {
    vi.stubGlobal("navigator", {});
    const acionar = vi.fn(() => new Promise<void>(() => {}));
    aplicarAtualizacaoPendenteERecarregar({
      acionar,
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO,
    });

    // O prazo não depende do settlement: mesmo com a promise pendurada,
    // ele recarrega no instante combinado.
    await vi.advanceTimersByTimeAsync(PRAZO + 1);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("throw SÍNCRONO do acionar não derruba o instalador: o prazo recarrega", async () => {
    vi.stubGlobal("navigator", {});
    const acionar = vi.fn(() => {
      throw new Error("registro do SW falhou no sincronismo");
    });

    expect(() =>
      aplicarAtualizacaoPendenteERecarregar({
        acionar,
        motivo: "atualizacao-aplicada",
        prazoMs: PRAZO,
      }),
    ).not.toThrow();

    await vi.advanceTimersByTimeAsync(PRAZO + 1);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("motivo HONESTO com evidência: controllerchange grava 'atualizacao-aplicada' — e NADA antes dele", () => {
    comServiceWorker(({ avisarAssumiu }) => {
      aplicarAtualizacaoPendenteERecarregar({
        acionar: vi.fn(async () => {}),
        motivo: "atualizacao-aplicada",
        prazoMs: PRAZO,
      });

      // A origem do build viaja na SESSÃO da aba (achado 1 da revisão: por
      // aba, invisível às irmãs) para o boot provar a troca de build (a
      // comparação com o build de chegada é trabalho do boot, não daqui).
      expect(sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBeTruthy();
      // Antes da evidência, nenhum motivo de sucesso é gravado — leitura
      // pela superfície do protocolo (o stub devolve null para ausente).
      expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBeNull();

      avisarAssumiu();
      expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBe(
        "atualizacao-aplicada",
      );
    });
  });

  it("motivo HONESTO sem evidência: o prazo grava o NEUTRO, nunca 'atualizacao-aplicada'", async () => {
    vi.stubGlobal("navigator", {});
    aplicarAtualizacaoPendenteERecarregar({
      acionar: vi.fn(async () => {
        throw new Error("SW preso em install falhando");
      }),
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO,
    });

    await vi.advanceTimersByTimeAsync(PRAZO + 1);
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBe(
      "atualizacao-nao-confirmada",
    );
  });

  it("UMA recarga e ouvinte limpo: controllerchange TARDIO depois do prazo não recarrega de novo", async () => {
    const ouvidores = new Map<string, () => void>();
    const esquecer = vi.fn((evento: string) => {
      ouvidores.delete(evento);
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        addEventListener: vi.fn((evento: string, fn: () => void) => {
          ouvidores.set(evento, fn);
        }),
        removeEventListener: esquecer,
      },
    });
    aplicarAtualizacaoPendenteERecarregar({
      acionar: vi.fn(async () => {}),
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO,
    });

    // Captura ANTES do prazo: após a recarga o ouvinte já foi esquecido.
    const registrado = ouvidores.get("controllerchange")!;

    await vi.advanceTimersByTimeAsync(PRAZO + 1);
    expect(recarregar).toHaveBeenCalledTimes(1);
    // A recarga limpa o próprio ouvinte — e é a MESMA função que registrou.
    expect(esquecer).toHaveBeenCalledWith("controllerchange", registrado);

    // Um controllerchange que chegasse agora não tem mais dono (o ouvinte
    // foi removido) — e, ainda que uma referência antiga disparasse, a
    // guarda de UMA recarga segura e o motivo segue o NEUTRO do prazo.
    registrado();
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE_MOTIVO_DE_RECARGA)).toBe(
      "atualizacao-nao-confirmada",
    );
  });
});
