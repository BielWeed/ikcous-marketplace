// @vitest-environment jsdom
//
// Financeiro — folhas do caixa: o sinal de menos digitado ou colado NÃO pode
// sumir em silêncio. Os campos "Dinheiro na gaveta" (abrir caixa), "Valor"
// (sangria/suprimento) e "Dinheiro contado" (fechar caixa) usavam a máscara de
// moeda sem `permiteNegativo`, que descartava o "-": colar "-10,00" mostrava
// "10,00", a validação (`< 0` / `<= 0`) passava e o servidor recebia +10, sem
// aviso (a sangria de "-10" saía como sangria de +10).
// O servidor recusa negativo nas três (fin_caixa_abrir, fin_caixa_fechar_sessao
// e fin_caixa_movimentar_com_chave), então não existe motivo legítimo para o
// sinal passar: a máscara agora o carrega até a validação, que recusa.
//
// Os testes antigos injetam o valor já formatado e nunca discriminam o sinal
// da máscara: aqui o negativo entra pelo campo, do jeito que a pessoa faz.
import { type ReactElement, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import {
  AbrirCaixaFolha,
  FecharCaixaFolha,
  MovimentarCaixaFolha,
} from "@/components/admin/financeiro/FolhasDoCaixa";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CaixaAtual,
  type ContaFinanceira,
} from "@/types/financeiro";

const HOJE = "2026-11-13";
const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id, i) => ({
    id,
    nome: id === CONTA_BANCARIA ? "Banco" : "Caixa",
    tipo: id === CONTA_BANCARIA ? ("banco" as const) : ("caixa" as const),
    saldoInicial: 0,
    saldoInicialEm: HOJE,
    ativa: true,
    ordem: i + 1,
    sistema: true,
    saldo: 100,
  }),
);
const CAIXA: CaixaAtual = {
  id: "sessao-1",
  contaId: CONTA_CAIXA_DA_LOJA,
  contaNome: "Caixa",
  abertoEm: "2026-11-13T12:00:00Z",
  valorAbertura: 100,
  vendasDinheiro: 0,
  devolucoesDinheiro: 0,
  estornosExternosDinheiro: 0,
  entradasManuais: 0,
  saidasManuais: 0,
  esperado: 100,
  movimentos: [],
};

const semEfeito = () => {};
const semEfeitoAsync = async () => {};

interface Caso {
  readonly nome: string;
  readonly campo: string;
  readonly botao: string;
  readonly recusa: string;
  readonly funcaoRpc: string;
  readonly parametro: string;
  readonly montar: () => ReactElement;
}

const CASOS: Caso[] = [
  {
    nome: "abrir caixa",
    campo: "fin-caixa-abertura",
    botao: "Abrir caixa",
    recusa: "Conte o dinheiro da gaveta e informe o valor (pode ser 0,00).",
    funcaoRpc: "fin_caixa_abrir",
    parametro: "p_valor_abertura",
    montar: () => (
      <AbrirCaixaFolha
        contas={CONTAS}
        aoReconciliar={semEfeitoAsync}
        aoMudarEnviando={semEfeito}
        aoFechar={semEfeito}
        aoSalvar={semEfeito}
        aoMudarSujo={semEfeito}
      />
    ),
  },
  ...(["sangria", "suprimento"] as const).map(
    (movimento): Caso => ({
      nome: movimento,
      campo: "fin-caixa-mov-valor",
      botao:
        movimento === "sangria" ? "Registrar sangria" : "Registrar suprimento",
      recusa: "Informe um valor maior que zero.",
      funcaoRpc: "fin_caixa_movimentar_com_chave",
      parametro: "p_valor",
      montar: () => (
        <MovimentarCaixaFolha
          autorId="autor-1"
          aoReconciliar={semEfeitoAsync}
          aoMudarEnviando={semEfeito}
          sessaoId="sessao-1"
          movimento={movimento}
          esperado={100}
          contas={CONTAS}
          contaDoCaixa={CONTA_CAIXA_DA_LOJA}
          aoFechar={semEfeito}
          aoSalvar={semEfeito}
          aoMudarSujo={semEfeito}
        />
      ),
    }),
  ),
  {
    nome: "contagem do fechamento",
    campo: "fin-caixa-contado",
    botao: "Fechar caixa",
    recusa: "Conte a gaveta e informe o valor (pode ser 0,00).",
    funcaoRpc: "fin_caixa_fechar_sessao",
    parametro: "p_valor_contado",
    montar: () => (
      <FecharCaixaFolha
        aoReconciliar={semEfeitoAsync}
        aoMudarEnviando={semEfeito}
        caixa={CAIXA}
        aoFechar={semEfeito}
        aoFechado={semEfeito}
        aoMudarSujo={semEfeito}
      />
    ),
  },
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset().mockImplementation(async (nome: string) => {
    if (nome === "fin_caixa_movimentar_com_chave") {
      return {
        data: { id: "mov-1", replay: false, status: "realizado" },
        error: null,
      };
    }
    if (nome === "fin_caixa_fechar_sessao") {
      return {
        data: { id: "sessao-1", esperado: 100, contado: 10, diferenca: -90 },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  localStorage.clear();
});

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

/** O que o navegador faz: o campo passa a ter `valorNoCampo` e dispara `input`. */
async function evento(
  id: string,
  valorNoCampo: string,
  inputType: string,
  data?: string,
) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valorNoCampo);
    campo.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType, data }),
    );
  });
  // Sair do campo descarrega o valor para o formulário.
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function confirmar(rotulo: string) {
  const botao = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => normalizar(b.textContent) === rotulo);
  expect(botao).toBeTruthy();
  await act(async () => botao?.click());
  for (let i = 0; i < 4; i += 1) await act(async () => Promise.resolve());
}

