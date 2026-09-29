import type { View } from "@/types";
// @vitest-environment jsdom
//
// CONTRATO da rota "Estratégias do frete nacional" (`admin-shipping-national`).
//
// T4-UNIFICAÇÃO (23/09/2026, pedido do dono): a tela PRÓPRIA morreu poucas
// horas depois de nascer — o cabeçalho transbordava e a tela ficou poluída
// com uma seção a mais. `AdminShippingNationalView` virou uma CASCA fina
// que renderiza `AdminShippingView` com o painel "Fora da cidade" aberto
// (`painelInicial="nacional"`) — este arquivo testa exatamente essa casca,
// através da ROTA (o componente que `AdminArea.tsx` importa), então tudo
// que muda aqui é o que muda pela unificação:
//
//   1. as 5 pills da estratégia continuam existindo, e o painel certo por
//      escolha (mínimo para acima_de_valor; tipo+valor+mínimo opcional
//      para o desconto; alcance só para as 3 de GRÁTIS);
//   2. o alcance NUNCA muda sozinho — só pré-seleciona "mais_barata" ao
//      sair de "desligado" pela primeira vez; mexer só no mínimo preserva;
//   3. o aviso de custo com alcance "todas", e o botão que troca;
//   4. a prévia em reais com a MESMA conta da edge;
//   5. o aviso sem transportadora ligada;
//   6. validação antes de salvar (espelha os CHECKs do banco) — o botão do
//      CABEÇALHO fica desabilitado, não mais o da barra fixa;
//   7. SALVAR AGORA É UMA AÇÃO SÓ (mudança do dia): o clique grava os 5
//      campos nacionais E os campos locais da mesma config, porque as duas
//      telas viraram UM formulário. O que se prova aqui é que os 5 campos
//      nacionais saem CORRETOS dentro desse payload maior — não mais que o
//      payload seja SÓ eles.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, estadoOnline, updateConfig, invoke } =
  vi.hoisted(() => ({
    estadoOnline: { offline: false },
    estadoDaLoja: {
      atual: {
        freeShippingMin: 100,
        originCep: "38400-000",
        shippingCoverage: "national" as "local" | "national",
        localDeliveryFee: 10,
        localCepRange: "",
        enabledShippingMethods: ["sedex", "pac"] as string[],
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
    estadoDoBanco: {
      ligados: ["melhor_envio"] as string[],
    },
    updateConfig: vi.fn(),
    invoke: vi.fn(),
  }));

function respostaConfig() {
  return {
    success: true,
    modo: estadoDoBanco.ligados.length > 0 ? "multi" : "legado",
    ligados: estadoDoBanco.ligados,
    provedores: {
      melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
    },
  };
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estadoOnline.offline,
}));

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

