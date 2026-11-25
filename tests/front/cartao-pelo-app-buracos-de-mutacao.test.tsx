// @vitest-environment jsdom
//
// Buracos achados por caça de mutação no bloco "Cartão pelo app" (os testes
// antigos passavam mesmo com o defeito de uma linha plantado):
//  - o aviso do débito só aparece com o débito LIGADO;
//  - o aviso de sucesso das parcelas diz "só à vista" para 1x e "em até Nx"
//    para as demais (é o que a lojista lê depois de mexer no que a cliente paga);
//  - a gravação leva o valor do banco para os campos que a lojista não tocou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, toastErro, toastSucesso } = vi.hoisted(() => ({
  banco: {
    linha: { credito: false, debito: false, parcelas_max: 1 } as unknown,
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
          maybeSingle: async () => ({ data: banco.linha, error: null }),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => banco.rpc(...args),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro },
}));

import { CartaoPeloAppBloco } from "@/components/admin/settings/FormasDePagamentoCard";
import { CARTAO_PELO_APP } from "@/components/admin/settings/mercado-pago-conteudo";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Cartão pelo app (buracos de mutação)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.linha = { credito: false, debito: false, parcelas_max: 1 };
    banco.rpc.mockReset();
    banco.rpc.mockImplementation(
      async (
        _nome: string,
        p: { p_credito: boolean; p_debito: boolean; p_parcelas_max: number },
      ) => ({
        data: {
          id: 1,
          credito: p.p_credito,
          debito: p.p_debito,
          parcelas_max: p.p_parcelas_max,
        },
        error: null,
      }),
    );
    toastErro.mockReset();
    toastSucesso.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
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
      raiz.render(<CartaoPeloAppBloco pixLigado={true} isOffline={false} />);
    });
    await esperar();
  }

  const interruptor = (rotulo: string) =>
    hospedeiro.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${rotulo}"]`,
    ) as HTMLButtonElement;
  const seletorDeParcelas = () =>
    hospedeiro.querySelector<HTMLSelectElement>("select");

  async function escolherParcelas(valor: string) {
    const sel = seletorDeParcelas();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(sel, valor);
      sel?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
  }

  it("o aviso do débito aparece só com o débito ligado", async () => {
    banco.linha = { credito: false, debito: true, parcelas_max: 1 };
    await montar();
    expect(hospedeiro.textContent).toContain(CARTAO_PELO_APP.debito);
  });

  it("com o débito desligado o aviso do débito não aparece", async () => {
    banco.linha = { credito: true, debito: false, parcelas_max: 1 };
    await montar();
    expect(hospedeiro.textContent).not.toContain(CARTAO_PELO_APP.debito);
  });

  it.each([
    ["1", "Crédito só à vista"],
    ["2", "Crédito em até 2x"],
    ["12", "Crédito em até 12x"],
  ])("escolher %sx avisa '%s' e grava esse teto", async (valor, aviso) => {
    banco.linha = { credito: true, debito: true, parcelas_max: 6 };
    await montar();
    expect(seletorDeParcelas()?.value).toBe("6");
    await escolherParcelas(valor);
    expect(toastSucesso).toHaveBeenCalledExactlyOnceWith(aviso);
    // Só o teto mudou: crédito e débito seguem como o banco tinha.
    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc.mock.calls[0][1]).toEqual({
      p_credito: true,
      p_debito: true,
      p_parcelas_max: Number(valor),
    });
  });

  it("desligar o crédito leva o débito e o teto como o banco tinha", async () => {
    banco.linha = { credito: true, debito: true, parcelas_max: 6 };
    await montar();
    await act(async () => {
      interruptor("Cartão de crédito pelo app").click();
    });
    await esperar();
    expect(banco.rpc.mock.calls[0][1]).toEqual({
      p_credito: false,
      p_debito: true,
      p_parcelas_max: 6,
    });
    expect(toastSucesso).toHaveBeenCalledExactlyOnceWith(
      "Cartão de crédito pelo app desligado",
    );
    // Sem crédito o seletor de parcelas some.
    expect(seletorDeParcelas()).toBeNull();
  });
});
