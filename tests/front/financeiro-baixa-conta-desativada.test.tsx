// @vitest-environment jsdom
//
// Financeiro — "Dar baixa" numa conta a pagar/receber cuja conta foi
// DESATIVADA: o servidor recusa ("Escolha uma conta ativa."), então a tela não
// pode oferecer a conta inativa nem deixá-la como padrão. Com a conta do
// lançamento inativa, o campo começa vazio e a baixa só confirma depois de
// escolher uma conta ativa. Com a conta ativa, nada muda.
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
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-11-06";
const CONTA_VELHA = "00000000-0000-4000-8000-0000000000aa";

function conta(
  id: string,
  nome: string,
  ativa: boolean,
  ordem: number,
): ContaFinanceira {
  return {
    id,
    nome,
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa,
    ordem,
    sistema: false,
    saldo: 100,
  };
}

const CONTAS: ContaFinanceira[] = [
  conta(CONTA_CAIXA_DA_LOJA, "Caixa da loja", true, 1),
  conta(CONTA_BANCARIA, "Conta bancária", true, 2),
  conta(CONTA_VELHA, "Banco antigo", false, 3),
];

const ALVO: AlvoDaBaixa = {
  id: "lancamento-1",
  descricao: "Aluguel",
  valor: 1200,
  contaId: CONTA_BANCARIA,
  lado: "saida",
  vencimento: "2026-11-05",
};

const AJUDA_DA_CONTA_DESATIVADA =
  "A conta original está desativada: escolha de onde saiu o dinheiro ou reative a conta em Contas.";

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

function folha(): HTMLElement {
  const el = document.querySelector('[data-slot="sheet-content"]');
  if (!el) throw new Error("folha não abriu");
  return el as HTMLElement;
}

const seletor = () =>
  document.getElementById("fin-baixa-conta") as HTMLSelectElement;

const opcoes = () =>
  [...seletor().options].map((o) => [o.value, normalizar(o.textContent)]);

function confirmar(): HTMLButtonElement {
  const el = [...folha().querySelectorAll("button")].find(
    (b) => normalizar(b.textContent) === "Confirmar baixa",
  );
  if (!el) throw new Error("botão Confirmar baixa não existe");
  return el as HTMLButtonElement;
}

