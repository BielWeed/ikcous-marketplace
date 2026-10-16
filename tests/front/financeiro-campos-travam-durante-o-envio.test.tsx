// @vitest-environment jsdom
// A RPC fica pendente para conferir a trava sem mudar o conteúdo enviado.
import { type ReactElement, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import type { FormularioDoLancamento } from "@/lib/financeiro";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-10-16";
const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_BANCARIA,
    nome: "Banco",
    tipo: "banco",
    saldoInicial: 50,
    saldoInicialEm: HOJE,
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 50,
  },
  {
    id: CONTA_CAIXA_DA_LOJA,
    nome: "Caixa",
    tipo: "caixa",
    saldoInicial: 0,
    saldoInicialEm: HOJE,
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 0,
  },
];
const CATEGORIA: CategoriaFinanceira = {
  id: "cat-aluguel",
  nome: "Aluguel",
  natureza: "despesa",
  grupoDre: "despesa_fixa",
  ativa: true,
  sistema: false,
};

type CampoEditavel =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | HTMLButtonElement;

function folha(): HTMLElement {
  const elemento = document.querySelector<HTMLElement>(
    '[data-slot="sheet-content"]',
  );
  if (!elemento) throw new Error("Folha não abriu");
  return elemento;
}

function campos(): CampoEditavel[] {
  return [
    ...folha().querySelectorAll<CampoEditavel>(
      'input:not([type="hidden"]), textarea, select, button[aria-pressed], button[role="switch"]',
    ),
  ];
}

function conteudoDosCampos() {
  return campos().map((campo) => ({
    valor: campo.value,
    marcado: campo instanceof HTMLInputElement ? campo.checked : null,
    pressionado: campo.getAttribute("aria-pressed"),
    ligado: campo.getAttribute("aria-checked"),
  }));
}

function botao(rotulo: string): HTMLButtonElement {
  const elemento = [...folha().querySelectorAll("button")].find(
    (candidato) => candidato.textContent?.trim() === rotulo,
  );
  if (!elemento) throw new Error(`Botão ${rotulo} não existe`);
  return elemento;
}

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

interface Caso {
  readonly nome: string;
  readonly montar: (aoSalvar: (mensagem: string) => void) => ReactElement;
  readonly campoDeTexto: string;
  readonly texto: string;
  readonly rpc: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly salvar: string;
}

const LANCAMENTOS: {
  nome: string;
  inicial: Partial<FormularioDoLancamento>;
  payload: Readonly<Record<string, unknown>>;
}[] = [
  {
    nome: "lançamento realizado",
    inicial: { formaPagamento: "pix" },
    payload: {
      categoria_id: CATEGORIA.id,
      status: "realizado",
      data_realizacao: HOJE,
      forma_pagamento: "pix",
    },
  },
  {
    nome: "lançamento previsto parcelado",
    inicial: { situacao: "previsto", parcelas: "3" },
    payload: {
      categoria_id: CATEGORIA.id,
      status: "previsto",
      data_vencimento: HOJE,
      parcelas: 3,
    },
  },
  {
    nome: "transferência",
    inicial: {
      tipo: "transferencia",
      contaDestinoId: CONTA_CAIXA_DA_LOJA,
    },
    payload: {
      conta_destino_id: CONTA_CAIXA_DA_LOJA,
      status: "realizado",
      data_realizacao: HOJE,
    },
  },
];

