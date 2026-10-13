// @vitest-environment jsdom
//
// L10 da auditoria de segurança (12/10/2026), irmão de
// useorders-fila-offline-e-do-usuario-que-gravou.test.tsx — agora para a fila
// offline de PRODUTOS: preço, estoque, nome. Num tablet de balcão, a edição que
// o admin A gravou sem rede ia ao banco com o login do admin B que entrasse
// depois.
//
// Desenho (decisão da hub após crítica de desenho): a CHAVE é por usuário —
// `products_offline_updates_queue:<uid>` —, não um carimbo dentro de uma
// chave compartilhada. Isto resolve, de uma vez, o que o carimbo não
// resolvia: o item novo de B para o MESMO produto não herda o preço que A
// deixou pendente (as alterações do mesmo produto se juntam DENTRO da fila do
// dono), e a fila de A não vira "falha para sempre" na conta de B.
// Antes de CADA envio confere-se que a sessão ainda é a do dono; item com mais
// de 72 h não é enviado (produto grava valor ABSOLUTO — estoque de 30 dias
// atrás por cima do de hoje corrompe o estoque); a fila ANTIGA só migra para
// um admin CONFIRMADO (a atualização de produto por não-admin dá 0 linhas SEM
// erro e o código a contaria como sincronizada).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  // O que o CONTEXTO de auth diz (uid de guardar e de enviar, e `isAdmin`).
  auth: { id: null as string | null, admin: true },
  // O que o cliente Supabase diz AGORA (`getSession`), conferido antes de
  // cada envio.
  sessao: { id: null as string | null },
  atualizados: [] as { id: string; payload: any }[],
  erroNoUpdate: null as unknown,
  aoAtualizar: null as null | (() => void),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mock.auth.id ? { id: mock.auth.id } : null,
    isAdmin: mock.auth.admin,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
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
          mock.aoAtualizar?.();
          return Promise.resolve({ error: mock.erroNoUpdate });
        },
      }),
    }),
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => ({
        data: {
          session: mock.sessao.id ? { user: { id: mock.sessao.id } } : null,
        },
      }),
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "products_offline_updates_queue";
const chaveDe = (uid: string) => `${BASE}:${uid}`;
const HORA = 60 * 60 * 1000;

let host: HTMLDivElement;
let raiz: Root;
let onLine: ReturnType<typeof vi.spyOn>;

function itemDe(id: string, updates: object, idadeMs = HORA) {
  return { id, updates, timestamp: Date.now() - idadeMs };
}

function filaDe(uid: string): any[] | null {
  const bruto = localStorage.getItem(chaveDe(uid));
  return bruto === null ? null : JSON.parse(bruto);
}

function guardarFila(uid: string, itens: unknown[]) {
  localStorage.setItem(chaveDe(uid), JSON.stringify(itens));
}

function entrarComo(uid: string | null, admin = true) {
  mock.auth.id = uid;
  mock.auth.admin = admin;
  mock.sessao.id = uid;
}

function idsEnviados(): string[] {
  return mock.atualizados.map((a) => a.id);
}

async function sincronizar(userId: string) {
  const { _syncOfflineUpdatesParaTeste } = await import("@/hooks/useProducts");
  return _syncOfflineUpdatesParaTeste(userId);
}

