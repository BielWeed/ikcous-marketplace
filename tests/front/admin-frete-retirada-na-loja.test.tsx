// @vitest-environment jsdom
//
// RETIRADA NA LOJA NO PAINEL (release 1.5.3, 22/09/2026).
//
// A chave `store-pickup` mora em `store_config.enabled_shipping_methods` —
// a MESMA lista em que Ajustes → Transportadoras grava os serviços
// (sedex/pac/jadlog). Duas telas escrevem na mesma coluna, então o risco é
// uma apagar a escolha da outra. O que se prova:
//   1. as funções puras preservam as chaves de transportadora (inclusive
//      com base [] e base ausente, que a edge lê como ["sedex","pac"]);
//   2. Frete → "Permitir retirada na loja": liga/desliga SÓ a chave da
//      retirada, calculada do config ATUAL; salvar outra regra não envia a
//      lista;
//   3. sem endereço da loja a chave NÃO liga e a tela manda cadastrar em
//      Minha loja (com o botão "Abrir Minha loja");
//   4. Ajustes → Transportadoras preserva `store-pickup` no save, mesmo
//      quando a retirada foi ligada DEPOIS que a seção sincronizou.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chavesDeTransportadoraDaLista,
  listaComRetirada,
  retiradaLigadaNaLista,
} from "@/lib/guarda-de-frete";

const updateConfig = vi.fn();

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

type ConfigDeTeste = {
  originCep?: string;
  freeShippingMin?: number;
  shippingProvider?: string;
  localDeliveryFee?: number;
  localDeliveryEnabled?: boolean;
  localDeliveryDays?: number;
  localCepRange?: string;
  enabledShippingMethods?: string[];
  storeAddress?: string | null;
};

