// @vitest-environment jsdom
//
// Direção B "Rádio do lojista" (lote B, tela 2 — notificações), aprovada
// pelo dono em 12/09/2026: propostas em
// equipe/entregas/20260912-lote-b-propostas-glm/tela2-notificacoes-B-radio.html
// (base) e tela2-notificacoes-A-passos.html (a prévia do celular, emprestada
// de lá). Este arquivo prende só o que MUDA de forma ou de lugar:
//
//   a. Público em CHIPS com o número GRANDE de cada segmento — e segmento
//      medido como zero aparece desativado COM o motivo do zero (nunca um
//      zero mudo que o lojista não sabe interpretar).
//   b. Prévia no celular: o que foi digitado aparece no mockup EXATAMENTE
//      como a notificação chega (título, corpo, "agora"), ao vivo.
//   c. Prova social e botão de teste saem da composição: viram o bloco
//      recolhível "Ajustes" no fim da tela (sacrifício aceito pelo dono).
//   d. Histórico "O que já foi ao ar" com estado vazio desenhado — não uma
//      frase seca.
//
// O que NÃO muda (envio, medição, convenção ContagemMedida, histórico
// preenchido) continua preso nos arquivos irmãos:
// admin-push-view-contadores, admin-push-envio-honesto,
// push-medicao-nao-baixa-credencial. Mesmos dublês de lá.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    porSegmento: {
      vip: [{ id: "1" }, { id: "2" }] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    historico: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: estadoDoBanco.historico, error: null }),
            }),
          }),
        };
      }
      // vw_produtos_public, public_profiles: sem linha — não é o que este
      // arquivo mede.
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) => {
      // Mesma fronteira do irmão: medição pela count, envio pela targets —
      // este arquivo não envia, então a targets só precisa existir.
      if (
        nome !== "get_segmented_push_targets" &&
        nome !== "get_segmented_push_count"
      ) {
        return Promise.resolve({
          data: null,
          error: new Error("rpc desconhecida"),
        });
      }
      const linhas = estadoDoBanco.porSegmento[args.p_segment] ?? null;
      if (linhas === null) {
        return Promise.resolve({
          data: null,
          error: new Error("sem segmento"),
        });
      }
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: linhas.length, error: null });
      }
      return Promise.resolve({ data: linhas, error: null });
    },
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — rádio do lojista (direção B)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = {
      vip: [{ id: "1" }, { id: "2" }],
      inactive: [],
      new: [],
    };
    estadoDoBanco.historico = [];

    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

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
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  function chipDeSegmento(rotulo: string): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(rotulo),
    );
  }

  // Cabeçalho de seção colapsável (mesmo padrão do irmão
  // admin-visual-canais-avisar: botão com aria-expanded, achado pelo texto).
  function cabecalhoDeSecao(
    textoDoCabecalho: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => (b.textContent ?? "").includes(textoDoCabecalho));
  }

  // O número grande do chip vive num <span class="font-mono"> — mesma
  // convenção de leitura do arquivo irmão (o rótulo do segmento tem dígitos
  // próprios, "R$ 150+" e "30d", então o número só pode ser lido DELE).
  function numeroDoChip(chip: HTMLButtonElement | undefined): string | null {
    return chip?.querySelector("span.font-mono")?.textContent ?? null;
  }

  it("cada chip de público mostra o número GRANDE do seu segmento, e o selecionado fica em destaque", async () => {
    await abrirTela();

    const chipTodos = chipDeSegmento("Todos os Clientes");
    const chipVip = chipDeSegmento("Gastaram R$ 150+ (pagos)");
    const chipInativo = chipDeSegmento("Sem pedidos há 30d (qualquer status)");

    // Números medidos de verdade: all=8 (subCount), vip=2, inactive=0.
    expect(numeroDoChip(chipTodos)).toBe("8");
    expect(numeroDoChip(chipVip)).toBe("2");
    expect(numeroDoChip(chipInativo)).toBe("0");

    // O chip do segmento selecionado ("all" por padrão) tem destaque; os
    // outros não.
    expect(chipTodos?.className).toContain("border-admin-gold/50");
    expect(chipVip?.className).not.toContain("border-admin-gold/50");

    // A linha de unidade embaixo do número — parte do chip da direção B
    // ("9 / aparelhos"), que o botão antigo não tinha.
    expect(chipTodos!.textContent).toContain("aparelhos");

    // Chip com gente pode ser clicado.
    expect(chipVip?.disabled).toBe(false);
  });

  it("segmento medido como zero aparece DESATIVADO, com o motivo do zero — e não pode ser selecionado", async () => {
    await abrirTela();

    const chipInativo = chipDeSegmento("Sem pedidos há 30d (qualquer status)");
    expect(chipInativo).toBeTruthy();

    // Zero medido tem EXPLICAÇÃO na cara do chip — não é um zero mudo.
    expect(chipInativo!.disabled).toBe(true);
    expect(chipInativo!.textContent).toContain(
      "ninguém passou de 30 dias sem pedir",
    );

    // E a desativação é de verdade: clicar não troca o segmento — a tela
    // continua no "all" (8 aparelhos), não no zero.
    await act(async () => {
      chipInativo!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(chipInativo!.className).not.toContain("border-admin-gold/50");
    expect(texto()).toContain("Receberão: 8 aparelhos");
  });

  it("contagem zero desatualizada REMEDE ao voltar o foco: cliente novo com a tela aberta destrava o chip (achado 3 da revisão do PR 549)", async () => {
    await abrirTela();

    const chipNovos = chipDeSegmento("Cadastrados há ≤ 7 dias");
    expect(chipNovos).toBeTruthy();
    // Abertura da tela: zero medido de verdade → chip desativado com motivo.
    expect(chipNovos!.disabled).toBe(true);
    expect(numeroDoChip(chipNovos)).toBe("0");

    // O banco andou enquanto a tela estava aberta: um cliente se cadastrou.
    estadoDoBanco.porSegmento.new = [{ id: "9" }];

    // Lojista volta o foco à janela/aba (voltou do WhatsApp, foi ver a
    // loja…): a medição dos segmentos roda de novo e o chip acompanha —
    // antes deste conserto ele ficava travado no zero para sempre, sem
    // caminho de remedir (chip desativado não dispara a medição).
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await esperar(50);
    });

    expect(numeroDoChip(chipNovos)).toBe("1");
    expect(chipNovos!.disabled).toBe(false);
  });

  it("o público 'Todos' também REMEDE ao voltar o foco: inscrito novo destrava o chip (achado do bot de revisão do GitHub sobre o ef4c1ee)", async () => {
    // Abertura com a loja SEM aparelho inscrito: o chip "Todos" nasce zero e
    // desativado, pela mesma regra de zero medido dos demais chips.
    estadoDoBanco.subCount = 0;
    await abrirTela();

    const chipTodos = chipDeSegmento("Todos os Clientes");
    expect(chipTodos).toBeTruthy();
    expect(chipTodos!.disabled).toBe(true);
    expect(numeroDoChip(chipTodos)).toBe("0");

    // O banco andou com a tela aberta: um aparelho se inscreveu.
    estadoDoBanco.subCount = 1;

    // O foco volta: `subCount` tem de ser medido de novo — antes deste
    // conserto o efeito de foco só remediava os segmentos, e o "Todos"
    // ficava travado no zero para sempre.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await esperar(50);
    });

    expect(numeroDoChip(chipTodos)).toBe("1");
    expect(chipTodos!.disabled).toBe(false);
  });

  it("a prévia do celular mostra o título e o corpo digitados, como a notificação chega", async () => {
    await abrirTela();

    const previa = hospedeiro.querySelector('[data-testid="previa-celular"]');
    expect(previa).toBeTruthy();

    // Estado vazio: o mockup existe, mas não finge ter mensagem.
    expect(previa!.textContent).toContain("agora");
    expect(previa!.textContent).not.toContain("Promoção de teste");

    const campoTitulo =
      hospedeiro.querySelector<HTMLInputElement>("#push-title");
    const campoCorpo =
      hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
    expect(campoTitulo).toBeTruthy();
    expect(campoCorpo).toBeTruthy();
    await act(async () => {
      const setterTitulo = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setterTitulo?.call(campoTitulo, "Promoção de teste");
      campoTitulo!.dispatchEvent(new Event("input", { bubbles: true }));
      const setterCorpo = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setterCorpo?.call(campoCorpo, "Só hoje, confira na loja!");
      campoCorpo!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // LocalBufferedInput/Textarea só descarregam no debounce (~200ms).
    await act(async () => {
      await esperar(400);
    });

    const previaDepois = hospedeiro.querySelector(
      '[data-testid="previa-celular"]',
    );
    expect(previaDepois!.textContent).toContain("Promoção de teste");
    expect(previaDepois!.textContent).toContain("Só hoje, confira na loja!");
    // O carimbo de tempo da notificação real.
    expect(previaDepois!.textContent).toContain("agora");
  });

  // Revisão do lote B (12/09/2026), achado 2: a proposta aprovada trava o
  // comprimento (maxlength 60/140) e o contador "{n}/60" existia sem a
  // trava — o envio saía com 73 e a prévia mostrava inteiro o que o SO do
  // cliente trunca. `maxLength` é a propriedade DOM que reflete o atributo;
  // sem o atributo, o valor é -1 (sem limite).
  it("título e corpo têm a trava de comprimento da proposta — o contador não é só enfeite", async () => {
    await abrirTela();

    const campoTitulo =
      hospedeiro.querySelector<HTMLInputElement>("#push-title");
    const campoCorpo =
      hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
    expect(campoTitulo).toBeTruthy();
    expect(campoCorpo).toBeTruthy();
    expect(campoTitulo!.maxLength).toBe(60);
    expect(campoCorpo!.maxLength).toBe(140);
  });

  it("prova social e botão de teste ficam no bloco Ajustes, fora da composição", async () => {
    await abrirTela();

    // A composição está aberta (porta de trabalho) — e o interruptor de
    // prova social NÃO está nela nem em lugar visível nenhum.
    const ajustes = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => (b.textContent ?? "").includes("Ajustes"));
    expect(ajustes).toBeTruthy();
    expect(ajustes!.getAttribute("aria-expanded")).toBe("false");
    expect(
      hospedeiro.querySelector("#realtime-sales-alerts-switch"),
    ).toBeNull();

    // Abrir o Ajustes monta o bloco com o interruptor dentro — a função
    // continua inteira, só mudou o lugar.
    await act(async () => {
      ajustes!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(ajustes!.getAttribute("aria-expanded")).toBe("true");
    expect(
      hospedeiro.querySelector("#realtime-sales-alerts-switch"),
    ).not.toBeNull();
  });

  it("histórico sem envios mostra o estado vazio desenhado — com o que vai aparecer lá", async () => {
    await abrirTela();

    expect(texto()).toContain("O que já foi ao ar");
    expect(texto()).toContain("Nenhuma mensagem enviada até agora");
    expect(texto()).toContain("Quando você enviar, cada mensagem aparece aqui");
    // O texto antigo, seco, não sobrevive em lugar nenhum.
    expect(texto()).not.toContain("Nenhuma mensagem enviada até o momento");
  });

  // Revisão do lote B (12/09/2026), achado 3: o colapso da composição saiu —
  // "painel único aceso, nada escondido" (mesma decisão da T1 no
  // Atendimento). Os inputs são controlados por um useState da própria view
  // e remontam com o valor, então o colapso nunca descartou rascunho: a
  // guarda real é de navegação (onSetDirty), e a frase "Salve antes de
  // fechar" sai junto com a seção que a carregava.
  it("a composição 'No ar agora' é cartão fixo — não colapsa, e o rascunho não desmonta nada", async () => {
    await abrirTela();

    // Zero controle de colapso para a composição.
    const controleDeColapso = cabecalhoDeSecao("No ar agora");
    expect(controleDeColapso).toBeUndefined();
    expect(texto()).not.toMatch(/salve antes de fechar/i);

    const campo = hospedeiro.querySelector<HTMLInputElement>("#push-title");
    expect(campo).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, "Oferta da semana");
      campo!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await esperar(400); // flush do LocalBufferedInput (~200ms)
    });

    // Com rascunho pendente, nada sai da árvore: o campo segue com o valor,
    // e a guarda real (o sinal para o App) é coberta pelo teste de baixo.
    expect(hospedeiro.querySelector("#push-title")).not.toBeNull();
    expect(campo!.value).toBe("Oferta da semana");
  });

  // O bloco Ajustes NOVO não pode virar armadilha: abrir e fechar é o gesto
  // de quem só quer olhar o interruptor de prova social — e não pode apagar
  // o rascunho que está na composição. A guarda da view inteira
  // (onSetDirty) segue dizendo "tem rascunho" antes e depois do gesto.
  it("abrir e fechar o bloco Ajustes não descarta o rascunho nem desliga a guarda da tela", async () => {
    const onSetDirty = vi.fn();
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} onSetDirty={onSetDirty} />,
      );
    });
    await act(async () => {
      await esperar(50);
    });

    const campo = hospedeiro.querySelector<HTMLInputElement>("#push-title");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, "Rascunho que sobrevive");
      campo!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await esperar(400);
    });

    // A guarda da view marcou: existe rascunho.
    expect(onSetDirty).toHaveBeenCalledWith(true);

    const ajustes = cabecalhoDeSecao("Ajustes");
    expect(ajustes).toBeTruthy();
    await act(async () => {
      ajustes!.click();
    });
    await act(async () => {
      await esperar(50);
    });
    expect(ajustes!.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      ajustes!.click();
    });
    await act(async () => {
      await esperar(350); // fim da animação de saída
    });
    expect(ajustes!.getAttribute("aria-expanded")).toBe("false");

    // O rascunho continua na composição, e a guarda continua de pé.
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#push-title")?.value,
    ).toBe("Rascunho que sobrevive");
    expect(
      (onSetDirty.mock.calls as boolean[][])[
        onSetDirty.mock.calls.length - 1
      ][0],
    ).toBe(true);
  });
});
