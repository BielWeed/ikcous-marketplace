// @vitest-environment jsdom
//
// CONTRATO da tela de Frete v2 (frente frete-v2-0309, 03/09/2026 — o dono
// reprovou o visual do PR #414: "o visual não mudou nada" e a "entrega fixa
// não faz sentido existir"). Este arquivo prende o que a tela nova É, não
// só como ela parece:
//
//   1. o HERO descreve o estado REAL salvo no config (local com cidade,
//      nacional com transportadora conectada, grátis pelo preset);
//   2. a taxa fixa MORREU: nenhum card, campo ou payload dela;
//   3. os presets de frete grátis são EXCLUSIVOS (escolher um é desligar os
//      outros) e gravam via `valorDoPreset` — inclusive as sentinelas do
//      contrato final: 0,01 do "sempre" e -1 do "por produto"
//      (FRETE_GRATIS_POR_PRODUTO; a estratégia mora na marcação do produto,
//      o negativo no config é só o marcador dela);
//   4. sem transportadora conectada, o aviso é BEM VISÍVEL e o caminho para
//      Ajustes existe de verdade;
//   5. salvar aqui NÃO envia campo da seção de Transportadoras.
//
// Os companheiros desta prova: admin-shipping-nao-inventa-cep-de-origem
// (CEP de origem), admin-shipping-trocar-de-aba (guarda de dirty),
// admin-visual-frete (divisão de território).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { View } from "@/types";

