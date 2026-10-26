// @vitest-environment jsdom
//
// Frete grátis (lote 203): digitar 49.999 gravava 50,00 no banco (numeric(10,2))
// e a tela ficava em "não deu para confirmar que tudo foi salvo" para sempre;
// acima de 99.999.999,99 a coluna estoura. Agora o valor ENVIADO já é o
// arredondado em centavos e limitado ao máximo da coluna, para o frete local
// ("a partir de") e o nacional (mínimo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// `atual` guarda a IDENTIDADE do objeto de config, não só os valores. Isso
// importa: o efeito sob teste depende de `config` na lista de dependências, e
// o React compara por identidade. Um mock que MUTA o mesmo objeto nunca faz o
// efeito redisparar — o teste passaria sem exercitar nada. Custou uma rodada
// verde-por-acaso para perceber; trocar a config agora é sempre um objeto novo.
const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      localDeliveryFee: 12 as number | undefined,
      freeShippingMin: 150,
      enabledShippingMethods: ["sedex", "pac"] as string[],
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 100,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    } as Record<string, unknown>,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      // AdminShippingView-126: a tela filtra credenciais com .not()/.neq()
      // em credentials->>token; o dublê tem de aceitar a cadeia, senão o
      // TypeError cai no catch e liga credsErro em silêncio.
      select: () => {
        const consulta = (): any =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            not: () => consulta(),
            neq: () => consulta(),
          });
        return consulta();
      },
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView: valores de frete grátis em centavos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockResolvedValue(true);
    estadoDaLoja.atual = {
      localDeliveryFee: 12,
      freeShippingMin: 150,
      enabledShippingMethods: ["sedex", "pac"],
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 100,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    };
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

  async function abrir() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function digitar(id: string, texto: string) {
    const campo = hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
    expect(campo).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function salvar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement;
    expect(botao).toBeTruthy();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
  }

  it("49.999 vai para o banco como 50 (o que ele guardaria), e o campo mostra 50", async () => {
    await abrir();
    await digitar("frete-gratis-acima-de", "49.999");
    await salvar();
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0].freeShippingMin).toBe(50);
    expect(
      (hospedeiro.querySelector("#frete-gratis-acima-de") as HTMLInputElement)
        .value,
    ).toBe("50");
  });

  it("acima do máximo da coluna, grava o máximo (99999999.99)", async () => {
    await abrir();
    await digitar("frete-gratis-acima-de", "1000000000");
    await salvar();
    expect(updateConfig.mock.calls[0][0].freeShippingMin).toBe(99999999.99);
  });

  it("um valor que já tem centavos certos segue idêntico", async () => {
    await abrir();
    await digitar("frete-gratis-acima-de", "199.9");
    await salvar();
    expect(updateConfig.mock.calls[0][0].freeShippingMin).toBe(199.9);
  });

  it("o mínimo do frete nacional também vai em centavos e limitado", async () => {
    await abrir();
    await digitar("frete-nacional-minimo", "79.996");
    await salvar();
    expect(updateConfig.mock.calls[0][0].nationalShippingMin).toBe(80);

    updateConfig.mockClear();
    await digitar("frete-nacional-minimo", "5000000000");
    await salvar();
    expect(updateConfig.mock.calls[0][0].nationalShippingMin).toBe(99999999.99);
  });

  it("um valor que arredonda para zero é recusado, não vira 'desligado'", async () => {
    await abrir();
    await digitar("frete-gratis-acima-de", "0.004");
    await salvar();
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
