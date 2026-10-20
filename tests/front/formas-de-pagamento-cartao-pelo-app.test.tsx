// @vitest-environment jsdom
//
// CARTÃO PELO APP (Fase 3.5, 26/09/2026) — o bloco novo de "Formas de
// pagamento" no painel: interruptores de Crédito e Débito e o "Parcelar em
// até" (1–12x, só com crédito). Lê a tabela `config_pagamento_cartao`, grava
// pela RPC `salvar_config_pagamento_cartao` e mostra o que o BANCO devolveu.
// Travado (com o porquê) sem o PIX pelo app ligado — desligar continua
// possível. Mesmo andaime de formas-de-pagamento-secao-admin.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, toastErro, toastSucesso } = vi.hoisted(() => ({
  banco: {
    linha: { credito: false, debito: false, parcelas_max: 1 } as unknown,
    erroDeLeitura: null as { message: string } | null,
    rpc: vi.fn(),
  },
  toastErro: vi.fn(),
  toastSucesso: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: banco.erroDeLeitura ? null : banco.linha,
            error: banco.erroDeLeitura,
          }),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => banco.rpc(...args),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro },
}));

import { FormasDePagamentoSection } from "@/components/admin/settings/FormasDePagamentoCard";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O aviso diz a verdade sobre o teste: ligar vale para a loja inteira, o jeito
// de conferir com a chave de produção é uma compra pequena com cartão REAL, e
// cartão de teste só passa com a chave de teste (com a de produção é recusado).
const TESTE_ANTES =
  "Ao ligar, o cartão já aparece para todos os clientes. Para conferir, faça uma compra de valor baixo com um cartão seu e devolva o valor depois, no Mercado Pago. Cartão de teste só funciona com a chave de teste; com a chave de produção ele é recusado.";

