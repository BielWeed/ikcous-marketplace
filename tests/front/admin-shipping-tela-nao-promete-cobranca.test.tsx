// @vitest-environment jsdom
//
// Auditoria de 20/08/2026, achados 2 e 3 — a prova de que a TELA usa a regra,
// e não só de que a regra existe.
//
// O companheiro deste arquivo (`admin-shipping-frases-da-regra.test.ts`) prova
// a função pura. Sozinho ele não vale nada aqui: se alguém escrever a função
// certinha e esquecer de ligá-la no markup, ele continua verde e a tela segue
// mentindo. Este arquivo monta a tela de verdade e lê o texto renderizado.
//
// O que a tela dizia antes, e não pode voltar a dizer:
//   - "Frete grátis desativado. Todos os pedidos terão cobrança de entrega."
//     com a taxa também em zero — quando na verdade o app cota R$ 0,00 para o
//     Brasil inteiro.
//   - "Sem taxa fixa configurada." para uma taxa que ESTÁ configurada, em zero,
//     e que é usada.
//   - "Frete grátis ativo para pedidos a partir de R$ X" sem dizer que a regra
//     exige o cliente autenticado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    freeShippingMin: 100,
    shippingFee: 10,
    shippingCoverage: "national" as "local" | "national",
    shippingProvider: "flat_fee" as "flat_fee" | "melhor_envio" | "frenet",
    originCep: "38500-000",
    enabledShippingMethods: ["sedex", "pac"] as string[],
    localDeliveryFee: 10,
    localCepRange: "",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — a tela não promete cobrança que o app não faz", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.freeShippingMin = 100;
    mockConfig.shippingFee = 10;
    mockConfig.shippingCoverage = "national";
    mockConfig.shippingProvider = "flat_fee";
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

  const texto = () => hospedeiro.textContent ?? "";

  it("com as duas regras ligadas: diz o valor e avisa que exige entrar na conta", async () => {
    await abrirTela();

    expect(texto()).toContain("R$ 100");
    expect(texto()).toMatch(/entrou na conta|entrar na conta/i);
    expect(texto()).toContain("R$ 10");
  });

  it("com as duas desligadas: NÃO diz que todo pedido paga entrega", async () => {
    mockConfig.freeShippingMin = 0;
    mockConfig.shippingFee = 0;
    await abrirTela();

    // A frase exata que a auditoria pegou.
    expect(texto()).not.toMatch(/Todos os pedidos ter[aã]o cobran[çc]a/i);
    // E a que descrevia uma taxa configurada como se estivesse faltando.
    expect(texto()).not.toMatch(/Sem taxa fixa configurada/i);
  });

  it("com as duas desligadas: avisa que a loja vai entregar de graça para qualquer CEP", async () => {
    mockConfig.freeShippingMin = 0;
    mockConfig.shippingFee = 0;
    await abrirTela();

    expect(texto()).toMatch(/qualquer CEP/i);
    expect(texto()).toMatch(/Quem paga a entrega é a loja/i);
  });

  it("taxa em zero mas cobertura só local: o aviso NÃO aparece", async () => {
    // A taxa fixa não governa o preço nesse estado — a edge function responde
    // pela taxa local e retorna antes de olhar para ela. O aviso aqui seria a
    // tela afirmando um efeito que não acontece, que é o defeito de origem.
    mockConfig.freeShippingMin = 0;
    mockConfig.shippingFee = 0;
    mockConfig.shippingCoverage = "local";
    await abrirTela();

    expect(texto()).not.toMatch(/qualquer CEP/i);
  });

  it("taxa acima de zero: o aviso NÃO aparece", async () => {
    mockConfig.freeShippingMin = 0;
    mockConfig.shippingFee = 10;
    await abrirTela();

    expect(texto()).not.toMatch(/qualquer CEP/i);
    expect(texto()).not.toMatch(/Todos os pedidos ter[aã]o cobran[çc]a/i);
  });

  it("taxa em zero com transportadora salva (melhor_envio): o aviso NÃO aparece, e o resumo cita a transportadora SALVA", async () => {
    // Achado D1 da revisão adversária (frente glm-visual-admin-0209): com a
    // mudança de casa das transportadoras, o provedor que alimenta o aviso
    // passou a ser o SALVO (`config.shippingProvider`) — era o do formulário.
    // Todos os cenários anteriores usam flat_fee, então uma regressão que
    // cravasse "flat_fee" no código passaria batida por esta suíte inteira.
    // Este cenário prende a LIGAÇÃO: com melhor_envio salvo, a taxa fixa não
    // governa o preço nacional (a cotação governa) e o aviso de entrega
    // gratuita seria a tela afirmando um efeito que não acontece.
    mockConfig.freeShippingMin = 0;
    mockConfig.shippingFee = 0;
    mockConfig.shippingCoverage = "national";
    mockConfig.shippingProvider = "melhor_envio";
    await abrirTela();

    expect(texto()).not.toMatch(/qualquer CEP/i);
    expect(texto()).not.toMatch(/Quem paga a entrega é a loja/i);
    // O resumo do frete nacional nomeia a transportadora salva — se esta
    // linha quebra, o provedor deixou de ser lido do config.
    expect(texto()).toMatch(/Melhor Envio/i);
  });

  it("o texto acompanha o interruptor antes de salvar, não o que está no banco", async () => {
    // Quem desliga a taxa precisa ver a consequência ANTES de tocar em Salvar.
    // Se as frases lessem o config salvo em vez do formulário, a tela só
    // contaria a verdade depois do estrago.
    mockConfig.freeShippingMin = 0;
    mockConfig.shippingFee = 10;
    await abrirTela();

    expect(texto()).not.toMatch(/qualquer CEP/i);

    const interruptorDaTaxa = hospedeiro.querySelector(
      "#shipping-fee-switch",
    ) as HTMLButtonElement;
    expect(interruptorDaTaxa).toBeTruthy();

    await act(async () => {
      interruptorDaTaxa.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Desligou a taxa: o aviso tem de aparecer na hora, sem salvar nada.
    expect(texto()).toMatch(/qualquer CEP/i);
  });
});
