// @vitest-environment jsdom
import { BaixarLancamentoFolha } from "@/components/admin/financeiro/FolhasDeLancamento";
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const baixar = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useFinanceiro", () => ({
  baixarLancamento: baixar,
  cancelarLancamento: vi.fn(),
}));
vi.mock("@/components/admin/financeiro/FolhaFinanceira", () => ({
  FolhaFinanceira: ({
    children,
    rodape,
  }: { children: ReactNode; rodape: ReactNode }) => (
    <div>
      {children}
      {rodape}
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("baixa financeira com valores padrão também veta a atualização", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    baixar.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it.each([false, true])("marca até a RPC terminar (erro=%s)", async (erro) => {
    const envio = adiar<void>();
    baixar.mockReturnValue(envio.promessa);
    const aoSalvar = vi.fn();
    const aoMudarSujo = vi.fn();
    act(() =>
      raiz.render(
        <BaixarLancamentoFolha
          alvo={{
            id: "lancamento-teste",
            descricao: "Conta",
            valor: 10,
            contaId: null,
            lado: "entrada",
            vencimento: null,
          }}
          hoje="2026-10-16"
          contas={[]}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={aoMudarSujo}
        />,
      ),
    );
    expect(aoMudarSujo).toHaveBeenLastCalledWith(false);
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Confirmar baixa",
    );
    expect(botao).toBeDefined();
    try {
      act(() => botao?.click());
      expect(baixar).toHaveBeenCalledWith({
        id: "lancamento-teste",
        data: "2026-10-16",
        contaId: null,
      });
      expect(motivosDeOperacaoSensivel()).toEqual(["baixa-financeira"]);
      // Fechar a folha não cancela a gravação no servidor.
      act(() => raiz.render(null));
      expect(haOperacaoSensivel()).toBe(true);
    } finally {
      await act(async () => {
        if (erro) envio.rejeitar(new Error("falha simulada"));
        else envio.resolver(undefined);
        await envio.promessa.catch(() => {});
      });
    }
    expect(haOperacaoSensivel()).toBe(false);
    if (erro) expect(aoSalvar).not.toHaveBeenCalled();
    else expect(aoSalvar).toHaveBeenCalledWith("Recebimento registrado.");
  });
});
