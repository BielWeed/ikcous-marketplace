// @vitest-environment jsdom
//
// Frete (painel), regra de FORA da cidade: o Salvar manda SÓ o campo que a
// lojista mexeu neste aparelho, não os cinco juntos.
//
// Antes, mexer em qualquer um dos cinco (estratégia, pedido mínimo, tipo e valor
// do desconto, alcance) mandava os cinco. Com dois aparelhos abertos, quem
// salvava só o "pedido mínimo" regravava, com o valor velho que a tela ainda
// tinha, o desconto que o outro aparelho acabara de REDUZIR: a loja voltava a
// bancar o frete com o valor antigo, sem aviso. Mesma coisa com o mínimo do
// "grátis acima de" quando o aparelho velho só trocava o alcance.
//
// O banco guarda cada coluna separada e confere a linha FINAL (CHECKs entre as
// colunas), então mandar só o que mudou é seguro; o que não vem é preservado.
import type { StoreConfig } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loja, updateConfig, onSetDirty, toastSucesso, toastErro } = vi.hoisted(
  () => ({
    loja: { atual: {} as StoreConfig },
    updateConfig: vi.fn(),
    onSetDirty: vi.fn(),
    toastSucesso: vi.fn(),
    toastErro: vi.fn(),
  }),
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: loja.atual, isLoaded: true, updateConfig }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: {
      invoke: vi
        .fn()
        .mockResolvedValue({ data: { success: false }, error: null }),
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function configBase(): StoreConfig {
  return {
    freeShippingMin: 0,
    freeShippingCardStyle: "completo",
    shippingFee: 15,
    whatsappNumber: "",
    shareText: "",
    businessHours: "",
    enableReviews: true,
    enableCoupons: true,
    originCep: "38400-000",
    storeAddress: "Rua A, 10",
    enabledShippingMethods: ["sedex", "pac"],
    shippingCoverage: "national",
    localDeliveryFee: 8,
    localDeliveryDays: 1,
    localDeliveryEnabled: true,
    localCepRange: "",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
    formasPagamentoEntrega: ["pix", "card", "cash"],
  } as unknown as StoreConfig;
}

const COM_DESCONTO_DE_20: Partial<StoreConfig> = {
  nationalShippingStrategy: "desconto_na_mais_barata",
  nationalShippingMin: 0,
  nationalDiscountType: "fixo",
  nationalDiscountValue: 20,
  nationalBenefitScope: "mais_barata",
};

const GRATIS_ACIMA_DE_100: Partial<StoreConfig> = {
  nationalShippingStrategy: "acima_de_valor",
  nationalShippingMin: 100,
  nationalDiscountType: null,
  nationalDiscountValue: 0,
  nationalBenefitScope: "mais_barata",
};

describe("Frete — regra de fora da cidade manda só o campo mexido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O banco de verdade: o que o OUTRO aparelho grava chega aqui antes de chegar
  // à tela deste aparelho (que segue com o config que já tinha).
  let banco: StoreConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    loja.atual = configBase();
    banco = configBase();
    // Como o app real: o banco recebe SÓ as chaves enviadas (a RPC preserva as
    // ausentes) e o config local só mescla o que foi enviado.
    updateConfig.mockImplementation(async (enviado: Partial<StoreConfig>) => {
      banco = { ...banco, ...enviado };
      loja.atual = { ...loja.atual, ...enviado };
      return true;
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function desenhar() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={onSetDirty}
          onNavigate={() => undefined}
        />,
      );
    });
  }

  /** O outro aparelho grava; a tela daqui ainda NÃO soube (formulário velho). */
  function outroAparelhoGravaSemAvisar(mudanca: Partial<StoreConfig>) {
    banco = { ...banco, ...mudanca };
  }
  /** O config novo chega à tela daqui (Realtime/recarga). */
  async function configNovoChegaATela() {
    loja.atual = { ...loja.atual, ...banco };
    await desenhar();
  }
  /** Os dois aparelhos partem do mesmo estado já salvo. */
  async function abrirComRegra(regra: Partial<StoreConfig>) {
    loja.atual = { ...configBase(), ...regra };
    banco = { ...configBase(), ...regra };
    await desenhar();
  }

  function campo(id: string) {
    const input = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error(`Campo ausente: ${id}`);
    return input;
  }
  async function digitar(id: string, texto: string) {
    const input = campo(id);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, texto);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function radio(texto: string): HTMLElement {
    const achado = [
      ...hospedeiro.querySelectorAll<HTMLElement>(
        '#bloco-estrategia-nacional [role="radio"]',
      ),
    ].find((r) => r.textContent?.includes(texto));
    if (!achado) throw new Error(`Opção ausente: ${texto}`);
    return achado;
  }
  async function escolher(texto: string) {
    await act(async () => radio(texto).click());
  }
  function botaoSalvar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() ?? "",
      ),
    );
    if (!botao) throw new Error("Botão Salvar ausente");
    return botao;
  }
  async function salvar() {
    expect(botaoSalvar().disabled).toBe(false);
    await act(async () => botaoSalvar().click());
  }

  describe("o defeito: o valor velho que a tela ainda tem voltava", () => {
    it("desconto reduzido por outro aparelho; aqui só o pedido mínimo muda: o valor do desconto NÃO é regravado", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      // Outro aparelho reduz o desconto de R$ 20 para R$ 5; a tela daqui segue
      // mostrando R$ 20.
      outroAparelhoGravaSemAvisar({ nationalDiscountValue: 5 });

      await digitar("frete-nacional-minimo", "50");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith(
        { nationalShippingMin: 50 },
        { silentSuccess: true },
      );
      // A loja guardou o mínimo novo SEM desfazer o desconto reduzido.
      expect(banco).toMatchObject({
        nationalShippingMin: 50,
        nationalDiscountValue: 5,
        nationalDiscountType: "fixo",
      });
    });

    it("grátis acima de R$ 100 elevado para R$ 200 por outro aparelho; aqui só o alcance muda: o mínimo NÃO volta a R$ 100", async () => {
      await abrirComRegra(GRATIS_ACIMA_DE_100);
      outroAparelhoGravaSemAvisar({ nationalShippingMin: 200 });

      await escolher("Qualquer uma");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith(
        { nationalBenefitScope: "todas" },
        { silentSuccess: true },
      );
      expect(banco).toMatchObject({
        nationalShippingMin: 200,
        nationalBenefitScope: "todas",
      });
    });

    it("o config novo chega à tela durante a edição: o campo que ela não mexeu acompanha, o que ela mexeu fica, e o Salvar manda só o dela", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await digitar("frete-nacional-minimo", "50");

      outroAparelhoGravaSemAvisar({ nationalDiscountValue: 5 });
      await configNovoChegaATela();
      // O desconto reduzido aparece na tela; o mínimo digitado fica.
      expect(campo("frete-nacional-valor-desconto").value).toBe("5");
      expect(campo("frete-nacional-minimo").value).toBe("50");

      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith(
        { nationalShippingMin: 50 },
        { silentSuccess: true },
      );
      expect(banco.nationalDiscountValue).toBe(5);
    });

    it("os dois mexeram no MESMO campo: vale o que ela digitou neste aparelho", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await digitar("frete-nacional-valor-desconto", "8");

      outroAparelhoGravaSemAvisar({ nationalDiscountValue: 5 });
      await configNovoChegaATela();
      expect(campo("frete-nacional-valor-desconto").value).toBe("8");

      await salvar();

      expect(updateConfig).toHaveBeenCalledWith(
        { nationalDiscountValue: 8 },
        { silentSuccess: true },
      );
      expect(banco.nationalDiscountValue).toBe(8);
    });
  });

  describe("o que vai quando ela mexe", () => {
    it("só o valor do desconto: só ele", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await digitar("frete-nacional-valor-desconto", "5");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith(
        { nationalDiscountValue: 5 },
        { silentSuccess: true },
      );
    });

    it("só o alcance: só ele", async () => {
      await abrirComRegra(GRATIS_ACIMA_DE_100);
      await escolher("Qualquer uma");
      await salvar();

      expect(updateConfig).toHaveBeenCalledWith(
        { nationalBenefitScope: "todas" },
        { silentSuccess: true },
      );
    });

    it("vários campos: todos os que mexeu, e nenhum dos que não mexeu", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await escolher("Porcentagem");
      await digitar("frete-nacional-valor-desconto", "10");
      await digitar("frete-nacional-minimo", "80");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith(
        {
          nationalDiscountType: "percentual",
          nationalDiscountValue: 10,
          nationalShippingMin: 80,
        },
        { silentSuccess: true },
      );
    });

    it("trocar a estratégia para uma sem desconto LIMPA o desconto que sobrava (o que vai mudar vai)", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await escolher("Sempre grátis");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      // Tipo e valor do desconto saem do banco: com a estratégia "sempre" o
      // desconto de R$ 20 não pode ficar guardado para voltar depois.
      expect(updateConfig).toHaveBeenCalledWith(
        {
          nationalShippingStrategy: "sempre",
          nationalDiscountType: null,
          nationalDiscountValue: 0,
        },
        { silentSuccess: true },
      );
      expect(banco).toMatchObject({
        nationalShippingStrategy: "sempre",
        nationalDiscountType: null,
        nationalDiscountValue: 0,
      });
    });

    it("de 'não dar frete grátis' para 'grátis acima de R$ 150': estratégia e mínimo", async () => {
      await desenhar();
      await escolher("Grátis acima de um valor");
      await digitar("frete-nacional-minimo", "150");
      await salvar();

      expect(updateConfig).toHaveBeenCalledWith(
        {
          nationalShippingStrategy: "acima_de_valor",
          nationalShippingMin: 150,
        },
        { silentSuccess: true },
      );
    });
  });

  describe("dado que já existia", () => {
    it("config sem os campos da regra de fora (loja antiga): mexer só na taxa não manda nenhum campo dela", async () => {
      const semARegra = configBase() as unknown as Record<string, unknown>;
      for (const chave of [
        "nationalShippingStrategy",
        "nationalShippingMin",
        "nationalDiscountType",
        "nationalDiscountValue",
        "nationalBenefitScope",
      ]) {
        Reflect.deleteProperty(semARegra, chave);
      }
      loja.atual = semARegra as unknown as StoreConfig;
      await desenhar();
      await digitar("local-delivery-fee", "9");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith(
        { localDeliveryFee: 9 },
        { silentSuccess: true },
      );
    });

    it("grátis acima de R$ 100 virou R$ 200 por fora; aqui troca para 'Sempre grátis': o mínimo sai do banco (não fica guardado)", async () => {
      await abrirComRegra(GRATIS_ACIMA_DE_100);
      outroAparelhoGravaSemAvisar({ nationalShippingMin: 200 });

      await escolher("Sempre grátis");
      await salvar();

      expect(updateConfig).toHaveBeenCalledWith(
        { nationalShippingStrategy: "sempre", nationalShippingMin: 0 },
        { silentSuccess: true },
      );
      expect(banco).toMatchObject({
        nationalShippingStrategy: "sempre",
        nationalShippingMin: 0,
      });
    });
  });

  describe("nada mudou", () => {
    it("o Salvar fica parado e nada é enviado", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);

      expect(botaoSalvar().textContent?.trim()).toBe("Salvo");
      expect(botaoSalvar().disabled).toBe(true);
      expect(updateConfig).not.toHaveBeenCalled();
    });

    it("mexeu e desfez (voltou ao valor salvo): o Salvar fica parado", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await digitar("frete-nacional-valor-desconto", "5");
      await digitar("frete-nacional-valor-desconto", "20");

      expect(botaoSalvar().disabled).toBe(true);
      expect(updateConfig).not.toHaveBeenCalled();
    });
  });

  describe("depois de salvar", () => {
    it("o segundo Salvar manda só o campo novo (o primeiro já virou o salvo)", async () => {
      await abrirComRegra(COM_DESCONTO_DE_20);
      await digitar("frete-nacional-valor-desconto", "5");
      await salvar();
      expect(updateConfig).toHaveBeenLastCalledWith(
        { nationalDiscountValue: 5 },
        { silentSuccess: true },
      );

      await digitar("frete-nacional-minimo", "40");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(2);
      expect(updateConfig).toHaveBeenLastCalledWith(
        { nationalShippingMin: 40 },
        { silentSuccess: true },
      );
      expect(banco).toMatchObject({
        nationalDiscountValue: 5,
        nationalShippingMin: 40,
      });
      expect(toastErro).not.toHaveBeenCalled();
    });
  });
});
