// @vitest-environment jsdom
import {
  ConfirmarRecebimento,
  PerguntaDoRecebimento,
} from "@/components/admin/orders/ConfirmarRecebimento";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("confirmação compartilhada do recebimento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function botao(texto: string) {
    const encontrado = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    );
    expect(encontrado).toBeTruthy();
    return encontrado!;
  }

  it("M8: duplo toque em Recebi grava uma vez enquanto a gravação está em voo", async () => {
    let concluir!: () => void;
    const pendente = new Promise<void>((resolve) => {
      concluir = resolve;
    });
    const gravar = vi.fn(() => pendente);
    await act(async () => {
      raiz.render(<ConfirmarRecebimento total={100} aoConfirmar={gravar} />);
    });
    await act(async () => botao("Marcar como recebido").click());

    const recebi = botao("Recebi");
    await act(async () => {
      // Dois eventos antes de o React fechar o diálogo: não depender do render
      // nem do disabled do pai para proteger o segundo toque.
      recebi.click();
      recebi.click();
    });
    expect(gravar).toHaveBeenCalledTimes(1);

    // Mesmo reabrindo a pergunta, a chamada anterior ainda não terminou.
    await act(async () => botao("Marcar como recebido").click());
    await act(async () => botao("Recebi").click());
    expect(gravar).toHaveBeenCalledTimes(1);

    await act(async () => concluir());
    await act(async () => botao("Recebi").click());
    expect(gravar).toHaveBeenCalledTimes(2);
  });

  it("Ainda não continua disponível offline/processando e mantém o foco e as classes da lista", async () => {
    const cancelar = vi.fn();
    const confirmar = vi.fn();
    await act(async () => {
      raiz.render(
        <PerguntaDoRecebimento
          total={100}
          disabled
          aoCancelar={cancelar}
          aoConfirmar={confirmar}
        />,
      );
    });
    const aindaNao = botao("Ainda não");
    expect(aindaNao.disabled).toBe(false);
    expect(botao("Recebi").disabled).toBe(true);
    for (const b of [aindaNao, botao("Recebi")]) {
      for (const classe of [
        "relative",
        "z-10",
        "whitespace-normal",
        "disabled:cursor-not-allowed",
        "disabled:text-zinc-400",
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-sky-300",
      ]) {
        expect(b.classList.contains(classe), classe).toBe(true);
      }
    }
    await act(async () => aindaNao.click());
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect(confirmar).not.toHaveBeenCalled();
  });
});
