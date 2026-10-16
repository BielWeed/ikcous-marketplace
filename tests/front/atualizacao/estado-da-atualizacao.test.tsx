// @vitest-environment jsdom
//
// O CONTRATO DE ESTADO que a Onda 2 (a ilha, o App) consome. A forma da API é
// a da spec 2026-10-16-atualizacao-unica-obrigatoria.md — mudar um nome aqui
// quebra quem consome, por isso o teste a trava.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDaAtualizacao,
  anunciarAtualizacaoConcluida,
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
  useEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("estado da atualização", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // cancela timer de conclusão que sobrou de outro teste e volta ao zero
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
  });

  afterEach(() => {
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
  });

  it("começa em 'nenhuma', sem versão", () => {
    expect(obterEstadoDaAtualizacao()).toEqual({
      fase: "nenhuma",
      versaoNova: null,
    });
  });

  it("definir é PARCIAL: mexer na fase preserva a versão", () => {
    definirEstadoDaAtualizacao({ fase: "aguardando", versaoNova: "1.5.32" });
    definirEstadoDaAtualizacao({ fase: "instalando" });
    expect(obterEstadoDaAtualizacao()).toEqual({
      fase: "instalando",
      versaoNova: "1.5.32",
    });
  });

  it("o instantâneo é ESTÁVEL quando nada muda (useSyncExternalStore não pode girar em loop)", () => {
    definirEstadoDaAtualizacao({ fase: "aguardando", versaoNova: "1.5.32" });
    const antes = obterEstadoDaAtualizacao();
    definirEstadoDaAtualizacao({ fase: "aguardando", versaoNova: "1.5.32" });
    expect(obterEstadoDaAtualizacao()).toBe(antes);
    expect(obterEstadoDaAtualizacao()).toBe(obterEstadoDaAtualizacao());
  });

  describe("useEstadoDaAtualizacao", () => {
    let host: HTMLDivElement;
    let raiz: Root;
    const vistos: EstadoDaAtualizacao[] = [];

    function Leitor() {
      const estado = useEstadoDaAtualizacao();
      vistos.push(estado);
      return <span data-testid="fase">{estado.fase}</span>;
    }

    beforeEach(() => {
      vistos.length = 0;
      host = document.createElement("div");
      document.body.appendChild(host);
      raiz = createRoot(host);
    });
    afterEach(() => {
      act(() => raiz.unmount());
      host.remove();
    });

    it("re-renderiza quando a fase muda e mostra o valor novo", () => {
      act(() => raiz.render(<Leitor />));
      expect(host.textContent).toBe("nenhuma");
      act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
      expect(host.textContent).toBe("instalando");
    });

    it("depois do unmount, mudar o estado não lança nem renderiza (ouvinte limpo)", () => {
      act(() => raiz.render(<Leitor />));
      act(() => raiz.unmount());
      const antes = vistos.length;
      expect(() =>
        definirEstadoDaAtualizacao({ fase: "aguardando" }),
      ).not.toThrow();
      expect(vistos.length).toBe(antes);
      // recria a raiz para o afterEach desmontar sem erro
      raiz = createRoot(host);
    });
  });

  describe("anunciarAtualizacaoConcluida", () => {
    it("fica 'concluida' pela duração e VOLTA a 'nenhuma' sozinho (padrão ~3 s)", () => {
      anunciarAtualizacaoConcluida();
      expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
      vi.advanceTimersByTime(2999);
      expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
      vi.advanceTimersByTime(2);
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("respeita duracaoMs", () => {
      anunciarAtualizacaoConcluida({ duracaoMs: 1000 });
      vi.advanceTimersByTime(999);
      expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
      vi.advanceTimersByTime(2);
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("chamar de novo REINICIA o prazo (um timer velho não encurta o novo aviso)", () => {
      anunciarAtualizacaoConcluida({ duracaoMs: 1000 });
      vi.advanceTimersByTime(800);
      anunciarAtualizacaoConcluida({ duracaoMs: 1000 });
      vi.advanceTimersByTime(800); // 1600 desde o 1º, 800 desde o 2º
      expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
      vi.advanceTimersByTime(300);
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("outra fase definida no meio CANCELA a volta automática (não pisa numa instalação nova)", () => {
      anunciarAtualizacaoConcluida({ duracaoMs: 1000 });
      definirEstadoDaAtualizacao({ fase: "instalando" });
      vi.advanceTimersByTime(5000);
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
    });

    it("não deixa timer pendente depois de voltar a 'nenhuma'", () => {
      anunciarAtualizacaoConcluida({ duracaoMs: 500 });
      vi.advanceTimersByTime(600);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
