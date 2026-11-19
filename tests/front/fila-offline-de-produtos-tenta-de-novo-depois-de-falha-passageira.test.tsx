// @vitest-environment jsdom
//
// Irmão de fila-offline-de-pedidos-tenta-de-novo-depois-de-falha-passageira:
// a lojista muda preço/estoque de um produto sem internet; a rede volta e
// ESTÁVEL, mas na hora da passada o servidor responde 500 (ou estoura o
// tempo). O item voltava à fila com "Tentando novamente mais tarde" e NADA
// tentava de novo -- nenhum novo `online` acontece com a rede estável --, e o
// produto seguia com o preço/estoque antigo até a página recarregar ou o item
// vencer (72 h).
//
// Agora, ao fim de uma passada que deixou item na fila por falha, o hook marca
// nova passada com recuo crescente (30 s, 2 min, 10 min, teto de 10 min). É a
// mesma passada de sempre: sessão do dono antes de cada envio, UPDATE só com a
// versão-base do produto (`ultima_atualizacao`), 72 h, uma passada por vez.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  auth: { id: null as string | null, admin: true },
  // O que o cliente Supabase diz AGORA (`getSession`): sempre o dono, a rede
  // está boa -- a falha aqui é do SERVIDOR.
  sessaoId: null as string | null,
  // Respostas da sessão que saem ANTES de `sessaoId` (uma por leitura).
  sessoesSeguintes: [] as string[],
  atualizados: [] as { id: string; payload: any }[],
  // Quantas respostas de erro (500) ainda saem antes de o servidor aceitar.
  falhasRestantes: 0,
  // O erro que o servidor devolve enquanto `falhasRestantes` > 0.
  erroDoServidor: { message: "Internal Server Error", code: "500" } as {
    message: string;
    code?: string;
  },
  // Quando verdadeiro, o UPDATE só conclui quando alguém o chamar.
  segurar: false,
  segurarEnvio: null as null | { concluir: () => void },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mock.auth.id ? { id: mock.auth.id } : null,
    isAdmin: mock.auth.admin,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [
      {
        id: "prod-1",
        name: "Produto 1",
        updatedAt: "2026-10-01T10:00:00.000000+00:00",
      },
    ],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => row,
  mapVariantFromDB: (row: any) => row,
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "t"),
    dismiss: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (payload: any) => ({
        eq: (_coluna: string, id: string) => {
          mock.atualizados.push({ id, payload });
          const encadeado = {
            eq: () => encadeado,
            is: () => encadeado,
            select: () => {
              let resposta: { data: unknown; error: unknown } = {
                data: [{ id }],
                error: null,
              };
              if (mock.falhasRestantes > 0) {
                mock.falhasRestantes -= 1;
                resposta = { data: null, error: mock.erroDoServidor };
              }
              if (!mock.segurar) return Promise.resolve(resposta);
              return new Promise((resolve) => {
                mock.segurarEnvio = { concluir: () => resolve(resposta) };
              });
            },
          };
          return encadeado;
        },
      }),
    }),
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => {
        const id = mock.sessoesSeguintes.shift() ?? mock.sessaoId;
        return {
          data: { session: id ? { user: { id } } : null },
          error: null,
        };
      },
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_A = "products_offline_updates_queue:admin-a";
const CHAVE_B = "products_offline_updates_queue:admin-b";
const HORA = 60 * 60 * 1000;
const S = 1000;

let host: HTMLDivElement;
let raiz: Root;

function itemDe(id: string, updates: object) {
  return {
    id,
    updates,
    baseUpdatedAt: "2026-10-01T10:00:00.000000+00:00",
    timestamp: Date.now() - HORA,
  };
}

function fila(chave = CHAVE_A): any[] | null {
  const bruto = localStorage.getItem(chave);
  return bruto === null ? null : JSON.parse(bruto);
}