const chamadas = (funcao: string) =>
  rpc.mock.calls.filter(([nome]) => nome === funcao);

describe.each(CASOS)(
  "caixa — $nome: valor negativo entra pela máscara",
  (caso) => {
    const campo = () => document.getElementById(caso.campo) as HTMLInputElement;
    const colar = (texto: string) =>
      evento(caso.campo, texto, "insertFromPaste", texto);
    const digitar = (texto: string) => evento(caso.campo, texto, "insertText");

    beforeEach(async () => {
      await act(async () => raiz.render(caso.montar()));
    });

    it.each([
      ["colar", "-10,00"],
      ["colar com sinal no fim", "10,00-"],
      ["colar entre parênteses", "(10,00)"],
      ["colar com R$ e sinal", "R$ -10,00"],
      ["colar menos um centavo", "-0,01"],
      ["digitar o sinal e os dígitos", "-1000"],
    ])("%s %j: o sinal fica à vista e nada é gravado", async (modo, texto) => {
      const entrar = modo.startsWith("colar") ? colar : digitar;
      await entrar(texto);
      // O campo mostra o que a pessoa colocou: nada de trocar por valor positivo.
      expect(campo().value.startsWith("-")).toBe(true);

      await confirmar(caso.botao);

      expect(chamadas(caso.funcaoRpc)).toHaveLength(0);
      expect(normalizar(document.body.textContent)).toContain(caso.recusa);
    });

    it("controle: colar 10,00 positivo continua gravando 10", async () => {
      await colar("10,00");
      expect(campo().value).toBe("10,00");

      await confirmar(caso.botao);

      expect(chamadas(caso.funcaoRpc)).toHaveLength(1);
      expect(chamadas(caso.funcaoRpc)[0][1]).toMatchObject({
        [caso.parametro]: 10,
      });
    });

    it("controle: digitar 1000 (centavos) continua virando 10,00 e gravando 10", async () => {
      await digitar("1000");
      expect(campo().value).toBe("10,00");

      await confirmar(caso.botao);

      expect(chamadas(caso.funcaoRpc)[0][1]).toMatchObject({
        [caso.parametro]: 10,
      });
    });

    it("apagar o sinal depois de recusado deixa gravar o valor positivo", async () => {
      await colar("-10,00");
      await confirmar(caso.botao);
      expect(chamadas(caso.funcaoRpc)).toHaveLength(0);

      await colar("10,00");
      await confirmar(caso.botao);

      expect(chamadas(caso.funcaoRpc)).toHaveLength(1);
      expect(chamadas(caso.funcaoRpc)[0][1]).toMatchObject({
        [caso.parametro]: 10,
      });
    });
  },
);
