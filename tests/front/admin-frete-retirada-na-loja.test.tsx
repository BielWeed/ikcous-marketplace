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
//      Minha loja (com o botão "Cadastrar endereço em Minha loja");
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

  function chaveDaRetirada(titulo = "Entrego e retiro"): HTMLButtonElement {
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
    expect(hospedeiro.textContent).toContain(ENDERECO_FICTICIO);

    await clicar(chaveDaRetirada());
    expect(chaveDaRetirada().getAttribute("aria-checked")).toBe("true");
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
    await clicar(chaveDaRetirada("Entrego"));
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
        'button[role="switch"][aria-label="Só entregar na cidade"]',
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

    // A explicação está na linha da chave, sem precisar tentar ligar.
    expect(hospedeiro.textContent).toContain(
      "cadastre o endereço da loja em Minha loja",
    );
    const cadastrar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cadastrar endereço em Minha loja",
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
    ["Entrego", false, ["pac", "store-pickup"], true, ["pac"]],
    ["Entrego e retiro", true, ["pac"], true, ["pac", "store-pickup"]],
    ["Só retiro", true, ["pac"], false, ["pac", "store-pickup"]],
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

  it("Só retiro sem endereço não muda o formulário nem permite salvar", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: "  " };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retiro"));
    expect(chaveDaRetirada("Só retiro").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(botaoSalvar()?.disabled).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Minha loja",
    );
  });

  it("eco sem storeAddress usa a mesma fonte do bloco e impede Só retiro", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    estadoDaLoja.atual = { originCep: "38500-000" };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retiro"));
    expect(chaveDaRetirada("Só retiro").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("endereço some depois da escolha: salvar não envia Só retiro", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retiro"));
    estadoDaLoja.atual = { originCep: "38500-000" };
    await renderizarFrete();
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
      await clicar(chaveDaRetirada("Entrego e retiro"));
      await clicar(botaoSalvar());
      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ localDeliveryDays: 1 }),
      );
    },
  );

  it("Só retiro oculta campos inaplicáveis e voltar preserva valor, prazo e alcance", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryFee: 12,
      localDeliveryDays: 3,
      localCepRange: "38500",
    };
    await renderizarFrete();
    await clicar(chaveDaRetirada("Só retiro"));
    expect(hospedeiro.querySelector("#local-delivery-days")).toBeNull();
    expect(hospedeiro.querySelector("#local-delivery-fee")).toBeNull();
    expect(hospedeiro.querySelector("#local-cep-range")).toBeNull();
    await clicar(chaveDaRetirada("Entrego"));
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
    await clicar(chaveDaRetirada("Entrego e retiro"));
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
    expect(chaveDaRetirada("Só retiro").textContent).toContain(
      "Seus clientes só poderão retirar na loja. Não oferecemos entrega.",
    );
    expect(chaveDaRetirada("Entrego").textContent).toContain(
      "Ele não pode retirar na loja",
    );
    expect(chaveDaRetirada("Entrego e retiro").textContent).toContain(
      "retira na loja, de graça",
    );
  });

  it("loja já em Só retiro abre marcada, com a retirada e sem prazo nem valor", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
      localDeliveryEnabled: false,
      enabledShippingMethods: ["pac", "store-pickup"],
    };
    await renderizarFrete();
    expect(chaveDaRetirada("Só retiro").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(chaveDaRetirada("Entrego").getAttribute("aria-checked")).toBe(
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
    expect(chaveDaRetirada("Só retiro").className).toContain("border-solid");
    const cadastrar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cadastrar endereço em Minha loja",
    );
    expect(cadastrar?.className).toContain("border-solid");
    const resumo = [...hospedeiro.querySelectorAll("summary")].find((x) =>
      x.textContent?.includes("Escrever faixa de CEP"),
    );
    expect(resumo?.className).toContain("before:content-");
  });

  const alertas = () => [...hospedeiro.querySelectorAll('[role="alert"]')];

  it("Só retiro sem endereço: UM aviso só, colado nos cartões, e a dica não repete a falta", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: null };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada("Só retiro"));
    expect(alertas()).toHaveLength(1);
    const grupo = hospedeiro.querySelector(
      '[role="radiogroup"][aria-label="Como você entrega na sua cidade"]',
    );
    expect(grupo?.parentElement?.contains(alertas()[0])).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Para oferecer a retirada");
  });

  it("Só retiro salvo e loja sem endereço: diz que ninguém consegue comprar, num aviso só", async () => {
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

  it("retirada salva sem endereço e clique em Só retiro: nunca dois avisos juntos", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: null,
      enabledShippingMethods: ["pac", "store-pickup"],
    };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada("Só retiro"));
    expect(alertas()).toHaveLength(1);
  });

  it("os textos da tela falam sempre 'o cliente' (nunca 'a cliente')", async () => {
    estadoDaLoja.atual = { originCep: "38500-000", storeAddress: null };
    await renderizarFrete(vi.fn());
    await clicar(chaveDaRetirada("Só retiro"));
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
      p.textContent?.startsWith("Ligada: quem é de fora"),
    );
    expect(dica?.className).toContain("text-zinc-400");
    const unidade = [...hospedeiro.querySelectorAll("label span")].find(
      (x) => x.textContent === "R$",
    );
    expect(unidade?.className).toContain("text-zinc-400");
    const resumo = [...hospedeiro.querySelectorAll("summary")].find((x) =>
      x.textContent?.includes("Escrever faixa de CEP"),
    );
    expect(resumo?.className).toContain("before:text-zinc-300");
  });

  it("'Só entregar na cidade' some em Só retiro e volta em Entrego", async () => {
    estadoDaLoja.atual = {
      originCep: "38500-000",
      storeAddress: ENDERECO_FICTICIO,
    };
    await renderizarFrete();
    const chave = () =>
      hospedeiro.querySelector(
        'button[role="switch"][aria-label="Só entregar na cidade"]',
      );
    expect(chave()).not.toBeNull();
    await clicar(chaveDaRetirada("Só retiro"));
    expect(chave()).toBeNull();
    await clicar(chaveDaRetirada("Entrego"));
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
    await clicar(chaveDaRetirada("Entrego e retiro"));
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
    await clicar(chaveDaRetirada("Só retiro"));
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
