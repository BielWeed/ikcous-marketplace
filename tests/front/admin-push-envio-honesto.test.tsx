// @vitest-environment jsdom
//
// Fecha os achados 8 e 11 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-config.md), que juntos formam um só
// mecanismo: o envio de push falha em silêncio para 15 dos 16 clientes
// (achado 8) e o histórico carimba "ENVIADA" mesmo quando ninguém recebeu
// (achado 11). O terceiro pedaço — "clientes" em vez de "aparelhos" no
// histórico — é o mesmo defeito do achado 12, já corrigido no resto da
// tela, mas esquecido aqui.
//
// Este arquivo é irmão de `admin-push-view-contadores.test.tsx` (mesmo
// andaime de mocks) e cobre o ENVIO e o HISTÓRICO, não os contadores de
// segmento.
//
// Sobre "cliente sem aparelho" e "segmento vazio": o botão "Enviar
// Notificação Agora" fica desabilitado quando o alcance MEDIDO
// (`predictedReach`) é zero — e React suprime o `onClick` de um botão
// `disabled`, mesmo via `dispatchEvent` (não é só o `.click()` nativo que é
// suprimido; o plugin de eventos do React também checa `target.disabled`).
// Isso é comportamento PRÉ-EXISTENTE, fora do escopo desta tarefa. Para
// exercitar o `handleSend`, os dois testes simulam a mesma corrida que
// justifica o achado 8 na prática: a tela mede o alcance uma vez
// (habilitando o botão) e o `handleSend` mede de novo, na hora do clique,
// com a `mesma RPC` — se o aparelho sumiu nesse intervalo, a medição nova
// é zero mesmo com o botão mostrando a medição antiga.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    // Segmentos usados pelos botões "Clientes Frequentes / Sem comprar há
    // 30d / Novos Clientes" — não é o que este arquivo mede, mas o
    // componente busca os três ao montar.
    porSegmento: {
      vip: [] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    // RPC `get_segmented_push_targets` para um `p_segment` que É um UUID —
    // o caso "Mensagem para Cliente Específico".
    alvosDoClienteEspecifico: [] as {
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[],
    nomeDoClienteEspecifico: "Cliente de Teste",
    // Resultado do RPC para o segmento "all" — a lista de destinatários
    // que o `handleSend` usa de verdade para montar os tokens do push.
    alvosDoSegmentoTodos: [
      {
        user_id: "u1",
        endpoint: "https://push.example/1",
        p256dh: "p1",
        auth: "a1",
      },
    ] as { user_id: string; endpoint: string; p256dh: string; auth: string }[],
    respostaDoEnvio: { enviados: 1, falharam: 0, falhas: [] as unknown[] },
    historico: [] as Record<string, unknown>[],
    // Conserto 4: o insert em `notificacoes` pode ser recusado pelo banco
    // (RLS, coluna obrigatória faltando etc.) sem lançar exceção — o
    // postgrest-js resolve normalmente com `{ data: null, error }`. `null`
    // aqui é "insert vai dar certo"; preencher é "o banco recusou esta
    // linha".
    erroDoInsertNotificacoes: null as null | { message: string },
  },
}));