describe("Formas de pagamento — Cartão pelo app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.linha = { credito: false, debito: false, parcelas_max: 1 };
    banco.erroDeLeitura = null;
    banco.rpc.mockReset();
    banco.rpc.mockImplementation(async (_nome: string, p: any) => ({
      data: {
        id: 1,
        credito: p.p_credito,
        debito: p.p_debito,
        parcelas_max: p.p_parcelas_max,
      },
      error: null,
    }));
    toastErro.mockReset();
    toastSucesso.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function esperar() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  async function montar({
    pixLigado = true,
    isOffline = false,
  }: { pixLigado?: boolean; isOffline?: boolean } = {}) {
    await act(async () => {
      raiz.render(
        <FormasDePagamentoSection
          formasNaEntrega={["pix", "card", "cash"]}
          pixLigado={pixLigado}
          pixChaveOk={pixLigado}
          isOffline={isOffline}
          updateConfig={vi.fn(async () => true)}
          onAbrirMercadoPago={vi.fn()}
        />,
      );
    });
    await esperar();
  }

  function interruptor(rotulo: string): HTMLButtonElement {
    const alvo = hospedeiro.querySelector(
      `[role="switch"][aria-label="${rotulo}"]`,
    );
    if (!alvo) throw new Error(`O switch "${rotulo}" não está na tela.`);
    return alvo as HTMLButtonElement;
  }

  const credito = () => interruptor("Cartão de crédito pelo app");
  const debito = () => interruptor("Cartão de débito pelo app");
  const seletorDeParcelas = () =>
    [...hospedeiro.querySelectorAll("select")].find((s) =>
      s.labels?.[0]?.textContent?.includes("Parcelar em até"),
    ) as HTMLSelectElement | undefined;

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await esperar();
  }

  it("nasce como o banco diz (desligado), com o aviso de testar antes", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Cartão pelo app");
    expect(credito().getAttribute("data-state")).toBe("unchecked");
    expect(debito().getAttribute("data-state")).toBe("unchecked");
    expect(seletorDeParcelas()).toBeUndefined();
    expect(hospedeiro.textContent).toContain(TESTE_ANTES);
    // Não manda mais fazer "pedido de teste antes de ligar": o interruptor liga
    // para a loja inteira e o cartão de teste é recusado com chave de produção.
    expect(hospedeiro.textContent).not.toContain("Antes de ligar");
    expect(hospedeiro.textContent).not.toMatch(/pedido de teste/i);
  });

  it("distingue PIX, cartão e dinheiro sem mudar os nomes dos interruptores", async () => {
    await montar();
    const pix = interruptor("Pix na entrega ou retirada").closest("label")!;
    expect(
      pix.querySelector("svg.icone-pix")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(pix.querySelector(".lucide-wallet")).toBeNull();
    expect(hospedeiro.querySelectorAll("svg.icone-pix")).toHaveLength(2);
    expect(
      interruptor("Cartão na entrega ou retirada")
        .closest("label")!
        .querySelector(".lucide-credit-card"),
    ).not.toBeNull();
    expect(
      interruptor("Dinheiro na entrega ou retirada")
        .closest("label")!
        .querySelector(".lucide-banknote"),
    ).not.toBeNull();
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("ligar crédito grava pela RPC e mostra a linha devolvida — com o 'Parcelar em até' 1 a 12x", async () => {
    await montar();
    await clicar(credito());

    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: true,
      p_debito: false,
      p_parcelas_max: 1,
    });
    expect(credito().getAttribute("data-state")).toBe("checked");
    expect(toastSucesso).toHaveBeenCalledWith(
      "Cartão de crédito pelo app ligado",
    );

    const seletor = seletorDeParcelas();
    expect(seletor).toBeDefined();
    expect([...seletor!.options].map((o) => o.value)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );
  });

  it("onda L: clicar no TEXTO 'Crédito' (o <label> de 44px) liga o crédito uma única vez", async () => {
    await montar();
    const texto = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Crédito",
    );
    if (!texto) throw new Error("O texto 'Crédito' não está na tela.");
    expect(texto.closest("label")).not.toBeNull();
    await clicar(texto as HTMLElement);

    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: true,
      p_debito: false,
      p_parcelas_max: 1,
    });
  });

  it("onda L: clicar DIRETO no botão do switch de crédito grava uma única vez (o <label> não re-dispara o clique)", async () => {
    await montar();
    await clicar(credito());

    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: true,
      p_debito: false,
      p_parcelas_max: 1,
    });
  });

  it("onda L: crédito travado (sem PIX ligado e desligado): clicar no TEXTO não grava nada", async () => {
    await montar({ pixLigado: false });
    expect(credito().hasAttribute("disabled")).toBe(true);
    const texto = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Crédito",
    );
    if (!texto) throw new Error("O texto 'Crédito' não está na tela.");
    await clicar(texto as HTMLElement);

    expect(banco.rpc).not.toHaveBeenCalled();
    expect(credito().getAttribute("data-state")).toBe("unchecked");
  });

  it("onda L: débito travado (sem PIX ligado e desligado): clicar no TEXTO não grava nada", async () => {
    await montar({ pixLigado: false });
    expect(debito().hasAttribute("disabled")).toBe(true);
    const texto = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Débito",
    );
    if (!texto) throw new Error("O texto 'Débito' não está na tela.");
    await clicar(texto as HTMLElement);

    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("mudar o 'Parcelar em até' grava o teto novo, sem mexer nos tipos", async () => {
    banco.linha = { credito: true, debito: true, parcelas_max: 1 };
    await montar();

    const seletor = seletorDeParcelas()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!.call(seletor, "6");
      seletor.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();

    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: true,
      p_debito: true,
      p_parcelas_max: 6,
    });
    expect(seletorDeParcelas()!.value).toBe("6");
  });

  it("ligar débito sozinho não mostra parcelas (débito é à vista)", async () => {
    await montar();
    await clicar(debito());
    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: false,
      p_debito: true,
      p_parcelas_max: 1,
    });
    expect(debito().getAttribute("data-state")).toBe("checked");
    expect(seletorDeParcelas()).toBeUndefined();
  });

  it("sem o PIX pelo app ligado: ligar fica travado e a tela diz por quê", async () => {
    await montar({ pixLigado: false });
    expect(credito().disabled).toBe(true);
    expect(debito().disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("pagamento pelo app liberado");
    await clicar(credito());
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("sem o PIX pelo app, mas com crédito ligado: DESLIGAR continua possível", async () => {
    banco.linha = { credito: true, debito: false, parcelas_max: 3 };
    await montar({ pixLigado: false });
    expect(credito().disabled).toBe(false);
    expect(debito().disabled).toBe(true);
    await clicar(credito());
    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: false,
      p_debito: false,
      p_parcelas_max: 3,
    });
  });

  it("leitura que falha não finge 'desligado': avisa e não mostra interruptor", async () => {
    banco.erroDeLeitura = { message: "permission denied" };
    await montar();
    expect(hospedeiro.textContent).toContain(
      "Não foi possível ler a configuração do cartão",
    );
    expect(
      hospedeiro.querySelector('[aria-label="Cartão de crédito pelo app"]'),
    ).toBeNull();
  });

  it("RPC recusando: toast com a frase curada e a tela continua no que o banco tinha", async () => {
    banco.rpc.mockResolvedValue({
      data: null,
      error: { message: "insufficient_privilege", code: "42501" },
    });
    await montar();
    await clicar(credito());
    expect(toastErro).toHaveBeenCalledWith(
      "Só o administrador da loja pode mudar o cartão pelo app.",
    );
    expect(credito().getAttribute("data-state")).toBe("unchecked");
  });

  it("offline: não chama a RPC e avisa", async () => {
    await montar({ isOffline: true });
    await clicar(credito());
    expect(banco.rpc).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledWith("Você está offline");
  });
});
