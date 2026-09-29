// @vitest-environment jsdom
//
// Achado HistoricoCotacoesCard-100: a edge function de `calculate-shipping`
// AGUARDA (`await`) a gravação da linha em `shipping_calculation_logs` só
// para garantir que o motivo do erro chegue ao banco — o comentário do
// arquivo chama isso de "a ÚNICA janela que a lojista tem" para descobrir
// que precisa conectar/configurar a transportadora. A tabela deste card,
// porém, só desenhava um selo "Erro" sem motivo nenhum: `error_message`
// entrava no `select("*")` e morria sem renderizar — indistinguível de
// "o Melhor Envio está fora do ar". Este arquivo prende:
//
//   1. o motivo aparece na tela para uma linha de erro;
//   2. sucesso nunca mostra "Motivo" (não há o que explicar, e o texto do
//      provedor não pode vazar como se fosse diagnóstico);
//   3. dez linhas seguidas com o MESMO motivo viram UMA linha com contador
//      (×N) — sem isso, a mesma credencial ausente citada dez vezes rolando
//      a tela não ensina nada de novo na segunda repetição.
//
// Modelo: admin-shipping-historico-honesto.test.tsx (mesmos mocks).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig, logsState } = vi.hoisted(() => ({
  mockConfig: {
    shippingProvider: "melhor_envio" as "flat_fee" | "melhor_envio" | "frenet",
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

const MOTIVO_CREDENCIAL =
  'Sem credencial cadastrada para o provedor "melhor_envio". Conecte a transportadora para cotar entregas fora da cidade.';

describe("HistoricoCotacoesSection — o selo vermelho passa a dizer o motivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.shippingProvider = "melhor_envio";
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
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const textoDoHistorico = () =>
    hospedeiro.querySelector("#historico-cotacoes-section")?.textContent ?? "";

  it("linha de erro mostra o error_message que a edge gravou", async () => {
    logsState.data = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        destination_cep: "38400000",
        provider: "melhor_envio",
        response_time_ms: 0,
        status: "error",
        error_message: MOTIVO_CREDENCIAL,
      },
    ];
    await abrirSecao();

    // Sem isto, o teste falharia pelo motivo CERTO: a implementação anterior
    // nunca lia `log.error_message` em lugar nenhum do JSX — o selo "Erro"
    // aparecia sozinho, sem o texto que a edge escreveu com `await` para
    // exatamente esta tela ler.
    expect(textoDoHistorico()).toContain(MOTIVO_CREDENCIAL);
    expect(textoDoHistorico()).toMatch(/Erro/);
  });

  it("linha de sucesso não mostra 'Motivo' nenhum (não há o que diagnosticar)", async () => {
    logsState.data = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        destination_cep: "38400000",
        provider: "melhor_envio",
        response_time_ms: 320,
        status: "success",
        error_message: null,
      },
    ];
    await abrirSecao();

    expect(textoDoHistorico()).not.toMatch(/Motivo:/);
  });

  it("dez erros seguidos com o MESMO motivo viram uma linha só, com contador", async () => {
    logsState.data = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      created_at: new Date(Date.now() - i * 1000).toISOString(),
      destination_cep: "38400000",
      provider: "melhor_envio",
      response_time_ms: 0,
      status: "error",
      error_message: MOTIVO_CREDENCIAL,
    }));
    await abrirSecao();

    // Uma linha de dado só (mais o cabeçalho) — não dez repetições do mesmo
    // texto poluindo a tela.
    const linhasDeDado = hospedeiro.querySelectorAll("tbody tr");
    // Cada grupo desenha 2 <tr> (a linha de dado + a linha do motivo), e há
    // um único grupo para as dez ocorrências.
    expect(linhasDeDado.length).toBe(2);
    expect(textoDoHistorico()).toMatch(/Erro\s*×10/);
    // O texto do motivo aparece uma única vez, não dez.
    const ocorrencias = (
      textoDoHistorico().match(new RegExp(MOTIVO_CREDENCIAL, "g")) ?? []
    ).length;
    expect(ocorrencias).toBe(1);
  });

  it("RODADA DE CORREÇÃO (achado BLOQUEIA): mesmo motivo mas destino/transportadora DIFERENTES não colapsam — a linha sobrevivente não pode afirmar um destino e uma transportadora que não valem para as outras", async () => {
    // Caso real do achado: loja `flat_fee` remanescente grava a MESMA
    // `error_message` para todo cliente de fora, mas cada um é de um CEP e
    // (aqui) até de uma transportadora salva diferente. Agrupar por
    // status+error_message sozinho faria a tabela imprimir o CEP e a
    // transportadora do PRIMEIRO log como se valesse para os outros dois.
    logsState.data = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        destination_cep: "01310100",
        provider: "melhor_envio",
        response_time_ms: 0,
        status: "error",
        error_message: MOTIVO_CREDENCIAL,
      },
      {
        id: "2",
        created_at: new Date(Date.now() - 1000).toISOString(),
        destination_cep: "20040002",
        provider: "melhor_envio",
        response_time_ms: 0,
        status: "error",
        error_message: MOTIVO_CREDENCIAL,
      },
      {
        id: "3",
        created_at: new Date(Date.now() - 2000).toISOString(),
        destination_cep: "90010150",
        provider: "frenet",
        response_time_ms: 0,
        status: "error",
        error_message: MOTIVO_CREDENCIAL,
      },
    ];
    await abrirSecao();

    // Três grupos (cada um sua linha de dado + linha de motivo) — nada
    // colapsa, porque nenhum dos três é de fato a MESMA consulta repetida.
    const linhasDeDado = hospedeiro.querySelectorAll("tbody tr");
    expect(linhasDeDado.length).toBe(6);
    expect(textoDoHistorico()).toContain("01310-100");
    expect(textoDoHistorico()).toContain("20040-002");
    expect(textoDoHistorico()).toContain("90010-150");
    // Sem o contador ×N: nenhum dos três é repetição do outro.
    expect(textoDoHistorico()).not.toMatch(/×\d/);
  });

  it("RODADA DE CORREÇÃO (achado ANTES DE CRESCER): motivo muito longo é cortado na tela, mas o texto completo vai para o title", async () => {
    // A edge concatena o corpo bruto da resposta do provedor
    // (`await response.text()`) na mensagem de erro de falha de API — sem
    // limite. Um corpo de gateway de alguns KB não pode virar um parágrafo
    // de texto empurrando o resto da tabela para fora da tela no celular.
    const motivoGigante = `Melhor Envio API retornou 502: ${"x".repeat(2500)}`;
    logsState.data = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        destination_cep: "38400000",
        provider: "melhor_envio",
        response_time_ms: 0,
        status: "error",
        error_message: motivoGigante,
      },
    ];
    await abrirSecao();

    // Sem isto, o teste falharia pelo motivo CERTO: a implementação
    // anterior imprimia `log.error_message` cru, sem corte e sem `title`
    // com o texto completo.
    const celulaComTitulo = [...hospedeiro.querySelectorAll("[title]")].find(
      (el) => el.getAttribute("title") === motivoGigante,
    );
    expect(celulaComTitulo).toBeTruthy();
    expect(celulaComTitulo!.textContent!.length).toBeLessThan(300);
    expect(celulaComTitulo!.textContent).not.toContain(motivoGigante);
  });

  it("RODADA DE CORREÇÃO (achado ANOTADO): rodapé conta grupos quando o agrupamento reduz as linhas visíveis, sem afirmar um número de linhas que a tela não mostra", async () => {
    logsState.data = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      created_at: new Date(Date.now() - i * 1000).toISOString(),
      destination_cep: "38400000",
      provider: "melhor_envio",
      response_time_ms: 0,
      status: "error",
      error_message: MOTIVO_CREDENCIAL,
    }));
    await abrirSecao();

    // O rodapé antigo dizia "Exibindo as 10 consultas mais recentes" com
    // uma ÚNICA linha de dado na tela — o número parava de bater com o que
    // o lojista via (achado ANOTADO). Sem a correção este teste falharia
    // pelo motivo certo: a contagem de OCORRÊNCIAS (grupos) não aparece em
    // lugar nenhum, só a contagem crua de logs.
    const rodape = hospedeiro.querySelector(
      "#historico-cotacoes-section > div:last-child",
    )?.textContent;
    expect(rodape).toMatch(/10 consultas/i);
    expect(rodape).toMatch(/1 ocorrência/i);
  });

  it("erros seguidos com motivos DIFERENTES não colapsam", async () => {
    logsState.data = [
      {
        id: "1",
        created_at: new Date().toISOString(),
        destination_cep: "38400000",
        provider: "melhor_envio",
        response_time_ms: 0,
        status: "error",
        error_message: "Sem credencial cadastrada para o provedor.",
      },
      {
        id: "2",
        created_at: new Date(Date.now() - 1000).toISOString(),
        destination_cep: "38400000",
        provider: "melhor_envio",
        response_time_ms: 5000,
        status: "error",
        error_message: "Nenhum método de envio retornado.",
      },
    ];
    await abrirSecao();

    const linhasDeDado = hospedeiro.querySelectorAll("tbody tr");
    // Dois grupos, cada um com sua linha de dado + linha de motivo: 4 <tr>.
    expect(linhasDeDado.length).toBe(4);
    expect(textoDoHistorico()).toContain(
      "Sem credencial cadastrada para o provedor.",
    );
    expect(textoDoHistorico()).toContain("Nenhum método de envio retornado.");
    expect(textoDoHistorico()).not.toMatch(/×\d/);
  });
});
