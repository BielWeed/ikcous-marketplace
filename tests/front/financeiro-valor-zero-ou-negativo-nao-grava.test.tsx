// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import {
  formularioInicialDoLancamento,
  validarLancamento,
} from "@/lib/financeiro";
import type { CategoriaFinanceira, ContaFinanceira } from "@/types/financeiro";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

const hoje = "2026-11-10";
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
function formulario(valor: string) {
  return formularioInicialDoLancamento(hoje, {
    valor,
    descricao: "Compra de material",
    contaId: conta.id,
    categoriaId: categoria.id,
    formaPagamento: "pix",
  });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { ids: ["lancamento-teste"] },
    error: null,
  });
});
afterEach(() => {
  localStorage.clear();
});

it.each(["0,00", "-10,00"])(
  "validação recusa o valor preenchido %s, sem outros campos inválidos",
  (valor) => {
    expect(validarLancamento(formulario(valor), hoje)).toEqual({
      ok: false,
      erros: { valor: "Informe um valor maior que zero." },
    });
  },
);

it.each(["0,00", "-10,00"])(
  "folha não grava o valor preenchido %s",
  async (valor) => {
    const elemento = document.createElement("div");
    document.body.appendChild(elemento);
    const raiz = createRoot(elemento);
    const aoSalvar = vi.fn();
    try {
      await act(async () => {
        raiz.render(
          <NovoLancamentoFolha
            hoje={hoje}
            contas={[conta]}
            categorias={[categoria]}
            inicial={formulario(valor)}
            aoFechar={vi.fn()}
            aoSalvar={aoSalvar}
            aoMudarSujo={vi.fn()}
          />,
        );
      });
      const salvar = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Salvar lançamento",
      );
      expect(salvar).toBeTruthy();
      await act(async () => {
        salvar?.click();
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(aoSalvar).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain(
        "Informe um valor maior que zero.",
      );
    } finally {
      act(() => raiz.unmount());
      elemento.remove();
    }
  },
);

it("controle: valor positivo de 10,00 passa pela mesma validação", () => {
  expect(validarLancamento(formulario("10,00"), hoje)).toMatchObject({
    ok: true,
    payload: { valor: 10 },
  });
});
