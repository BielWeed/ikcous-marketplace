// @vitest-environment jsdom
//
// Achado 13 / item I da fila (degrau 2) + o segundo defeito na mesma seção
// (degrau 1, "Zero é uma afirmação"): o histórico de cotações mostrava um
// único estado vazio — "Nenhuma cotação registrada recentemente" — para três
// situações bem diferentes:
//
//   1. a consulta FALHOU (catch silencioso, `logs` fica como estava);
//   2. o provedor salvo é `flat_fee`, que nunca grava log — vazio para
//      sempre, por desenho, não por falta de uso;
//   3. o provedor salvo é `melhor_envio`/`frenet` e realmente não há
//      cotação ainda — aí "Nenhuma cotação registrada recentemente" É
//      verdade.
//
// MUDOU DE TELA (frente glm-visual-admin-0209, pedido do Gabriel 02/09): o
// histórico saiu da tela de Frete e agora é a seção "Histórico de cotações
// de frete" da tela de Ajustes (`HistoricoCotacoesSection`), ao lado da
// seção de Transportadoras. Os três estados continuam distinguíveis, e a
// regra mais fácil de reintroduzir continua presa: o motivo do vazio lê o
// provedor SALVO (`config.shippingProvider`) — nunca uma escolha não salva
// da seção vizinha, que só vale depois de gravar.
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
// qualquer outra tabela (ex.: `store_shipping_credentials`, que a seção de
// Transportadoras busca no carregamento) devolve vazio sem erro.
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

describe("HistoricoCotacoesSection — o histórico de cotações para de mentir sobre o motivo de estar vazio", () => {
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

  async function abrirSecao() {
    const { HistoricoCotacoesSection } = await import(
      "@/components/admin/settings/HistoricoCotacoesCard"
    );
    await act(async () => {
      raiz.render(<HistoricoCotacoesSection />);
    });
    // A seção busca no mount (em Ajustes ela só monta quando o lojista a
    // expande): dois ciclos de microtarefas para o fetch resolver.
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  // Escopar ao container da seção: o card vizinho de Transportadoras fala de
  // "Melhor Envio" e "Taxa única fixa" por natureza própria — a checagem de
  // ausência no texto INTEIRO daria falso positivo por causa de texto
  // vizinho, sem relação com o histórico.
  const textoDoHistorico = () =>
    hospedeiro.querySelector("#historico-cotacoes-section")?.textContent ?? "";

  it("provedor salvo flat_fee + 0 linhas: explica o motivo, e NÃO diz 'nenhuma cotação registrada'", async () => {
    mockConfig.shippingProvider = "flat_fee";
    logsState.data = [];
    await abrirSecao();

    expect(textoDoHistorico()).toMatch(/Taxa Única Fixa/i);
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
  });

  it("provedor salvo melhor_envio + 0 linhas: diz 'nenhuma cotação registrada', e NÃO mostra a explicação do flat_fee", async () => {
    mockConfig.shippingProvider = "melhor_envio";
    logsState.data = [];
    await abrirSecao();

    expect(textoDoHistorico()).toMatch(/Nenhuma cotação registrada recentemente/i);
    expect(textoDoHistorico()).not.toMatch(/Taxa Única Fixa/i);
  });

  it("a consulta falha: mostra o aviso de falha, e NÃO diz 'nenhuma cotação registrada'", async () => {
    logsState.data = null;
    logsState.error = { message: "conexão perdida" };
    await abrirSecao();

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

  it("escolha não salva na seção vizinha NÃO muda o motivo do vazio (o histórico lê o SALVO)", async () => {
    // A armadilha original, na nova casa: em Ajustes, Transportadoras e
    // Histórico convivem na mesma tela. O lojista escolhe Melhor Envio na
    // seção de Transportadoras e NÃO salva — a edge function segue na
    // transportadora SALVA (flat_fee), e o histórico tem de continuar
    // explicando o flat_fee, não virar a frase do melhor_envio.
    mockConfig.shippingProvider = "flat_fee";
    logsState.data = [];

    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    const { HistoricoCotacoesSection } = await import(
      "@/components/admin/settings/HistoricoCotacoesCard"
    );
    await act(async () => {
      raiz.render(
        <>
          <TransportadorasSection />
          <HistoricoCotacoesSection />
        </>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // CONTROLE POSITIVO — o arranjo é premissa deste teste, e premissa se
    // asserta antes do veredito. Sem isto, um clique que não registrasse
    // deixaria o teste passar VAZIO: o config já é flat_fee, então o ramo
    // certo renderiza de qualquer jeito.
    const opcaoMelhorEnvio = [
      ...hospedeiro.querySelectorAll('[role="radio"]'),
    ].find(
      (b) => b.textContent?.includes("Melhor Envio"),
    ) as HTMLButtonElement | undefined;
    expect(opcaoMelhorEnvio).toBeTruthy();
    expect(opcaoMelhorEnvio?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      opcaoMelhorEnvio?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // A escolha de verdade mudou no formulário da seção vizinha...
    expect(
      [...hospedeiro.querySelectorAll('[role="radio"]')]
        .find((b) => b.textContent?.includes("Melhor Envio"))
        ?.getAttribute("aria-checked"),
    ).toBe("true");

    // ...mas a edge function continua em flat_fee até alguém SALVAR — o
    // motivo do vazio tem de continuar lendo o provedor SALVO.
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
    await abrirSecao();

    expect(hospedeiro.querySelector("table")).toBeTruthy();
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
    expect(textoDoHistorico()).not.toMatch(/Taxa Única Fixa/i);
    expect(textoDoHistorico()).not.toMatch(/Não foi possível/i);
    expect(textoDoHistorico()).toMatch(/Exibindo a 1 consulta mais recente/i);
  });
});
