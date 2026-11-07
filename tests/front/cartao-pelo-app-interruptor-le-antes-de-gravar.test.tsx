// @vitest-environment jsdom
//
// CARTÃO PELO APP — a tela fica aberta e o celular muda a configuração. O
// painel lia a linha só ao abrir e mandava as TRÊS coisas (crédito, débito e
// parcelas) a cada toque: ligar o "Débito" no computador desfazia, em
// silêncio, o "Parcelar em até 3x" escolhido no celular (a loja voltava a
// oferecer 6x à cliente). Agora, antes de gravar, o painel lê a linha de
// AGORA e troca só o campo em que a lojista tocou; se não conseguir ler, não
// grava nada e avisa. Mesmo andaime de formas-de-pagamento-cartao-pelo-app.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, toastErro, toastSucesso } = vi.hoisted(() => ({
  banco: {
    linha: { credito: true, debito: false, parcelas_max: 6 } as unknown,
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

const RPC = "salvar_config_pagamento_cartao";

describe("Cartão pelo app — grava só o que a lojista tocou, sobre a linha de agora", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.linha = { credito: true, debito: false, parcelas_max: 6 };
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

  async function montar() {
    await act(async () => {
      raiz.render(
        <FormasDePagamentoSection
          formasNaEntrega={["pix", "card", "cash"]}
          pixLigado={true}
          pixChaveOk={true}
          isOffline={false}
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
  async function escolherParcelas(valor: string) {
    const seletor = seletorDeParcelas()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!.call(seletor, valor);
      seletor.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
  }

  it("ligar o débito não desfaz o 3x que o celular escolheu depois que a tela abriu", async () => {
    await montar();
    // A tela abriu vendo 6x; o celular muda para 3x sem a tela saber.
    expect(seletorDeParcelas()!.value).toBe("6");
    banco.linha = { credito: true, debito: false, parcelas_max: 3 };

    await clicar(debito());

    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: true,
      p_debito: true,
      p_parcelas_max: 3,
    });
    expect(debito().getAttribute("data-state")).toBe("checked");
    expect(seletorDeParcelas()!.value).toBe("3");
  });

  it("desligar o crédito mantém o débito que o outro aparelho ligou", async () => {
    await montar();
    expect(debito().getAttribute("data-state")).toBe("unchecked");
    banco.linha = { credito: true, debito: true, parcelas_max: 3 };

    await clicar(credito());

    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: false,
      p_debito: true,
      p_parcelas_max: 3,
    });
    expect(credito().getAttribute("data-state")).toBe("unchecked");
    expect(debito().getAttribute("data-state")).toBe("checked");
  });

  it("mudar as parcelas mantém o crédito e o débito que estão gravados agora", async () => {
    await montar();
    banco.linha = { credito: true, debito: true, parcelas_max: 6 };

    await escolherParcelas("2");

    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: true,
      p_debito: true,
      p_parcelas_max: 2,
    });
    expect(debito().getAttribute("data-state")).toBe("checked");
    expect(seletorDeParcelas()!.value).toBe("2");
  });

  it("se não conseguir ler a linha de agora, não grava nada, avisa e destrava a tela", async () => {
    await montar();
    banco.erroDeLeitura = { message: "permission denied" };

    await clicar(debito());

    expect(banco.rpc).not.toHaveBeenCalled();
    expect(toastSucesso).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalledTimes(1);
    const aviso = String(toastErro.mock.calls[0][0]);
    expect(aviso).toContain("Nada foi alterado");
    expect(aviso).not.toContain("permission denied");
    // A tela continua no que mostrava, e a lojista pode tentar de novo.
    expect(debito().getAttribute("data-state")).toBe("unchecked");
    expect(debito().hasAttribute("disabled")).toBe(false);

    banco.erroDeLeitura = null;
    await clicar(debito());
    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: true,
      p_debito: true,
      p_parcelas_max: 6,
    });
  });

  it("linha de agora ausente vale 'desligado' e o toque grava só o campo tocado", async () => {
    await montar();
    banco.linha = null;

    await clicar(debito());

    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: false,
      p_debito: true,
      p_parcelas_max: 1,
    });
  });

  it("sem mudança em outro aparelho, o toque grava o mesmo de sempre", async () => {
    await montar();

    await clicar(debito());

    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: true,
      p_debito: true,
      p_parcelas_max: 6,
    });
    expect(toastSucesso).toHaveBeenCalledWith(
      "Cartão de débito pelo app ligado",
    );
  });
});
