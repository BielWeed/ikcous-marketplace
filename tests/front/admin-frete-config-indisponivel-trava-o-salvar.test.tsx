// @vitest-environment jsdom
//
// FRETE COM A LEITURA DA LOJA FALHA (lote r64-g, 07/11/2026).
//
// Quando a leitura da configuração estoura e não há cópia da loja no aparelho,
// o StoreContext devolve a configuração de FÁBRICA com `isLoaded = true` e
// `configIndisponivel = true`. A tela de Frete abria editável com os valores de
// fábrica e o Salvar ligado: mexer em UMA resposta de "Fora da região" manda os
// CINCO campos juntos (estratégia, mínimo, tipo e valor do desconto, alcance)
// lidos da fábrica por cima da regra de verdade. Aqui se prova que, com a
// leitura falha, a tela avisa, trava os campos que gravam config e o Salvar —
// e que com a config carregada nada muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();
const refresh = vi.fn();

const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: {
    config: {} as Record<string, unknown>,
    // `undefined` imita o contexto antigo (dublê sem o campo).
    configIndisponivel: undefined as boolean | undefined,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.config,
    isLoaded: true,
    updateConfig,
    refresh,
    configIndisponivel: estadoDaLoja.configIndisponivel,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "store_shipping_credentials") {
        const resposta = { data: [], error: null };
        const consulta = (): any =>
          Object.assign(Promise.resolve(resposta), {
            not: () => consulta(),
            neq: () => consulta(),
            eq: () => consulta(),
          });
        return {
          select: () => consulta(),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG_DE_FABRICA_DE_TESTE = {
  originCep: "",
  freeShippingMin: 0,
  shippingCoverage: "local",
  localDeliveryFee: 10,
  localDeliveryEnabled: true,
  localDeliveryDays: 1,
  localCepRange: "",
  enabledShippingMethods: ["sedex", "pac"],
  storeAddress: "",
  nationalShippingStrategy: "desligado",
  nationalShippingMin: 0,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "mais_barata",
};

describe("Frete — leitura da loja falha (configIndisponivel)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockResolvedValue(true);
    refresh.mockResolvedValue(undefined);
    estadoDaLoja.config = { ...CONFIG_DE_FABRICA_DE_TESTE };
    estadoDaLoja.configIndisponivel = undefined;
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

  async function drenar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function renderizar() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active onSetDirty={vi.fn()} />);
    });
    await drenar();
  }

  function botaoSalvar(): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…)$/.test(b.textContent?.trim() || ""),
    );
    expect(botao).toBeDefined();
    return botao as HTMLButtonElement;
  }

  function chaveForaDaRegiao(): HTMLButtonElement {
    return hospedeiro.querySelector(
      'button[role="switch"][aria-label="Vender para fora da sua região"]',
    ) as HTMLButtonElement;
  }

  function respostaDeEntrega(titulo: string): HTMLButtonElement {
    const resposta = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((b) => b.querySelector("span")?.textContent === titulo);
    expect(resposta).toBeDefined();
    return resposta as HTMLButtonElement;
  }

  async function clicar(el: HTMLElement | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
    });
    await drenar();
  }

  const aviso = () =>
    hospedeiro.querySelector<HTMLElement>("[data-aviso-loja-sem-dados]");

  it("leitura falha: mostra o aviso, trava os campos de regra e o Salvar; nada é gravado", async () => {
    estadoDaLoja.configIndisponivel = true;
    await renderizar();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(
      "Não foi possível carregar os dados da loja",
    );
    // Campos que gravam config: travados, para ninguém editar a fábrica.
    expect(chaveForaDaRegiao().disabled).toBe(true);
    expect(respostaDeEntrega("Eu entrego").disabled).toBe(true);

    // Tentar mexer não muda nada: o Salvar segue travado e nada é gravado.
    await clicar(chaveForaDaRegiao());
    expect(botaoSalvar().disabled).toBe(true);
    await clicar(botaoSalvar());
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("leitura falha com o formulário já mexido: o Salvar fica travado mesmo assim", async () => {
    // Prova a trava do botão sozinha (sem depender de os campos estarem
    // travados): mexe com a config boa e só então a leitura passa a falha.
    estadoDaLoja.configIndisponivel = false;
    await renderizar();
    await clicar(chaveForaDaRegiao());
    expect(botaoSalvar().textContent?.trim()).toBe("Salvar");
    expect(botaoSalvar().disabled).toBe(false);

    estadoDaLoja.configIndisponivel = true;
    await renderizar();

    expect(aviso()).not.toBeNull();
    expect(botaoSalvar().disabled).toBe(true);
    await clicar(botaoSalvar());
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("'Tentar de novo' do aviso relê só a configuração", async () => {
    estadoDaLoja.configIndisponivel = true;
    await renderizar();

    const tentar = [...(aviso()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );
    await clicar(tentar);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ onlyConfig: true });
  });

  it.each([
    ["false", false],
    ["ausente (contexto antigo)", undefined],
  ] as const)(
    "configIndisponivel %s: sem aviso, campos soltos e o Salvar grava como sempre",
    async (_nome, valor) => {
      estadoDaLoja.configIndisponivel = valor;
      await renderizar();

      expect(aviso()).toBeNull();
      expect(chaveForaDaRegiao().disabled).toBe(false);
      expect(respostaDeEntrega("Eu entrego").disabled).toBe(false);
      expect(botaoSalvar().disabled).toBe(true); // nada mexido ainda

      await clicar(chaveForaDaRegiao());
      expect(botaoSalvar().disabled).toBe(false);
      await clicar(botaoSalvar());

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig.mock.calls[0][0]).toMatchObject({
        shippingCoverage: "national",
      });
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});
