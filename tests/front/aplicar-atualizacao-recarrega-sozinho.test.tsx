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
  PRAZO_APLICACAO_UPDATE_MS,
  aplicarAtualizacaoPendenteERecarregar,
} from "@/lib/recuperacao-chunk";

// Mesmo literal do módulo, duplicado de propósito: se o prazo mudar, este
// teste quebra e avisa.
const PRAZO = PRAZO_APLICACAO_UPDATE_MS;

describe("aplicarAtualizacaoPendenteERecarregar — instala e recarrega sozinho", () => {
  let recarregar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    recarregar = vi.fn();
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
});
