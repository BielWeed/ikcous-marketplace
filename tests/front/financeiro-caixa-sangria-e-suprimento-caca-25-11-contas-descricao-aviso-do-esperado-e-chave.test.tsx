// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — folha de Sangria e Suprimento do caixa.
// RISCO: dinheiro que muda de conta. Os testes antigos cobriam o valor (zero,
// negativo, teto) mas não QUAL conta recebe o dinheiro, a descrição que vai
// para o extrato, o aviso de "mais do que o esperado" e a chave que impede
// gravar duas vezes a mesma sangria.
//
// O que se prova aqui:
//  - a lista de contas só traz contas ATIVAS que não são o próprio caixa, e o
//    Banco já vem escolhido; sem Banco, a pessoa PRECISA escolher e a tela diz
//    "Escolha a conta de destino/origem";
//  - sem nenhuma outra conta ativa o botão fica travado e a frase explica;
//  - contas ainda não carregadas dizem "ainda não carregaram" (não "não há conta");
//  - a descrição vai sem espaços nas pontas e, em branco, vira o texto padrão;
//  - o aviso de "mais do que o esperado" só aparece na sangria, só acima do
//    esperado (em centavos), e o aviso de esperado incerto só quando ele é nulo;
//  - repetir uma sangria depois de falha de rede reenvia a MESMA chave, e a
//    chave guardada some depois que o servidor confirma.
// Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { MovimentarCaixaFolha } from "@/components/admin/financeiro/FolhasDoCaixa";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type ContaFinanceira,
  type TipoDeConta,
} from "@/types/financeiro";

const COFRE = "conta-cofre-teste";
const ANTIGA = "conta-antiga-teste";

function conta(
  id: string,
  nome: string,
  tipo: TipoDeConta,
  ativa = true,
): ContaFinanceira {
  return {
    id,
    nome,
    tipo,
    saldoInicial: 0,
    saldoInicialEm: "2026-11-13",
    ativa,
    ordem: 1,
    sistema: false,
    saldo: 100,
  };
}

const CAIXA = conta(CONTA_CAIXA_DA_LOJA, "Caixa da loja", "caixa");
const BANCO = conta(CONTA_BANCARIA, "Banco", "banco");
const CAIXA_E_BANCO_E_COFRE = [
  CAIXA,
  BANCO,
  conta(COFRE, "Cofre", "outro"),
  conta(ANTIGA, "Conta antiga", "outro", false),
];

const semEfeito = () => {};
const semEfeitoAsync = async () => {};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset().mockImplementation(async () => ({
    data: { id: "mov-1", replay: false, status: "realizado" },
    error: null,
  }));
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
const texto = () => normalizar(document.body.textContent);

async function montar(
  movimento: "sangria" | "suprimento",
  opcoes: {
    contas?: readonly ContaFinanceira[];
    esperado?: number | null;
    autorId?: string | null;
  } = {},
) {
  await act(async () =>
    raiz.render(
      <MovimentarCaixaFolha
        autorId={opcoes.autorId === undefined ? "autor-1" : opcoes.autorId}
        aoReconciliar={semEfeitoAsync}
        aoMudarEnviando={semEfeito}
        sessaoId="sessao-1"
        movimento={movimento}
        esperado={opcoes.esperado === undefined ? 100 : opcoes.esperado}
        contas={opcoes.contas ?? CAIXA_E_BANCO_E_COFRE}
        contaDoCaixa={CONTA_CAIXA_DA_LOJA}
        aoFechar={semEfeito}
        aoSalvar={semEfeito}
        aoMudarSujo={semEfeito}
      />,
    ),
  );
}

async function colar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
        data: valor,
      }),
    );
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function escolherConta(id: string) {
  const select = document.getElementById(
    "fin-caixa-mov-conta",
  ) as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLSelectElement.prototype,
      "value",
    )?.set?.call(select, id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const botaoDeRegistro = (movimento: "sangria" | "suprimento") =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      normalizar(b.textContent) ===
      (movimento === "sangria" ? "Registrar sangria" : "Registrar suprimento"),
  ) as HTMLButtonElement;

async function registrar(movimento: "sangria" | "suprimento") {
  await act(async () => botaoDeRegistro(movimento).click());
  for (let i = 0; i < 4; i += 1) await act(async () => Promise.resolve());
}

