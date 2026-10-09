import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";
import type { AdminQAView as TipoPerguntas } from "@/views/admin/AdminQAView";
import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";
// @vitest-environment jsdom
//
// Painel simples, onda 3 — "resto do jargão" das telas de lista: Clientes,
// Ficha do cliente e Perguntas (Produtos tem a prova no teste da margem, que
// monta a tela com o hook de produtos dublado). O assunto aqui é o que a
// lojista LÊ: "LTV", "Role", "Ticket Médio", "Q&A" e "SAC" saem; entram os
// termos do glossário (src/lib/glossario-do-painel.ts). Só texto: a
// ordenação, os números e o payload continuam os de antes.
//
// Duas coisas deixam de ser só texto e por isso têm prova própria:
//   - o botão "Contato Direto" da Ficha passa a usar `linkWhatsappDoCliente`
//     (antes: com menos de 10 dígitos abria um link quebrado);
//   - o cartão "Conversão Comercial" de Perguntas sai (nasceu vazio, sem
//     métrica real), e a fileira fica com os três cartões medidos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const h = vi.hoisted(() => ({
  chamadasRpc: [] as Array<{ nome: string; args: any }>,
  whatsapp: "(11) 98888-7777" as string | null,
  statsDasPerguntas: {
    status: "ok",
    total: 12,
    pending: 5,
    answered: 7,
    rate: 58,
  } as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: any) => {
      h.chamadasRpc.push({ nome, args });
      if (nome === "get_admin_customers_paged") {
        return Promise.resolve({
          data: {
            data: [
              {
                id: "cli-1",
                email: "cliente@teste.com",
                full_name: "Cliente Teste",
                phone: "34999999999",
                role: "customer",
                created_at: new Date().toISOString(),
                orders_count: 3,
                total_spent: 150.5,
                last_order_date: new Date().toISOString(),
              },
            ],
            total_count: 1,
            stats: {
              total_customers: 2,
              global_ltv: 300,
              global_orders: 5,
              new_customers_30d: 0,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: h.whatsapp,
          },
          orders: [],
          cart_items: [],
          addresses: [],
        },
        error: null,
      });
    },
    from: () => ({
      select: () => {
        const resposta = Promise.resolve({ data: [], error: null });
        return Object.assign(resposta, { in: () => resposta });
      },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
  cachedQAStats: null,
  setCachedQAStats: vi.fn(),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: () => Promise.resolve({ questions: [], total: 0 }),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: () => Promise.resolve(h.statsDasPerguntas),
  }),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// O `await import()` de cada tela custa segundos; feito aqui, uma vez, não
// vira flakiness de timeout dentro de cada `it`.
let AdminCustomersView: typeof TipoClientes;
let AdminUserDetailView: typeof TipoFicha;
let AdminQAView: typeof TipoPerguntas;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
  ({ AdminQAView } = await import("@/views/admin/AdminQAView"));
}, 60_000);

describe("telas de lista na língua da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.chamadasRpc.length = 0;
    h.whatsapp = "(11) 98888-7777";
    h.statsDasPerguntas = {
      status: "ok",
      total: 12,
      pending: 5,
      answered: 7,
      rate: 58,
    };
    // Clientes só desenha os cabeçalhos clicáveis no modo "detailed".
    const armazem = new Map<string, string>([
      ["admin_customers_view_mode", "detailed"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const textoDaTela = () => hospedeiro.textContent ?? "";
  /** Texto E atributos (title, aria-label) de tudo que está no documento. */
  const marcacaoDoDocumento = () => document.body.innerHTML;

  // ---- Clientes ------------------------------------------------------------

  async function abrirClientes() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch da lista sai de um timer de 320 ms dentro da view.
    await act(async () => {
      await esperar(400);
    });
  }

  const botaoPorTexto = (trecho: string): HTMLElement => {
    const achado = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find((el) => (el.textContent ?? "").includes(trecho));
    if (!achado) throw new Error(`"${trecho}" não está na tela`);
    return achado;
  };

  it("Clientes: cabeçalhos, chip e cartões sem LTV, Role nem Ticket Médio", async () => {
    await abrirClientes();

    const tela = textoDaTela();
    expect(tela).toContain("Contato / Tipo de conta");
    expect(tela).toContain("Total já comprado");
    expect(tela).toContain("Valor médio por venda");
    expect(tela).not.toMatch(/\bLTV\b/);
    expect(tela).not.toMatch(/\bRole\b/);
    expect(tela).not.toMatch(/Ticket M[ée]dio/i);
  });

  it("Clientes: 'Total já comprado' ordena do maior para o menor já no primeiro clique", async () => {
    await abrirClientes();
    await act(async () => {
      botaoPorTexto("Total já comprado").click();
      await esperar(400);
    });

    expect(h.chamadasRpc.at(-1)?.args).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
  });

  // ---- Ficha do cliente ----------------------------------------------------

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const botaoContatoDireto = (): HTMLButtonElement => {
    const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Contato Direto"),
    );
    if (!achado) throw new Error('"Contato Direto" não está na tela');
    return achado;
  };

  it("Ficha: os cartões do resumo falam 'Total já comprado' e 'Valor médio por venda'", async () => {
    await abrirFicha();

    const tela = textoDaTela();
    expect(tela).toContain("Total já comprado");
    expect(tela).toContain("Valor médio por venda");
    expect(tela).not.toMatch(/\bLTV\b/);
    expect(tela).not.toMatch(/Ticket M[ée]dio/i);
  });

  it("Ficha: o WhatsApp de (11) 98888-7777 abre wa.me/5511988887777", async () => {
    const abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    await abrirFicha();

    const botao = botaoContatoDireto();
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
    });

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0]?.[0]).toBe("https://wa.me/5511988887777");
  });

  it("Ficha: número com 4 dígitos deixa o botão desabilitado e não abre link quebrado", async () => {
    h.whatsapp = "1234";
    const abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    await abrirFicha();

    const botao = botaoContatoDireto();
    expect(botao.disabled).toBe(true);
    await act(async () => {
      botao.click();
    });
    expect(abrir).not.toHaveBeenCalled();
  });

  // ---- Perguntas -----------------------------------------------------------

  async function abrirPerguntas() {
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar(0);
    });
  }

  it("Perguntas: três cartões medidos, sem 'Conversão Comercial'", async () => {
    await abrirPerguntas();

    const tela = textoDaTela();
    expect(tela).toContain("Dúvidas Pendentes");
    expect(tela).toContain("Taxa de Resposta");
    expect(tela).toContain("Total de Perguntas");
    expect(tela).not.toContain("Conversão Comercial");
    expect(tela).not.toContain("Respostas Ajudam a Vender");
  });

  it("Perguntas: nem a tela nem a ajuda dizem 'Q&A' ou 'SAC'", async () => {
    await abrirPerguntas();
    // `match` (e não `not.toMatch`): em caso de falha o relatório mostra o
    // trecho achado, não a marcação inteira do documento.
    const jargao = /.{0,30}(?:Q&(?:amp;)?A|\bSAC\b).{0,30}/;
    expect(marcacaoDoDocumento().match(jargao)?.[0]).toBeUndefined();

    const ajuda = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.getAttribute("title") ?? "").startsWith("Guia"),
    );
    expect(ajuda).toBeDefined();
    await act(async () => {
      ajuda!.click();
      await esperar(0);
    });

    // O modal entra por portal em document.body.
    expect(document.body.textContent).toContain("Dúvidas Pendentes");
    expect(marcacaoDoDocumento().match(jargao)?.[0]).toBeUndefined();
  });
});
