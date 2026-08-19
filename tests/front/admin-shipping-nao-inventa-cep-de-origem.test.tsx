// @vitest-environment jsdom
//
// Bloco "o app para de inventar endereço": a Tarefa 2 tirou o CEP de origem
// assumido (`38500-000`, Monte Carmelo) do `defaultStoreConfig` e do frete de
// contingência da edge function, mas a tela de Frete continuava cravando o
// mesmo valor em três lugares (estado inicial do formulário, sincronização
// com o config salvo, e a checagem de "formulário sujo"). Isso é a porta dos
// fundos: quem abre Admin → Frete via a única tela onde a taxa se define, o
// campo "CEP de Origem" já aparecia preenchido -- parece configurado, e a
// lojista salva sem desconfiar. O CEP de Monte Carmelo ficava gravado no
// banco DELA, e a validação que a Tarefa 7 construiu nunca disparava.
//
// Este teste prova: o campo abre vazio quando a loja não configurou, abre
// com o valor salvo quando configurou, o formulário não se marca como
// "alterado" só por abrir sem CEP, e a tela avisa que o campo é obrigatório
// para cotar frete.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();

// `mockConfig` precisa ser mutável entre os testes -- cada `it` ajusta o
// `originCep` antes de montar a tela, então ele fica em `let` dentro do
// `vi.hoisted` (mesmo padrão de `admin-settings-identidade-da-loja.test.tsx`).
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    originCep: undefined as string | undefined,
    // Mantido igual à reserva que o próprio efeito de sincronização usa
    // (`config.enabledShippingMethods || ["sedex", "pac"]`) para isolar o
    // teste da checagem de "sujo" só no campo de CEP -- há uma assimetria
    // pré-existente e fora do escopo desta tarefa entre esse valor de
    // reserva e o que a comparação de "sujo" usa (`|| []`), que por si só já
    // marcaria o formulário como alterado mesmo sem tocar em nada.
    enabledShippingMethods: ["sedex", "pac"] as string[],
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// AdminShippingView busca credenciais e logs de frete direto do Supabase no
// carregamento -- sem o dublê o `from(...).select(...)` tentaria criar um
// client de verdade em jsdom.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
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

describe("AdminShippingView — não inventa CEP de origem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.originCep = undefined;
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

  function pegarCampoCep(): HTMLInputElement {
    const campo = hospedeiro.querySelector("#origin-cep") as HTMLInputElement;
    expect(campo).toBeDefined();
    return campo;
  }

  function pegarBotaoSalvar(): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    return botao;
  }

  it("abre com o CEP de origem vazio quando a loja não configurou", async () => {
    mockConfig.originCep = undefined;
    await abrirTela();

    expect(pegarCampoCep().value).toBe("");
  });

  it("abre com o CEP de origem salvo quando a loja configurou", async () => {
    mockConfig.originCep = "38400-000";
    await abrirTela();

    expect(pegarCampoCep().value).toBe("38400-000");
  });

  it("não marca o formulário como alterado só por abrir sem CEP configurado", async () => {
    mockConfig.originCep = undefined;
    await abrirTela();

    // O botão Salvar depende de `isFormDirty`. Se a comparação de "sujo"
    // ainda usar a reserva "38500-000", o formData ("") nunca bate com ela
    // e o botão fica habilitado sem nenhuma mudança real da pessoa.
    expect(pegarBotaoSalvar().disabled).toBe(true);
  });

  it("avisa que o CEP de origem é obrigatório para calcular frete quando está vazio", async () => {
    mockConfig.originCep = undefined;
    await abrirTela();

    expect(hospedeiro.textContent?.toLowerCase()).toContain(
      "obrigatório para calcular frete",
    );
  });

  it("não mostra o aviso de CEP obrigatório quando a loja já configurou", async () => {
    mockConfig.originCep = "38400-000";
    await abrirTela();

    expect(hospedeiro.textContent?.toLowerCase()).not.toContain(
      "obrigatório para calcular frete",
    );
  });
});