const { estadoDaLoja, estadoDoBanco, updateConfig } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      freeShippingMin: 100,
      shippingCoverage: "national" as "local" | "national",
      shippingProvider: "melhor_envio" as
        | "flat_fee"
        | "melhor_envio"
        | "frenet",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"] as string[],
      localDeliveryFee: 10,
      localCepRange: "",
      storeCity: "Uberlândia" as string | null,
      storeState: "MG" as string | null,
    },
  },
  estadoDoBanco: {
    credenciais: [
      {
        provider: "melhor_envio",
        credentials: { token: "tok-salvo", sandbox: false },
      },
    ] as any[],
  },
  updateConfig: vi.fn(),
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
        return {
          select: () =>
            Promise.resolve({ data: estadoDoBanco.credenciais, error: null }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function digitarNoCampo(
  campo: HTMLInputElement,
  texto: string,
): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

describe("Contrato da tela de Frete v2", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Tipada pela IMPLEMENTAÇÃO (padrão de
  // ficha-do-pedido-pergunta-se-recebeu-ao-entregar): `ReturnType<typeof
  // vi.fn>` solto infere um mock genérico demais e o typecheck reprova ao
  // passar o mock como prop.
  let onNavigate: ReturnType<typeof vi.fn<(view: View) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      freeShippingMin: 100,
      shippingCoverage: "national",
      shippingProvider: "melhor_envio",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryFee: 10,
      localCepRange: "",
      storeCity: "Uberlândia",
      storeState: "MG",
    };
    estadoDoBanco.credenciais = [
      {
        provider: "melhor_envio",
        credentials: { token: "tok-salvo", sandbox: false },
      },
    ];
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

  async function abrirTela() {
    onNavigate = vi.fn<(view: View) => void>();
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  const textoDoHero = () =>
    hospedeiro.querySelector(
      '[aria-label="Como a entrega funciona hoje"]',
    )?.textContent ?? "";

  async function escolherPreset(nome: RegExp) {
    const cartao = [...hospedeiro.querySelectorAll('[role="radio"]')].find(
      (r) => nome.test(r.textContent || ""),
    );
    expect(cartao).toBeDefined();
    await act(async () => {
      (cartao as HTMLElement).click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function salvar() {
    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botaoSalvar.disabled).toBe(false);
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });
  }

  it("o hero descreve o estado REAL salvo: local com cidade, nacional conectado, grátis pelo preset", async () => {
    await abrirTela();

    expect(textoDoHero()).toContain("R$ 10 por entrega");
    expect(textoDoHero()).toContain("Uberlândia/MG");
    expect(textoDoHero()).toContain("Melhor Envio conectado");
    expect(textoDoHero()).toContain("Acima de R$ 100");
    // Nada foi mexido: sem selo de pendência.
    expect(textoDoHero()).not.toMatch(/altera[çc][õo]es n[ãa]o salvas/i);
  });

  it("a taxa fixa morreu: nenhum card, campo ou interruptor dela na tela", async () => {
    await abrirTela();

    expect(texto()).not.toMatch(/taxa de entrega fixa/i);
    expect(hospedeiro.querySelector("#shipping-fee-switch")).toBeNull();
    expect(hospedeiro.querySelector("#shipping-flat-fee")).toBeNull();
  });

  it("preset 'Sempre grátis' grava a sentinela 0,01 (0 sempre significou desligado)", async () => {
    await abrirTela();

    await escolherPreset(/Sempre grátis/);
    expect(
      hospedeiro.querySelector('[role="radio"][aria-checked="true"]')?.textContent,
    ).toMatch(/Sempre grátis/);

    await salvar();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0]).toHaveProperty("freeShippingMin", 0.01);
  });

  it("preset 'acima de um valor': o valor editado é o que vai para o config", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 0 };
    await abrirTela();

    await escolherPreset(/Grátis acima de um valor/);

    const campoValor = hospedeiro.querySelector(
      "#frete-gratis-acima-de",
    ) as HTMLInputElement;
    expect(campoValor).toBeDefined();
    // Semente de R$ 100 (a mesma que a tela antiga usava ao ligar o
    // interruptor) — visível e editável ANTES de salvar, nunca gravada às
    // escondidas.
    expect(campoValor.value).toBe("100");

    await digitarNoCampo(campoValor, "250");
    await salvar();

    expect(updateConfig.mock.calls[0][0]).toHaveProperty("freeShippingMin", 250);
  });

  it("REVISÃO A7: o campo do 'acima de' trava 0/negativo e avisa que valor vazio desliga o grátis", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 100 };
    await abrirTela();

    await escolherPreset(/Grátis acima de um valor/);

    const campoValor = hospedeiro.querySelector(
      "#frete-gratis-acima-de",
    ) as HTMLInputElement;
    // `min="0.01"`: 0 é "desligado" no contrato de presets — nunca é limiar.
    expect(campoValor.min).toBe("0.01");
    // E a consequência é dita ANTES do salvar, não no susto da reabertura.
    expect(texto()).toMatch(/valor vazio desliga o frete gr[áa]tis/i);
  });

  it("preset 'Por produto marcado' grava a sentinela -1 e NÃO envia campo alheio", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 0 };
    await abrirTela();

    await escolherPreset(/Por produto marcado/);
    await salvar();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    // FRETE_GRATIS_POR_PRODUTO (contrato final em presets-de-frete-gratis.ts):
    // a estratégia mora na marcação `product.freeShipping`; o -1 no config é
    // o marcador dela — `0` já significava "desligado" e não podia servir.
    expect(payload).toHaveProperty("freeShippingMin", -1);
    // Campos da seção de Transportadoras NUNCA saem daqui.
    expect(payload).not.toHaveProperty("shippingProvider");
    expect(payload).not.toHaveProperty("enabledShippingMethods");
    // A taxa fixa morta também não.
    expect(payload).not.toHaveProperty("shippingFee");
  });

  it("preset 'por produto' salvo (-1) volta como o ativo no seletor e no hero (a sentinela preserva a escolha)", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: -1 };
    await abrirTela();

    expect(textoDoHero()).toContain("Por produto marcado");
    const marcado = hospedeiro.querySelector(
      '[role="radio"][aria-checked="true"]',
    )?.textContent;
    expect(marcado).toMatch(/Por produto marcado/);
    // Nada foi mexido: o config já descreve o preset escolhido.
    expect(textoDoHero()).not.toMatch(/altera[çc][õo]es n[ãa]o salvas/i);
  });

  it("escolher 'Desligado' sobre um config de grátis-por-valor grava 0 (presets são exclusivos)", async () => {
    await abrirTela();

    await escolherPreset(/Desligado/);
    await salvar();

    expect(updateConfig.mock.calls[0][0]).toHaveProperty("freeShippingMin", 0);
  });

  it("preset 'sempre' salvo no config volta como o ativo no seletor e no hero", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 0.01 };
    await abrirTela();

    expect(textoDoHero()).toContain("Em toda a loja");
    const marcado = hospedeiro.querySelector(
      '[role="radio"][aria-checked="true"]',
    )?.textContent;
    expect(marcado).toMatch(/Sempre grátis/);
  });

  it("sem transportadora conectada: aviso BEM VISÍVEL de loja-só-cidade + caminho para Ajustes", async () => {
    estadoDoBanco.credenciais = [];
    await abrirTela();

    expect(texto()).toMatch(/Nenhuma transportadora conectada/i);
    expect(texto()).toMatch(/s[óo] entrega na/i);

    const cta = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /conectar transportadora/i.test(b.textContent || ""),
    );
    expect(cta).toBeDefined();
    await act(async () => {
      (cta as HTMLElement).click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  it("com transportadora conectada: o aviso de sem-conexão NÃO aparece, e o atalho de Ajustes segue existindo", async () => {
    await abrirTela();

    expect(texto()).not.toMatch(/Nenhuma transportadora conectada/i);
    expect(texto()).toMatch(/Conectado ao Melhor Envio/i);

    const botaoAjustes = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /abrir ajustes/i.test(b.textContent || ""),
    );
    expect(botaoAjustes).toBeDefined();
    await act(async () => {
      (botaoAjustes as HTMLElement).click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  it("REVISÃO A5: provedor flat_fee (sem nome) diz 'conecte uma transportadora', nunca 'conecte o uma transportadora'", async () => {
    // Loja antiga com `flat_fee` remanescente (ou provedor ausente): o nome
    // é indefinido, então a frase do aviso troca o artigo em vez de costurar
    // "o" + "uma transportadora".
    estadoDaLoja.atual = { ...estadoDaLoja.atual, shippingProvider: "flat_fee" };
    await abrirTela();

    expect(texto()).toMatch(/conecte uma transportadora em Ajustes/);
    expect(texto()).not.toMatch(/conecte o uma transportadora/i);
  });

  it("REVISÃO A5: provedor nomeado sem credencial mantém o artigo 'o' ('conecte o Melhor Envio')", async () => {
    estadoDoBanco.credenciais = [];
    await abrirTela();

    expect(texto()).toMatch(/conecte o Melhor Envio em Ajustes/);
  });

  it("CEP da loja vazio no config: o hero diz que a entrega está PARADA (não inventa funcionamento)", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, originCep: "" };
    await abrirTela();

    expect(textoDoHero()).toMatch(/Parado/i);
    expect(textoDoHero()).toMatch(/falta o CEP da loja/i);
  });
});