describe("AdminShippingNationalView — CONTRATO (casca da tela unificada)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<typeof vi.fn<(view: View) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      freeShippingMin: 100,
      originCep: "38400-000",
      shippingCoverage: "national",
      localDeliveryFee: 10,
      localCepRange: "",
      enabledShippingMethods: ["sedex", "pac"],
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    };
    estadoDoBanco.ligados = ["melhor_envio"];
    estadoOnline.offline = false;
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaConfig(), error: null });
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
    onNavigate = vi.fn<(view: View) => void>();
    const { AdminShippingNationalView } = await import(
      "@/views/admin/AdminShippingNationalView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingNationalView
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

  function pill(padrao: RegExp): HTMLElement | undefined {
    // Escopado ao bloco da ESTRATÉGIA NACIONAL: a tela unificada também
    // tem pills do preset LOCAL com o mesmo texto ("Grátis acima de um
    // valor", "Sempre grátis"…) no painel "Estratégias do frete local".
    const escopo = hospedeiro.querySelector("#bloco-estrategia-nacional");
    return [...(escopo?.querySelectorAll('[role="radio"]') ?? [])].find((r) =>
      padrao.test(r.textContent || ""),
    ) as HTMLElement | undefined;
  }

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  /** O botão Salvar do cabeçalho (T4 unificação): o rótulo troca por
   * estado, o botão nunca some da tela. */
  function botaoSalvar(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() || "",
      ),
    ) as HTMLButtonElement | undefined;
  }

  async function digitar(campo: HTMLInputElement, texto: string) {
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

  it("a rota abre a tela de Frete com o painel 'Fora da cidade' JÁ aberto", async () => {
    await abrirTela();
    const botaoPainel = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^fora da cidade/i.test(b.textContent?.trim() || ""),
    );
    expect(botaoPainel).toBeDefined();
    expect(botaoPainel?.getAttribute("aria-expanded")).toBe("true");
  });

  it("as 5 estratégias existem como pills, com 'Desligado' marcada por padrão", async () => {
    await abrirTela();
    for (const nome of [
      /Desligado/i,
      /Grátis acima de um valor/i,
      /Sempre grátis/i,
      /Por produto marcado/i,
      /Desconto na opção mais barata/i,
    ]) {
      expect(pill(nome)).toBeDefined();
    }
    expect(pill(/Desligado/i)?.getAttribute("aria-checked")).toBe("true");
  });

  it("acima_de_valor: mostra o campo de mínimo, e SEM alcance nasce 'mais_barata' pré-selecionado ao sair de desligado", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);

    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    expect(minimo).toBeDefined();

    const alcanceMaisBarata = pill(/s[óo] a op[çc][ãa]o mais barata/i);
    expect(alcanceMaisBarata?.getAttribute("aria-checked")).toBe("true");
  });

  it("desconto: mostra tipo + valor + mínimo opcional, e NÃO mostra alcance", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);

    expect(pill(/^Percentual$/i)).toBeDefined();
    expect(pill(/^Valor fixo$/i)).toBeDefined();
    expect(
      hospedeiro.querySelector("#frete-nacional-valor-desconto"),
    ).toBeDefined();
    expect(hospedeiro.querySelector("#frete-nacional-minimo")).toBeDefined();
    expect(pill(/s[óo] a op[çc][ãa]o mais barata/i)).toBeUndefined();
    expect(pill(/todas as op[çc][õo]es/i)).toBeUndefined();
  });

  it("o cabeçalho da estratégia descreve a ESTRATÉGIA escolhida, não finge ser 'estado salvo'", async () => {
    await abrirTela();
    const escopo = hospedeiro.querySelector("#bloco-estrategia-nacional");
    expect(escopo?.textContent).toMatch(/estrat[ée]gia:/i);
    expect(escopo?.textContent).not.toMatch(/estado salvo:/i);
  });

  it("desconto sem tipo escolhido NUNCA mostra 'R$ 0 na mais barata'", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);

    const escopo = hospedeiro.querySelector("#bloco-estrategia-nacional");
    expect(escopo?.textContent).not.toMatch(/r\$\s*0\s*na mais barata/i);
  });

  it("alcance salvo 'todas' é preservado ao mexer só no mínimo (não reseta sozinho)", async () => {
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalBenefitScope: "todas",
    };
    await abrirTela();

    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "250");

    expect(pill(/todas as op[çc][õo]es/i)?.getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("trocar entre DUAS estratégias de grátis (sem passar por desligado) preserva o alcance salvo", async () => {
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "sempre",
      nationalBenefitScope: "todas",
    };
    await abrirTela();

    await clicar(pill(/Grátis acima de um valor/i)!);

    expect(pill(/todas as op[çc][õo]es/i)?.getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("aviso de custo aparece com alcance 'todas' numa estratégia de grátis, e o botão troca para 'mais_barata'", async () => {
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalBenefitScope: "todas",
    };
    await abrirTela();

    expect(hospedeiro.textContent).toMatch(
      /entrega expressa.*frete dela fica por sua conta/i,
    );
    const botaoLimitar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /limitar.*mais barata/i.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;
    expect(botaoLimitar).toBeDefined();

    await clicar(botaoLimitar!);
    expect(
      pill(/s[óo] a op[çc][ãa]o mais barata/i)?.getAttribute("aria-checked"),
    ).toBe("true");
    // Ainda exige salvar — não é aplicado sozinho.
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvar");
  });

  it("sem transportadora ligada: avisa que a estratégia só vale com cotação de transportadora", async () => {
    estadoDoBanco.ligados = [];
    await abrirTela();
    expect(hospedeiro.textContent).toMatch(
      /a estrat[ée]gia s[óo] vale quando h[áa] cota[çc][ãa]o de transportadora/i,
    );
  });

  it("prévia em reais: 15% de R$ 24,90 mostra R$ 21,16", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Percentual$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "15");

    expect(hospedeiro.textContent).toContain("21,16");
  });

  it("validação: acima_de_valor sem mínimo bloqueia o salvar", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);
    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "0");

    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("validação: desconto percentual > 100 bloqueia o salvar", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Percentual$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "150");

    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("REVISÃO (correção 3): acima_de_valor com mínimo que ARREDONDA para R$ 0,00 em centavos bloqueia o salvar", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);
    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "0.001");

    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("REVISÃO (correção 3): desconto fixo com valor que ARREDONDA para R$ 0,00 em centavos bloqueia o salvar", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Valor fixo$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "0.004");

    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("painel com erro de validação não recolhe, e o erro aparece perto da estratégia", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);
    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "0");

    const botaoPainel = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^fora da cidade/i.test(b.textContent?.trim() || ""),
    ) as HTMLButtonElement;
    expect(botaoPainel.getAttribute("aria-expanded")).toBe("true");

    await clicar(botaoPainel);
    // A tentativa de fechar não fez efeito — ainda há erro pendente.
    expect(botaoPainel.getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.textContent).toMatch(
      /informe um valor m[íi]nimo maior que r\$ 0/i,
    );
  });

  it("depois de salvar, o formData bate com o payload AJUSTADO — o botão volta a 'Salvo' e uma edição nova volta a avisar", async () => {
    // Estado salvo: acima_de_valor 199, alcance "todas".
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalBenefitScope: "todas",
    };
    updateConfig.mockImplementation(
      async (payload: Record<string, unknown>) => {
        estadoDaLoja.atual = { ...estadoDaLoja.atual, ...payload };
        return true;
      },
    );

    const onSetDirty = vi.fn();
    const nav = vi.fn<(view: View) => void>();
    const { AdminShippingNationalView } = await import(
      "@/views/admin/AdminShippingNationalView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingNationalView
          active={true}
          onSetDirty={onSetDirty}
          onNavigate={nav}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    await clicar(pill(/Sempre grátis/i)!);

    const botao = botaoSalvar()!;
    expect(botao.textContent?.trim()).toBe("Salvar");
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O botão volta a "Salvo" — se formData ainda guardasse o mínimo/alcance
    // velhos, isFormDirty nacional ficaria preso em `true` para sempre.
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
    expect(onSetDirty.mock.calls.at(-1)?.[0]).toBe(false);

    onSetDirty.mockClear();

    const alcanceMaisBarata = pill(/s[óo] a op[çc][ãa]o mais barata/i)!;
    expect(alcanceMaisBarata).toBeDefined();
    await clicar(alcanceMaisBarata);

    expect(onSetDirty).toHaveBeenCalledWith(true);
  });

  it("salvar grava os 5 campos nacionais corretos, dentro do payload único da tela — acima_de_valor", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);
    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "250");

    const botao = botaoSalvar()!;
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    expect(payload).toMatchObject({
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 250,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    });
    // A tela unificada grava os campos LOCAIS junto, na MESMA ação — a
    // regra que morreu foi "só os 5 nacionais", não a de campo alheio
    // (nada de Transportadoras, isso continua provado em
    // admin-frete-v2-contrato.test.tsx / admin-visual-frete.test.tsx).
    expect(payload).toHaveProperty("originCep");
    expect(payload).not.toHaveProperty("shippingProvider");
  });

  it("salvar desconto: grava tipo/valor e zera o mínimo quando o campo ficou vazio (sem mínimo)", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Valor fixo$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "5");

    const botao = botaoSalvar()!;
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig.mock.calls[0][0]).toMatchObject({
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalShippingMin: 0,
      nationalDiscountType: "fixo",
      nationalDiscountValue: 5,
      nationalBenefitScope: "mais_barata",
    });
  });

  it("offline: salvar não chama updateConfig", async () => {
    // Fica dirty ONLINE (os controles ficam desabilitados quando offline —
    // não daria para nem escolher a pill depois de ficar offline). Só
    // então a rede cai.
    await abrirTela();
    await clicar(pill(/Sempre grátis/i)!);
    expect(botaoSalvar()?.disabled).toBe(false);

    estadoOnline.offline = true;
    const { AdminShippingNationalView } = await import(
      "@/views/admin/AdminShippingNationalView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingNationalView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const botao = botaoSalvar();
    expect(botao?.disabled).toBe(true);

    if (botao) {
      await act(async () => {
        botao.click();
      });
    }
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
