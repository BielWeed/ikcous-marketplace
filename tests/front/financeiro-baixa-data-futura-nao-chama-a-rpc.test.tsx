// @vitest-environment jsdom
//
// A data da baixa é validada na folha, ANTES de chamar o banco.
// O servidor falso aceita tudo: é a guarda do front que precisa recusar amanhã.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { BaixarLancamentoFolha } from "@/components/admin/financeiro/FolhasDeLancamento";
import type { AlvoDaBaixa } from "@/components/admin/financeiro/navegacao";
import { CONTA_BANCARIA, type ContaFinanceira } from "@/types/financeiro";

// O componente recebe hoje por propriedade; não consulta o relógio da máquina.
const HOJE = "2026-11-11";
const AMANHA = "2026-11-12";
const ALVO: AlvoDaBaixa = {
  id: "lancamento-1",
  descricao: "Aluguel",
  valor: 1200,
  contaId: CONTA_BANCARIA,
  lado: "saida",
  vencimento: HOJE,
};
const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: false,
    saldo: 1500,
  },
];

function campoData(): HTMLInputElement {
  const campo = document.getElementById("fin-baixa-data");
  if (!(campo instanceof HTMLInputElement))
    throw new Error("Campo da data da baixa não existe");
  return campo;
}

async function digitarData(valor: string) {
  const campo = campoData();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function confirmar() {
  const botao = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Confirmar baixa",
  );
  if (!botao) throw new Error("Botão Confirmar baixa não existe");
  await act(async () => {
    botao.click();
  });
}

function esperarErroNaData(mensagem: string) {
  const erro = document.getElementById("fin-baixa-data-erro");
  expect(erro?.getAttribute("role")).toBe("alert");
  expect(erro?.textContent?.trim()).toBe(mensagem);
  expect(erro?.parentElement).toBe(campoData().parentElement);
}

describe("Financeiro — data da baixa validada antes da RPC", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoSalvar: Mock<(mensagem: string) => void>;

  beforeEach(async () => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({
      data: { id: ALVO.id, status: "realizado" },
      error: null,
    });
    aoSalvar = vi.fn<(mensagem: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <BaixarLancamentoFolha
          alvo={ALVO}
          hoje={HOJE}
          contas={CONTAS}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("amanhã mostra erro junto ao campo e não chama a RPC nem aoSalvar", async () => {
    await digitarData(AMANHA);
    expect(campoData().value).toBe(AMANHA);
    await confirmar();

    // Primeira asserção: a mutação tem de cair pela gravação indevida.
    expect(rpcFalso).not.toHaveBeenCalled();
    expect(aoSalvar).not.toHaveBeenCalled();
    esperarErroNaData(
      "A baixa é do que já aconteceu: a data não pode ser no futuro.",
    );
  });

  it("hoje permite a baixa e chama a RPC exatamente uma vez", async () => {
    await digitarData(HOJE);
    expect(campoData().value).toBe(HOJE);
    await confirmar();

    expect(rpcFalso).toHaveBeenCalledTimes(1);
    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_baixar", {
      p_id: ALVO.id,
      p_data: HOJE,
      p_conta_id: CONTA_BANCARIA,
    });
    expect(aoSalvar).toHaveBeenCalledTimes(1);
    expect(aoSalvar).toHaveBeenCalledWith("Pagamento registrado.");
    expect(document.getElementById("fin-baixa-data-erro")).toBeNull();
  });

  it.each(["", "data-inválida"])(
    "data vazia ou inválida (%j) pede a data sem chamar a RPC",
    async (valor) => {
      await digitarData(valor);
      // O input date do navegador normaliza valor inválido para vazio.
      expect(campoData().value).toBe("");
      await confirmar();

      expect(rpcFalso).not.toHaveBeenCalled();
      expect(aoSalvar).not.toHaveBeenCalled();
      esperarErroNaData("Informe a data.");
    },
  );
});
