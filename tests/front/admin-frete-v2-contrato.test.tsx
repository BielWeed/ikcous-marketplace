import type { View } from "@/types";
// @vitest-environment jsdom
//
// CONTRATO da tela de Frete v2 na DIREÇÃO D (frente frete-v2-0309, 03/09/2026
// — o dono reprovou o visual do PR #414 e, depois, a primeira casca nova;
// a direção D aprovada tem faixa-resumo, seções como linhas finas sem
// caixa, presets em pills e barra de salvar FIXA no rodapé). Este arquivo
// prende o que a tela É, não só como ela parece:
//
//   1. a FAIXA descreve o estado REAL salvo no config (local com cidade,
//      nacional com transportadora ligada, grátis pelo preset);
//   2. a taxa fixa MORREU: nenhum card, campo ou payload dela;
//   3. os presets de frete grátis são EXCLUSIVOS (escolher um é desligar os
//      outros) e gravam via `valorDoPreset` — inclusive as sentinelas do
//      contrato final: 0,01 do "sempre" e -1 do "por produto"
//      (FRETE_GRATIS_POR_PRODUTO; a estratégia mora na marcação do produto,
//      o negativo no config é só o marcador dela);
//   4. CHAVES só onde há estado real: "Só entregar na cidade" grava
//      `shippingCoverage` (role="switch"); a credencial da transportadora é
//      de Ajustes, então "Cotação na hora" é EXIBIÇÃO — nenhum botão finge
//      salvar o que não salva;
//   5. o botão SALVAR (agora no cabeçalho, T4 unificação 23/09/2026) só
//      fica CLICÁVEL com alteração pendente, e salvar aqui NÃO envia campo
//      da seção de Transportadoras.
//
// RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2): a tela deixou de ler
// `store_shipping_credentials` por PostgREST e de comparar
// `config.shippingProvider` — a conexão agora é POR PROVEDOR, lida pela
// mesma edge que Ajustes → Transportadoras usa (`ler_configuracao_frete`).
// Este arquivo foi reescrito para o mock de `functions.invoke`
// (admin-shipping-frete-por-provedor.test.tsx already prova o estado por
// provedor isoladamente; aqui a prova é que o RESTO da tela — faixa,
// presets, chaves, barra de salvar — convive corretamente com esse estado).
// As duas provas de gramática "REVISÃO A5" ("conecte o Melhor Envio" vs.
// "conecte uma transportadora") foram REMOVIDAS: elas dependiam de um único
// `shippingProvider` nomeado ou ausente — no modo multi-provedor a frase de
// zero-ligados é sempre a mesma, genérica, sem nome de provedor nenhum
// (ver FreteNacionalBloco.tsx).
//
// TAREFA T4-UNIFICAÇÃO (23/09/2026): a barra de salvar fixa morreu — o
// botão vive no cabeçalho, com 4 estados ("Salvo"/"Salvar"/"Salvando…"/
// "Tentar de novo"), e nunca some da tela (só troca de rótulo/estilo). As
// seções viraram painéis recolhíveis (`PainelRecolhivel`) — o conteúdo
// continua no DOM sempre (o painel esconde por `hidden`, não desmonta),
// então testes que só LEEM estado não precisam abrir o painel; testes que
// CLICAM numa pill abrem o painel primeiro (`abrirPainel`) para não colidir
// com a pill homônima do OUTRO painel (a estratégia nacional, agora na
// mesma tela, repete rótulos como "Grátis acima de um valor").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, updateConfig, invoke } = vi.hoisted(
  () => ({
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
      },
    },
    // Estado que a edge `ler_configuracao_frete` devolveria — o único que
    // esta tela consulta para saber quem está ligado.
    estadoDoBanco: {
      ligados: ["melhor_envio"] as string[],
      provedores: {
        melhor_envio: { tem_chave: true, sandbox: false },
      } as Record<string, { tem_chave: boolean; sandbox?: boolean }>,
    },
    updateConfig: vi.fn(),
    invoke: vi.fn(),
  }),
);

