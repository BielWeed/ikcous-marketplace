// @vitest-environment jsdom
//
// Auditoria de 20/08/2026, achados 6, 7 e 12 — a prova de que a TELA usa a
// medição real, e não só de que a função pura existe.
//
// O companheiro deste arquivo (`push-contadores-de-segmento.test.ts`) prova
// as funções puras. Sozinho ele não pega o defeito de origem: alguém podia
// escrever `rotuloDaContagem` certinha e esquecer de trocar o
// `Math.ceil(subCount * 0.3)` no JSX pelo valor medido — o teste da função
// pura continuaria verde e a tela continuaria mentindo. Este arquivo monta
// `AdminPushView` de verdade e lê o texto e os números renderizados.
//
// O cenário usa exatamente os números da auditoria: 8 aparelhos no total,
// segmento "vip" com 2, "inactive" com 0, "new" com 0. A versão com o
// defeito mostraria 3, 2 e 3 (30%, 25% e 45% de 8, arredondados) — se
// qualquer um desses três aparecer, a mutação não foi corrigida.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RPC `get_segmented_push_targets` devolve uma lista de linhas por
// segmento — o contador real é o TAMANHO da lista, igual ao que o
// componente já fazia para o segmento selecionado (achado 6, decisão 1).
const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    porSegmento: {
      vip: [{ id: "1" }, { id: "2" }] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    falharRpc: false,
    // O quarto contador (achado do revisor sobre o commit 6e406b4, em
    // 20/08/2026): a consulta a `push_subscriptions` pode falhar, e a tela
    // tem de mostrar desconhecido — nunca zero.
    falharSubCount: false,
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
            estadoDoBanco.falharSubCount
              ? Promise.resolve({ count: null, error: new Error("falhou") })
              : Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      // push_notifications_log, vw_produtos_public, public_profiles: sem
      // linha nenhuma — não é o que este teste mede.
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
      // Lote 2 (laudo 29/08, achado config 18): a MEDIÇÃO do público passou
      // a usar `get_segmented_push_count` (devolve o número, sem baixar
      // credencial de envio). A `get_segmented_push_targets` (linhas com
      // auth/endpoint/p256dh) ficou para o ENVIO. O dublê responde às duas
      // com a mesma população, para provar que os números exibidos batem
      // com o banco de onde vier a função.
      if (
        nome !== "get_segmented_push_targets" &&
        nome !== "get_segmented_push_count"
      ) {
        return Promise.resolve({
          data: null,
          error: new Error("rpc desconhecida"),
        });
      }
      if (estadoDoBanco.falharRpc) {
        return Promise.resolve({ data: null, error: new Error("falhou") });
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

describe("AdminPushView — os contadores de segmento são medidos, não multiplicados", () => {
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
    estadoDoBanco.falharRpc = false;
    estadoDoBanco.falharSubCount = false;

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

  // Lê o CONTADOR (o `<span>` que mostra o número), não o `textContent` do
  // botão inteiro. Conserto 2 (revisão de 20/08/2026): o rótulo "Sem
  // comprar há 30d" contém um "0" (o "0" de "30d"), então
  // `botao.textContent.toContain("0")` passava mesmo com o multiplicador
  // antigo devolvendo "Sem pedidos há 30d (qualquer status)2" — o "2" ficava colado ao "d" e
  // nenhum `\bN\b` casava. O contador vive no `<span>` com a classe
  // `font-mono`, que é o único span com essa classe dentro do botão.
  function numeroDoSegmento(
    botao: HTMLButtonElement | undefined,
  ): string | undefined {
    return botao?.querySelector("span.font-mono")?.textContent ?? undefined;
  }

  it("cada segmento mostra O SEU número medido, não uma fração do total", async () => {
    await abrirTela();

    // vip=2, inactive=0, new=0 — o real do banco. A versão com o defeito
    // mostraria 3, 2 e 3 (30%, 25% e 45% de 8).
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Gastaram R$ 150+ (pagos)"),
    );
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem pedidos há 30d (qualquer status)"),
    );
    const botaoNovo = botoes.find((b) =>
      (b.textContent ?? "").includes("Cadastrados há ≤ 7 dias"),
    );

    expect(numeroDoSegmento(botaoVip)).toBe("2");
    expect(numeroDoSegmento(botaoInativo)).toBe("0");
    expect(numeroDoSegmento(botaoNovo)).toBe("0");
  });

  // C2 (revisão de 20/08/2026): o título original prometia "mostra 0
  // (medido)" e "o botão de enviar some ao selecioná-lo" — o corpo nunca
  // afirmava o "0", e o botão não some, DESABILITA. Corrigido nos dois
  // lados: o corpo agora prova o "0" que o título promete, e o título
  // deixou de dizer "some".
  it("segmento vazio mostra 0 (medido), e o botão de enviar desabilita ao selecioná-lo", async () => {
    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem pedidos há 30d (qualquer status)"),
    );
    expect(botaoInativo).toBeTruthy();

    await act(async () => {
      botaoInativo?.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(numeroDoSegmento(botaoInativo as HTMLButtonElement)).toBe("0");

    const botaoEnviar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("Enviar Notificação Agora"),
    ) as HTMLButtonElement | undefined;
    expect(botaoEnviar).toBeTruthy();
    // effectiveReach === 0 para o segmento vazio selecionado — o botão de
    // enviar continua desabilitado. Comportamento já existente, não pode
    // quebrar.
    expect(botaoEnviar?.disabled).toBe(true);
  });

  it("medição que ainda não chegou (RPC pendente) mostra traço, nunca um número chutado", async () => {
    // Trava a RPC dos três segmentos não selecionados num Promise que nunca
    // resolve durante o teste — simula "a medição ainda não voltou".
    const controlador: { resolver: (() => void) | null } = { resolver: null };
    const travada = new Promise<void>((resolve) => {
      controlador.resolver = () => resolve();
    });

    const { supabase } = await import("@/lib/supabase");
    const original = supabase.rpc;
    (supabase as any).rpc = vi.fn(
      async (nome: string, args: { p_segment: string }) => {
        if (args.p_segment !== "all") {
          await travada;
        }
        return (original as any)(nome, args);
      },
    );

    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Gastaram R$ 150+ (pagos)"),
    );
    // A11: o rótulo agora DESCREVE a regra ("R$ 150+ (pagos)") — ou seja,
    // tem dígitos no próprio rótulo. A asserção antiga lia o textContent do
    // botão inteiro e caçava dígito no fim, o que o rótulo novo fabrica em
    // falso; o contador vive no span.font-mono (mesma lição do Conserto 2
    // lá em cima), então a leitura é DELE.
    expect(numeroDoSegmento(botaoVip)).toBe("—");

    controlador.resolver?.();
    await act(async () => {
      await esperar(50);
    });
  });

  it("medição que falha também mostra traço, não zero", async () => {
    estadoDoBanco.falharRpc = true;
    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Gastaram R$ 150+ (pagos)"),
    );
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem pedidos há 30d (qualquer status)"),
    );

    expect(botaoVip?.textContent).toContain("—");
    expect(botaoInativo?.textContent).toContain("—");
  });

  // Conserto 1 (revisão de 20/08/2026, o "quinto contador"): `predictedReach`
  // nascia em `useState(0)` e o `if (!error && data)` de `calculateReach` não
  // fazia nada quando a RPC falhava — o valor do segmento medido ANTES
  // sobrevivia à falha do segmento seguinte, e o selo do segmento
  // selecionado (que lia `effectiveReach`, sempre numérico) virava "0" em
  // vez de "—" mesmo quando a medição daquele segmento nunca chegou.
  it("RPC de um segmento falha depois de outro já medido: mostra traço, não herda o número anterior, e o botão de enviar desabilita", async () => {
    await abrirTela();

    const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = () =>
      botoes().find((b) =>
        (b.textContent ?? "").includes("Gastaram R$ 150+ (pagos)"),
      );
    const botaoInativo = () =>
      botoes().find((b) =>
        (b.textContent ?? "").includes("Sem pedidos há 30d (qualquer status)"),
      );
    const botaoEnviar = () =>
      botoes().find((b) =>
        (b.textContent ?? "").includes("Enviar Notificação Agora"),
      ) as HTMLButtonElement | undefined;

    // 1) Seleciona "Gastaram R$ 150+ (pagos)" — mede 2 de verdade.
    await act(async () => {
      botaoVip()!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(numeroDoSegmento(botaoVip())).toBe("2");
    expect(botaoEnviar()?.disabled).toBe(false);

    // 2) Agora o segmento "inactive" vai falhar de propósito ao medir.
    estadoDoBanco.porSegmento.inactive = null;

    await act(async () => {
      botaoInativo()!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    // O "2" do segmento anterior não pode sobreviver: o segmento selecionado
    // agora é "inactive", que nunca terminou de medir.
    expect(numeroDoSegmento(botaoInativo())).toBe("—");
    expect(numeroDoSegmento(botaoInativo())).not.toBe("0");
    expect(texto()).toContain("Receberão: — aparelhos");
    expect(botaoEnviar()?.disabled).toBe(true);
  });

  // Parte A1 da revisão de 20/08/2026: o teste acima só observa o estado
  // DEPOIS que a RPC do segmento seguinte termina (falhando). Ele não prova
  // nada sobre a JANELA em que a nova medição ainda está no ar — e é
  // exatamente aí que `setPredictedReach(null)` (chamado ANTES do `await`
  // em `calculateReach`) age: sem essa linha, o número do segmento anterior
  // sobreviveria na tela enquanto a nova consulta ainda estivesse voando.
  // Medido pelo revisor: apagar essa linha deixava os 20 testes originais
  // verdes, porque nenhum deles olhava o instante intermediário — só depois
  // do flush, quando o `else`/`catch` já tinha gravado `null` de qualquer
  // jeito.
  it("troca de segmento: o número do segmento ANTERIOR não pode aparecer enquanto a medição do novo segmento ainda está no ar", async () => {
    await abrirTela();

    const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = () =>
      botoes().find((b) =>
        (b.textContent ?? "").includes("Gastaram R$ 150+ (pagos)"),
      );
    const botaoInativo = () =>
      botoes().find((b) =>
        (b.textContent ?? "").includes("Sem pedidos há 30d (qualquer status)"),
      );

    // 1) Seleciona "Gastaram R$ 150+ (pagos)" e deixa medir de verdade: 2.
    await act(async () => {
      botaoVip()!.click();
    });
    await act(async () => {
      await esperar(50);
    });
    expect(texto()).toContain("Receberão: 2 aparelhos");

    // 2) A partir de agora, a RPC de MEDIÇÃO do segmento "inactive" fica
    // PRESA num Promise que só este teste resolve — simula a medição em
    // voo. (Lote 2: a medição é a `get_segmented_push_count`; a condição
    // pega as duas para continuar provando a fronteira se a função da
    // medição voltar a ser a de alvos.)
    const controlador: { resolver: (() => void) | null } = { resolver: null };
    const travada = new Promise<void>((resolve) => {
      controlador.resolver = () => resolve();
    });
    const { supabase } = await import("@/lib/supabase");
    const original = supabase.rpc;
    (supabase as any).rpc = vi.fn(
      async (nome: string, args: { p_segment: string }) => {
        if (
          (nome === "get_segmented_push_count" ||
            nome === "get_segmented_push_targets") &&
          args.p_segment === "inactive"
        ) {
          await travada;
        }
        return (original as any)(nome, args);
      },
    );

    // 3) Seleciona "inactive": o clique dispara a nova medição, mas ela
    // fica travada — nunca chega a resolver dentro deste teste.
    await act(async () => {
      botaoInativo()!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    // Enquanto a medição de "inactive" está no ar, o "2" de "vip" (o
    // segmento ANTERIOR) não pode sobreviver na tela.
    expect(texto()).not.toContain("Receberão: 2 aparelhos");
    expect(texto()).toContain("Receberão: — aparelhos");

    // Limpeza: libera a RPC travada para não vazar para o teste seguinte.
    controlador.resolver?.();
    await act(async () => {
      await esperar(50);
    });
  });

  // Parte A2 da revisão de 20/08/2026: tentativa de ISOLAR, por mutação de
  // um termo só, a trava `botaoEnviarDesabilitado = ... || reachDesconhecido
  // || (effectiveReach === 0 && !podeGravarAvisoSemPush)` para o caso de
  // alcance desconhecido. Medido pelo revisor: mutar `podeGravarAvisoSemPush`
  // para aceitar `null` derruba a asserção do BANNER (não tem aparelho),
  // nunca a do `disabled` — o outro termo segura.
  //
  // Tentei a mutação pedida — remover `reachDesconhecido ||` da expressão —
  // e ela TAMBÉM não derruba este teste (verificado manualmente: mutação
  // aplicada, suíte rodada, ficou verde; revertida em seguida). A razão é
  // estrutural, não coincidência de dado de teste: `effectiveReach` é
  // `reachExibido ?? 0` e `reachDesconhecido` é `reachExibido === null` — as
  // duas vêm da MESMA fonte (`reachExibido`). Sempre que `reachDesconhecido`
  // é verdadeiro, `reachExibido` é `null`, e por isso `effectiveReach` já é
  // `0` por causa do `?? 0` — o segundo termo fecha sozinho, em TODO estado
  // alcançável do código atual. Não existe teste de UI (mudar segmento,
  // cliente-alvo, RPC) capaz de isolar `reachDesconhecido` sozinho sem antes
  // mudar a fórmula de `effectiveReach` — e mudar produção para viabilizar
  // um teste de isolamento estava fora do escopo desta tarefa.
  //
  // Fica então como teste de REGRESSÃO (prova que a trava falha fechada com
  // alcance desconhecido), não como prova de isolamento de termo — a mesma
  // conclusão que o comentário reescrito em `AdminPushView.tsx` (achado C1)
  // documenta: as duas guardas são mutuamente redundantes hoje.
  it("alcance desconhecido (RPC de segmento falhou): o botão de enviar falha fechado — teste de regressão, não isola o termo por mutação (ver comentário acima)", async () => {
    estadoDoBanco.falharRpc = true;
    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Gastaram R$ 150+ (pagos)"),
    );
    await act(async () => {
      botaoVip!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    const botaoEnviar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("Enviar Notificação Agora"),
    ) as HTMLButtonElement | undefined;
    expect(botaoEnviar?.disabled).toBe(true);
  });

  it("os selos de plataforma iOS/Android saíram da tela", async () => {
    await abrirTela();

    expect(texto()).not.toMatch(/iOS:/);
    expect(texto()).not.toMatch(/Android:/);
  });

  it("os textos de alcance dizem aparelhos, não clientes — no plural certo", async () => {
    await abrirTela();

    // Segmento "all": 8 aparelhos, real (subCount).
    expect(texto()).toContain("Receberão: 8 aparelhos");
    expect(texto()).toContain("Enviar Notificação Agora (8 aparelhos)");
    expect(texto()).not.toMatch(/Receberão:\s*\d+\s*clientes/);
    expect(texto()).not.toMatch(/Enviar Notificação Agora \(\d+ clientes\)/);
  });

  it("com um único aparelho, o texto de alcance vem no singular", async () => {
    estadoDoBanco.subCount = 1;
    await abrirTela();

    expect(texto()).toContain("Receberão: 1 aparelho");
    expect(texto()).not.toContain("Receberão: 1 aparelhos");
  });

  // Achado do revisor sobre o commit 6e406b4, em 20/08/2026: o QUARTO
  // contador (`subCount`, o total de aparelhos) nascia em `useState(0)` e o
  // `if (!error) setSubCount(...)` simplesmente não fazia nada quando a
  // consulta falhava — a tela ficava presa em "0" para sempre, indistinguível
  // de uma loja sem ninguém cadastrado. Estes três testes provam que os TRÊS
  // lugares de exibição (topbar, cartão grande, badge "Todos os Clientes") e
  // o texto de alcance concordam entre si, e que o botão de enviar SEMPRE
  // falha fechado quando o total é desconhecido.
  describe("o total de aparelhos (subCount) distingue desconhecido de zero medido", () => {
    function numeroDoTopbar(): string | undefined {
      const span = Array.from(hospedeiro.querySelectorAll("span")).find(
        (s) =>
          (s.textContent ?? "").includes("Celulares Cadastrados") &&
          !(s.textContent ?? "").includes("Computadores"),
      );
      return span?.querySelector("strong")?.textContent ?? undefined;
    }

    function numeroDoCartaoGrande(): string | undefined {
      return hospedeiro.querySelector("h2.text-3xl")?.textContent ?? undefined;
    }

    function numeroDoBadgeTodosOsClientes(): string | undefined {
      const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").includes("Todos os Clientes"),
      );
      return botao?.textContent ?? undefined;
    }

    function botaoEnviar(): HTMLButtonElement | undefined {
      return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Enviar Notificação Agora"),
      ) as HTMLButtonElement | undefined;
    }

    it("quando a consulta ao total de aparelhos FALHA, os três lugares mostram desconhecido — nunca zero — e o botão de enviar continua desabilitado", async () => {
      estadoDoBanco.falharSubCount = true;
      await abrirTela();

      expect(numeroDoTopbar()).toBe("—");
      expect(numeroDoCartaoGrande()).toBe("—");
      expect(numeroDoBadgeTodosOsClientes()).toContain("—");

      expect(texto()).toContain("Receberão: — aparelhos");
      expect(texto()).toContain("Enviar Notificação Agora (— aparelhos)");

      // O ponto mais importante desta tarefa: total desconhecido não pode
      // virar botão liberado. Falhar fechado.
      expect(botaoEnviar()?.disabled).toBe(true);
    });

    it("quando a consulta DEVOLVE 0 de verdade, os três lugares mostram 0 (medido) e o botão de enviar continua desabilitado, por ser zero real", async () => {
      estadoDoBanco.subCount = 0;
      await abrirTela();

      expect(numeroDoTopbar()).toBe("0");
      expect(numeroDoCartaoGrande()).toBe("0");
      expect(numeroDoBadgeTodosOsClientes()).toContain("0");

      expect(texto()).toContain("Receberão: 0 aparelhos");

      expect(botaoEnviar()?.disabled).toBe(true);
    });

    it("quando a consulta DEVOLVE 8, os três lugares mostram 8 e o botão de enviar habilita", async () => {
      await abrirTela();

      expect(numeroDoTopbar()).toBe("8");
      expect(numeroDoCartaoGrande()).toBe("8");
      expect(numeroDoBadgeTodosOsClientes()).toContain("8");

      expect(texto()).toContain("Receberão: 8 aparelhos");

      expect(botaoEnviar()?.disabled).toBe(false);
    });
  });
});
