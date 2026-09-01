import { useNotificationCenter } from "@/contexts/NotificationContextCore";
// @vitest-environment jsdom
//
// "Marcar todas como lidas" zerava o sino, e o aviso voltava.
//
// Uma campanha para "Todos os Clientes" (AdminPushView.tsx) grava UMA linha
// só em `notificacoes`, com `usuario_id: null` — toda cliente vê a mesma
// linha. As policies de UPDATE e DELETE de `notificacoes`
// (supabase/migrations/20260806000000_baseline_do_schema_vivo.sql) exigem
// `auth.uid() = usuario_id`, e essa linha não tem dono nenhum: o Postgrest
// ignora a linha, SEM erro (0 linhas afetadas é sucesso, não falha). O
// `markAllAsRead` antigo não conferia isso — ele fazia o UPDATE (que não
// tocava a linha de campanha) e, MESMO ASSIM, marcava TODAS as notificações
// como lidas no estado local, inclusive a de campanha. Ao recarregar o app,
// o banco continuava dizendo `lida: false` para aquela linha, e ela voltava
// como não lida. Sempre.
//
// O conserto (opção (a) do plano): como marcar de verdade no banco é
// impossível para uma linha sem dono, a leitura desse tipo de aviso passa a
// ser guardada localmente, por usuário, e combinada com o que o banco diz
// na hora de montar a lista — a leitura vale de verdade NESTE aparelho, e
// sobrevive a um recarregamento.
//
// POR QUE O FALSO NEGATIVO DO BANCO NÃO ENGANA ESTE TESTE: o dublê de
// `supabase.from("notificacoes")` simula a policy de verdade — o UPDATE só
// muda `lida` na linha se `usuario_id` bater com o usuário logado — em vez
// de um mock ingênuo que aceita qualquer update. Sem essa réplica da RLS, o
// teste passaria com a implementação antiga, porque o mock "funcionaria"
// mesmo quando o banco real não funciona.
//
// POR QUE useLeaderElection É MOCADO: o hook real usa BroadcastChannel e
// localStorage para eleição de aba líder — ruído para um teste sobre
// persistência de leitura. Fixar `isLeader: false` evita que o Provider
// tente assinar `postgres_changes` (que exigiria mocar `supabase.channel`
// também) sem mudar o que está em julgamento aqui.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USUARIA = { id: "cliente-1" };

// Tabela falsa em memória — o "banco". `usuario_id: null` é a linha de
// campanha; `usuario_id: USUARIA.id` é um aviso pessoal, para o controle.
const { tabela } = vi.hoisted(() => ({
  tabela: {
    linhas: [] as {
      id: string;
      usuario_id: string | null;
      titulo: string;
      mensagem: string;
      tipo: string;
      lida: boolean;
      created_at: string;
      acao: null;
      dados: null;
    }[],
  },
}));

// Só as três colunas que os .eq() do contexto realmente usam. Um `switch`
// explícito em vez de acesso dinâmico (`linha[coluna]`) evita o
// `security/detect-object-injection` do eslint — mesmo padrão de
// `admin-push-envio-honesto.test.tsx` (indexar por MemberExpression, nunca
// por Identifier isolado).
function valorDaColuna(
  linha: (typeof tabela.linhas)[number],
  coluna: string,
): unknown {
  switch (coluna) {
    case "id":
      return linha.id;
    case "usuario_id":
      return linha.usuario_id;
    case "lida":
      return linha.lida;
    default:
      return undefined;
  }
}

function construirEncadeamentoDeUpdate(patch: Record<string, unknown>) {
  const filtros: [string, unknown][] = [];
  const encadeamento: {
    eq: (coluna: string, valor: unknown) => typeof encadeamento;
    then?: (
      resolve: (v: { error: null }) => void,
      reject?: (e: unknown) => void,
    ) => Promise<void>;
  } = {
    eq(coluna: string, valor: unknown) {
      filtros.push([coluna, valor]);
      return encadeamento;
    },
  };
  // O query builder do Supabase É thenable por desenho — é isso que faz
  // `await supabase.from(...).update(...).eq(...)` funcionar sem um
  // `.execute()`. O mock precisa desta propriedade para imitar o objeto
  // real (mesmo padrão de admin-layout-cracha-pedidos-pendentes.test.tsx).
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase, ver acima
  encadeamento.then = (resolve, reject) => {
    // Espelha notificacoes_update_policy: só a dona da linha (aqui, sem
    // is_admin) tem o UPDATE aplicado — igual ao banco real, uma linha
    // que a policy barra NÃO gera erro, só fica de fora.
    for (const linha of tabela.linhas) {
      const passaFiltros = filtros.every(
        ([coluna, valor]) => valorDaColuna(linha, coluna) === valor,
      );
      if (!passaFiltros) continue;
      if (linha.usuario_id !== USUARIA.id) continue;
      Object.assign(linha, patch);
    }
    return Promise.resolve({ error: null }).then(resolve, reject);
  };
  return encadeamento;
}

