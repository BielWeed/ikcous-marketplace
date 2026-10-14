// @vitest-environment jsdom
/**
 * No 3G instavel, o chunk de uma aba falha uma vez e a rede volta logo depois.
 * `lazyWithPreload` guardava a promessa REJEITADA para sempre, e o React.lazy
 * guarda a rejeicao no proprio objeto: toda nova tentativa reutilizava a
 * mesma falha ate a cliente fechar e reabrir o app.
 */
import {
  lazyWithPreload,
  reiniciarCargasQueFalharam,
} from "@/utils/lazyWithPreload";
import React, { Suspense, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Tela = () => <div>tela carregada</div>;

class Captura extends React.Component<
  { children: React.ReactNode },
  { erro: Error | null }
> {
  state: { erro: Error | null } = { erro: null };
  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }
  render() {
    return this.state.erro ? (
      <div>falhou: {this.state.erro.message}</div>
    ) : (
      this.props.children
    );
  }
}

const FALHA = "Failed to fetch dynamically imported module: /assets/Tela.js";

describe("lazyWithPreload - esquece a falha de carregamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
  });

  async function montar(Aba: React.ComponentType) {
    await act(async () => {
      raiz.render(
        <Captura>
          <Suspense fallback={<div>carregando</div>}>
            <Aba />
          </Suspense>
        </Captura>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function desmontar() {
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
  }

  it("preload que rejeitou uma vez refaz o import na proxima tentativa", async () => {
    const fabrica = vi
      .fn<() => Promise<{ default: typeof Tela }>>()
      .mockRejectedValueOnce(new Error(FALHA))
      .mockResolvedValue({ default: Tela });
    const Aba = lazyWithPreload(fabrica);

    await expect(Aba.preload()).rejects.toThrow(FALHA);
    await expect(Aba.preload()).resolves.toBe(Tela);

    expect(fabrica).toHaveBeenCalledTimes(2);
    expect(Aba.getLoaded()).toBe(Tela);
  });

  it("depois de carregar com sucesso nao importa de novo", async () => {
    const fabrica = vi.fn().mockResolvedValue({ default: Tela });
    const Aba = lazyWithPreload(fabrica);

    await Aba.preload();
    await Aba.preload();

    expect(fabrica).toHaveBeenCalledTimes(1);
  });

  it("aba que rejeitou ao montar volta a carregar depois do reinicio", async () => {
    const fabrica = vi
      .fn<() => Promise<{ default: typeof Tela }>>()
      .mockRejectedValueOnce(new Error(FALHA))
      .mockResolvedValue({ default: Tela });
    const Aba = lazyWithPreload(fabrica);

    await montar(Aba);
    expect(hospedeiro.textContent).toBe(`falhou: ${FALHA}`);
    await desmontar();

    // Sem o reinicio, o React.lazy segue entregando a mesma rejeicao.
    await montar(Aba);
    expect(hospedeiro.textContent).toBe(`falhou: ${FALHA}`);
    await desmontar();

    act(() => reiniciarCargasQueFalharam());

    await montar(Aba);
    expect(hospedeiro.textContent).toBe("tela carregada");
    expect(fabrica).toHaveBeenCalledTimes(2);
  });

  it("reiniciar nao toca em aba que ja carregou", async () => {
    const fabrica = vi.fn().mockResolvedValue({ default: Tela });
    const Aba = lazyWithPreload(fabrica);
    await Aba.preload();

    reiniciarCargasQueFalharam();
    await Aba.preload();

    expect(fabrica).toHaveBeenCalledTimes(1);
    expect(Aba.getLoaded()).toBe(Tela);
  });
});