async function montar() {
  const { useProducts } = await import("@/hooks/useProducts");
  let api: ReturnType<typeof useProducts> | undefined;
  function Sonda() {
    const retorno = useProducts({ autoFetch: false });
    useEffect(() => {
      api = retorno;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  return () => api as ReturnType<typeof useProducts>;
}

function limparArmazem() {
  for (const chave of Object.keys(localStorage)) {
    if (chave.startsWith(BASE)) localStorage.removeItem(chave);
  }
}

describe("fila offline de produtos — uma chave por usuário", () => {
  beforeEach(() => {
    entrarComo(null);
    mock.atualizados.length = 0;
    mock.erroNoUpdate = null;
    mock.aoAtualizar = null;
    limparArmazem();
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const t of [toast.warning, toast.error, toast.success, toast.info]) {
      vi.mocked(t).mockClear();
    }
    onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    limparArmazem();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("envio", () => {
    it("a fila de A NÃO é enviada com a sessão de B: a passada de B só olha a chave de B", async () => {
      const deA = itemDe("prod-1", { name: "Do A" });
      guardarFila("admin-a", [deA]);
      entrarComo("admin-b");

      await sincronizar("admin-b");

      expect(mock.atualizados).toHaveLength(0);
      expect(filaDe("admin-a")).toEqual([deA]);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("quando A volta, só o dele é enviado e a fila dele esvazia", async () => {
      guardarFila("admin-a", [itemDe("prod-1", { name: "Do A" })]);
      entrarComo("admin-a");

      await sincronizar("admin-a");

      expect(idsEnviados()).toEqual(["prod-1"]);
      expect(filaDe("admin-a")).toBeNull();
    });

    it("as filas coexistem: B envia a dele e a de A fica, sem aviso de falha para sempre", async () => {
      const deA = itemDe("prod-1", { name: "Do A" });
      guardarFila("admin-a", [deA]);
      guardarFila("admin-b", [itemDe("prod-2", { name: "Do B" })]);
      entrarComo("admin-b");

      await sincronizar("admin-b");

      expect(idsEnviados()).toEqual(["prod-2"]);
      expect(filaDe("admin-b")).toBeNull();
      expect(filaDe("admin-a")).toEqual([deA]);
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("a sessão é conferida antes de CADA envio: troca no meio encerra, o que saiu sai da fila e o resto fica", async () => {
      const primeiro = itemDe("prod-a1", { name: "1" });
      const segundo = itemDe("prod-a2", { name: "2" });
      guardarFila("admin-a", [primeiro, segundo]);
      entrarComo("admin-a");
      // A sessão do cliente vira B assim que o primeiro envio acontece.
      mock.aoAtualizar = () => {
        mock.sessao.id = "admin-b";
      };

      await sincronizar("admin-a");

      expect(idsEnviados()).toEqual(["prod-a1"]);
      expect(filaDe("admin-a")).toEqual([segundo]);
      expect(filaDe("admin-b")).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("a sessão já é outra quando a passada ia começar: nenhum envio, fila intacta", async () => {
      const deA = itemDe("prod-1", { name: "Do A" });
      guardarFila("admin-a", [deA]);
      mock.auth.id = "admin-a";
      mock.sessao.id = "admin-b";

      await sincronizar("admin-a");

      expect(mock.atualizados).toHaveLength(0);
      expect(filaDe("admin-a")).toEqual([deA]);
    });
  });

  describe("validade: 72 h", () => {
    it("item velho NÃO é enviado, é descartado com aviso; o recente sai", async () => {
      guardarFila("admin-a", [
        itemDe("prod-velho", { stock: 30 }, 73 * HORA),
        itemDe("prod-novo", { stock: 3 }),
      ]);
      entrarComo("admin-a");

      await sincronizar("admin-a");

      expect(idsEnviados()).toEqual(["prod-novo"]);
      expect(filaDe("admin-a")).toBeNull();
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
        "1 alteração offline antiga foi descartada",
      );
    });

    it("só itens velhos: nada é enviado e a fila some", async () => {
      guardarFila("admin-a", [
        itemDe("prod-1", { stock: 1 }, 100 * HORA),
        itemDe("prod-2", { stock: 2 }, 200 * HORA),
      ]);
      entrarComo("admin-a");

      await sincronizar("admin-a");

      expect(mock.atualizados).toHaveLength(0);
      expect(filaDe("admin-a")).toBeNull();
      expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
        "2 alterações offline antigas foram descartadas",
      );
    });

    it("item sem timestamp numérico não prova a própria idade: não é enviado (valor absoluto)", async () => {
      guardarFila("admin-a", [{ id: "prod-1", updates: { stock: 5 } }]);
      entrarComo("admin-a");

      await sincronizar("admin-a");

      expect(mock.atualizados).toHaveLength(0);
      expect(filaDe("admin-a")).toBeNull();
      expect(toast.warning).toHaveBeenCalledTimes(1);
    });
  });

  describe("fila ANTIGA (chave sem :<uid>)", () => {
    const legado = () => itemDe("prod-legado", { stock: 4 });

    async function comHook(uid: string, admin: boolean) {
      vi.useFakeTimers();
      entrarComo(uid, admin);
      await montar();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
    }

    it("admin CONFIRMADO: migra para a chave dele e envia; a chave antiga some", async () => {
      localStorage.setItem(BASE, JSON.stringify([legado()]));

      await comHook("admin-b", true);

      expect(idsEnviados()).toEqual(["prod-legado"]);
      expect(localStorage.getItem(BASE)).toBeNull();
      expect(filaDe("admin-b")).toBeNull();
    });

    it("cliente (não admin): a chave antiga fica INTOCADA e nada é enviado (0 linhas sem erro apagaria a escrita)", async () => {
      const item = legado();
      localStorage.setItem(BASE, JSON.stringify([item]));

      await comHook("cliente-1", false);

      expect(mock.atualizados).toHaveLength(0);
      expect(JSON.parse(localStorage.getItem(BASE) ?? "null")).toEqual([item]);
      expect(filaDe("cliente-1")).toBeNull();
    });

    it("admin com falha: o item migrado fica na chave DELE, a antiga some", async () => {
      const item = legado();
      localStorage.setItem(BASE, JSON.stringify([item]));
      mock.erroNoUpdate = { message: "Failed to fetch" };

      await comHook("admin-b", true);

      expect(localStorage.getItem(BASE)).toBeNull();
      expect(filaDe("admin-b")).toEqual([item]);
    });
  });

  describe("gravação offline (updateProduct) e o efeito 'online' do hook", () => {
    it("grava na chave do usuário; o preço que A deixou pendente NÃO vaza para o item de B", async () => {
      onLine.mockReturnValue(false);
      const deA = itemDe("prod-1", { price: 10 });
      guardarFila("admin-a", [deA]);
      entrarComo("lojista-1");
      const api = await montar();

      await act(async () => {
        await api().updateProduct("prod-1", { stock: 5 });
      });

      expect(filaDe("admin-a")).toEqual([deA]);
      const minha = filaDe("lojista-1") ?? [];
      expect(minha).toHaveLength(1);
      expect(minha[0]).toMatchObject({ id: "prod-1", updates: { stock: 5 } });
      expect(minha[0].updates).not.toHaveProperty("price");
      expect(minha[0]).not.toHaveProperty("userId");
      expect(localStorage.getItem(BASE)).toBeNull();
    });

    it("regravar o mesmo produto pelo mesmo usuário funde com o item dele (sem duplicar)", async () => {
      onLine.mockReturnValue(false);
      entrarComo("lojista-1");
      const api = await montar();

      await act(async () => {
        await api().updateProduct("prod-1", { stock: 5 });
      });
      await act(async () => {
        await api().updateProduct("prod-1", { price: 12 });
      });

      const fila = filaDe("lojista-1") ?? [];
      expect(fila).toHaveLength(1);
      expect(fila[0]).toMatchObject({ updates: { stock: 5, price: 12 } });
    });

    it("SEM uid: não guarda nada, recusa com aviso", async () => {
      onLine.mockReturnValue(false);
      entrarComo(null);
      const api = await montar();

      await act(async () => {
        await api().updateProduct("prod-1", { stock: 5 });
      });

      expect(
        Object.keys(localStorage).filter((c) => c.startsWith(BASE)),
      ).toEqual([]);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.info).not.toHaveBeenCalled();
    });

    it("ao voltar a rede, o hook envia só a fila da sessão ativa e guarda a do outro", async () => {
      vi.useFakeTimers();
      const deA = itemDe("prod-1", { name: "Do A" });
      guardarFila("admin-a", [deA]);
      guardarFila("admin-b", [itemDe("prod-2", { name: "Do B" })]);
      entrarComo("admin-b");
      await montar();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(idsEnviados()).toEqual(["prod-2"]);
      expect(filaDe("admin-a")).toEqual([deA]);
    });

    it("sem sessão o hook não envia nada", async () => {
      vi.useFakeTimers();
      const deA = itemDe("prod-1", { name: "Do A" });
      guardarFila("admin-a", [deA]);
      entrarComo(null);
      await montar();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(mock.atualizados).toHaveLength(0);
      expect(filaDe("admin-a")).toEqual([deA]);
    });

    it("sair da tela antes de 1 s cancela o envio agendado (o temporizador não sobrevive ao desmonte)", async () => {
      vi.useFakeTimers();
      guardarFila("admin-a", [itemDe("prod-1", { name: "Do A" })]);
      entrarComo("admin-a");
      await montar();
      act(() => {
        raiz.unmount();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(mock.atualizados).toHaveLength(0);
      expect(filaDe("admin-a")).toHaveLength(1);
      // o afterEach desmonta de novo: recria a raiz para não duplicar.
      raiz = createRoot(host);
    });
  });
});