function construirEncadeamentoDeDelete() {
  const filtros: [string, unknown][] = [];
  const encadeamento: {
    eq: (coluna: string, valor: unknown) => typeof encadeamento;
    then?: (
      resolve: (v: { error: null }) => void,
      reject?: (e: unknown) => void,
    ) => Promise<void>;
  } = {
    eq(coluna: string, valor: unknown) {
      filtros.push([coluna, valor]);
      return encadeamento;
    },
  };
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase, ver construirEncadeamentoDeUpdate
  encadeamento.then = (resolve, reject) => {
    // Espelha notificacoes_delete_policy: mesma exigência de dono.
    tabela.linhas = tabela.linhas.filter((linha) => {
      const passaFiltros = filtros.every(
        ([coluna, valor]) => valorDaColuna(linha, coluna) === valor,
      );
      if (!passaFiltros) return true;
      return linha.usuario_id !== USUARIA.id;
    });
    return Promise.resolve({ error: null }).then(resolve, reject);
  };
  return encadeamento;
}

// Trocavel para o caso das DUAS contas no mesmo aparelho: o estado de campanha
// e guardado localmente, e a chave carrega o id da pessoa. Sem um caso com
// duas, tirar o `${userId}` da chave passa despercebido -- e ai a segunda a
// entrar herda o "ja li" da primeira.
let usuarioLogado: { id: string } = USUARIA;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (nomeDaTabela: string) => {
      if (nomeDaTabela !== "notificacoes") {
        throw new Error(`tabela inesperada no mock: ${nomeDaTabela}`);
      }
      return {
        select: () => {
          // Laudo 0109 (A9): o contexto consulta em DUAS pontas — avisos
          // próprios (.eq usuario_id) e campanha (.is usuario_id null) —
          // cada uma com o seu `.limit`. O mock resolve cada ponta com as
          // linhas que o banco devolveria para aquele filtro (a policy de
          // SELECT continua valendo nas duas).
          const linhasDoFiltro = (filtro: "proprias" | "campanha") =>
            tabela.linhas
              .filter((l) =>
                filtro === "proprias"
                  ? l.usuario_id === USUARIA.id
                  : l.usuario_id === null,
              )
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
              )
              .slice(0, 50);
          const comOrdenacao = (filtro: "proprias" | "campanha") => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: linhasDoFiltro(filtro), error: null }),
            }),
          });
          return {
            eq: (_coluna: string, valor: unknown) =>
              comOrdenacao(valor === USUARIA.id ? "proprias" : "campanha"),
            is: (_coluna: string, valor: unknown) =>
              comOrdenacao(valor === null ? "campanha" : "proprias"),
          };
        },
        update: (patch: Record<string, unknown>) =>
          construirEncadeamentoDeUpdate(patch),
        delete: () => construirEncadeamentoDeDelete(),
      };
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class BroadcastChannelStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