// UMA função de componente só: renderizar de novo com ela é re-render (o usuário
// do contexto mudou), não desmonte e montagem de outro componente.
let Sonda: () => null;

async function montar() {
  if (!Sonda) {
    const { useProducts } = await import("@/hooks/useProducts");
    Sonda = () => {
      useProducts({ autoFetch: true });
      return null;
    };
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("fila offline de produtos — tenta de novo depois de falha passageira", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.auth.id = "admin-a";
    mock.auth.admin = true;
    mock.sessaoId = "admin-a";
    mock.sessoesSeguintes.length = 0;
    mock.atualizados.length = 0;
    mock.falhasRestantes = 0;
    mock.erroDoServidor = { message: "Internal Server Error", code: "500" };
    mock.segurar = false;
    mock.segurarEnvio = null;
    localStorage.clear();
    localStorage.setItem(
      CHAVE_A,
      JSON.stringify([itemDe("prod-1", { price: 19.9 })]),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const t of [
      toast.loading,
      toast.success,
      toast.error,
      toast.info,
      toast.warning,
      toast.dismiss,
    ]) {
      vi.mocked(t).mockClear();
    }
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    localStorage.clear();
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("500 na passada: a edição fica, e passados 30 s a nova passada a envia (silenciosa) e esvazia a fila", async () => {
    mock.falhasRestantes = 1;

    await montar();
    await passar(1 * S); // a passada da montagem (1 s)

    expect(mock.atualizados).toHaveLength(1);
    expect(fila()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Antes dos 30 s (+ 1 s da passada agendada) nada acontece.
    await passar(30 * S);
    expect(mock.atualizados).toHaveLength(1);

    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(2);
    expect(fila()).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
    // A nova tentativa não pisca "Sincronizando…" outra vez.
    expect(toast.loading).toHaveBeenCalledTimes(1);

    // Fila vazia: o relógio acabou, nenhuma passada nova.
    await passar(60 * 60 * S);
    expect(mock.atualizados).toHaveLength(2);
  });

  it("envia a edição que entrou durante o envio e só anuncia sucesso com a fila vazia", async () => {
    mock.segurar = true;
    await montar();
    await passar(S);
    expect(mock.atualizados.map(({ id }) => id)).toEqual(["prod-1"]);

    // O segundo produto entra enquanto a primeira gravação ainda está em voo.
    const novo = itemDe("prod-2", { price: 25 });
    localStorage.setItem(CHAVE_A, JSON.stringify([...(fila() ?? []), novo]));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(S);
    });
    expect(mock.atualizados).toHaveLength(1);

    await act(async () => {
      mock.segurarEnvio?.concluir();
    });
    expect(fila()).toEqual([novo]);
    expect(toast.success).not.toHaveBeenCalled();

    await passar(S);
    expect(mock.atualizados.map(({ id }) => id)).toEqual(["prod-1", "prod-2"]);
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      mock.segurarEnvio?.concluir();
    });
    expect(fila()).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("mantém no recuo a edição nova que sempre falha, sem anunciar que tudo foi enviado", async () => {
    mock.segurar = true;
    await montar();
    await passar(S);

    const veneno = itemDe("prod-2", { price: 25 });
    localStorage.setItem(CHAVE_A, JSON.stringify([...(fila() ?? []), veneno]));
    mock.falhasRestantes = 99;
    mock.segurar = false;
    await act(async () => {
      mock.segurarEnvio?.concluir();
    });
    await passar(S);
    expect(mock.atualizados.map(({ id }) => id)).toEqual(["prod-1", "prod-2"]);
    expect(fila()).toEqual([veneno]);
    expect(toast.success).not.toHaveBeenCalled();

    // O item que falhou não é novo: antes do recuo, não volta a ser enviado.
    await passar(31 * S - 1);
    expect(mock.atualizados).toHaveLength(2);
    await passar(1);
    expect(mock.atualizados).toHaveLength(3);
    expect(fila()).toEqual([veneno]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("falha que persiste: o recuo cresce (30 s, 2 min, 10 min) e fica em 10 min", async () => {
    mock.falhasRestantes = 99;

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);

    await passar(31 * S - 1);
    expect(mock.atualizados).toHaveLength(1);
    await passar(1);
    expect(mock.atualizados).toHaveLength(2);

    await passar(121 * S - 1);
    expect(mock.atualizados).toHaveLength(2);
    await passar(1);
    expect(mock.atualizados).toHaveLength(3);

    await passar(601 * S - 1);
    expect(mock.atualizados).toHaveLength(3);
    await passar(1);
    expect(mock.atualizados).toHaveLength(4);
    await passar(601 * S - 1);
    expect(mock.atualizados).toHaveLength(4);
    await passar(1);
    expect(mock.atualizados).toHaveLength(5);

    expect(fila()).toHaveLength(1);
  });

  it("depois de a edição entrar, a fila esvazia e o relógio para: o servidor que volta a responder encerra o ciclo", async () => {
    mock.falhasRestantes = 2;

    await montar();
    await passar(1 * S);
    await passar(31 * S);
    expect(mock.atualizados).toHaveLength(2);
    expect(fila()).toHaveLength(1);

    await passar(121 * S);
    expect(mock.atualizados).toHaveLength(3);
    expect(fila()).toBeNull();

    await passar(2 * HORA);
    expect(mock.atualizados).toHaveLength(3);
  });

  it("a fila foi esvaziada por outro caminho (outra aba enviou): a nova tentativa acha a fila vazia e o relógio PARA de vez", async () => {
    mock.falhasRestantes = 99;
    // Cada passada começa conferindo `navigator.onLine`: é o que conta quantas
    // passadas houve (a espiã é a mesma do `beforeEach`).
    const leituraDaRede = vi.spyOn(window.navigator, "onLine", "get");
    const passadas = () => leituraDaRede.mock.calls.length;

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);

    // A outra aba enviou a edição e limpou a fila.
    localStorage.removeItem(CHAVE_A);
    await passar(31 * S);
    const passadasAteAqui = passadas();
    // A espiã enxerga as passadas (senão a conta abaixo seria 0 === 0).
    expect(passadasAteAqui).toBeGreaterThan(0);
    expect(mock.atualizados).toHaveLength(1);

    // Sem falha na passada que achou a fila vazia, nada mais é marcado: nenhuma
    // passada nova em horas.
    await passar(3 * HORA);
    expect(passadas()).toBe(passadasAteAqui);
    expect(mock.atualizados).toHaveLength(1);
  });

  it.each([
    ["23505", "duplicate key value violates unique constraint"],
    ["23502", "null value in column violates not-null constraint"],
    ["23514", "new row violates check constraint"],
    ["42501", "new row violates row-level security policy"],
  ])(
    "erro PERMANENTE do banco (%s): a edição é descartada com aviso e NÃO há nova tentativa",
    async (code, message) => {
      mock.falhasRestantes = 99;
      mock.erroDoServidor = { message, code };
      localStorage.setItem(
        CHAVE_A,
        JSON.stringify([
          {
            ...itemDe("prod-1", { price: 19.9 }),
            productName: "Camiseta azul",
          },
        ]),
      );

      await montar();
      await passar(1 * S);

      expect(mock.atualizados).toHaveLength(1);
      // Saiu da fila (tentar de novo não conserta) e a lojista foi avisada, com
      // o nome do produto; nenhum "Tentando novamente mais tarde".
      expect(fila()).toBeNull();
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain(
        "Camiseta azul",
      );
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();

      await passar(3 * HORA);
      expect(mock.atualizados).toHaveLength(1);
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("erro de tempo esgotado do banco (57014, sem código de classe 23 nem 42501) segue passageiro: a edição fica e é retentada", async () => {
    mock.falhasRestantes = 1;
    mock.erroDoServidor = {
      message: "canceling statement due to statement timeout",
      code: "57014",
    };

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);
    expect(fila()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledTimes(1);

    await passar(31 * S);
    expect(mock.atualizados).toHaveLength(2);
    expect(fila()).toBeNull();
  });

  it("a passada que parou porque a sessão NÃO é do dono (conta trocada) não marca nova tentativa", async () => {
    mock.sessaoId = "admin-b";

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(0);
    expect(fila()).toHaveLength(1);

    await passar(2 * HORA);
    expect(mock.atualizados).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falha num item e a CONTA TROCA antes do seguinte: passada interrompida não marca nova tentativa (e o segundo item não sai com o login de B)", async () => {
    localStorage.setItem(
      CHAVE_A,
      JSON.stringify([
        itemDe("prod-1", { price: 19.9 }),
        itemDe("prod-2", { price: 5 }),
      ]),
    );
    mock.falhasRestantes = 99;
    // A sessão é conferida antes de CADA envio: no primeiro item é a do dono,
    // no segundo já é de outro usuário (e depois volta a ser a do dono, para
    // que uma nova tentativa, se existisse, ENVIASSE).
    mock.sessoesSeguintes.push("admin-a", "admin-b");

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);
    expect(fila()).toHaveLength(2);

    await passar(2 * HORA);
    expect(mock.atualizados).toHaveLength(1);
  });

  it("sair da tela cancela a nova tentativa marcada", async () => {
    mock.falhasRestantes = 99;

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);

    act(() => {
      raiz.unmount();
    });
    await passar(2 * HORA);

    expect(mock.atualizados).toHaveLength(1);
    expect(fila()).toHaveLength(1);
    // o afterEach desmonta de novo: recria a raiz para não duplicar.
    raiz = createRoot(host);
  });

  it("sair da tela com a passada AINDA em voo: o fim dela não marca nova tentativa", async () => {
    mock.falhasRestantes = 99;
    mock.segurar = true;

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);

    act(() => {
      raiz.unmount();
    });
    await act(async () => {
      mock.segurarEnvio?.concluir();
      await vi.advanceTimersByTimeAsync(0);
    });
    mock.segurar = false;
    await passar(2 * HORA);

    expect(mock.atualizados).toHaveLength(1);
    raiz = createRoot(host);
  });

  it("trocar de usuário cancela a nova tentativa do ANTERIOR: a fila de A fica intacta e nada sai", async () => {
    mock.falhasRestantes = 99;

    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);

    // O tablet passa para B (fila vazia). A sessão do cliente segue a de A de
    // propósito: assim a trava de troca de conta NÃO esconde uma nova
    // tentativa de A que sobrasse -- só o cancelamento do relógio a impede.
    mock.auth.id = "admin-b";
    await montar();
    await passar(2 * HORA);

    expect(mock.atualizados).toHaveLength(1);
    expect(fila(CHAVE_A)).toHaveLength(1);
    expect(fila(CHAVE_B)).toBeNull();
  });

  it("`online` e a nova tentativa marcada caindo JUNTOS enviam uma vez só por rodada (passadas não se sobrepõem)", async () => {
    mock.falhasRestantes = 1;
    await montar();
    await passar(1 * S);
    expect(mock.atualizados).toHaveLength(1);

    // O envio da próxima passada fica pendurado.
    mock.segurar = true;

    // A nova tentativa marcada dispara em t = 31 s (30 s de recuo + 1 s da
    // passada agendada); um `online` logo antes agenda outra no MESMO segundo.
    await passar(30 * S - 1);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(2 * S);
    });
    // As duas passadas dispararam com a primeira ainda em voo: um envio só.
    expect(mock.atualizados).toHaveLength(2);

    mock.segurar = false;
    await act(async () => {
      mock.segurarEnvio?.concluir();
      await vi.advanceTimersByTimeAsync(1 * S);
    });
    expect(mock.atualizados).toHaveLength(2);
    expect(fila()).toBeNull();
  });
});