const inserts = vi.hoisted(() => ({
  notificacoes: [] as Record<string, unknown>[],
  pushLog: [] as Record<string, unknown>[],
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

const invokeSendPush = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { full_name: estadoDoBanco.nomeDoClienteEspecifico },
                  error: null,
                }),
            }),
          }),
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
          insert: (linha: Record<string, unknown>) => {
            const registrado = {
              id: `log-${inserts.pushLog.length + 1}`,
              ...linha,
            };
            inserts.pushLog.push(registrado);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: registrado.id }, error: null }),
              }),
            };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_coluna: string, id: string) => {
              const linha = inserts.pushLog.find((l) => l.id === id);
              if (linha) Object.assign(linha, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: (
            linhaOuLinhas: Record<string, unknown> | Record<string, unknown>[],
          ) => {
            // Como o postgrest-js de verdade: uma linha recusada NÃO lança
            // exceção — resolve com `{ error }` preenchido, e nada entra na
            // tabela.
            if (estadoDoBanco.erroDoInsertNotificacoes) {
              return Promise.resolve({
                error: estadoDoBanco.erroDoInsertNotificacoes,
              });
            }
            const linhas = Array.isArray(linhaOuLinhas)
              ? linhaOuLinhas
              : [linhaOuLinhas];
            inserts.notificacoes.push(...linhas);
            return Promise.resolve({ error: null });
          },
        };
      }
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
      if (nome !== "get_segmented_push_targets") {
        return Promise.resolve({
          data: null,
          error: new Error("rpc desconhecida"),
        });
      }
      const seg = args.p_segment;
      if (seg === "vip" || seg === "inactive" || seg === "new") {
        // Indexar por `args.p_segment` (MemberExpression), não por `seg`
        // (Identifier isolado): mesmo padrão do arquivo irmão
        // (`admin-push-view-contadores.test.tsx:100`), que não dispara
        // `security/detect-object-injection` — a regra só olha a FORMA da
        // expressão, não o tipo já estreitado pelo `if` acima.
        return Promise.resolve({
          data: estadoDoBanco.porSegmento[args.p_segment] ?? [],
          error: null,
        });
      }
      if (seg === "all") {
        return Promise.resolve({
          data: estadoDoBanco.alvosDoSegmentoTodos,
          error: null,
        });
      }
      // Qualquer outro valor é tratado, no banco real, como UUID de cliente
      // específico (`get_segmented_push_targets`, caso 1).
      return Promise.resolve({
        data: estadoDoBanco.alvosDoClienteEspecifico,
        error: null,
      });
    },
    functions: { invoke: invokeSendPush },
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

