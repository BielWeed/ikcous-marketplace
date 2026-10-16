// @vitest-environment jsdom
//
// O APPLY da versão nova NÃO recarrega por cima do veto local. O
// `aplicarAtualizacaoPendenteERecarregar` tem dois caminhos de reload próprios
// — o controllerchange e o prazo de segurança de ~1,2 s — e ambos corriam FORA
// do veto: o instalador decidia começar num momento seguro, a pessoa entrava no
// checkout nos instantes seguintes, e a compra era recarregada.
//
// Agora os dois consultam o momento seguro NO INSTANTE do reload. Vetou: não
// recarrega, a recarga fica pendente (o gate recarrega no próximo ponto de
// parada) e o apply NÃO tenta de novo por conta própria (sem laço).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  haRecargaPendente,
  limparRecargaPendente,
} from "@/lib/atualizacao/recarga-pendente";
import { definirAvaliadorDeMomentoSeguro } from "@/lib/atualizacao/veto-de-recarga";
import { CHAVE_MOTIVO_DE_RECARGA } from "@/lib/motivo-de-recarga";
import {
  PRAZO_APLICACAO_UPDATE_MS,
  aplicarAtualizacaoPendenteERecarregar,
} from "@/lib/recuperacao-chunk";

const memoria = new Map<string, string>();
const memoriaDeSessao = new Map<string, string>();

describe("o apply respeita o veto local no instante do reload", () => {
  let recarregar: ReturnType<typeof vi.fn>;
  let esquecer: ReturnType<typeof vi.fn>;
  let avisarAssumiu: () => void;
  let livre: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    recarregar = vi.fn();
    memoria.clear();
    memoriaDeSessao.clear();
    limparRecargaPendente();
    livre = true;
    definirAvaliadorDeMomentoSeguro(() => livre);
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
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: recarregar },
    });
    const ouvidores = new Map<string, () => void>();
    esquecer = vi.fn((evento: string) => {
      ouvidores.delete(evento);
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        addEventListener: (evento: string, aoAssumir: () => void) => {
          ouvidores.set(evento, aoAssumir);
        },
        removeEventListener: esquecer,
      },
    });
    avisarAssumiu = () => ouvidores.get("controllerchange")?.();
  });

  afterEach(() => {
    definirAvaliadorDeMomentoSeguro(null);
    limparRecargaPendente();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function aplicar() {
    aplicarAtualizacaoPendenteERecarregar({
      acionar: vi.fn(async () => {}),
      motivo: "atualizacao-aplicada",
      prazoMs: PRAZO_APLICACAO_UPDATE_MS,
    });
  }

  it("controle: momento seguro no controllerchange, recarrega UMA vez e nada fica pendente", () => {
    aplicar();
    avisarAssumiu();
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(haRecargaPendente()).toBe(false);
  });

  it("a pessoa ENTROU no checkout entre o acionar e o assumir: NÃO recarrega no controllerchange — fica pendente", () => {
    aplicar();
    livre = false; // entrou no checkout nesse intervalo
    avisarAssumiu();
    expect(recarregar).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
  });

  it("SEM LAÇO: vetado no controllerchange, o prazo de segurança que sobrou NÃO recarrega depois (nem com o momento já liberado)", () => {
    aplicar();
    livre = false;
    avisarAssumiu();
    livre = true;
    vi.advanceTimersByTime(PRAZO_APLICACAO_UPDATE_MS * 10);
    expect(recarregar).not.toHaveBeenCalled();
    // e o ouvinte foi desarmado: um segundo controllerchange também não recarrega
    expect(esquecer).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
    );
    avisarAssumiu();
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("o prazo de segurança de ~1,2 s TAMBÉM respeita o veto: no checkout, não recarrega e fica pendente", () => {
    aplicar();
    livre = false;
    vi.advanceTimersByTime(PRAZO_APLICACAO_UPDATE_MS + 50);
    expect(recarregar).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
  });

  it("controle: o prazo de segurança com momento seguro continua recarregando (SW preso não pendura o instalador)", () => {
    aplicar();
    vi.advanceTimersByTime(PRAZO_APLICACAO_UPDATE_MS + 50);
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(haRecargaPendente()).toBe(false);
  });

  it("vetado, o apply NÃO escreve o motivo de recarga (quem recarregar depois é que grava, com a evidência dele)", () => {
    aplicar();
    livre = false;
    avisarAssumiu();
    expect(memoria.get(CHAVE_MOTIVO_DE_RECARGA)).toBeUndefined();
  });
});
