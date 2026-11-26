// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — folhas do caixa: o ZERO.
// RISCO: dinheiro. A tela promete "pode ser 0,00" na abertura e no fechamento
// (gaveta vazia é normal), mas exige "maior que zero" na sangria e no
// suprimento. Os testes antigos só provavam o negativo e o teto; trocar
// `< 0` por `<= 0` (ou o contrário) passava despercebido e travava a abertura
// de um caixa sem troco, ou deixava gravar uma sangria de R$ 0,00.
//
// Aqui o valor entra pelo campo, do jeito que a pessoa faz, e o que vai ao
// servidor é conferido pela chamada da RPC.
import { act } from "react";
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

const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id, i) => ({
    id,
    nome: id === CONTA_BANCARIA ? "Banco" : "Caixa",
    tipo: id === CONTA_BANCARIA ? ("banco" as const) : ("caixa" as const),
    saldoInicial: 0,
    saldoInicialEm: "2026-11-13",
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
        data: { id: "sessao-1", esperado: 100, contado: 0, diferenca: -100 },
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
  (t ?? "")
    .replaceAll(String.fromCharCode(160), " ")
    .replace(/\s+/g, " ")
    .trim();

async function colar(id: string, texto: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, texto);
    campo.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
        data: texto,
      }),
    );
  });
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
const texto = () => normalizar(document.body.textContent);

describe("Abrir caixa — zero e prévia", () => {
  beforeEach(async () => {
    await act(async () =>
      raiz.render(
        <AbrirCaixaFolha
          contas={CONTAS}
          aoReconciliar={semEfeitoAsync}
          aoMudarEnviando={semEfeito}
          aoFechar={semEfeito}
          aoSalvar={semEfeito}
          aoMudarSujo={semEfeito}
        />,
      ),
    );
  });

  it("abrir com troco 0,00 é permitido: grava 0 e não mostra recusa", async () => {
    await colar("fin-caixa-abertura", "0,00");
    await confirmar("Abrir caixa");
    expect(chamadas("fin_caixa_abrir")).toHaveLength(1);
    expect(chamadas("fin_caixa_abrir")[0][1]).toMatchObject({
      p_valor_abertura: 0,
    });
    expect(texto()).not.toContain("Conte o dinheiro da gaveta e informe");
  });

  it("com 0,00 na gaveta e R$ 100,00 no sistema, a prévia já avisa que faltam R$ 100,00", async () => {
    await colar("fin-caixa-abertura", "0,00");
    expect(texto()).toContain("Faltam R$ 100,00 em relação ao sistema.");
  });

  it("no teto exato (R$ 99.999.999,99) a prévia ainda aparece; um centavo acima ela some e a recusa fala do limite", async () => {
    await colar("fin-caixa-abertura", "99.999.999,99");
    expect(texto()).toContain("Sobram R$ 99.999.899,99 em relação ao sistema.");
    await colar("fin-caixa-abertura", "100.000.000,00");
    expect(texto()).not.toContain("em relação ao sistema");
    await confirmar("Abrir caixa");
    expect(chamadas("fin_caixa_abrir")).toHaveLength(0);
    expect(texto()).toContain("Valor acima do limite.");
  });

  it("a prévia some quando o valor bate e vira 'Sobram' quando passa", async () => {
    await colar("fin-caixa-abertura", "100,00");
    expect(texto()).not.toContain("em relação ao sistema");
    await colar("fin-caixa-abertura", "150,00");
    expect(texto()).toContain("Sobram R$ 50,00 em relação ao sistema.");
    expect(texto()).not.toContain("Faltam");
  });
});

describe("Fechar caixa — zero contado", () => {
  beforeEach(async () => {
    await act(async () =>
      raiz.render(
        <FecharCaixaFolha
          aoReconciliar={semEfeitoAsync}
          aoMudarEnviando={semEfeito}
          caixa={CAIXA}
          aoFechar={semEfeito}
          aoFechado={semEfeito}
          aoMudarSujo={semEfeito}
        />,
      ),
    );
  });

  it("contar 0,00 é permitido: grava 0 e não mostra recusa", async () => {
    await colar("fin-caixa-contado", "0,00");
    await confirmar("Fechar caixa");
    expect(chamadas("fin_caixa_fechar_sessao")).toHaveLength(1);
    expect(chamadas("fin_caixa_fechar_sessao")[0][1]).toMatchObject({
      p_valor_contado: 0,
    });
    expect(texto()).not.toContain("Conte a gaveta e informe");
  });

  const comparativo = () =>
    normalizar(
      document.querySelector('dl[aria-label="Esperado, contado e diferença"]')
        ?.textContent,
    );

  it("com 0,00 contado e R$ 100,00 esperados, o comparativo já mostra a quebra de R$ 100,00", async () => {
    // Antes de digitar não há conta: o rótulo é o neutro.
    expect(comparativo()).toContain("Diferença");
    expect(comparativo()).not.toContain("Quebra");
    await colar("fin-caixa-contado", "0,00");
    expect(comparativo()).toContain("Quebra");
    expect(comparativo()).toContain("R$ 100,00");
  });

  it("se o servidor falhar com 0,00 contado, a tela mostra o erro do servidor e não a recusa de valor", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "fin_caixa_fechar_sessao"
        ? { data: null, error: { message: "falha de rede" } }
        : { data: null, error: null },
    );
    await colar("fin-caixa-contado", "0,00");
    await confirmar("Fechar caixa");
    expect(chamadas("fin_caixa_fechar_sessao")).toHaveLength(1);
    expect(texto()).not.toContain("Conte a gaveta e informe");
  });

  async function escreverObservacao(valor: string) {
    const campo = document.getElementById(
      "fin-caixa-observacao",
    ) as HTMLTextAreaElement;
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  it("observação só com espaços não vai ao servidor", async () => {
    await colar("fin-caixa-contado", "100,00");
    await escreverObservacao("    ");
    await confirmar("Fechar caixa");
    const args = chamadas("fin_caixa_fechar_sessao")[0][1] as {
      p_observacao?: string | null;
    };
    expect(args.p_observacao ?? null).toBeNull();
  });

  it("observação com espaços nas pontas vai sem eles", async () => {
    await colar("fin-caixa-contado", "100,00");
    await escreverObservacao("  troco dado a mais  ");
    await confirmar("Fechar caixa");
    expect(chamadas("fin_caixa_fechar_sessao")[0][1]).toMatchObject({
      p_observacao: "troco dado a mais",
    });
  });
});

describe.each(["sangria", "suprimento"] as const)(
  "%s — zero é recusado, um centavo passa",
  (movimento) => {
    const botao =
      movimento === "sangria" ? "Registrar sangria" : "Registrar suprimento";
    beforeEach(async () => {
      await act(async () =>
        raiz.render(
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
          />,
        ),
      );
    });

    it("0,00: não grava e diz 'maior que zero'", async () => {
      await colar("fin-caixa-mov-valor", "0,00");
      await confirmar(botao);
      expect(chamadas("fin_caixa_movimentar_com_chave")).toHaveLength(0);
      expect(texto()).toContain("Informe um valor maior que zero.");
    });

    it("0,01: grava um centavo e não mostra recusa", async () => {
      await colar("fin-caixa-mov-valor", "0,01");
      await confirmar(botao);
      expect(chamadas("fin_caixa_movimentar_com_chave")).toHaveLength(1);
      expect(chamadas("fin_caixa_movimentar_com_chave")[0][1]).toMatchObject({
        p_valor: 0.01,
      });
      expect(texto()).not.toContain("Informe um valor maior que zero.");
    });
  },
);
