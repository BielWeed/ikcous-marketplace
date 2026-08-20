// @vitest-environment jsdom
//
// Achado 13 / item I da fila (degrau 2) + o segundo defeito na mesma seção
// (degrau 1, "Zero é uma afirmação"): a seção "Histórico de Cotações & Audit
// Logs" da tela de Frete mostrava um único estado vazio — "Nenhuma cotação
// registrada recentemente" — para três situações bem diferentes:
//
//   1. a consulta FALHOU (catch silencioso, `logs` fica como estava);
//   2. o provedor salvo é `flat_fee`, que nunca grava log — vazio para
//      sempre, por desenho, não por falta de uso;
//   3. o provedor salvo é `melhor_envio`/`frenet` e realmente não há
//      cotação ainda — aí "Nenhuma cotação registrada recentemente" É
//      verdade.
//
// Este arquivo prova que a tela agora distingue os três, sem misturar as
// frases, e que o motivo do estado 2 lê o provedor SALVO
// (`config.shippingProvider`), nunca o que está só no formulário sem salvar
// — testado à parte porque é a armadilha mais fácil de reintroduzir.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig, logsState } = vi.hoisted(() => ({
  mockConfig: {
    shippingProvider: "flat_fee" as "flat_fee" | "melhor_envio" | "frenet",
  },
  logsState: {
    data: [] as any[] | null,
    error: null as { message: string } | null,
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

// `shipping_calculation_logs` responde o que o teste armou em `logsState`;
// qualquer outra tabela (ex.: `store_shipping_credentials`, que a tela busca
// no carregamento) devolve vazio sem erro, como nos dois testes-irmãos desta
// tela.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "shipping_calculation_logs") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: logsState.data,
                  error: logsState.error,
                }),
            }),
          }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — o histórico de cotações para de mentir sobre o motivo de estar vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.shippingProvider = "flat_fee";
    logsState.data = [];
    logsState.error = null;
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

  async function abrirTelaEExpandirHistorico() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botaoExpandir = [
      ...hospedeiro.querySelectorAll("button"),
    ].find((b) => b.textContent?.includes("Histórico de Cotações")) as
      | HTMLButtonElement
      | undefined;
    expect(botaoExpandir).toBeTruthy();

    await act(async () => {
      botaoExpandir?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  // A seção de histórico não é a única parte da tela com "Taxa Única Fixa"
  // no texto — o seletor de provedor (fora da seção) usa a mesma frase para
  // rotular a opção. Escopar ao container da seção evita que a checagem de
  // ausência dê falso positivo por causa de um texto vizinho, sem relação.
  const textoDoHistorico = () =>
    hospedeiro.querySelector("#shipping-logs-section")?.textContent ?? "";

  it("provedor salvo flat_fee + 0 linhas: explica o motivo, e NÃO diz 'nenhuma cotação registrada'", async () => {
    mockConfig.shippingProvider = "flat_fee";
    logsState.data = [];
    await abrirTelaEExpandirHistorico();

    expect(textoDoHistorico()).toMatch(/Taxa Única Fixa/i);
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
  });

  it("provedor salvo melhor_envio + 0 linhas: diz 'nenhuma cotação registrada', e NÃO mostra a explicação do flat_fee", async () => {
    mockConfig.shippingProvider = "melhor_envio";
    logsState.data = [];
    await abrirTelaEExpandirHistorico();

    expect(textoDoHistorico()).toMatch(/Nenhuma cotação registrada recentemente/i);
    expect(textoDoHistorico()).not.toMatch(/Taxa Única Fixa/i);
  });

  it("a consulta falha: mostra o aviso de falha, e NÃO diz 'nenhuma cotação registrada'", async () => {
    logsState.data = null;
    logsState.error = { message: "conexão perdida" };
    await abrirTelaEExpandirHistorico();

    expect(textoDoHistorico()).toMatch(/não foi possível carregar/i);
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
    // A ausência ACIMA sozinha não decide nada neste caso: o `mockConfig`
    // aqui fica no `flat_fee` do `beforeEach`, e o texto do ramo flat_fee é
    // "Nenhuma cotação PARA MOSTRAR...", que não casa com o regex anterior.
    // Sem a linha abaixo, uma falha de consulta caindo no ramo flat_fee
    // passaria pela asserção de ausência por acidente.
    expect(textoDoHistorico()).not.toMatch(/não existe cotação para registrar/i);
  });

  it("config salvo é flat_fee mas o formulário foi mudado para Melhor Envio sem salvar: continua explicando o flat_fee", async () => {
    mockConfig.shippingProvider = "flat_fee";
    logsState.data = [];
    await abrirTelaEExpandirHistorico();

    const botaoAbrirDropdown = [
      ...hospedeiro.querySelectorAll("button"),
    ].find((b) =>
      b.textContent?.includes("Taxa Única Fixa (Sem API externa)"),
    ) as HTMLButtonElement | undefined;
    expect(botaoAbrirDropdown).toBeTruthy();

    await act(async () => {
      botaoAbrirDropdown?.click();
    });

    const opcaoMelhorEnvio = [
      ...hospedeiro.querySelectorAll("button"),
    ].find((b) => b.textContent?.includes("Melhor Envio (API)")) as
      | HTMLButtonElement
      | undefined;
    expect(opcaoMelhorEnvio).toBeTruthy();

    await act(async () => {
      opcaoMelhorEnvio?.click();
    });

    // CONTROLE POSITIVO — o arranjo é premissa deste teste, e premissa se
    // asserta antes do veredito. Sem esta linha, um clique que não
    // registrasse (menu que não abriu, rótulo que mudou) deixaria o teste
    // passar VAZIO: o `config` já é flat_fee, então o ramo certo renderiza
    // de qualquer jeito e o veredito abaixo não provaria mais nada.
    // O gatilho do seletor só exibe este texto quando `formData` mudou
    // mesmo — o rótulo da OPÇÃO no menu é "Melhor Envio (API)", sem o
    // "em tempo real", e o menu já fechou neste ponto.
    const gatilhoDoSeletor = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Melhor Envio (API em tempo real)"),
    );
    expect(gatilhoDoSeletor).toBeTruthy();

    // A edge function continua em flat_fee até alguém clicar em Salvar — o
    // aviso tem de continuar lendo o provedor SALVO, não o do formulário.
    expect(textoDoHistorico()).toMatch(/Taxa Única Fixa/i);
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
  });

  it("com linhas: a tabela aparece, e nenhum dos textos de vazio/erro aparece", async () => {
    mockConfig.shippingProvider = "flat_fee";
    logsState.data = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        destination_cep: "38400000",
        provider: "melhor_envio",
        response_time_ms: 320,
        status: "success",
      },
    ];
    await abrirTelaEExpandirHistorico();

    expect(hospedeiro.querySelector("table")).toBeTruthy();
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
    expect(textoDoHistorico()).not.toMatch(/Taxa Única Fixa/i);
    expect(textoDoHistorico()).not.toMatch(/Não foi possível/i);
    expect(textoDoHistorico()).toMatch(/Exibindo a 1 consulta mais recente/i);
  });
});