const seleto = () =>
  document.getElementById("fin-caixa-mov-conta") as HTMLSelectElement;
const chamadas = () =>
  rpc.mock.calls.filter(([nome]) => nome === "fin_caixa_movimentar_com_chave");

describe.each(["sangria", "suprimento"] as const)(
  "%s — a conta",
  (movimento) => {
    const destino = movimento === "sangria" ? "destino" : "origem";

    it("a lista só traz contas ativas que não são o caixa, e o Banco já vem escolhido", async () => {
      await montar(movimento);
      expect([...seleto().options].map((o) => o.textContent)).toEqual([
        "Banco",
        "Cofre",
      ]);
      expect(seleto().value).toBe(CONTA_BANCARIA);
      // E vai para o servidor: o Banco, sem a pessoa precisar mexer.
      await colar("fin-caixa-mov-valor", "10,00");
      await registrar(movimento);
      expect(chamadas()[0][1]).toMatchObject({
        p_conta_contrapartida: CONTA_BANCARIA,
      });
    });

    it("escolher o Cofre manda o dinheiro para o Cofre", async () => {
      await montar(movimento);
      await escolherConta(COFRE);
      await colar("fin-caixa-mov-valor", "10,00");
      await registrar(movimento);
      expect(chamadas()[0][1]).toMatchObject({ p_conta_contrapartida: COFRE });
    });

    it("sem Banco entre as contas nada vem escolhido: precisa escolher, e a tela diz qual conta", async () => {
      await montar(movimento, {
        contas: [CAIXA, conta(COFRE, "Cofre", "outro")],
      });
      expect(seleto().value).toBe("");
      const vazia = [...seleto().options].find((o) => o.value === "");
      expect(vazia?.textContent).toBe("Escolha uma conta");
      expect(vazia?.disabled).toBe(true);
      // Antes de tentar, ainda não reclama.
      expect(texto()).not.toContain(`Escolha a conta de ${destino}.`);

      await colar("fin-caixa-mov-valor", "10,00");
      await registrar(movimento);
      expect(chamadas()).toHaveLength(0);
      expect(texto()).toContain(`Escolha a conta de ${destino}.`);

      await escolherConta(COFRE);
      expect(texto()).not.toContain(`Escolha a conta de ${destino}.`);
      await registrar(movimento);
      expect(chamadas()).toHaveLength(1);
      expect(chamadas()[0][1]).toMatchObject({ p_conta_contrapartida: COFRE });
    });

    it("sem nenhuma outra conta ativa: a frase explica, o botão trava e nada é gravado", async () => {
      await montar(movimento, {
        contas: [CAIXA, conta(ANTIGA, "Conta antiga", "outro", false)],
      });
      expect(texto()).toContain(
        `Não há outra conta ativa ${movimento === "sangria" ? "para receber" : "de onde tirar"} esse dinheiro.`,
      );
      expect(seleto().options).toHaveLength(0);
      expect(botaoDeRegistro(movimento).disabled).toBe(true);
      await colar("fin-caixa-mov-valor", "10,00");
      await act(async () => botaoDeRegistro(movimento).click());
      expect(chamadas()).toHaveLength(0);
    });

    it("contas ainda não carregadas: diz 'ainda não carregaram' (e não 'não há conta') e trava o botão", async () => {
      await montar(movimento, { contas: [] });
      expect(texto()).toContain(
        "As contas ainda não carregaram. Aguarde um instante ou atualize a página.",
      );
      expect(texto()).not.toContain("Não há outra conta ativa");
      expect(botaoDeRegistro(movimento).disabled).toBe(true);
    });
  },
);

describe.each(["sangria", "suprimento"] as const)(
  "%s — a descrição que vai para o extrato",
  (movimento) => {
    const padrao =
      movimento === "sangria" ? "Sangria do caixa" : "Suprimento do caixa";

    it.each([
      ["vazia", "", padrao],
      ["só espaços", "     ", padrao],
      ["com espaços nas pontas", "  depósito de sexta  ", "depósito de sexta"],
    ])("descrição %s", async (_nome, digitada, enviada) => {
      await montar(movimento);
      if (digitada !== "") await colar("fin-caixa-mov-descricao", digitada);
      await colar("fin-caixa-mov-valor", "10,00");
      await registrar(movimento);
      expect(chamadas()).toHaveLength(1);
      expect(chamadas()[0][1]).toMatchObject({ p_descricao: enviada });
    });
  },
);

