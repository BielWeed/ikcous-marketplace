// @vitest-environment jsdom
//
// TAREFA T4-UNIFICAÇÃO (23/09/2026, pedido do dono): a tela "Estratégias do
// frete nacional" voltou a morar dentro da tela de Frete, em painéis
// recolhíveis, com um botão Salvar único no cabeçalho. Este arquivo prende
// o CONTRATO da unificação em si — o que cada peça (`FreteLocalBloco`,
// `FreteNacionalBloco`, os presets) faz continua coberto pelos arquivos
// antigos (admin-frete-v2-contrato.test.tsx, admin-shipping-national-view.
// test.tsx etc.):
//
//   1. os painéis nascem TODOS fechados, com resumo do estado salvo;
//   2. abrir um painel revela os controles completos (nada foi removido);
//   3. a faixa fixa de salvar morreu — nenhum elemento `fixed` na tela, e
//      a frase "Alterações não salvas" não existe mais em lugar nenhum;
//   4. o botão Salvar do cabeçalho passa pelos 4 estados: Salvo → Salvar →
//      Salvando… → Tentar de novo (e volta a Salvo depois de um retry OK);
//   5. salvar grava os campos LOCAIS e NACIONAIS na MESMA chamada de
//      updateConfig, mesmo quando só um dos dois lados foi editado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, updateConfig, invoke } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      freeShippingMin: 100,
      shippingCoverage: "national" as "local" | "national",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"] as string[],
      localDeliveryFee: 10,
      localCepRange: "",
      storeCity: "Uberlândia" as string | null,
      storeState: "MG" as string | null,
      nationalShippingStrategy: "desligado" as
        | "desligado"
        | "acima_de_valor"
        | "sempre"
        | "por_produto"
        | "desconto_na_mais_barata",
      nationalShippingMin: 0,
      nationalDiscountType: null as "percentual" | "fixo" | null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata" as "mais_barata" | "todas",
    },
  },
  updateConfig: vi.fn(),
  invoke: vi.fn(),
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
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
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

