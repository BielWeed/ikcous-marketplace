// @vitest-environment jsdom
//
// `useRevalidarAoVoltar` (src/hooks/useRevalidarAoVoltar.ts): a releitura
// silenciosa do CRM e da fila de perguntas quando o lojista volta ao app. Até
// aqui o hook era trocado por um dublê em todos os testes de tela, então nada
// provava o contrato dele. O que protege:
//  - `active = false`: nenhum ouvinte (o painel fechado não consulta o banco);
//  - uma volta pode gerar três eventos (visibilitychange, focus, pageshow): só
//    UMA leitura a cada 30 s, contada da montagem (29 999 ms não, 30 000 ms
//    sim); os três eventos, separados, valem;
//  - aba escondida não relê; `podeReler() === false` (consulta em voo) não relê
//    E não gasta a janela;
//  - uma leitura ainda em voo não empilha outra por cima, e terminada libera;
//  - usa SEMPRE a leitura mais recente passada pela tela (não a da montagem);
//  - desmontar solta os três ouvintes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRevalidarAoVoltar } from "@/hooks/useRevalidarAoVoltar";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Props {
  active: boolean;
  reler: () => unknown;
  podeReler: () => boolean;
}

function Tela({ active, reler, podeReler }: Props) {
  useRevalidarAoVoltar(active, reler, podeReler);
  return null;
}

describe("useRevalidarAoVoltar — releitura silenciosa ao voltar ao app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let visibilidade: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilidade = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montar(props: Partial<Props> = {}) {
    const completas: Props = {
      active: true,
      reler: vi.fn(),
      podeReler: () => true,
      ...props,
    };
    await act(async () => {
      raiz.render(<Tela {...completas} />);
    });
    return completas;
  }

  async function renderizar(props: Props) {
    await act(async () => {
      raiz.render(<Tela {...props} />);
    });
  }

  async function voltarPelaAba() {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  async function voltarPelaJanela() {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
  }

  async function voltarPelaPagina() {
    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });
  }

  it("com active falso nenhum evento relê", async () => {
    const reler = vi.fn();
    await montar({ active: false, reler });

    vi.advanceTimersByTime(60_000);
    await voltarPelaAba();
    await voltarPelaJanela();
    await voltarPelaPagina();

    expect(reler).not.toHaveBeenCalled();
  });

  it("a janela de 30 s conta da montagem: aos 29 999 ms não relê; aos 30 000 ms relê", async () => {
    const reler = vi.fn();
    await montar({ reler });

    vi.advanceTimersByTime(29_999);
    await voltarPelaAba();
    expect(reler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await voltarPelaAba();
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["visibilitychange", voltarPelaAba],
    ["focus", voltarPelaJanela],
    ["pageshow", voltarPelaPagina],
  ] as const)(
    "o evento %s, sozinho, dispara a releitura",
    async (_, voltar) => {
      const reler = vi.fn();
      await montar({ reler });

      vi.advanceTimersByTime(30_000);
      await voltar();

      expect(reler).toHaveBeenCalledTimes(1);
    },
  );

  it("os três eventos da MESMA volta custam uma leitura só; a próxima volta, 30 s depois, custa outra", async () => {
    const reler = vi.fn();
    await montar({ reler });

    vi.advanceTimersByTime(30_000);
    await voltarPelaAba();
    await voltarPelaJanela();
    await voltarPelaPagina();
    expect(reler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29_999);
    await voltarPelaJanela();
    expect(reler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await voltarPelaJanela();
    expect(reler).toHaveBeenCalledTimes(2);
  });

  it("aba escondida não relê e não gasta a janela: ao ficar visível, relê", async () => {
    const reler = vi.fn();
    await montar({ reler });

    vi.advanceTimersByTime(30_000);
    visibilidade.mockReturnValue("hidden");
    await voltarPelaJanela();
    expect(reler).not.toHaveBeenCalled();

    visibilidade.mockReturnValue("visible");
    await voltarPelaAba();
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("podeReler falso (consulta em voo) não relê e não gasta a janela", async () => {
    const reler = vi.fn();
    let pode = false;
    await montar({ reler, podeReler: () => pode });

    vi.advanceTimersByTime(30_000);
    await voltarPelaAba();
    expect(reler).not.toHaveBeenCalled();

    // Liberou logo em seguida: a volta seguinte não precisa esperar outros 30 s.
    pode = true;
    await voltarPelaAba();
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("leitura ainda em voo não empilha outra por cima; terminada, libera a próxima", async () => {
    let terminar: () => void = () => {};
    const reler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    await montar({ reler });

    vi.advanceTimersByTime(30_000);
    await voltarPelaAba();
    expect(reler).toHaveBeenCalledTimes(1);

    // Passou outra janela de 30 s, mas a primeira leitura ainda não voltou.
    vi.advanceTimersByTime(30_000);
    await voltarPelaAba();
    expect(reler).toHaveBeenCalledTimes(1);

    await act(async () => {
      terminar();
    });

    await voltarPelaAba();
    expect(reler).toHaveBeenCalledTimes(2);
  });

  it("usa a leitura MAIS RECENTE da tela, não a da montagem", async () => {
    const antiga = vi.fn();
    const nova = vi.fn();
    const props = await montar({ reler: antiga });

    await renderizar({ ...props, reler: nova });
    vi.advanceTimersByTime(30_000);
    await voltarPelaAba();

    expect(antiga).not.toHaveBeenCalled();
    expect(nova).toHaveBeenCalledTimes(1);
  });

  it("desmontar solta os três ouvintes", async () => {
    const reler = vi.fn();
    await montar({ reler });

    await act(async () => {
      raiz.unmount();
    });
    // O afterEach desmonta de novo: troca por uma raiz nova e vazia.
    raiz = createRoot(hospedeiro);

    vi.advanceTimersByTime(30_000);
    await voltarPelaAba();
    await voltarPelaJanela();
    await voltarPelaPagina();

    expect(reler).not.toHaveBeenCalled();
  });
});