describe("avisos sobre o esperado na gaveta", () => {
  const MAIS_QUE_O_ESPERADO = "É mais do que o esperado na gaveta";
  const INCERTO = "Não deu para atualizar o esperado na gaveta";

  it.each([
    ["100,01", true],
    ["100,00", false],
    ["99,99", false],
    ["1.000,00", true],
  ])(
    "sangria de %s com R$ 100,00 esperados: aviso? %s",
    async (digitado, avisa) => {
      await montar("sangria", { esperado: 100 });
      await colar("fin-caixa-mov-valor", digitado);
      if (avisa) {
        expect(texto()).toContain(MAIS_QUE_O_ESPERADO);
        expect(texto()).toContain("(R$ 100,00)");
      } else {
        expect(texto()).not.toContain(MAIS_QUE_O_ESPERADO);
      }
    },
  );

  it("o suprimento nunca avisa de 'mais do que o esperado' (entra dinheiro, não sai)", async () => {
    await montar("suprimento", { esperado: 100 });
    await colar("fin-caixa-mov-valor", "5.000,00");
    expect(texto()).not.toContain(MAIS_QUE_O_ESPERADO);
    expect(texto()).not.toContain("Esperado na gaveta");
  });

  it("a sangria mostra o esperado; com esperado nulo avisa que pode estar desatualizado", async () => {
    await montar("sangria", { esperado: 100 });
    expect(texto()).toContain("Esperado na gavetaR$ 100,00");
    expect(texto()).not.toContain(INCERTO);
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar("sangria", { esperado: null });
    expect(texto()).toContain(INCERTO);
    expect(texto()).not.toContain("Esperado na gaveta");
    // Esperado incerto não bloqueia nem avisa de "mais que o esperado".
    await colar("fin-caixa-mov-valor", "999,00");
    expect(texto()).not.toContain(MAIS_QUE_O_ESPERADO);
  });

  it("o suprimento com esperado nulo não mostra o aviso de esperado incerto", async () => {
    await montar("suprimento", { esperado: null });
    expect(texto()).not.toContain(INCERTO);
  });
});

describe("a chave que impede gravar duas vezes", () => {
  const CHAVE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const guardadas = () => {
    const achadas: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith("ikcous_fin_caixa_tentativa:")) achadas.push(k);
    }
    return achadas;
  };

  it("sem autor conhecido: repetir depois de falha reenvia a MESMA chave (e ela é um UUID v4)", async () => {
    rpc
      .mockReset()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "falha de rede" },
      })
      .mockResolvedValue({
        data: { id: "mov-1", replay: false, status: "realizado" },
        error: null,
      });
    await montar("sangria", { autorId: null });
    await colar("fin-caixa-mov-valor", "10,00");
    await registrar("sangria");
    expect(chamadas()).toHaveLength(1);
    await registrar("sangria");
    expect(chamadas()).toHaveLength(2);
    const primeira = (chamadas()[0][1] as { p_chave: string }).p_chave;
    const segunda = (chamadas()[1][1] as { p_chave: string }).p_chave;
    expect(primeira).toMatch(CHAVE);
    expect(segunda).toBe(primeira);
  });

  it("com autor: a chave fica guardada enquanto o servidor não respondeu e some quando ele confirma", async () => {
    rpc
      .mockReset()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "falha de rede" },
      })
      .mockResolvedValue({
        data: { id: "mov-1", replay: false, status: "realizado" },
        error: null,
      });
    await montar("sangria", { autorId: "autor-1" });
    await colar("fin-caixa-mov-valor", "10,00");
    await registrar("sangria");
    expect(guardadas()).toHaveLength(1);

    await registrar("sangria");
    expect(chamadas()).toHaveLength(2);
    const [a, b] = chamadas().map((c) => (c[1] as { p_chave: string }).p_chave);
    expect(b).toBe(a);
    // Confirmou: a intenção foi cumprida, nada fica guardado.
    expect(guardadas()).toHaveLength(0);
  });
});