describe("AdminPushView — o envio não engole o aviso do app, e o histórico não mente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSendPush.mockResolvedValue({
      data: estadoDoBanco.respostaDoEnvio,
      error: null,
    });
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = { vip: [], inactive: [], new: [] };
    estadoDoBanco.alvosDoClienteEspecifico = [];
    estadoDoBanco.nomeDoClienteEspecifico = "Cliente de Teste";
    estadoDoBanco.alvosDoSegmentoTodos = [
      {
        user_id: "u1",
        endpoint: "https://push.example/1",
        p256dh: "p1",
        auth: "a1",
      },
    ];
    estadoDoBanco.respostaDoEnvio = { enviados: 1, falharam: 0, falhas: [] };
    estadoDoBanco.historico = [];
    estadoDoBanco.erroDoInsertNotificacoes = null;
    inserts.notificacoes = [];
    inserts.pushLog = [];

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

  async function abrirTela(targetUserId?: string) {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
      );
    });
    await act(async () => {
      await esperar(80);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  function digitar(
    elemento: HTMLInputElement | HTMLTextAreaElement,
    valor: string,
  ) {
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
    setter?.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function preencherMensagem(titulo: string, corpo: string) {
    const campoTitulo =
      hospedeiro.querySelector<HTMLInputElement>("#push-title");
    const campoCorpo =
      hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
    expect(campoTitulo).toBeTruthy();
    expect(campoCorpo).toBeTruthy();
    await act(async () => {
      digitar(campoTitulo!, titulo);
      digitar(campoCorpo!, corpo);
    });
    // `LocalBufferedInput`/`LocalBufferedTextarea` só chamam `onFlush` depois
    // do debounce (200ms) — esperar até o estado do componente refletir o
    // que foi digitado.
    await act(async () => {
      await esperar(260);
    });
  }

  function botaoEnviar(): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Enviar Notificação Agora"),
    ) as HTMLButtonElement | undefined;
  }

  async function clicarEnviar() {
    const botao = botaoEnviar();
    expect(botao).toBeTruthy();
    expect(botao!.disabled).toBe(false);
    await act(async () => {
      botao!.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  it("cliente específico SEM aparelho: o aviso é gravado no app, e o toast conta a verdade — não fica mudo", async () => {
    // No instante em que a tela mede o alcance, o cliente TEM um aparelho —
    // é isso que habilita o botão. No instante do clique, o `handleSend`
    // faz uma consulta NOVA (mesma RPC) e não acha mais nenhum — o mesmo
    // efeito de "1 dos 16 tem aparelho" da auditoria, só que capturado no
    // meio da corrida em vez de num cliente já sem aparelho desde sempre.
    estadoDoBanco.alvosDoClienteEspecifico = [
      {
        user_id: "cliente-sem-aparelho",
        endpoint: "e1",
        p256dh: "p1",
        auth: "a1",
      },
    ];
    await abrirTela("cliente-sem-aparelho");
    await preencherMensagem("Oferta especial", "Corre que acaba hoje!");

    estadoDoBanco.alvosDoClienteEspecifico = [];

    await clicarEnviar();

    expect(inserts.notificacoes).toHaveLength(1);
    expect(inserts.notificacoes[0]).toMatchObject({
      usuario_id: "cliente-sem-aparelho",
      titulo: "Oferta especial",
      mensagem: "Corre que acaba hoje!",
    });

    // A parte de PUSH não tinha para quem enviar — nada de log de envio nem
    // chamada à função de disparo.
    expect(inserts.pushLog).toHaveLength(0);
    expect(invokeSendPush).not.toHaveBeenCalled();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalled();
    const chamada = (toast.error as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => /aparelho/i.test(call[0]),
    );
    expect(chamada).toBeTruthy();
  });

  it("cliente específico COM aparelho: continua criando o log de envio e o aviso no app (sem regressão)", async () => {
    estadoDoBanco.alvosDoClienteEspecifico = [
      {
        user_id: "cliente-com-aparelho",
        endpoint: "https://push.example/2",
        p256dh: "p2",
        auth: "a2",
      },
    ];
    await abrirTela("cliente-com-aparelho");
    await preencherMensagem("Chegou novidade", "Confere lá na loja!");

    await clicarEnviar();

    expect(inserts.pushLog).toHaveLength(1);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(inserts.notificacoes).toHaveLength(1);
    expect(inserts.notificacoes[0]).toMatchObject({
      usuario_id: "cliente-com-aparelho",
    });
  });

  it("segmento vazio (sem cliente específico): continua parando sem criar aviso no app — a trava da decisão 3", async () => {
    // Mesma corrida do primeiro teste: o segmento "Sem comprar há 30d"
    // tem 1 aparelho no instante em que é selecionado (habilita o botão),
    // e 0 no instante em que o `handleSend` mede de novo.
    estadoDoBanco.porSegmento.inactive = [
      { user_id: "alguem", endpoint: "e", p256dh: "p", auth: "a" },
    ];
    await abrirTela();
    await preencherMensagem("Promoção geral", "Só até domingo!");

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem comprar há 30d"),
    );
    expect(botaoInativo).toBeTruthy();
    await act(async () => {
      botaoInativo!.click();
    });
    await act(async () => {
      await esperar(80);
    });

    estadoDoBanco.porSegmento.inactive = [];

    await clicarEnviar();

    expect(inserts.notificacoes).toHaveLength(0);
    expect(inserts.pushLog).toHaveLength(0);
    expect(invokeSendPush).not.toHaveBeenCalled();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      "Nenhum destinatário encontrado para este segmento",
    );
  });

  it("histórico com recipient_count 0 não diz 'ENVIADA'", async () => {
    estadoDoBanco.historico = [
      {
        id: "h1",
        title: "Campanha antiga",
        body: "Ninguém recebeu",
        url: "/",
        recipient_count: 0,
        sent_at: new Date().toISOString(),
      },
    ];
    await abrirTela();

    // `\b` importa aqui: o cabeçalho fixo da seção diz "Histórico de
    // Mensagens Enviadas" (plural), que contém "Enviada" como substring —
    // sem a fronteira de palavra o teste acusaria um selo que não existe.
    expect(texto()).not.toMatch(/\bENVIADA\b/i);
    expect(texto()).toContain("Não confirmada");
  });

  // Conserto 3 (decisão do plano, 20/08/2026, corrigindo o achado 8): dos 16
  // clientes sem aparelho, o botão "Enviar Notificação Agora" nascia
  // desabilitado (`effectiveReach === 0`) e NUNCA ficava clicável — o aviso
  // gravado no app (achado 8) era, na prática, inalcançável. A correção: se
  // existe `targetUserId` E o alcance foi MEDIDO como zero (não
  // desconhecido), ainda há uma ação real e segura — gravar o aviso — então
  // o botão habilita, e a tela avisa antes do clique.
  describe("Conserto 3 — cliente específico sem aparelho não trava mais o botão", () => {
    it("cliente específico sem aparelho, medido como zero (sem corrida): o botão fica HABILITADO e a tela avisa antes do clique", async () => {
      estadoDoBanco.alvosDoClienteEspecifico = [];
      await abrirTela("cliente-sem-aparelho");

      expect(botaoEnviar()?.disabled).toBe(false);
      expect(texto()).toMatch(/não tem aparelho/i);
    });

    it("segmento vazio, sem cliente específico: o botão continua DESABILITADO — a trava de sempre", async () => {
      estadoDoBanco.porSegmento.inactive = [];
      await abrirTela();

      const botaoInativo = Array.from(
        hospedeiro.querySelectorAll("button"),
      ).find((b) => (b.textContent ?? "").includes("Sem comprar há 30d"));
      expect(botaoInativo).toBeTruthy();
      await act(async () => {
        botaoInativo!.click();
      });
      await act(async () => {
        await esperar(80);
      });

      expect(botaoEnviar()?.disabled).toBe(true);
    });

    it("alcance desconhecido (a medição falhou): o botão continua DESABILITADO, mesmo com cliente específico", async () => {
      const { supabase } = await import("@/lib/supabase");
      const original = supabase.rpc;
      (supabase as any).rpc = vi.fn(
        async (nome: string, args: { p_segment: string }) => {
          if (
            nome === "get_segmented_push_targets" &&
            args.p_segment === "cliente-sem-medicao"
          ) {
            return { data: null, error: new Error("falhou") };
          }
          return (original as any)(nome, args);
        },
      );

      await abrirTela("cliente-sem-medicao");

      expect(botaoEnviar()?.disabled).toBe(true);
      // Sem medição não há como saber se falta aparelho — não afirma isso.
      expect(texto()).not.toMatch(/não tem aparelho/i);
    });
  });

  // Conserto 4 (revisão de contexto limpo sobre o commit 8292d27,
  // 20/08/2026): o insert em `notificacoes`, no caminho "cliente sem
  // aparelho", ficava dentro de um `try/catch` sem conferir o `{ error }`
  // do retorno. O cliente do Supabase NÃO lança exceção quando o Postgrest
  // recusa a linha — o `catch` nunca disparava, e a tela seguia para o
  // toast de sucesso e limpava o formulário mesmo sem ter gravado nada.
  describe("Conserto 4 — insert do aviso recusado pelo banco não vira sucesso", () => {
    it("cliente específico sem aparelho: se o banco recusar o insert do aviso, a tela NÃO diz que registrou, e o texto continua no formulário", async () => {
      estadoDoBanco.alvosDoClienteEspecifico = [];
      await abrirTela("cliente-sem-aparelho");
      await preencherMensagem("Oferta especial", "Corre que acaba hoje!");

      estadoDoBanco.erroDoInsertNotificacoes = { message: "RLS negou a linha" };

      await clicarEnviar();

      // `inserts.notificacoes.toHaveLength(0)` foi removida daqui (C3 da
      // revisão de 20/08/2026): o dublê de `notificacoes.insert` retorna
      // `{ error }` ANTES de empilhar a linha em `inserts.notificacoes`
      // (ver o mock acima), então esse comprimento dá 0 com ou sem a
      // correção — a asserção provava o mock, nunca o código. O que prova
      // o código é a tela dizer "não foi possível" (abaixo) e não limpar o
      // formulário (mais abaixo).
      const { toast } = await import("sonner");
      const mensagensDeErro = (
        toast.error as ReturnType<typeof vi.fn>
      ).mock.calls.map((chamada: any[]) => chamada[0]);
      expect(mensagensDeErro).toContain(
        "Não foi possível registrar o aviso para este cliente",
      );
      // O toast de "registrado com sucesso" não pode sair quando o insert
      // falhou.
      expect(mensagensDeErro).not.toContain(
        "Este cliente não tem aparelho inscrito para push",
      );

      // O formulário não pode ter sido limpo: a pessoa precisa poder
      // tentar de novo com o texto ainda na tela.
      const campoTitulo =
        hospedeiro.querySelector<HTMLInputElement>("#push-title");
      const campoCorpo =
        hospedeiro.querySelector<HTMLTextAreaElement>("#push-body");
      expect(campoTitulo?.value).toBe("Oferta especial");
      expect(campoCorpo?.value).toBe("Corre que acaba hoje!");
    });
  });

  // Parte B da revisão de 20/08/2026: o Conserto 4 aplicou a checagem de
  // `{ error }` só no insert do caminho "alcance zero" (achado 8). Os OUTROS
  // três inserts em `notificacoes` — cliente específico COM aparelho,
  // segmento "all" e segmento não vazio — continuavam sem checar, e o
  // `catch` que os cobre só fazia `console.error` (silencioso para quem usa
  // a tela). Cenário: envio para "Todos os Clientes", o push SAI, mas o
  // banco recusa a linha do aviso dentro do app — e ninguém era avisado
  // disso. O push tem de continuar sendo anunciado (não pode virar falha de
  // envio), e o aviso-no-app tem de ganhar um segundo aviso, distinto.
  describe("Parte B — a convenção do erro vale para os quatro inserts em notificacoes", () => {
    it("segmento 'Todos os Clientes': insert do aviso recusado pelo banco não apaga a confirmação de que o push saiu, e soma um aviso à parte sobre o aviso no app", async () => {
      await abrirTela();
      await preencherMensagem("Aviso geral", "Confira as novidades!");

      estadoDoBanco.erroDoInsertNotificacoes = { message: "RLS negou a linha" };

      await clicarEnviar();

      // O push SAIU de verdade: log criado, função chamada.
      expect(inserts.pushLog).toHaveLength(1);
      expect(invokeSendPush).toHaveBeenCalledTimes(1);

      const { toast } = await import("sonner");
      const mensagensDeSucesso = (
        toast.success as ReturnType<typeof vi.fn>
      ).mock.calls.map((chamada: any[]) => chamada[0]);
      // O primeiro fato — o push saiu — não pode ser apagado pela falha do
      // segundo.
      expect(
        mensagensDeSucesso.some((m) => /entregue em \d+ dispositivo/i.test(m)),
      ).toBe(true);

      // O segundo fato — o aviso dentro do app NÃO foi gravado — tem de
      // aparecer, separado do primeiro.
      const mensagensDeAviso = (
        toast.warning as ReturnType<typeof vi.fn>
      ).mock.calls.map((chamada: any[]) => chamada[0]);
      expect(mensagensDeAviso.some((m) => /aviso dentro do app/i.test(m))).toBe(
        true,
      );

      // 🔴 E ela fala SÓ do que observou. A versão anterior começava com "O
      // push saiu, mas..." — uma afirmação sobre o push, feita por uma
      // condição que não olha o push. Com os dois falhando juntos, a tela
      // dizia "Nenhum push saiu" e, logo abaixo, "O push saiu".
      //
      // Nenhum teste prendia esse texto, entao a frase falsa sobreviveu a
      // uma revisao de contexto limpo. Agora prende.
      const descricoesDeAviso = (
        toast.warning as ReturnType<typeof vi.fn>
      ).mock.calls.map((chamada: any[]) => chamada[1]?.description ?? "");
      for (const texto of [...mensagensDeAviso, ...descricoesDeAviso]) {
        expect(texto).not.toMatch(/push saiu/i);
        expect(texto).not.toMatch(/se o push chegar/i);
      }
    });
  });

  it("histórico com recipient_count > 0 continua dizendo que chegou, e conta 'aparelhos' (singular certo)", async () => {
    estadoDoBanco.historico = [
      {
        id: "h2",
        title: "Campanha ok",
        body: "Um aparelho recebeu",
        url: "/",
        recipient_count: 1,
        sent_at: new Date().toISOString(),
      },
    ];
    await abrirTela();

    expect(texto()).toContain("1 aparelho");
    expect(texto()).not.toContain("1 clientes");
    expect(texto()).not.toContain("1 aparelhos");
    expect(texto()).not.toContain("Não confirmada");
  });
});