async function escolher(valor: string) {
  const el = seletor();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Financeiro — dar baixa com a conta do lançamento desativada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoMudarSujo: Mock<(sujo: boolean) => void>;
  let aoSalvar: Mock<(mensagem: string) => void>;

  async function abrir(alvo: AlvoDaBaixa, contas: readonly ContaFinanceira[]) {
    await act(async () => {
      raiz.render(
        <BaixarLancamentoFolha
          alvo={alvo}
          hoje={HOJE}
          contas={contas}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={aoMudarSujo}
        />,
      );
    });
  }

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({
      data: { id: "lancamento-1", status: "realizado" },
      error: null,
    });
    aoMudarSujo = vi.fn<(sujo: boolean) => void>();
    aoSalvar = vi.fn<(mensagem: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  describe("conta do lançamento DESATIVADA", () => {
    const alvoInativo: AlvoDaBaixa = { ...ALVO, contaId: CONTA_VELHA };

    it("o campo começa vazio, sem a conta inativa e sem 'A conta do lançamento'", async () => {
      await abrir(alvoInativo, CONTAS);

      expect(seletor().value).toBe("");
      expect(opcoes()).toEqual([
        ["", "Escolha uma conta ativa…"],
        [CONTA_CAIXA_DA_LOJA, "Caixa da loja"],
        [CONTA_BANCARIA, "Conta bancária"],
      ]);
      expect(normalizar(folha().textContent)).not.toContain(
        "A conta do lançamento",
      );
    });

    it("explica que a conta original está desativada e como sair", async () => {
      await abrir(alvoInativo, CONTAS);

      const texto = normalizar(folha().textContent);
      expect(texto).toContain(AJUDA_DA_CONTA_DESATIVADA);
      expect(texto).not.toContain("mesmo inativa");
    });

    it("o botão Confirmar baixa fica desabilitado até escolher uma conta ativa", async () => {
      await abrir(alvoInativo, CONTAS);
      expect(confirmar().disabled).toBe(true);

      // Mesmo forçando o clique, nada vai ao banco.
      await clicar(confirmar());
      expect(rpcFalso).not.toHaveBeenCalled();

      await escolher(CONTA_CAIXA_DA_LOJA);
      expect(confirmar().disabled).toBe(false);

      // E voltar ao vazio desabilita de novo.
      await escolher("");
      expect(confirmar().disabled).toBe(true);
    });

    it("escolhida uma conta ativa, a baixa manda ESSA conta ao servidor", async () => {
      await abrir(alvoInativo, CONTAS);
      await escolher(CONTA_CAIXA_DA_LOJA);
      await clicar(confirmar());

      expect(rpcFalso).toHaveBeenCalledTimes(1);
      expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_baixar", {
        p_id: "lancamento-1",
        p_data: HOJE,
        p_conta_id: CONTA_CAIXA_DA_LOJA,
      });
      expect(aoSalvar).toHaveBeenCalledWith("Pagamento registrado.");
    });

    it("abrir sem mexer não conta como alteração; escolher a conta conta", async () => {
      await abrir(alvoInativo, CONTAS);
      expect(aoMudarSujo).toHaveBeenLastCalledWith(false);

      await escolher(CONTA_BANCARIA);
      expect(aoMudarSujo).toHaveBeenLastCalledWith(true);
    });

    it("na receita, a ajuda fala de onde o dinheiro entrou", async () => {
      await abrir({ ...alvoInativo, lado: "entrada" }, CONTAS);

      const texto = normalizar(folha().textContent);
      expect(texto).toContain(
        "A conta original está desativada: escolha em que conta o dinheiro entrou ou reative a conta em Contas.",
      );
      expect(texto).not.toContain("de onde saiu o dinheiro");
    });
  });

  describe("conta do lançamento ATIVA (comportamento de sempre)", () => {
    it("o campo já vem com a conta do lançamento e a confirmação está liberada", async () => {
      await abrir(ALVO, CONTAS);

      expect(seletor().value).toBe(CONTA_BANCARIA);
      expect(confirmar().disabled).toBe(false);
      expect(opcoes()).toEqual([
        ["", "A conta do lançamento"],
        [CONTA_CAIXA_DA_LOJA, "Caixa da loja"],
        [CONTA_BANCARIA, "Conta bancária"],
      ]);
      const texto = normalizar(folha().textContent);
      expect(texto).toContain("A conta do lançamento ou outra conta ativa.");
      expect(texto).not.toContain("mesmo inativa");
      expect(texto).not.toContain("desativada");
      expect(aoMudarSujo).toHaveBeenLastCalledWith(false);
    });

    it("confirma com a conta do lançamento", async () => {
      await abrir(ALVO, CONTAS);
      await clicar(confirmar());

      expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_baixar", {
        p_id: "lancamento-1",
        p_data: HOJE,
        p_conta_id: CONTA_BANCARIA,
      });
    });

    it("a conta inativa que NÃO é a do lançamento também não é oferecida", async () => {
      await abrir(ALVO, CONTAS);

      expect(opcoes().map(([valor]) => valor)).not.toContain(CONTA_VELHA);
    });
  });

  describe("sem a lista de contas (ainda não carregou)", () => {
    it("lançamento sem conta e lista vazia continua confirmável, como antes", async () => {
      await abrir({ ...ALVO, contaId: null }, []);

      expect(seletor().value).toBe("");
      expect(confirmar().disabled).toBe(false);
      expect(normalizar(folha().textContent)).not.toContain("desativada");

      await clicar(confirmar());
      expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_baixar", {
        p_id: "lancamento-1",
        p_data: HOJE,
        p_conta_id: null,
      });
    });

    it("conta do lançamento que a lista não traz não é tratada como desativada", async () => {
      await abrir({ ...ALVO, contaId: "outra-que-nao-veio" }, CONTAS);

      expect(confirmar().disabled).toBe(false);
      expect(normalizar(folha().textContent)).not.toContain("desativada");
    });
  });
});