describe("Tela de Frete unificada — painéis, botão Salvar do cabeçalho e save único", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      freeShippingMin: 100,
      shippingCoverage: "national",
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryFee: 10,
      localCepRange: "",
      storeCity: "Uberlândia",
      storeState: "MG",
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    };
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            success: true,
            modo: "multi",
            ligados: ["melhor_envio"],
            provedores: {
              melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
              superfrete: { tem_chave: false, sandbox: false, servicos: null },
              frenet: { tem_chave: false, sandbox: false, servicos: null },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
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
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function botaoComTexto(padrao: RegExp): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      padrao.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;
  }

  function botaoSalvar(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() || "",
      ),
    ) as HTMLButtonElement | undefined;
  }

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("classes anti-estouro: a linha do cabeçalho quebra em vez de forçar a tela a alargar em 375px", async () => {
    // Mesmo achado corrigido em AdminPushView
    // (admin-push-cabecalho-nao-estoura-no-mobile.test.tsx, 23/09/2026): o
    // h1 (shrink-0) e o botão Salvar (shrink-0, vindo de `acoes`) são os
    // dois únicos filhos da linha do cabeçalho — sem `flex-wrap` eles nunca
    // quebram e empurram a página inteira.
    await abrirTela();
    const h1 = hospedeiro.querySelector("h1");
    expect(h1).toBeTruthy();
    const linhaDoCabecalho = h1!.parentElement;
    expect(linhaDoCabecalho?.className).toContain("flex-wrap");
  });

  it("classes anti-estouro: CabecaDeSecao quebra título/estado em vez de forçar a linha a alargar", async () => {
    const { CabecaDeSecao } = await import(
      "@/components/admin/shipping/primitivas-direcao-d"
    );
    await act(async () => {
      raiz.render(
        <CabecaDeSecao
          titulo="Fora da cidade"
          estado={<span>Melhor Envio ligado</span>}
        />,
      );
    });
    const linha = hospedeiro.firstElementChild as HTMLElement;
    expect(linha.className).toContain("flex-wrap");
    const h2 = hospedeiro.querySelector("h2");
    expect(h2?.className).toContain("min-w-0");
  });

  it("os painéis nascem TODOS fechados, com resumo do estado salvo", async () => {
    await abrirTela();

    const painelLocal = botaoComTexto(/^entrega na sua cidade/i);
    const painelNacional = botaoComTexto(/^fora da cidade/i);
    const painelEstrategias = botaoComTexto(/^estrat[ée]gias do frete local/i);

    for (const painel of [painelLocal, painelNacional, painelEstrategias]) {
      expect(painel).toBeDefined();
      expect(painel!.getAttribute("aria-expanded")).toBe("false");
    }
    // Resumo do estado salvo aparece no texto do próprio botão fechado.
    expect(painelLocal!.textContent).toContain("R$ 10 por entrega");
    expect(painelNacional!.textContent).toContain("Melhor Envio ligado");
    expect(painelEstrategias!.textContent).toContain("Acima de R$ 100");
  });

  it("abrir um painel troca aria-expanded para true e o botão vira aria-controls de uma região visível", async () => {
    await abrirTela();

    const painelLocal = botaoComTexto(/^entrega na sua cidade/i)!;
    const idConteudo = painelLocal.getAttribute("aria-controls")!;
    expect(idConteudo).toBeTruthy();
    const conteudo = document.getElementById(idConteudo);
    expect(conteudo?.hasAttribute("hidden")).toBe(true);

    await clicar(painelLocal);

    expect(painelLocal.getAttribute("aria-expanded")).toBe("true");
    expect(conteudo?.hasAttribute("hidden")).toBe(false);
    // Os controles completos de sempre continuam lá dentro.
    expect(
      hospedeiro.querySelector(
        '[role="switch"][aria-label="Só entregar na cidade"]',
      ),
    ).toBeTruthy();
  });

  it("a faixa fixa de salvar morreu: nenhum elemento fixed na tela, e a frase antiga não existe mais", async () => {
    await abrirTela();

    expect(hospedeiro.textContent).not.toMatch(
      /altera[çc][õo]es n[ãa]o salvas/i,
    );
    const algumFixo = [...hospedeiro.querySelectorAll<HTMLElement>("div")].some(
      (el) => el.className.includes("fixed inset-x-0"),
    );
    expect(algumFixo).toBe(false);
  });

  it("o botão Salvar do cabeçalho passa pelos 4 estados: Salvo → Salvar → Salvando… → Tentar de novo → (retry) Salvo", async () => {
    let resolverSave: ((ok: boolean) => void) | undefined;
    updateConfig.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolverSave = resolve;
        }),
    );

    await abrirTela();
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
    expect(botaoSalvar()?.disabled).toBe(true);

    // Suja o formulário local.
    const painelLocal = botaoComTexto(/^entrega na sua cidade/i)!;
    await clicar(painelLocal);
    const chaveCobertura = hospedeiro.querySelector(
      '[role="switch"][aria-label="Só entregar na cidade"]',
    ) as HTMLElement;
    await clicar(chaveCobertura);

    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvar");
    expect(botaoSalvar()?.disabled).toBe(false);

    // Clica em Salvar — a promise fica pendurada, então o estado vira
    // "Salvando…" e o botão desabilita.
    await act(async () => {
      botaoSalvar()!.click();
    });
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvando…");
    expect(botaoSalvar()?.disabled).toBe(true);

    // A gravação FALHA (rede caiu no meio) — o botão vira "Tentar de novo".
    await act(async () => {
      resolverSave?.(false);
      await esperarMicrotarefas();
    });
    expect(botaoSalvar()?.textContent?.trim()).toBe("Tentar de novo");
    expect(botaoSalvar()?.disabled).toBe(false);

    // Tenta de novo — desta vez a gravação funciona e o config REFLETE o
    // que foi salvo (mesmo mock realista das demais suítes: sem isso,
    // `config` fica estático e `isFormDirty` nunca some — o botão nunca
    // voltaria a "Salvo", mesmo com o save tendo funcionado de verdade).
    updateConfig.mockImplementation(
      async (payload: Record<string, unknown>) => {
        estadoDaLoja.atual = { ...estadoDaLoja.atual, ...payload };
        return true;
      },
    );
    await act(async () => {
      botaoSalvar()!.click();
      await esperarMicrotarefas();
    });

    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("salvar grava os campos LOCAIS e NACIONAIS na MESMA ação, mesmo mexendo só de um lado", async () => {
    await abrirTela();

    // Mexe SÓ no lado nacional.
    const painelNacional = botaoComTexto(/^fora da cidade/i)!;
    await clicar(painelNacional);
    const pillSempreNacional = [
      ...(hospedeiro
        .querySelector("#bloco-estrategia-nacional")
        ?.querySelectorAll('[role="radio"]') ?? []),
    ].find((r) => /Sempre grátis/.test(r.textContent || "")) as HTMLElement;
    await clicar(pillSempreNacional);

    await act(async () => {
      botaoSalvar()!.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    // Os campos LOCAIS saem na MESMA chamada (com o valor atual salvo, sem
    // ter sido tocados) — é isso que faz o save ser UMA ação só.
    expect(payload).toHaveProperty("originCep", "38400-000");
    expect(payload).toHaveProperty("localDeliveryFee", 10);
    expect(payload).toHaveProperty("shippingCoverage", "national");
    // E o campo nacional que foi de fato editado:
    expect(payload).toHaveProperty("nationalShippingStrategy", "sempre");
  });
});
