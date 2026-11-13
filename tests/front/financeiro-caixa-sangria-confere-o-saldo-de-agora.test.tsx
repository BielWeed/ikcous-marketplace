// @vitest-environment jsdom
//
// Financeiro — a folha de Sangria NÃO barra o botão pelo "esperado" que ela
// recebeu quando abriu. Aparelho A abre a sangria com R$ 20 na gaveta; o
// aparelho B registra uma venda em dinheiro de R$ 100 na mesma sessão; no A a
// sangria de R$ 50 era barrada (a tela considerava R$ 20) embora existissem
// R$ 120, e a operação nem chegava ao servidor. O servidor (fin_caixa_
// movimentar_com_chave, sob trava da sessão) confere o dinheiro de AGORA e recusa
// o que passa dele: a folha só avisa e deixa o toque chegar lá.
// O que continua barrando na tela: faltar conta de destino.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import { MovimentarCaixaFolha } from "@/components/admin/financeiro/FolhasDoCaixa";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
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
    saldo: 20,
  }),
);
const SO_O_CAIXA = CONTAS.filter((c) => c.id === CONTA_CAIXA_DA_LOJA);

let host: HTMLDivElement;
let root: Root;
const aoSalvar = vi.fn();

beforeEach(() => {
  localStorage.clear();
  aoSalvar.mockReset();
  rpc.mockReset().mockResolvedValue({
    data: { id: "mov-1", replay: false, status: "realizado" },
    error: null,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();
const botao = (rotulo: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => normalizar(b.textContent) === rotulo,
  );
const chamadasDoMovimento = () =>
  rpc.mock.calls.filter(([nome]) => nome === "fin_caixa_movimentar_com_chave");

async function montar(
  esperado: number | null,
  opcoes: {
    movimento?: "sangria" | "suprimento";
    contas?: readonly ContaFinanceira[];
  } = {},
) {
  await act(async () =>
    root.render(
      <MovimentarCaixaFolha
        autorId="autor-1"
        aoReconciliar={vi.fn(async () => {})}
        aoMudarEnviando={vi.fn()}
        sessaoId="sessao-1"
        movimento={opcoes.movimento ?? "sangria"}
        esperado={esperado}
        contas={opcoes.contas ?? CONTAS}
        contaDoCaixa={CONTA_CAIXA_DA_LOJA}
        aoFechar={vi.fn()}
        aoSalvar={aoSalvar}
        aoMudarSujo={vi.fn()}
      />,
    ),
  );
}

async function digitarValor(valor: string) {
  const campo = document.getElementById(
    "fin-caixa-mov-valor",
  ) as HTMLInputElement;
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
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function registrar() {
  await act(async () => botao("Registrar sangria")!.click());
  for (let i = 0; i < 4; i += 1) await act(async () => Promise.resolve());
}

describe("sangria acima do esperado que a folha recebeu ao abrir", () => {
  it("o botão libera e o toque chega ao servidor, que confere o saldo de agora", async () => {
    await montar(20);
    await digitarValor("50,00");
    expect(botao("Registrar sangria")!.disabled).toBe(false);
    await registrar();
    const chamadas = chamadasDoMovimento();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0][1]).toMatchObject({
      p_sessao_id: "sessao-1",
      p_tipo: "sangria",
      p_valor: 50,
    });
    expect(aoSalvar).toHaveBeenCalledWith("Sangria registrada.");
  });

  it("avisa que passa do valor da abertura, sem prometer que o registro falha", async () => {
    await montar(20);
    await digitarValor("50,00");
    const aviso = [...document.querySelectorAll("p")].find((el) =>
      el.textContent?.includes("É mais do que o esperado"),
    );
    expect(aviso).toBeDefined();
    const texto = normalizar(aviso!.textContent);
    expect(texto).toMatch(/R\$\s?20,00/);
    expect(texto).toMatch(/outro aparelho/i);
    expect(texto).not.toContain("não registra");
    expect(aviso!.classList.contains("text-amber-400")).toBe(true);
  });

  it("o servidor recusa por saldo de agora: a frase dele aparece, nada é registrado e dá para tentar menos", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message:
          "A sangria (R$ 150.00) é maior que o dinheiro esperado no caixa (R$ 120.00).",
      },
    });
    await montar(20);
    await digitarValor("150,00");
    await registrar();
    expect(chamadasDoMovimento()).toHaveLength(1);
    expect(normalizar(document.body.textContent)).toContain(
      "A sangria (R$ 150,00) é maior que o dinheiro esperado no caixa (R$ 120,00).",
    );
    expect(aoSalvar).not.toHaveBeenCalled();
    expect(botao("Registrar sangria")!.disabled).toBe(false);

    await digitarValor("100,00");
    await registrar();
    expect(chamadasDoMovimento()).toHaveLength(2);
    expect(chamadasDoMovimento()[1][1]).toMatchObject({ p_valor: 100 });
    expect(aoSalvar).toHaveBeenCalledWith("Sangria registrada.");
  });

  it.each([
    { digitado: "20,00", enviado: 20 },
    { digitado: "20.00", enviado: 20 },
    { digitado: "20,01", enviado: 20.01 },
  ])(
    "o limite em centavos ($digitado) libera e chega ao servidor",
    async ({ digitado, enviado }) => {
      await montar(20);
      await digitarValor(digitado);
      expect(botao("Registrar sangria")!.disabled).toBe(false);
      await registrar();
      expect(chamadasDoMovimento()[0][1]).toMatchObject({ p_valor: enviado });
    },
  );

  it("valor igual ou menor que o esperado: sem aviso nenhum", async () => {
    await montar(20);
    await digitarValor("20,00");
    expect(normalizar(document.body.textContent)).not.toContain(
      "mais do que o esperado",
    );
  });

  it("valor zerado continua sendo recusado na tela, sem chamar o servidor", async () => {
    await montar(20);
    await digitarValor("0,00");
    await registrar();
    expect(chamadasDoMovimento()).toHaveLength(0);
    expect(normalizar(document.body.textContent)).toContain(
      "Informe um valor maior que zero.",
    );
  });

  it("sem outra conta para receber, o botão continua travado mesmo com valor pequeno", async () => {
    await montar(20, { contas: SO_O_CAIXA });
    await digitarValor("5,00");
    expect(botao("Registrar sangria")!.disabled).toBe(true);
    await registrar();
    expect(chamadasDoMovimento()).toHaveLength(0);
  });

  it("sem outra conta e acima do esperado: continua travado (a trava de conta não some)", async () => {
    await montar(20, { contas: SO_O_CAIXA });
    await digitarValor("50,00");
    expect(botao("Registrar sangria")!.disabled).toBe(true);
  });

  it("o suprimento nunca mostra aviso de esperado", async () => {
    await montar(20, { movimento: "suprimento" });
    await digitarValor("500,00");
    expect(normalizar(document.body.textContent)).not.toContain(
      "mais do que o esperado",
    );
    expect(botao("Registrar suprimento")!.disabled).toBe(false);
  });
});
