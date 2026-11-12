// @vitest-environment jsdom
//
// A lojista volta ao app e o Início relê os números em silêncio. Se essa releitura
// falha (a rede ainda não voltou, ou passou dos 20 s), os números de antes ficam na
// tela de propósito, sem a faixa vermelha. Só que o selo do cabeçalho continuava
// dizendo "Ao vivo · conectado" em verde por cima de números de horas atrás, e ela
// achava que tinha vendido menos do que vendeu. Agora o selo diz "Sem atualizar" (sem
// apagar os números e sem a faixa) e volta a "Ao vivo" quando uma releitura dá certo.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chamadasPainel: 0,
  // Como o banco responde ao painel_inicio.
  modo: "ok" as "ok" | "erro" | "rejeita" | "pendura",
  ultimo: null as null | {
    painel: unknown;
    erro: string | null;
    desatualizado: boolean;
    carregando: boolean;
    atualizar: () => Promise<void>;
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) => {
      if (nome !== "painel_inicio") {
        return Promise.resolve({ data: null, error: null });
      }
      h.chamadasPainel += 1;
      if (h.modo === "rejeita") return Promise.reject(new Error("rede caiu"));
      if (h.modo === "pendura") return new Promise(() => undefined);
      if (h.modo === "erro") {
        return Promise.resolve({
          data: null,
          error: { message: "Failed to fetch" },
        });
      }
      return Promise.resolve({ data: {}, error: null });
    }),
    channel: vi.fn(() => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: (status?: (status: string) => void) => {
          status?.("SUBSCRIBED");
          return canal;
        },
      };
      return canal;
    }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { originCep: "12345-678", storeName: "Loja" },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, profile: null }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const UMA_HORA_MS = 60 * 60 * 1000;

function definirVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: estado,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Início — releitura silenciosa que falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  /** O texto do selo de conexão do cabeçalho (a região de status que o contém). */
  function selo(): string {
    const regioes = Array.from(hospedeiro.querySelectorAll('[role="status"]'));
    const dele = regioes.find((r) =>
      /Ao vivo|Sem atualizar|Atualizando|Sem internet/.test(
        r.textContent ?? "",
      ),
    );
    return dele?.textContent ?? "";
  }

  async function abrirInicio() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () =>
      raiz.render(
        createElement(AdminDashboardView, {
          active: true,
          onNavigate: vi.fn(),
        }),
      ),
    );
    await passar(500);
  }

  async function sondarOHook() {
    const modulo = await import("@/hooks/usePainelInicio");
    function Sonda() {
      const estado = modulo.usePainelInicio(true);
      h.ultimo = {
        painel: estado.painel,
        erro: estado.erro,
        desatualizado: estado.desatualizado,
        carregando: estado.carregando,
        atualizar: estado.atualizar,
      };
      return null;
    }
    await act(async () => raiz.render(createElement(Sonda)));
    await passar(500);
  }

  async function voltarAoApp() {
    definirVisibilidade("hidden");
    await passar(8 * UMA_HORA_MS);
    definirVisibilidade("visible");
    await passar(25_000); // inclui o prazo de 20 s da busca que fica pendurada
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Meio-dia em São Paulo, fixo: o "Hoje" também muda com a virada do dia.
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    h.chamadasPainel = 0;
    h.modo = "ok";
    h.ultimo = null;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("controle: com a leitura boa o selo diz 'Ao vivo'", async () => {
    await abrirInicio();
    expect(selo()).toContain("Ao vivo");
    expect(selo()).not.toContain("Sem atualizar");
  });

  it.each(["erro", "rejeita", "pendura"] as const)(
    "a releitura ao voltar falha (%s): o selo diz 'Sem atualizar', não 'Ao vivo', e a faixa vermelha não volta",
    async (modo) => {
      await abrirInicio();
      expect(selo()).toContain("Ao vivo");

      h.modo = modo;
      await voltarAoApp();

      expect(h.chamadasPainel).toBe(2); // tentou de verdade
      expect(selo()).toContain("Sem atualizar");
      expect(selo()).not.toContain("Ao vivo");
      // O comentário do hook evita a faixa vermelha de propósito: só o selo muda.
      expect(hospedeiro.textContent).not.toContain(
        "Não foi possível ler os números",
      );
    },
  );

  it("os números de antes seguem na tela, sem erro e sem esqueleto, enquanto o selo avisa", async () => {
    await sondarOHook();
    const antes = h.ultimo?.painel;
    expect(antes).not.toBeNull();
    expect(h.ultimo?.desatualizado).toBe(false);

    h.modo = "erro";
    await voltarAoApp();

    expect(h.ultimo?.painel).toBe(antes); // o mesmo retrato, não apagado
    expect(h.ultimo?.erro).toBeNull(); // sem a faixa vermelha
    expect(h.ultimo?.carregando).toBe(false);
    expect(h.ultimo?.desatualizado).toBe(true); // mas o selo é avisado
  });

  it("uma releitura que dá certo depois volta o selo para 'Ao vivo'", async () => {
    await abrirInicio();
    h.modo = "erro";
    await voltarAoApp();
    expect(selo()).toContain("Sem atualizar");

    h.modo = "ok";
    await voltarAoApp();

    expect(h.chamadasPainel).toBe(3);
    expect(selo()).toContain("Ao vivo");
    expect(selo()).not.toContain("Sem atualizar");
  });

  it("o botão Sincronizar (leitura pedida por ela) que dá certo também limpa o aviso", async () => {
    await sondarOHook();
    h.modo = "erro";
    await voltarAoApp();
    expect(h.ultimo?.desatualizado).toBe(true);

    h.modo = "ok";
    await act(async () => {
      await h.ultimo?.atualizar();
    });

    expect(h.ultimo?.desatualizado).toBe(false);
    expect(h.ultimo?.erro).toBeNull();
  });
});
