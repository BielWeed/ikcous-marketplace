// @vitest-environment jsdom
//
// Financeiro — "Novo lançamento": o sinal de menos digitado ou colado no campo
// de valor NÃO pode sumir em silêncio. A máscara de dinheiro, sem
// `permiteNegativo`, descartava o "-" (colar "-10,00" mostrava "10,00" e o
// formulário gravava +10). O teste antigo (valor-zero-ou-negativo-nao-grava)
// injeta "-10,00" direto no formulário e nunca passa pela máscara: aqui o
// negativo entra pelo campo, do jeito que a pessoa faz.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import type { CategoriaFinanceira, ContaFinanceira } from "@/types/financeiro";

const HOJE = "2026-11-10";
const RECUSA = "Informe um valor maior que zero.";

const conta: ContaFinanceira = {
  id: "banco-teste",
  nome: "Banco de teste",
  tipo: "banco",
  saldoInicial: 0,
  saldoInicialEm: "2026-01-01",
  ativa: true,
  ordem: 1,
  sistema: false,
  saldo: 100,
};
const categoria: CategoriaFinanceira = {
  id: "despesa-teste",
  nome: "Material",
  natureza: "despesa",
  grupoDre: "despesa_fixa",
  ativa: true,
  sistema: false,
};

const campo = () =>
  document.getElementById("fin-lanc-valor") as HTMLInputElement;

/** O que o navegador faz: o campo passa a ter `valorNoCampo` e dispara `input`. */
async function evento(valorNoCampo: string, inputType: string, data?: string) {
  await act(async () => {
    campo().focus();
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo(), valorNoCampo);
    campo().dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType, data }),
    );
  });
  // Sair do campo descarrega o valor para o formulário.
  await act(async () => {
    campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

const colar = (texto: string) => evento(texto, "insertFromPaste", texto);
const digitar = (texto: string) => evento(texto, "insertText");

async function salvar() {
  const botao = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Salvar lançamento",
  );
  expect(botao).toBeTruthy();
  await act(async () => {
    botao?.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Financeiro — valor negativo entra pela máscara e é recusado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ids: ["lancamento-teste"] }, error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <NovoLancamentoFolha
          hoje={HOJE}
          contas={[conta]}
          categorias={[categoria]}
          inicial={{
            descricao: "Compra de material",
            contaId: conta.id,
            categoriaId: categoria.id,
            formaPagamento: "pix",
          }}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
  });

  it.each([
    ["colar", "-10,00"],
    ["colar com sinal no fim", "10,00-"],
    ["colar entre parênteses", "(10,00)"],
    ["colar com R$ e sinal", "R$ -10,00"],
    ["colar menos um centavo", "-0,01"],
    ["digitar o sinal e os dígitos", "-1000"],
  ])(
    "%s %j: o sinal continua à vista e nada é gravado",
    async (modo, texto) => {
      const entrar = modo.startsWith("colar") ? colar : digitar;
      await entrar(texto);
      // O campo mostra o que a pessoa colocou: nada de trocar por valor positivo.
      expect(campo().value.startsWith("-")).toBe(true);

      await salvar();

      expect(rpc).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain(RECUSA);
    },
  );

  it("controle: colar 10,00 positivo continua gravando 10", async () => {
    await colar("10,00");
    expect(campo().value).toBe("10,00");

    await salvar();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "fin_lancamento_salvar",
      expect.objectContaining({
        p: expect.objectContaining({ valor: 10, tipo: "saida" }),
      }),
    );
  });

  it("controle: digitar 1000 (centavos) continua virando 10,00 e gravando 10", async () => {
    await digitar("1000");
    expect(campo().value).toBe("10,00");

    await salvar();

    expect(rpc).toHaveBeenCalledWith(
      "fin_lancamento_salvar",
      expect.objectContaining({
        p: expect.objectContaining({ valor: 10 }),
      }),
    );
  });

  it("apagar o sinal depois de recusado deixa gravar o valor positivo", async () => {
    await colar("-10,00");
    await salvar();
    expect(rpc).not.toHaveBeenCalled();

    await colar("10,00");
    await salvar();

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