const CASOS: Caso[] = [
  ...LANCAMENTOS.map(
    ({ nome, inicial, payload }): Caso => ({
      nome,
      montar: (aoSalvar) => (
        <NovoLancamentoFolha
          hoje={HOJE}
          contas={CONTAS}
          categorias={[CATEGORIA]}
          inicial={{
            valor: "120.00",
            categoriaId: CATEGORIA.id,
            observacao: "Conferido",
            ...inicial,
          }}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />
      ),
      campoDeTexto: "fin-lanc-descricao",
      texto: "Movimento de outubro",
      rpc: "fin_lancamento_salvar",
      payload: {
        tipo: inicial.tipo ?? "saida",
        valor: 120,
        conta_id: CONTA_BANCARIA,
        descricao: "Movimento de outubro",
        data_competencia: HOJE,
        observacao: "Conferido",
        ...payload,
      },
      salvar: "Salvar lançamento",
    }),
  ),
  ...[false, true].flatMap((sistema): Caso[] => [
    {
      nome: sistema ? "conta do sistema" : "nova conta",
      montar: (aoSalvar) => (
        <ContaFolha
          conta={sistema ? CONTAS[0] : null}
          hoje={HOJE}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />
      ),
      campoDeTexto: "fin-conta-nome",
      texto: "Banco da loja",
      rpc: "fin_conta_salvar",
      payload: {
        ...(sistema ? { id: CONTA_BANCARIA } : {}),
        nome: "Banco da loja",
        tipo: "banco",
        saldo_inicial: sistema ? 50 : 0,
        saldo_inicial_em: HOJE,
        ativa: true,
      },
      salvar: "Salvar",
    },
    {
      nome: sistema ? "categoria do sistema" : "nova categoria",
      montar: (aoSalvar) => (
        <CategoriaFolha
          categoria={sistema ? { ...CATEGORIA, sistema: true } : null}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />
      ),
      campoDeTexto: "fin-categoria-nome",
      texto: "Aluguel da loja",
      rpc: "fin_categoria_salvar",
      payload: {
        ...(sistema ? { id: CATEGORIA.id } : {}),
        nome: "Aluguel da loja",
        natureza: "despesa",
        grupo_dre: "despesa_fixa",
        ativa: true,
      },
      salvar: "Salvar",
    },
  ]),
];

describe.each(CASOS)("Financeiro — $nome", (caso) => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it.each(["sucesso", "erro"])(
    "trava todos os campos durante o envio e restaura após %s",
    async (desfecho) => {
      const aoSalvar = vi.fn();
      let concluir!: (falhou: boolean) => void;
      const resposta = new Promise((resolve, reject) => {
        concluir = (falhou) => {
          if (falhou) reject(new Error("Falha na conexão"));
          else resolve({ data: { ids: ["salvo"] }, error: null });
        };
      });
      rpcFalso.mockReturnValue(resposta);

      await act(async () => raiz.render(caso.montar(aoSalvar)));
      await digitar(caso.campoDeTexto, caso.texto);
      const aberta = folha();
      const conteudo = conteudoDosCampos();
      const desabilitadosAntes = campos().map((campo) => campo.disabled);
      expect(campos().length).toBeGreaterThan(0);
      expect(desabilitadosAntes).toContain(false);

      await act(async () => botao(caso.salvar).click());

      try {
        expect(rpcFalso).toHaveBeenCalledExactlyOnceWith(caso.rpc, {
          p: caso.payload,
        });
        expect(aoSalvar).not.toHaveBeenCalled();
        for (const campo of campos()) expect(campo.disabled).toBe(true);
        expect(botao("Salvando…").disabled).toBe(true);
        expect(conteudoDosCampos()).toEqual(conteudo);
      } finally {
        await act(async () => concluir(desfecho === "erro"));
      }

      expect(campos().map((campo) => campo.disabled)).toEqual(
        desabilitadosAntes,
      );
      expect(botao(caso.salvar).disabled).toBe(false);
      expect(conteudoDosCampos()).toEqual(conteudo);
      expect(rpcFalso).toHaveBeenCalledTimes(1);
      if (desfecho === "erro") {
        expect(aoSalvar).not.toHaveBeenCalled();
        expect(folha()).toBe(aberta);
        expect(aberta.textContent).toContain("Confira a conexão");
        await digitar(caso.campoDeTexto, "Correção após a falha");
        expect(
          (document.getElementById(caso.campoDeTexto) as HTMLInputElement)
            .value,
        ).toBe("Correção após a falha");
      } else {
        expect(aoSalvar).toHaveBeenCalledTimes(1);
      }
    },
  );
});