function respostaConfig() {
  return {
    success: true,
    modo: estadoDoBanco.ligados.length > 0 ? "multi" : "legado",
    ligados: estadoDoBanco.ligados,
    provedores: {
      melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
      ...Object.fromEntries(
        Object.entries(estadoDoBanco.provedores).map(([p, v]) => [
          p,
          { servicos: null, ...v },
        ]),
      ),
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

describe("Contrato da tela de Frete v2 (direção D)", () => {
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
      originCep: "38400-000",
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryFee: 10,
      localCepRange: "",
      storeCity: "Uberlândia",
      storeState: "MG",
    };
    estadoDoBanco.ligados = ["melhor_envio"];
    estadoDoBanco.provedores = { melhor_envio: { tem_chave: true } };
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

  const textoDaFaixa = () =>
    hospedeiro.querySelector('[aria-label="Como a entrega funciona hoje"]')
      ?.textContent ?? "";

  function botaoComTexto(padrao: RegExp): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      padrao.test(b.textContent || ""),
    ) as HTMLButtonElement | undefined;
  }

  /** O botão Salvar do cabeçalho — o rótulo muda por estado, o botão nunca
   * some (T4 unificação, 23/09/2026: a barra fixa morreu). */
  function botaoSalvar(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      /^(Salvo|Salvar|Salvando…|Tentar de novo)$/.test(
        b.textContent?.trim() || "",
      ),
    ) as HTMLButtonElement | undefined;
  }

  /** Abre um painel recolhível pelo título (não faz nada se já estiver
   * aberto) — necessário só quando o teste CLICA numa pill/campo que tem
   * homônimo no outro painel (a estratégia nacional repete rótulos como
   * "Grátis acima de um valor"). */
  async function abrirPainel(padrao: RegExp) {
    const botao = botaoComTexto(padrao);
    expect(botao).toBeDefined();
    if (botao!.getAttribute("aria-expanded") !== "true") {
      await act(async () => {
        botao!.click();
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
  }

  /** Pills do preset LOCAL (`FreteGratisBloco`), escopadas ao próprio
   * painel — a estratégia NACIONAL tem pills com o MESMO texto agora que
   * as duas vivem na mesma tela. */
  async function escolherPresetLocal(nome: RegExp) {
    await abrirPainel(/estrat[ée]gias do frete local/i);
    const escopo = hospedeiro.querySelector("#bloco-frete-local-estrategias");
    const pill = [...(escopo?.querySelectorAll('[role="radio"]') ?? [])].find(
      (r) => nome.test(r.textContent || ""),
    );
    expect(pill).toBeDefined();
    await act(async () => {
      (pill as HTMLElement).click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function salvar() {
    const botao = botaoSalvar();
    expect(botao).toBeDefined();
    expect(botao!.disabled).toBe(false);
    expect(botao!.textContent?.trim()).toBe("Salvar");
    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });
  }

  it("a faixa descreve o estado REAL salvo: local com cidade, nacional ligado, grátis pelo preset", async () => {
    await abrirTela();

    expect(textoDaFaixa()).toContain("R$ 10 por entrega");
    expect(textoDaFaixa()).toContain("Uberlândia/MG");
    expect(textoDaFaixa()).toContain("Melhor Envio ligado");
    expect(textoDaFaixa()).toContain("Acima de R$ 100");
    // Nada foi mexido: o botão do cabeçalho mostra "Salvo", desabilitado.
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
    expect(botaoSalvar()?.disabled).toBe(true);
  });

  it("a taxa fixa morreu: nenhum card, campo ou interruptor dela na tela", async () => {
    await abrirTela();

    expect(texto()).not.toMatch(/taxa de entrega fixa|taxa fixa/i);
    expect(hospedeiro.querySelector("#shipping-fee-switch")).toBeNull();
    expect(hospedeiro.querySelector("#shipping-flat-fee")).toBeNull();
  });

  it("só há chave onde há campo gravável: 'Só entregar na cidade' grava a cobertura de verdade", async () => {
    estadoDaLoja.atual = {
      ...estadoDaLoja.atual,
      shippingCoverage: "national",
    };
    await abrirTela();
    await abrirPainel(/entrega na sua cidade/i);

    // A credencial da transportadora NÃO tem chave clicável (é de Ajustes —
    // aqui é exibição). As chaves interativas são SÓ as que têm campo
    // gravável real por trás: a cobertura e, desde a release 1.5.3, a
    // retirada na loja (chave `store-pickup` em enabledShippingMethods —
    // provada em admin-frete-retirada-na-loja.test.tsx).
    const chaves = [...hospedeiro.querySelectorAll('[role="switch"]')];
    expect(chaves.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Só entregar na cidade",
      "Permitir retirada na loja",
    ]);
    const cobertura = chaves[0] as HTMLElement;
    expect(cobertura.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      cobertura.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(cobertura.getAttribute("aria-checked")).toBe("true");

    await salvar();
    expect(updateConfig.mock.calls[0][0]).toHaveProperty(
      "shippingCoverage",
      "local",
    );
  });

  it("cobertura 'local' salva volta como a chave ligada (o estado vem do config)", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, shippingCoverage: "local" };
    await abrirTela();

    expect(
      hospedeiro.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("'Cotação na hora' é EXIBIÇÃO de estado: a frase do estado existe, mas nenhum botão com esse nome (nada salva credencial daqui)", async () => {
    await abrirTela();

    // O estado aparece em texto (dica da Linha "Cotação na hora", dentro do
    // painel "Fora da cidade" — o conteúdo NUNCA desmonta, só fica
    // `hidden`, então o texto é lido sem precisar abrir o painel)…
    expect(texto()).toMatch(
      /Cota[çc][ãa]o real, na hora, pelos provedores ligados/i,
    );
    // …mas NÃO existe botão "Cotação na hora" — chave decorativa que não
    // salvaria nada é proibida nesta tela.
    expect(botaoComTexto(/cota[çc][ãa]o na hora/i)).toBeUndefined();
  });

  it("o botão Salvar do cabeçalho: 'Salvo' e desabilitado quando está limpo, 'Salvar' e habilitado quando há mudança", async () => {
    await abrirTela();

    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
    expect(botaoSalvar()?.disabled).toBe(true);

    await escolherPresetLocal(/Sempre grátis/);

    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvar");
    expect(botaoSalvar()?.disabled).toBe(false);
  });

  it("preset 'Sempre grátis' grava a sentinela 0,01 (0 sempre significou desligado)", async () => {
    await abrirTela();

    await escolherPresetLocal(/Sempre grátis/);
    const escopo = hospedeiro.querySelector("#bloco-frete-local-estrategias");
    expect(
      escopo?.querySelector('[role="radio"][aria-checked="true"]')?.textContent,
    ).toMatch(/Sempre grátis/);

    await salvar();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0]).toHaveProperty(
      "freeShippingMin",
      0.01,
    );
  });

  it("preset 'acima de um valor': o valor editado é o que vai para o config", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 0 };
    await abrirTela();

    await escolherPresetLocal(/Grátis acima de um valor/);

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

    expect(updateConfig.mock.calls[0][0]).toHaveProperty(
      "freeShippingMin",
      250,
    );
  });

  it("REVISÃO A7: o campo do 'acima de' trava 0/negativo e avisa que valor vazio desliga o grátis", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 100 };
    await abrirTela();

    await escolherPresetLocal(/Grátis acima de um valor/);

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

    await escolherPresetLocal(/Por produto marcado/);
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

  it("preset 'por produto' salvo (-1) volta como o ativo no seletor e na faixa (a sentinela preserva a escolha)", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: -1 };
    await abrirTela();

    expect(textoDaFaixa()).toContain("Por produto marcado");
    const escopo = hospedeiro.querySelector("#bloco-frete-local-estrategias");
    const marcado = escopo?.querySelector(
      '[role="radio"][aria-checked="true"]',
    )?.textContent;
    expect(marcado).toMatch(/Por produto marcado/);
    // Nada foi mexido: o config já descreve o preset escolhido.
    expect(botaoSalvar()?.textContent?.trim()).toBe("Salvo");
  });

  it("escolher 'Desligado' sobre um config de grátis-por-valor grava 0 (presets são exclusivos)", async () => {
    await abrirTela();

    await escolherPresetLocal(/Desligado/);
    await salvar();

    expect(updateConfig.mock.calls[0][0]).toHaveProperty("freeShippingMin", 0);
  });

  it("preset 'sempre' salvo no config volta como o ativo no seletor e na faixa", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 0.01 };
    await abrirTela();

    expect(textoDaFaixa()).toContain("Em toda a loja");
    const escopo = hospedeiro.querySelector("#bloco-frete-local-estrategias");
    const marcado = escopo?.querySelector(
      '[role="radio"][aria-checked="true"]',
    )?.textContent;
    expect(marcado).toMatch(/Sempre grátis/);
  });

  it("sem transportadora ligada: aviso BEM VISÍVEL de loja-só-cidade + caminho para Ajustes", async () => {
    estadoDoBanco.ligados = [];
    estadoDoBanco.provedores = {};
    await abrirTela();

    expect(texto()).toMatch(/Nenhuma transportadora ligada/i);
    expect(texto()).toMatch(/s[óo] entrega na sua cidade/i);

    const cta = botaoComTexto(/conectar transportadora/i);
    expect(cta).toBeDefined();
    await act(async () => {
      (cta as HTMLElement).click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  it("com transportadora ligada: o aviso de sem-conexão NÃO aparece, e o atalho de Ajustes segue existindo", async () => {
    await abrirTela();

    expect(texto()).not.toMatch(/Nenhuma transportadora ligada/i);
    expect(texto()).toMatch(/Melhor Envio ligado/);

    const botaoAjustes = botaoComTexto(/abrir ajustes/i);
    expect(botaoAjustes).toBeDefined();
    await act(async () => {
      (botaoAjustes as HTMLElement).click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  it("CEP da loja vazio no config: a faixa diz que a entrega está PARADA (não inventa funcionamento)", async () => {
    estadoDaLoja.atual = { ...estadoDaLoja.atual, originCep: "" };
    await abrirTela();

    expect(textoDaFaixa()).toMatch(/Parado/i);
    expect(textoDaFaixa()).toMatch(/falta o CEP da loja/i);
  });
});