// Componente-sonda: expõe o contexto de notificação em atributos/data-*
// legíveis pelo teste, sem precisar renderizar NotificationsView inteira —
// este arquivo é sobre o CONTRATO do contexto (persistência da leitura),
// não sobre a tela.
function Sonda() {
  const {
    notifications,
    unreadCount,
    markAllAsRead,
    markAsRead,
    deleteNotification,
  } = useNotificationCenter();

  return (
    <div>
      <span data-testid="nao-lidas">{unreadCount}</span>
      <ul>
        {notifications.map((n: any) => (
          <li key={n.id} data-testid={`notif-${n.id}`} data-lida={n.read}>
            {n.title}
          </li>
        ))}
      </ul>
      <button type="button" data-testid="marcar-todas" onClick={markAllAsRead}>
        Marcar todas como lidas
      </button>
      <button
        type="button"
        data-testid="marcar-campanha"
        onClick={() => markAsRead("campanha-1")}
      >
        Marcar campanha
      </button>
      <button
        type="button"
        data-testid="marcar-pessoal"
        onClick={() => markAsRead("pessoal-1")}
      >
        Marcar pessoal
      </button>
      <button
        type="button"
        data-testid="apagar-campanha"
        onClick={() => deleteNotification("campanha-1")}
      >
        Apagar campanha
      </button>
    </div>
  );
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("NotificationContext — marcar como lida não mente sobre o que o banco aceitou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    usuarioLogado = USUARIA;
    vi.stubGlobal("BroadcastChannel", BroadcastChannelStub);
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

    tabela.linhas = [
      {
        id: "campanha-1",
        usuario_id: null,
        titulo: "Loja em promoção",
        mensagem: "Para todos os clientes",
        tipo: "aviso",
        lida: false,
        created_at: new Date("2026-08-20T10:00:00Z").toISOString(),
        acao: null,
        dados: null,
      },
      {
        id: "pessoal-1",
        usuario_id: USUARIA.id,
        titulo: "Seu pedido saiu para entrega",
        mensagem: "Chega hoje",
        tipo: "aviso",
        lida: false,
        created_at: new Date("2026-08-21T10:00:00Z").toISOString(),
        acao: null,
        dados: null,
      },
    ];

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { NotificationProvider } = await import(
      "@/contexts/NotificationContext"
    );
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <Sonda />
        </NotificationProvider>,
      );
    });
    await act(async () => {
      await esperar(20);
    });
  }

  const lida = (id: string) =>
    hospedeiro
      .querySelector(`[data-testid="notif-${id}"]`)
      ?.getAttribute("data-lida");
  const naoLidas = () =>
    hospedeiro.querySelector('[data-testid="nao-lidas"]')?.textContent;

  it("a âncora: as duas notificações chegaram, e nenhuma está lida", async () => {
    await montar();

    expect(naoLidas()).toBe("2");
    expect(lida("campanha-1")).toBe("false");
    expect(lida("pessoal-1")).toBe("false");
  });

  it("'Marcar todas como lidas' zera o contador, e o aviso de campanha CONTINUA lido depois de recarregar o app", async () => {
    await montar();

    const botao = hospedeiro.querySelector(
      '[data-testid="marcar-todas"]',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(20);
    });

    // O sino zerou — é o que a tela promete ao clicar.
    expect(naoLidas()).toBe("0");
    expect(lida("campanha-1")).toBe("true");
    expect(lida("pessoal-1")).toBe("true");

    // O banco real NÃO marcou a linha de campanha — é a policy fazendo o
    // trabalho dela. Confirma que o "lido" acima não veio de o UPDATE ter
    // silenciosamente alcançado a linha (o que provaria só o mock, não a
    // correção).
    const linhaDeCampanha = tabela.linhas.find((l) => l.id === "campanha-1");
    expect(linhaDeCampanha?.lida).toBe(false);

    // A prova que importa: simular um "recarregar o app" — desmontar e
    // montar de novo, lendo o banco (que ainda diz `lida: false` para a
    // campanha) mais o que ficou salvo localmente. Antes do conserto, a
    // campanha voltava como não lida aqui.
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await montar();

    expect(naoLidas()).toBe("0");
    expect(lida("campanha-1")).toBe("true");
    expect(lida("pessoal-1")).toBe("true");
  });

  it("controle negativo: marcar como lido um aviso QUE É da própria cliente continua indo para o banco, e persiste", async () => {
    await montar();

    const botao = hospedeiro.querySelector(
      '[data-testid="marcar-pessoal"]',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(20);
    });

    expect(lida("pessoal-1")).toBe("true");
    // Diferente da campanha: esta é a dona da linha, o UPDATE alcança de
    // verdade — sem precisar de estado local nenhum.
    const linhaPessoal = tabela.linhas.find((l) => l.id === "pessoal-1");
    expect(linhaPessoal?.lida).toBe(true);
    expect(lida("campanha-1")).toBe("false");
  });

  it("dispensar (apagar) o aviso de campanha não apaga a linha de todo mundo — some só deste aparelho, e não volta", async () => {
    await montar();

    const botao = hospedeiro.querySelector(
      '[data-testid="apagar-campanha"]',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(20);
    });

    expect(
      hospedeiro.querySelector('[data-testid="notif-campanha-1"]'),
    ).toBeNull();

    // A linha continua existindo no banco — outras clientes ainda a veem.
    expect(tabela.linhas.some((l) => l.id === "campanha-1")).toBe(true);

    // "Recarregar o app": ela não pode voltar para ESTA cliente.
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await montar();

    expect(
      hospedeiro.querySelector('[data-testid="notif-campanha-1"]'),
    ).toBeNull();
    expect(naoLidas()).toBe("1"); // só o "pessoal-1" continua.
  });

  // Achado da revisao: a chave do armazenamento local carrega o id da pessoa
  // (`...:${userId}`), e NENHUM caso segurava isso -- o arquivo tinha uma conta
  // so. Tirar o `${userId}` passava nos oito, e ai a segunda pessoa a entrar no
  // MESMO aparelho herdaria o "ja li" da primeira: ela abriria o sino e o aviso
  // da loja ja estaria lido, sem ela nunca ter visto.
  it("outra conta no mesmo aparelho NAO herda o que a primeira leu", async () => {
    await montar();

    const botao = hospedeiro.querySelector(
      '[data-testid="marcar-todas"]',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(20);
    });
    expect(naoLidas()).toBe("0");

    // Sai a primeira, entra a segunda no mesmo aparelho -- o armazenamento
    // local NAO e limpo no logout de proposito (limpar reintroduziria o
    // defeito para quem sai e volta, que e o caso normal numa loja).
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    usuarioLogado = { id: "cliente-2" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await montar();

    // Para a segunda pessoa, a campanha e nova.
    expect(lida("campanha-1")).toBe("false");
  });
});
