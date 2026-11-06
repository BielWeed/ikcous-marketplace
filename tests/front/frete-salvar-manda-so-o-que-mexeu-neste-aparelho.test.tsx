// @vitest-environment jsdom
//
// Frete (painel): o Salvar manda SÓ o que a lojista mexeu NESTE aparelho.
//
// Antes, o Salvar mandava todos os campos de frete. Com dois aparelhos abertos,
// quem salvava a taxa também regravava, com o valor velho que o aparelho ainda
// tinha na tela, a regra que o outro aparelho acabara de mudar — e a loja
// ficava com a regra do último Salvar, sem aviso.
//
// Cobre também o "Só retirada" com valor da entrega inválido escondido no
// formulário: não pode virar R$ 0 (= entrega grátis) em silêncio.
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

describe("Frete — o Salvar manda só o que foi mexido neste aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O que chega À TELA enquanto o Salvar ainda está em andamento (o config
  // confirmado, mais o que o outro aparelho gravou no mesmo instante). A tela
  // ignora o config nessa janela; é o que o app real faz.
  let ecoDuranteOSalvar: Partial<StoreConfig> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    loja.atual = configBase();
    ecoDuranteOSalvar = null;
    // Salva de verdade: o config do "servidor" passa a ter o que foi enviado.
    updateConfig.mockImplementation(async (enviado: Partial<StoreConfig>) => {
      loja.atual = { ...loja.atual, ...enviado };
      if (ecoDuranteOSalvar) {
        loja.atual = { ...loja.atual, ...ecoDuranteOSalvar };
        await desenhar();
      }
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
    // `memo`: uma função nova a cada chamada garante o redesenho, que é o que
    // o Realtime faz quando o config muda por fora.
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

  /** O que o OUTRO aparelho gravou: o config daqui muda e a tela redesenha. */
  async function outroAparelhoGrava(mudanca: Partial<StoreConfig>) {
    loja.atual = { ...loja.atual, ...mudanca };
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
  async function escolherRadio(escopo: string, texto: string) {
    const bloco = hospedeiro.querySelector(escopo);
    const radio = [
      ...(bloco?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []),
    ].find((r) => r.textContent?.includes(texto));
    if (!radio) throw new Error(`Opção ausente: ${texto}`);
    await act(async () => radio.click());
  }
  /** O Salvar com eco da tela (`ecoDuranteOSalvar`) termina em tarefas seguintes. */
  async function esperarOSalvarTerminar() {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 20));
    });
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

  describe("dois aparelhos na mesma tela", () => {
    it("mexeu só na taxa: o prazo e as regras que o outro aparelho mudou NÃO são regravados", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "15");

      await outroAparelhoGrava({
        localDeliveryDays: 3,
        freeShippingMin: 150,
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 200,
      });
      // O que ela NÃO mexeu acompanha o outro aparelho; o que ela digitou fica.
      expect(campo("local-delivery-days").value).toBe("3");
      expect(campo("local-delivery-fee").value).toBe("15");

      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith({ localDeliveryFee: 15 });
      // O servidor guardou a taxa nova SEM desfazer o que o outro aparelho fez.
      expect(loja.atual).toMatchObject({
        localDeliveryFee: 15,
        localDeliveryDays: 3,
        freeShippingMin: 150,
        nationalShippingStrategy: "acima_de_valor",
        nationalShippingMin: 200,
      });
      expect(toastSucesso).toHaveBeenCalledWith("Regras de frete salvas!");
      // Não fica "pendente" para sempre por causa do que veio de fora.
      await desenhar();
      expect(botaoSalvar().textContent?.trim()).toBe("Salvo");
      expect(onSetDirty).toHaveBeenLastCalledWith(false);
    });

    it("mexeu na regra de fora da cidade: manda a regra inteira, e não a taxa que o outro aparelho mudou", async () => {
      await desenhar();
      await escolherRadio("#bloco-estrategia-nacional", "Sempre grátis");

      await outroAparelhoGrava({ localDeliveryFee: 12 });
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith({
        nationalShippingStrategy: "sempre",
        nationalShippingMin: 0,
        nationalDiscountType: null,
        nationalDiscountValue: 0,
        nationalBenefitScope: "mais_barata",
      });
      expect(loja.atual.localDeliveryFee).toBe(12);
    });

    it("os dois mexeram no MESMO campo: vale o que ela digitou neste aparelho", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "15");

      await outroAparelhoGrava({ localDeliveryFee: 12 });
      expect(campo("local-delivery-fee").value).toBe("15");
      await salvar();

      expect(updateConfig).toHaveBeenCalledWith({ localDeliveryFee: 15 });
    });

    it("tela limpa recebe o que o outro aparelho gravou e depois manda só o que ela mexe", async () => {
      await desenhar();
      await outroAparelhoGrava({ localDeliveryDays: 4 });
      expect(campo("local-delivery-days").value).toBe("4");

      await digitar("local-delivery-fee", "9");
      await salvar();

      expect(updateConfig).toHaveBeenCalledWith({ localDeliveryFee: 9 });
    });

    it("mexeu em tudo: continua mandando todos os campos (comportamento de antes)", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "15");
      await digitar("local-delivery-days", "2");
      await escolherRadio("#bloco-frete-local", "Eu entrego ou ele retira");
      await escolherRadio("#bloco-frete-local-estrategias", "Sempre grátis");
      await escolherRadio("#bloco-estrategia-nacional", "Sempre grátis");
      const chave = hospedeiro.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Vender para fora da sua região"]',
      );
      expect(chave).toBeTruthy();
      await act(async () => chave?.click());
      await digitar("local-cep-range", "38400");

      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      const enviado = updateConfig.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.keys(enviado).sort()).toEqual(
        [
          "freeShippingMin",
          "shippingCoverage",
          "localDeliveryFee",
          "localCepRange",
          "localDeliveryEnabled",
          "localDeliveryDays",
          "enabledShippingMethods",
          "nationalShippingStrategy",
          "nationalShippingMin",
          "nationalDiscountType",
          "nationalDiscountValue",
          "nationalBenefitScope",
        ].sort(),
      );
      expect(enviado).toMatchObject({
        localDeliveryFee: 15,
        localDeliveryDays: 2,
        shippingCoverage: "local",
        localCepRange: "38400",
      });
    });
  });

  // O Salvar e a mesclagem decidem "o que ela mexeu" pela MESMA régua, e a
  // base da comparação é sempre o último config que a tela conheceu do banco:
  // o que sobra diferente é edição dela e vai no Salvar. Antes, o retrato só
  // andava nos campos que ela NÃO tinha mexido: voltar o campo ao valor antigo
  // parecia "não mexi", o Salvar não mandava nada e avisava "salvas".
  describe("mexeu, outro aparelho gravou, e a tela tem de acabar igual ao banco", () => {
    function radioMarcado(escopo: string, texto: string): boolean {
      const radio = [
        ...(hospedeiro
          .querySelector(escopo)
          ?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []),
      ].find((r) => r.textContent?.includes(texto));
      if (!radio) throw new Error(`Opção ausente: ${texto}`);
      return radio.getAttribute("aria-checked") === "true";
    }

    it("digita 12, o outro grava 15, ela volta o campo para o valor de antes (8): o Salvar manda o 8", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "12");

      await outroAparelhoGrava({ localDeliveryFee: 15 });
      // O que ela digitou fica; a loja já está com 15.
      expect(campo("local-delivery-fee").value).toBe("12");

      await digitar("local-delivery-fee", "8");
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith({ localDeliveryFee: 8 });
      // A loja passa a cobrar o que a tela mostra.
      expect(loja.atual.localDeliveryFee).toBe(8);
      expect(toastSucesso).toHaveBeenCalledWith("Regras de frete salvas!");
    });

    it("frete grátis: escolhe 'acima de um valor' e volta para 'não dar', mexe na taxa, o outro grava 'sempre grátis': a tela adota 'sempre' e o Salvar manda só a taxa", async () => {
      await desenhar();
      await escolherRadio(
        "#bloco-frete-local-estrategias",
        "acima de um valor",
      );
      await escolherRadio(
        "#bloco-frete-local-estrategias",
        "Não dar frete grátis",
      );
      await digitar("local-delivery-fee", "12");

      await outroAparelhoGrava({ freeShippingMin: 0.01 });
      // Ela só passou por 'acima de um valor' (o valor de 100 que o campo ganhou
      // não é resposta dela): vale o que o outro aparelho gravou.
      expect(
        radioMarcado("#bloco-frete-local-estrategias", "Sempre grátis"),
      ).toBe(true);

      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(updateConfig).toHaveBeenCalledWith({ localDeliveryFee: 12 });
      // Tela e loja dizem a mesma coisa: continua 'sempre grátis'.
      expect(loja.atual.freeShippingMin).toBe(0.01);
      expect(
        radioMarcado("#bloco-frete-local-estrategias", "Sempre grátis"),
      ).toBe(true);
    });

    it("salva, mexe em OUTRO campo, o outro aparelho grava o que ela salvou antes: a tela adota o dele e o 2º Salvar manda só o campo novo", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "15");
      // O config confirmado chega enquanto o Salvar ainda está em andamento.
      ecoDuranteOSalvar = {};
      await salvar();
      await esperarOSalvarTerminar();
      ecoDuranteOSalvar = null;
      expect(updateConfig).toHaveBeenCalledWith({ localDeliveryFee: 15 });

      await digitar("local-delivery-days", "2");
      await outroAparelhoGrava({ localDeliveryFee: 20 });
      // A taxa já foi salva por ela: deixou de ser edição pendente, então
      // acompanha o outro aparelho.
      expect(campo("local-delivery-fee").value).toBe("20,00");

      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(2);
      expect(updateConfig).toHaveBeenLastCalledWith({ localDeliveryDays: 2 });
      expect(loja.atual).toMatchObject({
        localDeliveryFee: 20,
        localDeliveryDays: 2,
      });
    });

    it("Salvar sem nada a gravar, com a tela ainda diferente do banco: NÃO avisa que salvou", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "15");
      // O outro aparelho grava 20 no mesmo instante em que o Salvar confirma.
      ecoDuranteOSalvar = { localDeliveryFee: 20 };
      await salvar();
      await esperarOSalvarTerminar();
      ecoDuranteOSalvar = null;
      expect(toastSucesso).toHaveBeenCalledTimes(1);
      expect(campo("local-delivery-fee").value).toBe("15");

      // A tela mostra 15 e a loja tem 20: ainda "suja", mas nada dela a gravar.
      await salvar();

      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(toastSucesso).toHaveBeenCalledTimes(1);
      expect(toastErro).toHaveBeenCalledWith(
        expect.stringContaining("Nada foi salvo"),
        expect.anything(),
      );
    });
  });

  describe("'Só retirada' com valor da entrega inválido escondido", () => {
    it.each([
      ["abc", "texto"],
      ["-3", "negativo"],
    ])(
      "%s (%s): grava a retirada, NÃO grava o valor como R$ 0, avisa e mantém o R$ 8",
      async (digitado) => {
        await desenhar();
        await digitar("local-delivery-fee", digitado);
        await escolherRadio("#bloco-frete-local", "Só retirada");
        expect(hospedeiro.querySelector("#local-delivery-fee")).toBeNull();

        await salvar();

        expect(updateConfig).toHaveBeenCalledTimes(1);
        const enviado = updateConfig.mock.calls[0][0] as Record<
          string,
          unknown
        >;
        expect(enviado).toMatchObject({ localDeliveryEnabled: false });
        expect(enviado).not.toHaveProperty("localDeliveryFee");
        expect(loja.atual.localDeliveryFee).toBe(8);
        // Avisa, com o valor que ficou.
        expect(toastSucesso).toHaveBeenCalledWith(
          "Regras de frete salvas!",
          expect.objectContaining({
            description: expect.stringContaining("R$ 8"),
          }),
        );
        // Não fica "pendente" por causa do valor descartado.
        await desenhar();
        expect(botaoSalvar().textContent?.trim()).toBe("Salvo");
        expect(onSetDirty).toHaveBeenLastCalledWith(false);

        // Ao voltar para 'Eu entrego', o campo mostra o R$ 8 (não vazio = grátis).
        await escolherRadio("#bloco-frete-local", "Eu entrego");
        expect(campo("local-delivery-fee").value).toBe("8,00");
      },
    );

    it("quando o valor gravado era 'grátis' (R$ 0), o aviso diz que continua grátis", async () => {
      loja.atual = { ...configBase(), localDeliveryFee: 0 };
      await desenhar();
      await digitar("local-delivery-fee", "abc");
      await escolherRadio("#bloco-frete-local", "Só retirada");
      await salvar();

      expect(updateConfig.mock.calls[0][0]).not.toHaveProperty(
        "localDeliveryFee",
      );
      expect(toastSucesso).toHaveBeenCalledWith(
        "Regras de frete salvas!",
        expect.objectContaining({
          description: expect.stringContaining("grátis"),
        }),
      );
    });

    it("controle: valor válido digitado antes de 'Só retirada' continua sendo gravado, sem aviso", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "15");
      await escolherRadio("#bloco-frete-local", "Só retirada");
      await salvar();

      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          localDeliveryEnabled: false,
          localDeliveryFee: 15,
        }),
      );
      expect(toastSucesso).toHaveBeenCalledWith("Regras de frete salvas!");
    });

    it("controle: com o campo visível, valor inválido continua barrando o Salvar", async () => {
      await desenhar();
      await digitar("local-delivery-fee", "abc");
      await salvar();

      expect(updateConfig).not.toHaveBeenCalled();
      expect(toastErro).toHaveBeenCalledWith(
        "Confira o valor da entrega.",
        expect.anything(),
      );
    });
  });
});