const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: { atual: {} as ConfigDeTeste },
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
    from: (tabela: string) => {
      if (tabela === "store_shipping_credentials") {
        const resposta = {
          data: [
            {
              provider: "melhor_envio",
              credentials: { token: "tok-de-teste", sandbox: false },
            },
          ],
          error: null,
        };
        const consulta = (): any =>
          Object.assign(Promise.resolve(resposta), {
            not: () => consulta(),
            neq: () => consulta(),
            // 1.5.4: modo de testes lido por filtro em `credentials->>sandbox`.
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("listas de métodos — a retirada entra e sai sem tocar nas transportadoras", () => {
  it("liga preservando ordem e chaves; desliga removendo só ela", () => {
    expect(listaComRetirada(["sedex", "jadlog"], true)).toEqual([
      "sedex",
      "jadlog",
      "store-pickup",
    ]);
    expect(listaComRetirada(["store-pickup", "pac"], false)).toEqual(["pac"]);
  });

  it("base [] vira só a retirada (a edge segue lendo 'todas as transportadoras')", () => {
    expect(listaComRetirada([], true)).toEqual(["store-pickup"]);
    expect(listaComRetirada([], false)).toEqual([]);
  });

  it("base ausente/NULL = ['sedex','pac'] (mesma leitura da edge): ligar NÃO vira 'todas'", () => {
    expect(listaComRetirada(undefined, true)).toEqual([
      "sedex",
      "pac",
      "store-pickup",
    ]);
    expect(listaComRetirada(null, true)).toEqual([
      "sedex",
      "pac",
      "store-pickup",
    ]);
    expect(retiradaLigadaNaLista(undefined)).toBe(false);
  });

  it("chave duplicada não se multiplica; comparação exata (sem trim)", () => {
    expect(
      listaComRetirada(["store-pickup", "sedex", "store-pickup"], true),
    ).toEqual(["sedex", "store-pickup"]);
    expect(retiradaLigadaNaLista([" store-pickup"])).toBe(false);
    expect(chavesDeTransportadoraDaLista(["sedex", "store-pickup"])).toEqual([
      "sedex",
    ]);
  });
});

describe("Painel — chave 'Permitir retirada na loja' e a seção de Transportadoras", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockResolvedValue(true);
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
      await esperarMicrotarefas();
    });
  }

  async function renderizarFrete(onNavigate?: (view: string) => void) {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active
          onSetDirty={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await drenar();
  }

  function chaveDaRetirada(
    titulo = "Eu entrego ou ele retira",
  ): HTMLButtonElement {
    const chave = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((b) => b.querySelector("span")?.textContent === titulo);
    expect(chave).toBeDefined();
    return chave as HTMLButtonElement;
  }

  /** O botão Salvar do cabeçalho (T4 unificação, 23/09/2026): o rótulo
   * troca por estado ("Salvo"/"Salvar"/"Salvando…"/"Tentar de novo"), o
   * botão nunca some — a barra fixa antiga morreu. */
  function botaoSalvar(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() || "",
      ),
    ) as HTMLButtonElement | undefined;
  }

  async function clicar(el: HTMLElement | undefined) {
    expect(el).toBeDefined();
    await act(async () => {
      el?.click();
    });
    await drenar();
  }

  it("ligar grava a lista do config ATUAL + store-pickup (sedex/jadlog intactos)", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "jadlog"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("false");
    // Em "Eu entrego" a retirada está desligada: o endereço não é prometido.
    expect(hospedeiro.textContent).not.toContain(ENDERECO_FICTICIO);

    await clicar(chaveDaRetirada());
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
    expect(hospedeiro.textContent).toContain(ENDERECO_FICTICIO);
    await clicar(botaoSalvar());

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0].enabledShippingMethods).toEqual([
      "sedex",
      "jadlog",
      "store-pickup",
    ]);
  });

  it("desligar tira SÓ a retirada", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["store-pickup", "pac"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
    await clicar(chaveDaRetirada("Eu entrego"));
    await clicar(botaoSalvar());
    expect(updateConfig.mock.calls[0][0].enabledShippingMethods).toEqual([
      "pac",
    ]);
  });

  it("salvar outra regra de frete NÃO envia a lista de métodos", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "pac", "store-pickup"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    await clicar(
      hospedeiro.querySelector(
        'button[role="switch"][aria-label="Vender para fora da sua região"]',
      ) as HTMLButtonElement,
    );
    await clicar(botaoSalvar());
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0]).not.toHaveProperty(
      "enabledShippingMethods",
    );
  });

  it("sem endereço da loja a chave NÃO liga e manda cadastrar em Minha loja", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "pac"],
      storeAddress: "   ",
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada());

    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("false");
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("Minha loja");
    expect(alerta?.textContent).not.toContain("Sobre a Loja");
    // Nada pendente para salvar: a chave não mudou (T4 unificação, o botão
    // nunca some — mostra "Salvo" desabilitado quando não há alteração).
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
    expect(botaoSalvar()?.disabled).toBe(true);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("sem endereço: a chave explica e oferece 'Cadastrar endereço em Minha loja' (leva a admin-about-store)", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "pac"],
      storeAddress: null,
    };
    const onNavigate = vi.fn();
    await renderizarFrete(onNavigate);

    await clicar(chaveDaRetirada());
    // A tentativa recusada mostra o caminho para cadastrar o endereço.
    expect(hospedeiro.textContent).toContain(
      "cadastre o endereço da loja em Minha loja",
    );
    const cadastrar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Abrir Minha loja",
    );
    expect(cadastrar).toBeDefined();
    await clicar(cadastrar);
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it("com endereço: mostra o endereço só para leitura (sem campo, sem botão de cadastrar)", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "pac"],
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada());

    expect(hospedeiro.textContent).toContain(ENDERECO_FICTICIO);
    const campos = [...hospedeiro.querySelectorAll("input")].filter(
      (i) => i.value === ENDERECO_FICTICIO,
    );
    expect(campos).toHaveLength(0);
    expect(
      [...hospedeiro.querySelectorAll("button")].some((b) =>
        /Cadastrar endereço em Minha loja/.test(b.textContent || ""),
      ),
    ).toBe(false);
  });

  it("retirada já ligada e endereço apagado: a tela AVISA que a cliente não vê a opção", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      enabledShippingMethods: ["sedex", "store-pickup"],
      storeAddress: null,
    };
    await renderizarFrete();
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "não aparece para o cliente",
    );
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Minha loja",
    );
  });

  it.each([
    ["Eu entrego", false, ["pac", "store-pickup"], true, ["pac"]],
    ["Eu entrego ou ele retira", true, ["pac"], true, ["pac", "store-pickup"]],
    ["Só retirada", true, ["pac"], false, ["pac", "store-pickup"]],
  ] as const)(
    "%s grava entrega própria e retirada juntas",
    async (titulo, inicial, metodos, ligada, esperados) => {
      estadoDaLoja.atual = {
        originCep: "38500-000",
        storeAddress: ENDERECO_FICTICIO,
        localDeliveryEnabled: inicial,
        enabledShippingMethods: [...metodos],
      };
      await renderizarFrete();
      await clicar(chaveDaRetirada(titulo));
      await clicar(botaoSalvar());
      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          localDeliveryEnabled: ligada,
          enabledShippingMethods: [...esperados],
          localDeliveryDays: 1,
        }),
      );
    },
  );

  it("Só retirada sem endereço não muda o formulário nem permite salvar", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: "  " };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retirada"));
    expect(chaveDaRetirada("Só retirada").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(botaoSalvar()?.disabled).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Minha loja",
    );
  });

  it("eco sem storeAddress usa a mesma fonte do bloco e impede Só retirada", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    estadoDaLoja.atual = { originCep: "38500-000" };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retirada"));
    expect(chaveDaRetirada("Só retirada").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("endereço some depois da escolha: salvar não envia Só retirada", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retirada"));
    estadoDaLoja.atual = { originCep: "38500-000" };
    await renderizarFrete();
    await clicar(botaoSalvar());
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("em 'Entrego' com endereço a linha 'Endereço da retirada' NÃO existe; nos outros dois modos continua", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryEnabled: true,
      enabledShippingMethods: ["pac"],
    };
    await renderizarFrete();
    expect(chaveDaRetirada("Eu entrego").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(hospedeiro.textContent).not.toContain("Endereço da retirada");
    expect(hospedeiro.textContent).not.toContain("pode buscar o pedido");

    await clicar(chaveDaRetirada("Eu entrego ou ele retira"));
    expect(hospedeiro.textContent).toContain("Endereço da retirada");
    expect(hospedeiro.textContent).toContain("pode buscar o pedido de graça");

    await clicar(chaveDaRetirada("Só retirada"));
    expect(hospedeiro.textContent).toContain("Endereço da retirada");
    expect(hospedeiro.textContent).toContain("Todo cliente pode buscar");

    await clicar(chaveDaRetirada("Eu entrego"));
    expect(hospedeiro.textContent).not.toContain("Endereço da retirada");
    expect(hospedeiro.textContent).not.toContain("pode buscar o pedido");
  });

  const AVISO_SEM_CEP =
    "Para vender só com retirada, cadastre o CEP da loja em Minha loja.";

  it.each(["", "385", "38500-00"])(
    "sem CEP completo da loja (%j): 'Só retirada' não vale, explica e não deixa salvar",
    async (cep) => {
      estadoDaLoja.atual = {
        originCep: cep,
        storeAddress: ENDERECO_FICTICIO,
        localDeliveryEnabled: true,
        enabledShippingMethods: ["pac"],
      };
      const onNavigate = vi.fn();
      await renderizarFrete(onNavigate);
      await clicar(chaveDaRetirada("Só retirada"));
      expect(chaveDaRetirada("Só retirada").getAttribute("aria-checked")).toBe(
        "false",
      );
      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        AVISO_SEM_CEP,
      );
      expect(botaoSalvar()?.disabled).toBe(true);
      const atalho = [...hospedeiro.querySelectorAll("button")].find((b) =>
        /Abrir Minha loja/.test(b.textContent || ""),
      );
      expect(atalho).toBeDefined();
      await clicar(atalho);
      expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
      expect(updateConfig).not.toHaveBeenCalled();
    },
  );

  it("sem CEP da loja os outros dois modos continuam escolhíveis e salváveis", async () => {
    estadoDaLoja.atual = {
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryEnabled: true,
      enabledShippingMethods: ["pac"],
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Eu entrego ou ele retira"));
    expect(
      chaveDaRetirada("Eu entrego ou ele retira").getAttribute("aria-checked"),
    ).toBe("true");
    expect(hospedeiro.textContent).not.toContain(AVISO_SEM_CEP);
    await clicar(botaoSalvar());
    expect(updateConfig).toHaveBeenCalled();
  });

  it("loja já em 'Só retirada' sem CEP: avisa e não salva; trocar de modo libera", async () => {
    estadoDaLoja.atual = {
      originCep: "",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryEnabled: false,
      enabledShippingMethods: ["pac", "store-pickup"],
    };
    await renderizarFrete();
    expect(chaveDaRetirada("Só retirada").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      AVISO_SEM_CEP,
    );
    await clicar(chaveDaRetirada("Eu entrego ou ele retira"));
    expect(hospedeiro.textContent).not.toContain(AVISO_SEM_CEP);
    expect(botaoSalvar()?.disabled).toBe(false);
  });

  it("loja em 'Só retirada' sem CEP com outra mudança pendente: o salvar fica travado", async () => {
    estadoDaLoja.atual = {
      originCep: "",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryEnabled: false,
      enabledShippingMethods: ["pac", "store-pickup"],
    };
    await renderizarFrete();
    // Mexe em outra coisa (frete grátis local) sem trocar o modo.
    const gratis = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ].find((b) => /Sempre grátis/.test(b.textContent || ""));
    await clicar(gratis);
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvar");
    expect(botaoSalvar()?.disabled).toBe(true);
    await clicar(botaoSalvar());
    expect(updateConfig).not.toHaveBeenCalled();
  });

  function digitar(seletor: string, valor: string) {
    const campo = hospedeiro.querySelector<HTMLInputElement>(seletor);
    expect(campo).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it.each([0, 30])("prazo %i dias é preservado no salvamento", async (dias) => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    digitar("#local-delivery-days", String(dias));
    await clicar(botaoSalvar());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryDays: dias }),
    );
  });

  it.each(["-1", "31", "365", "1.5"])(
    "prazo inválido %s não é salvo",
    async (dias) => {
      estadoDaLoja.atual = {
        originCep: "38500-000",
        storeAddress: ENDERECO_FICTICIO,
      };
      await renderizarFrete();
      digitar("#local-delivery-days", dias);
      await clicar(chaveDaRetirada("Eu entrego ou ele retira"));
      await clicar(botaoSalvar());
      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ localDeliveryDays: 1 }),
      );
    },
  );

  it("Só retirada oculta campos inaplicáveis e voltar preserva valor, prazo e alcance", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryFee: 12,
      localDeliveryDays: 3,
      localCepRange: "38500",
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retirada"));
    expect(hospedeiro.querySelector("#local-delivery-days")).toBeNull();
    expect(hospedeiro.querySelector("#local-delivery-fee")).toBeNull();
    expect(hospedeiro.querySelector("#local-cep-range")).toBeNull();
    await clicar(chaveDaRetirada("Eu entrego"));
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#local-delivery-days")?.value,
    ).toBe("3");
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#local-delivery-fee")?.value,
    ).toBe("12");
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#local-cep-range")?.value,
    ).toBe("38500");
    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("CEP mudou enquanto editava: salvar acompanha o novo CEP sem perder serviços atuais", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      localCepRange: "38500",
      storeAddress: ENDERECO_FICTICIO,
      enabledShippingMethods: ["pac"],
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Eu entrego ou ele retira"));
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      originCep: "38400-100",
      localCepRange: "38400",
      enabledShippingMethods: ["jadlog"],
    };
    await renderizarFrete();
    await clicar(botaoSalvar());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        localCepRange: "38400",
        enabledShippingMethods: ["jadlog", "store-pickup"],
      }),
    );
  });

  it("cada resposta diz o efeito para a cliente, em português simples", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    expect(chaveDaRetirada("Só retirada").textContent).toContain(
      "Ninguém recebe em casa. Qualquer cliente, de qualquer lugar, busca na loja.",
    );
    expect(chaveDaRetirada("Eu entrego").textContent).toContain(
      "Você leva o pedido até a casa do cliente.",
    );
    expect(chaveDaRetirada("Eu entrego ou ele retira").textContent).toContain(
      "busca na loja, sem pagar frete",
    );
  });

  it("loja já em Só retirada abre marcada, com a retirada e sem prazo nem valor", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryEnabled: false,
      enabledShippingMethods: ["pac", "store-pickup"],
    };
    await renderizarFrete();
    expect(chaveDaRetirada("Só retirada").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(chaveDaRetirada("Eu entrego").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(hospedeiro.querySelector("#local-delivery-days")).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "Todo cliente pode buscar o pedido",
    );
  });

  it("padrões intactos: mexer só na taxa não muda o modo nem a lista, e manda entrega ligada e 1 dia", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      enabledShippingMethods: ["sedex", "pac"],
    };
    await renderizarFrete();
    digitar("#local-delivery-fee", "7");
    await clicar(botaoSalvar());
    const enviado = updateConfig.mock.calls[0][0];
    expect(enviado).toMatchObject({
      localDeliveryFee: 7,
      localDeliveryEnabled: true,
      localDeliveryDays: 1,
    });
    expect(enviado).not.toHaveProperty("enabledShippingMethods");
  });

  it.each(["-1", "31", "365", "1.5", "abc"])(
    "prazo %s nem entra no campo: continua o valor anterior",
    async (digitado) => {
      estadoDaLoja.atual = {
        originCep: "38500-000",
        storeAddress: ENDERECO_FICTICIO,
        localDeliveryDays: 7,
      };
      await renderizarFrete();
      digitar("#local-delivery-days", digitado);
      expect(
        hospedeiro.querySelector<HTMLInputElement>("#local-delivery-days")
          ?.value,
      ).toBe("7");
    },
  );

  it("apagar o prazo e salvar volta ao padrão de 1 dia", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryDays: 5,
    };
    await renderizarFrete();
    digitar("#local-delivery-days", "");
    await clicar(botaoSalvar());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localDeliveryDays: 1 }),
    );
  });

  it("os cartões das respostas e o botão de cadastrar endereço têm border-solid; a faixa tem seta", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: null };
    await renderizarFrete(vi.fn());
    expect(chaveDaRetirada("Só retirada").className).toContain("border-solid");
    await clicar(chaveDaRetirada());
    const cadastrar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Abrir Minha loja",
    );
    expect(cadastrar?.className).toContain("border-solid");
    const resumo = [...hospedeiro.querySelectorAll("summary")].find((x) =>
      x.textContent?.includes("Escrever a faixa de CEP à mão"),
    );
    expect(resumo?.className).toContain("before:content-");
  });

  const alertas = () => [
    ...hospedeiro.querySelectorAll('#bloco-frete-local [role="alert"]'),
  ];

  it("Só retirada sem endereço: UM aviso só, colado nos cartões, e a dica não repete a falta", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: null };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada("Só retirada"));
    expect(alertas()).toHaveLength(1);
    const grupo = hospedeiro.querySelector(
      '[role="radiogroup"][aria-label="Como o cliente da sua região recebe"]',
    );
    expect(grupo?.parentElement?.contains(alertas()[0])).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Para oferecer a retirada");
  });

  it("Só retirada salvo e loja sem endereço: diz que ninguém consegue comprar, num aviso só", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: null,
      localDeliveryEnabled: false,
      enabledShippingMethods: ["store-pickup"],
    };
    await renderizarFrete(vi.fn());
    expect(alertas()).toHaveLength(1);
    expect(alertas()[0].textContent).toContain("ninguém consegue comprar");
    expect(alertas()[0].textContent).toContain("volte a entregar");
  });

  it("retirada salva sem endereço e clique em Só retirada: nunca dois avisos juntos", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: null,
      enabledShippingMethods: ["pac", "store-pickup"],
    };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada("Só retirada"));
    expect(alertas()).toHaveLength(1);
  });

  it("os textos da tela falam sempre 'o cliente' (nunca 'a cliente')", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: null };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada("Só retirada"));
    expect(hospedeiro.textContent).not.toMatch(
      /\ba cliente\b|\bda cliente\b|\bpara a cliente\b/i,
    );
  });

  it("valor e prazo: a pílula inteira é um rótulo do campo, com 44 px de toque", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    for (const id of ["local-delivery-fee", "local-delivery-days"]) {
      const rotulo = hospedeiro.querySelector(`label[for="${id}"]`);
      expect(rotulo?.querySelector(`#${id}`)).not.toBeNull();
      expect(rotulo?.className).toContain("min-h-11");
    }
  });

  it("contraste: dica e unidades em zinc-400 (não zinc-500) e seta do CEP no tom do texto", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    const dica = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Uma transportadora leva o pedido"),
    );
    expect(dica?.className).toContain("text-zinc-400");
    const unidade = [...hospedeiro.querySelectorAll("label span")].find(
      (x) => x.textContent === "R$",
    );
    expect(unidade?.className).toContain("text-zinc-400");
    const resumo = [...hospedeiro.querySelectorAll("summary")].find((x) =>
      x.textContent?.includes("Escrever a faixa de CEP à mão"),
    );
    expect(resumo?.className).toContain("before:text-zinc-300");
  });

  it("'Vender para fora da sua região' continua em Só retirada e em Entrego", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    const chave = () =>
      hospedeiro.querySelector(
        'button[role="switch"][aria-label="Vender para fora da sua região"]',
      );
    expect(chave()).not.toBeNull();
    await clicar(chaveDaRetirada("Só retirada"));
    expect(chave()).not.toBeNull();
    await clicar(chaveDaRetirada("Eu entrego"));
    expect(chave()).not.toBeNull();
  });

  it("alcance escrito de propósito é enviado exatamente como está", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    digitar("#local-cep-range", "38500-000, 38509-999");
    await clicar(botaoSalvar());
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ localCepRange: "38500-000, 38509-999" }),
    );
  });

  it("o que a lojista digita no alcance enquanto salva não é apagado", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      localCepRange: "38500",
      storeAddress: ENDERECO_FICTICIO,
      enabledShippingMethods: ["pac"],
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Eu entrego ou ele retira"));
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      originCep: "38400-100",
      localCepRange: "38400",
    };
    await renderizarFrete();
    let terminar: (ok: boolean) => void = () => {};
    updateConfig.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          terminar = r;
        }),
    );
    await clicar(botaoSalvar());
    digitar("#local-cep-range", "38400-000, 38499-999");
    await act(async () => {
      terminar(true);
    });
    await drenar();
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#local-cep-range")?.value,
    ).toBe("38400-000, 38499-999");
  });

  it("sem endereço, recusar o salvamento não deixa a tela presa em 'Salvando…'", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retirada"));
    estadoDaLoja.atual = { originCep: "38500-000" };
    await renderizarFrete();
    const botao = botaoSalvar() as HTMLButtonElement;
    // O botão está desabilitado: chama direto o clique que o React guarda.
    const chave = Object.keys(botao).find((k) =>
      k.startsWith("__reactProps"),
    ) as string;
    await act(async () => {
      (Reflect.get(botao, chave) as { onClick: () => void }).onClick();
    });
    await drenar();
    expect(updateConfig).not.toHaveBeenCalled();
    expect(botaoSalvar()?.textContent?.trim()).not.toBe("Salvando…");
  });

  // RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md): os dois testes "Transportadoras: ..."
  // que viviam aqui foram REMOVIDOS. Eles provavam que
  // `TransportadorasSection` preservava `store-pickup` ao salvar os chips de
  // serviço (sedex/pac/jadlog) via `updateConfig`. Esse desenho morreu: a
  // seção não gerencia mais `enabledShippingMethods` nem chama `updateConfig`
  // — os serviços por transportadora agora vêm de `list_services` (ids reais
  // da conta) e são salvos pela edge (`save_credentials`). `store-pickup`
  // continua intacto porque ninguém além de AdminShippingView escreve nessa
  // lista agora (prova pelos testes acima, que continuam de pé).
});
