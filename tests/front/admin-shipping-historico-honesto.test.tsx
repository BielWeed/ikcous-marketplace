// @vitest-environment jsdom
//
// Achado 13 / item I da fila (degrau 2) + o segundo defeito na mesma seção
// (degrau 1, "Zero é uma afirmação"): o histórico de cotações mostrava um
// único estado vazio — "Nenhuma cotação registrada recentemente" — para três
// situações bem diferentes:
//
//   1. a consulta FALHOU (catch silencioso, `logs` fica como estava);
//   2. NENHUM provedor está ligado — nunca grava log — vazio para sempre,
//      por desenho, não por falta de uso;
//   3. algum provedor está ligado e realmente não há cotação ainda — aí
//      "Nenhuma cotação registrada recentemente" É verdade.
//
// RELEASE 1.5.7 v2 (EMENDA R2, R2-5): o motivo do vazio deixou de ler o
// espelho `config.shippingProvider` — no modo multi ele não decide mais
// nada (R1-3/R2-1). A fonte agora é a MESMA edge que a seção de
// Transportadoras usa (`ler_configuracao_frete`), pela contagem de
// `ligados`. Este arquivo foi reescrito para o modelo novo: a versão
// anterior comparava com `config.shippingProvider === 'flat_fee'` e testava
// a seção de Transportadoras pelo radiogroup único, que não existe mais.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, logsState } = vi.hoisted(() => ({
  invoke: vi.fn(),
  logsState: {
    data: [] as any[] | null,
    error: null as { message: string } | null,
  },
}));

// `shipping_calculation_logs` responde o que o teste armou em `logsState`;
// qualquer outra tabela devolve vazio sem erro.
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
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function respostaConfig(ligados: string[]) {
  return {
    success: true,
    modo: ligados.length > 0 ? "multi" : "legado",
    ligados,
    provedores: {
      melhor_envio: {
        tem_chave: ligados.includes("melhor_envio"),
        sandbox: false,
        servicos: null,
      },
      superfrete: {
        tem_chave: ligados.includes("superfrete"),
        sandbox: false,
        servicos: null,
      },
      frenet: {
        tem_chave: ligados.includes("frenet"),
        sandbox: false,
        servicos: null,
      },
    },
  };
}

describe("HistoricoCotacoesSection — o histórico de cotações para de mentir sobre o motivo de estar vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    logsState.data = [];
    logsState.error = null;
    invoke.mockResolvedValue({ data: respostaConfig([]), error: null });
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
    // expande): dois ciclos de microtarefas para os dois fetches (logs +
    // ler_configuracao_frete) resolverem.
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const textoDoHistorico = () =>
    hospedeiro.querySelector("#historico-cotacoes-section")?.textContent ?? "";

  it("nenhum provedor ligado + 0 linhas: explica o motivo, e NÃO diz 'nenhuma cotação registrada'", async () => {
    invoke.mockResolvedValue({ data: respostaConfig([]), error: null });
    logsState.data = [];
    await abrirSecao();

    expect(textoDoHistorico()).toMatch(/Sem transportadora conectada/i);
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
  });

  it("nenhum provedor ligado: o texto conta a verdade do frete v2 (erro a cada tentativa de fora, não 'silêncio por desenho')", async () => {
    invoke.mockResolvedValue({ data: respostaConfig([]), error: null });
    logsState.data = [];
    await abrirSecao();

    expect(textoDoHistorico()).not.toMatch(
      /já responde o frete direto, sem consultar transportadora/i,
    );
    expect(textoDoHistorico()).not.toMatch(
      /não existe cotação para registrar aqui/i,
    );
    // A verdade medida no index.ts: sem transportadora conectada, é erro a
    // cada tentativa de fora da cidade — e o caminho para sair disso.
    expect(textoDoHistorico()).toMatch(/erro/i);
    expect(textoDoHistorico()).toMatch(/fora da cidade/i);
    expect(textoDoHistorico()).toMatch(/Melhor Envio, Frenet ou SuperFrete/i);
  });

  it("provedor ligado (Melhor Envio) + 0 linhas: diz 'nenhuma cotação registrada', sem a explicação de vazio-por-desenho", async () => {
    invoke.mockResolvedValue({
      data: respostaConfig(["melhor_envio"]),
      error: null,
    });
    logsState.data = [];
    await abrirSecao();

    expect(textoDoHistorico()).toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
    expect(textoDoHistorico()).not.toMatch(/Sem transportadora conectada/i);
  });

  it("a consulta de logs falha: mostra o aviso de falha, e NÃO diz 'nenhuma cotação registrada'", async () => {
    logsState.data = null;
    logsState.error = { message: "conexão perdida" };
    await abrirSecao();

    expect(textoDoHistorico()).toMatch(/não foi possível carregar/i);
    expect(textoDoHistorico()).not.toMatch(
      /Nenhuma cotação registrada recentemente/i,
    );
  });

  it("a leitura de ler_configuracao_frete falhou: o vazio cai no genérico (nunca afirma 'sem provedor' sem confirmar)", async () => {
    invoke.mockResolvedValue({ data: { success: false }, error: null });
    logsState.data = [];
    await abrirSecao();

    // `algumLigado` fica `null` (desconhecido) — a seção não finge saber, e
    // não afirma "sem transportadora conectada" sem confirmar.
    expect(textoDoHistorico()).not.toMatch(/Sem transportadora conectada/i);
    expect(textoDoHistorico()).toMatch(/Nenhuma cotação registrada/i);
  });

  it("com linhas: a tabela aparece, e nenhum dos textos de vazio/erro aparece", async () => {
    invoke.mockResolvedValue({ data: respostaConfig([]), error: null });
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
    expect(textoDoHistorico()).not.toMatch(/Sem transportadora conectada/i);
    expect(textoDoHistorico()).not.toMatch(/Não foi possível/i);
    expect(textoDoHistorico()).toMatch(/Exibindo a 1 consulta mais recente/i);
  });

  it("lote E: a seção veste o idioma visual do novo Ajustes (o card é da casca, não do conteúdo)", async () => {
    invoke.mockResolvedValue({
      data: respostaConfig(["melhor_envio"]),
      error: null,
    });
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

    // O card `rounded-3xl border-white/5` é da CASCA (SecaoColapsavel, peça
    // A do lote E). Conteúdo que ainda carrega o próprio vidro
    // (`admin-glass`) vira card dentro de card no salão novo.
    const secao = hospedeiro.querySelector("#historico-cotacoes-section");
    expect(secao).toBeTruthy();
    expect(secao?.querySelector(".admin-glass")).toBeNull();

    // Cabeçalho das colunas no padrão de rótulo do salão: text-[10px]
    // font-black uppercase tracking-[0.2em].
    const cabecalho = secao?.querySelector("thead tr");
    expect(cabecalho).toBeTruthy();
    expect(cabecalho?.classList.contains("text-[10px]")).toBe(true);
    expect(cabecalho?.classList.contains("font-black")).toBe(true);
    expect(cabecalho?.classList.contains("uppercase")).toBe(true);
    expect(cabecalho?.classList.contains("tracking-[0.2em]")).toBe(true);
  });
});
