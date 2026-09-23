import type { View } from "@/types";
// @vitest-environment jsdom
//
// TAREFA T4 (23/09/2026) — CONTRATO da tela nova "Estratégias do frete
// nacional" (`admin-shipping-national`), gramática direção D (mesma de
// AdminShippingView: AdminPageHeader, CabecaDeSecao/Linha de
// primitivas-direcao-d, pills role="radiogroup"/"radio", barra de salvar
// fixa só com alteração pendente). Prende:
//
//   1. as 5 pills da estratégia, e o painel certo por escolha (mínimo para
//      acima_de_valor; tipo+valor+mínimo opcional para o desconto; alcance
//      só para as 3 de GRÁTIS);
//   2. o alcance NUNCA muda sozinho — só pré-seleciona "mais_barata" ao
//      sair de "desligado" pela primeira vez; mexer só no mínimo preserva;
//   3. o aviso de custo com alcance "todas", e o botão que troca;
//   4. a prévia em reais com a MESMA conta da edge;
//   5. o aviso sem transportadora ligada;
//   6. validação antes de salvar (espelha os CHECKs do banco);
//   7. salvar grava SÓ as 5 colunas nacionais.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, estadoOnline, updateConfig, invoke } =
  vi.hoisted(() => ({
    estadoOnline: { offline: false },
    estadoDaLoja: {
      atual: {
        freeShippingMin: 100,
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

describe("AdminShippingNationalView — CONTRATO", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<typeof vi.fn<(view: View) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      freeShippingMin: 100,
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
    return [...hospedeiro.querySelectorAll('[role="radio"]')].find((r) =>
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

  function botaoComTexto(padrao: RegExp): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      padrao.test(b.textContent || ""),
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

  it("REVISÃO (correção 2): o cabeçalho descreve a ESTRATÉGIA escolhida, não finge ser 'estado salvo'", async () => {
    await abrirTela();
    expect(hospedeiro.textContent).toMatch(/estrat[ée]gia:/i);
    expect(hospedeiro.textContent).not.toMatch(/estado salvo:/i);
  });

  it("REVISÃO (correção 2): desconto sem tipo escolhido NUNCA mostra 'R$ 0 na mais barata'", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);

    expect(hospedeiro.textContent).not.toMatch(/r\$\s*0\s*na mais barata/i);
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
    const botaoLimitar = botaoComTexto(/limitar.*mais barata/i);
    expect(botaoLimitar).toBeDefined();

    await clicar(botaoLimitar!);
    expect(
      pill(/s[óo] a op[çc][ãa]o mais barata/i)?.getAttribute("aria-checked"),
    ).toBe("true");
    // Ainda exige salvar — não é aplicado sozinho.
    expect(botaoComTexto(/salvar altera[çc][õo]es/i)).toBeDefined();
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

    const botaoSalvar = botaoComTexto(/salvar altera[çc][õo]es/i);
    expect(botaoSalvar).toBeDefined();
    expect(botaoSalvar!.disabled).toBe(true);
  });

  it("validação: desconto percentual > 100 bloqueia o salvar", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Percentual$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "150");

    expect(botaoComTexto(/salvar altera[çc][õo]es/i)!.disabled).toBe(true);
  });

  it("REVISÃO (correção 3): acima_de_valor com mínimo que ARREDONDA para R$ 0,00 em centavos bloqueia o salvar (0,001 passa no '> 0' cru, mas o CHECK do banco vê centavos)", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);
    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "0.001");

    expect(botaoComTexto(/salvar altera[çc][õo]es/i)!.disabled).toBe(true);
  });

  it("REVISÃO (correção 3): desconto fixo com valor que ARREDONDA para R$ 0,00 em centavos bloqueia o salvar", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Valor fixo$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "0.004");

    expect(botaoComTexto(/salvar altera[çc][õo]es/i)!.disabled).toBe(true);
  });

  it("REVISÃO (correção 1, achado da revisão Opus): depois de salvar, o formData bate com o payload AJUSTADO — a barra some de vez e uma edição nova volta a avisar", async () => {
    // Estado salvo: acima_de_valor 199, alcance "todas".
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 199,
      nationalBenefitScope: "todas",
    };
    // updateConfig de VERDADE — muda a config que useStore devolve no
    // próximo render, como o updateConfig real faz. O mock ingênuo
    // (`mockResolvedValue(true)`, sem tocar a config) não pegava este
    // defeito: ele sempre devolvia sucesso sem jamais fazer `formData` e
    // `config` baterem de novo.
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

    // Escolhe "Sempre grátis" (o mínimo salvo de acima_de_valor, 199, fica
    // "esquecido" no formData — é exatamente o valor que o payload ajustado
    // precisa zerar ao montar o envio).
    await clicar(pill(/Sempre grátis/i)!);

    const botaoSalvar = botaoComTexto(/salvar altera[çc][õo]es/i)!;
    expect(botaoSalvar).toBeDefined();
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // A barra "Alterações não salvas" SOME — se formData ainda guardasse o
    // mínimo/alcance velhos, isFormDirty ficaria preso em `true` para
    // sempre e o botão continuaria na tela.
    expect(botaoComTexto(/salvar altera[çc][õo]es/i)).toBeUndefined();
    // O ÚLTIMO sinal de dirty que a tela emitiu foi `false`.
    expect(onSetDirty.mock.calls.at(-1)?.[0]).toBe(false);

    onSetDirty.mockClear();

    // Mexe de novo — troca o alcance salvo ("todas") para "mais_barata".
    // Se o bug persistisse, formData já estaria "sujo" desde o save
    // anterior e este clique não mudaria isFormDirty (que já seria `true`),
    // então onSetDirty(true) NUNCA seria chamado de novo — a lojista não
    // veria aviso nenhum da edição real que acabou de fazer.
    const alcanceMaisBarata = pill(/s[óo] a op[çc][ãa]o mais barata/i)!;
    expect(alcanceMaisBarata).toBeDefined();
    await clicar(alcanceMaisBarata);

    expect(onSetDirty).toHaveBeenCalledWith(true);
  });

  it("salvar grava SÓ as 5 colunas nacionais — acima_de_valor", async () => {
    await abrirTela();
    await clicar(pill(/Grátis acima de um valor/i)!);
    const minimo = hospedeiro.querySelector(
      "#frete-nacional-minimo",
    ) as HTMLInputElement;
    await digitar(minimo, "250");

    const botaoSalvar = botaoComTexto(/salvar altera[çc][õo]es/i)!;
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    expect(payload).toEqual({
      nationalShippingStrategy: "acima_de_valor",
      nationalShippingMin: 250,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
    });
    expect(payload).not.toHaveProperty("freeShippingMin");
  });

  it("salvar desconto: grava tipo/valor e zera o mínimo quando o campo ficou vazio (sem mínimo)", async () => {
    await abrirTela();
    await clicar(pill(/Desconto na opção mais barata/i)!);
    await clicar(pill(/^Valor fixo$/i)!);
    const valor = hospedeiro.querySelector(
      "#frete-nacional-valor-desconto",
    ) as HTMLInputElement;
    await digitar(valor, "5");

    const botaoSalvar = botaoComTexto(/salvar altera[çc][õo]es/i)!;
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig.mock.calls[0][0]).toEqual({
      nationalShippingStrategy: "desconto_na_mais_barata",
      nationalShippingMin: 0,
      nationalDiscountType: "fixo",
      nationalDiscountValue: 5,
      nationalBenefitScope: "mais_barata",
    });
  });

  it("offline: salvar não chama updateConfig", async () => {
    // Fica dirty ONLINE (os controles ficam desabilitados quando offline,
    // igual à tela de Frete local — não daria para nem escolher a pill
    // depois de ficar offline). Só então a rede cai.
    await abrirTela();
    await clicar(pill(/Sempre grátis/i)!);
    expect(botaoComTexto(/salvar altera[çc][õo]es/i)?.disabled).toBe(false);

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

    const botaoSalvar = botaoComTexto(/salvar altera[çc][õo]es/i);
    expect(botaoSalvar?.disabled).toBe(true);

    if (botaoSalvar) {
      await act(async () => {
        botaoSalvar.click();
      });
    }
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
