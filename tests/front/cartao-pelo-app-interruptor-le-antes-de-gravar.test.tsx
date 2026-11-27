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
    leituraPendurada: false,
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
          maybeSingle: async () => {
            if (banco.leituraPendurada) return new Promise<never>(() => {});
            return {
              data: banco.erroDeLeitura ? null : banco.linha,
              error: banco.erroDeLeitura,
            };
          },
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
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";
import { escolherNaLista, valorDaLista } from "./helpers/lista-de-escolha";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RPC = "salvar_config_pagamento_cartao";

describe("Cartão pelo app — grava só o que a lojista tocou, sobre a linha de agora", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    banco.linha = { credito: true, debito: false, parcelas_max: 6 };
    banco.erroDeLeitura = null;
    banco.leituraPendurada = false;
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function esperar() {
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
      else await new Promise((r) => setTimeout(r, 10));
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
  // O "Parcelar em até" é a lista de escolha do painel (lista premium,
  // 26/11/2026): o botão do campo, achado pelo rótulo `<label for>`.
  const seletorDeParcelas = () => {
    const rotulo = [...hospedeiro.querySelectorAll("label")].find(
      (l) => l.textContent === "Parcelar em até",
    );
    const campo = rotulo ? document.getElementById(rotulo.htmlFor) : null;
    return campo instanceof HTMLButtonElement &&
      campo.getAttribute("aria-haspopup") === "listbox"
      ? campo
      : undefined;
  };

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await esperar();
  }
  async function escolherParcelas(valor: string) {
    await act(async () => {
      escolherNaLista(seletorDeParcelas()!.id, valor);
    });
    await esperar();
  }
  const parcelasNaTela = () => valorDaLista(seletorDeParcelas()!.id);

  it("leitura inicial pendurada sai da espera e avisa como tentar de novo", async () => {
    vi.useFakeTimers();
    banco.leituraPendurada = true;
    await montar();
    expect(hospedeiro.textContent).toContain("Lendo a configuração...");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(hospedeiro.textContent).not.toContain("Lendo a configuração...");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Recarregue a página para tentar de novo.",
    );
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("conferência pendurada antes de salvar avisa, não grava e libera nova tentativa", async () => {
    vi.useFakeTimers();
    await montar();
    banco.leituraPendurada = true;
    await clicar(debito());
    expect(debito().disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(toastErro).toHaveBeenCalledWith(
      "Não foi possível conferir o que está salvo agora. Nada foi alterado. Tente de novo.",
    );
    expect(banco.rpc).not.toHaveBeenCalled();
    expect(debito().disabled).toBe(false);
    banco.leituraPendurada = false;
    await clicar(debito());
    expect(banco.rpc).toHaveBeenCalledTimes(1);
  });

  it("prazo esgotado avisa a dúvida e relê o crédito que o servidor já gravou", async () => {
    vi.useFakeTimers();
    banco.linha = { credito: false, debito: false, parcelas_max: 6 };
    await montar();
    let responder!: () => void;
    banco.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          responder = () => resolve({ data: banco.linha, error: null });
        }),
    );
    await clicar(credito());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    // O banco grava tarde, sem devolver a resposta à tela.
    banco.linha = { credito: true, debito: false, parcelas_max: 6 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    try {
      expect(toastErro).toHaveBeenCalledWith(
        "Não deu para confirmar se salvou o cartão pelo app. Confira o estado abaixo.",
      );
      expect(credito().getAttribute("data-state")).toBe("checked");
      expect(hospedeiro.textContent).toContain(
        "Não deu para confirmar se salvou",
      );
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
      expect(toastSucesso).not.toHaveBeenCalled();
    } finally {
      await act(async () => responder());
    }
  });

  it.each(["resolve", "rejeita"])(
    "débito aguarda a gravação pendurada do crédito que %s e preserva os dois no servidor",
    async (desfecho) => {
      vi.useFakeTimers();
      banco.linha = { credito: false, debito: false, parcelas_max: 6 };
      await montar();
      let concluirPrimeira!: () => void;
      banco.rpc.mockImplementation((_nome: string, p: any) => {
        const gravar = () => {
          banco.linha = {
            credito: p.p_credito,
            debito: p.p_debito,
            parcelas_max: p.p_parcelas_max,
          };
          return { data: banco.linha, error: null };
        };
        if (banco.rpc.mock.calls.length === 1) {
          return new Promise((resolve, reject) => {
            concluirPrimeira = () => {
              const resposta = gravar();
              if (desfecho === "rejeita")
                reject(new TypeError("resposta perdida"));
              else resolve(resposta);
            };
          });
        }
        return Promise.resolve(gravar());
      });

      await clicar(credito());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
      });
      await clicar(debito());
      try {
        expect(banco.rpc).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => concluirPrimeira());
      }
      await esperar();
      expect(banco.rpc).toHaveBeenCalledTimes(2);
      expect(banco.linha).toEqual({
        credito: true,
        debito: true,
        parcelas_max: 6,
      });
      expect(credito().getAttribute("data-state")).toBe("checked");
      expect(debito().getAttribute("data-state")).toBe("checked");
    },
  );

  it("releitura também pendurada solta o giro e não apresenta um estado como confirmado", async () => {
    vi.useFakeTimers();
    await montar();
    let responder!: () => void;
    banco.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          responder = () => resolve({ data: banco.linha, error: null });
        }),
    );
    await clicar(debito());
    banco.leituraPendurada = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    });
    try {
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
      expect(hospedeiro.textContent).toContain(
        "Não deu para confirmar se salvou",
      );
      expect(
        hospedeiro.querySelector('[aria-label="Cartão de crédito pelo app"]'),
      ).toBeNull();
      expect(
        hospedeiro.querySelector('[aria-label="Cartão de débito pelo app"]'),
      ).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
      });
      expect(hospedeiro.textContent).toContain(
        "Não deu para confirmar se salvou",
      );
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
      expect(toastSucesso).not.toHaveBeenCalled();
    } finally {
      await act(async () => responder());
    }
  });

  it("nova conferência não espera a gravação pendurada para sempre nem envia outra gravação depois do prazo", async () => {
    vi.useFakeTimers();
    await montar();
    let responder!: () => void;
    banco.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          responder = () => resolve({ data: banco.linha, error: null });
        }),
    );
    await clicar(debito());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    });
    await clicar(debito());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    });
    try {
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
      expect(debito().disabled).toBe(false);
      expect(banco.rpc).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => responder());
    }
    await esperar();
    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(toastSucesso).not.toHaveBeenCalled();
  });

  it.each(["crédito", "débito", "parcelas"])(
    "gravação de %s sem resposta avisa, relê o confirmado e libera nova tentativa",
    async (campo) => {
      vi.useFakeTimers();
      await montar();
      let responder!: () => void;
      banco.rpc.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            responder = () => resolve({ data: banco.linha, error: null });
          }),
      );

      if (campo === "parcelas") await escolherParcelas("2");
      else await clicar(campo === "crédito" ? credito() : debito());

      expect(credito().disabled).toBe(true);
      expect(debito().disabled).toBe(true);
      expect(seletorDeParcelas()!.disabled).toBe(true);
      expect(hospedeiro.querySelector(".animate-spin")).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
      });

      expect(credito().disabled).toBe(false);
      expect(debito().disabled).toBe(false);
      expect(seletorDeParcelas()!.disabled).toBe(false);
      expect(hospedeiro.querySelector(".animate-spin")).toBeNull();
      expect(credito().getAttribute("data-state")).toBe("checked");
      expect(debito().getAttribute("data-state")).toBe("unchecked");
      expect(parcelasNaTela()).toBe("6");
      expect(toastErro).toHaveBeenCalledWith(
        "Não deu para confirmar se salvou o cartão pelo app. Confira o estado abaixo.",
      );
      expect(toastSucesso).not.toHaveBeenCalled();
      expect(banco.rpc).toHaveBeenCalledTimes(1);

      // A requisição real termina antes de a próxima tentativa gravar.
      await act(async () => responder());
      await clicar(debito());
      expect(banco.rpc).toHaveBeenCalledTimes(2);
      expect(debito().getAttribute("data-state")).toBe("checked");
      expect(toastSucesso).toHaveBeenCalledWith(
        "Cartão de débito pelo app ligado",
      );
    },
  );

  it("ligar o débito não desfaz o 3x que o celular escolheu depois que a tela abriu", async () => {
    await montar();
    // A tela abriu vendo 6x; o celular muda para 3x sem a tela saber.
    expect(parcelasNaTela()).toBe("6");
    banco.linha = { credito: true, debito: false, parcelas_max: 3 };

    await clicar(debito());

    expect(banco.rpc).toHaveBeenCalledTimes(1);
    expect(banco.rpc).toHaveBeenCalledWith(RPC, {
      p_credito: true,
      p_debito: true,
      p_parcelas_max: 3,
    });
    expect(debito().getAttribute("data-state")).toBe("checked");
    expect(parcelasNaTela()).toBe("3");
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
    expect(parcelasNaTela()).toBe("2");
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
