// @vitest-environment jsdom
//
// Painel simples, onda J (J4) — Clientes no celular de 360px:
//   - o número de "Pedidos" do cartão compacto fica DENTRO do cartão (a linha
//     de baixo é uma grade `minmax(0,1fr)_auto`: o rótulo do total cede, o
//     número não é empurrado para fora);
//   - o tipo de conta aparece em português na lista e na ficha, nunca o valor
//     cru do banco ("customer");
//   - o menu diz "Ver ficha do cliente" e a ficha fala "carrinho"/"itens".
import { act } from "react";
import type { ReactNode } from "react";
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

import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";
import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";

const h = vi.hoisted(() => ({
  modo: "compact" as "compact" | "detailed",
  // O que a RPC da ficha devolve; cada teste da ficha ajusta.
  papelDaFicha: "customer",
  linhasDoCarrinho: [{ product_id: "p-1", quantity: 3 }] as Array<{
    product_id: string;
    quantity: number;
  }>,
}));

// Nomes SEM as palavras "Cliente"/"Administrador": o texto do selo de papel
// não pode ser confundido com o nome da pessoa.
const NOME_DA_FICHA = "Marina Souza";

function conta(
  id: string,
  nome: string,
  role: string,
  ordens: number,
  gasto: number,
) {
  return {
    id,
    email: `${id}@teste.com`,
    full_name: nome,
    phone: null,
    role,
    created_at: "2026-08-01T00:00:00Z",
    orders_count: ordens,
    total_spent: gasto,
    last_order_date: null,
  };
}

// Um de cada papel que o CHECK do banco aceita.
const clientes = [
  conta("a1", "Paulo Lima", "customer", 3, 150.5),
  conta("a2", "Rita Gomes", "admin", 0, 0),
  conta("a3", "Caio Alves", "gerente", 1, 20),
  conta("a4", "Tania Reis", "vendedor", 2, 40),
];

const PAPEL_ESPERADO_POR_NOME: ReadonlyArray<readonly [string, string]> = [
  ["Paulo Lima", "Cliente"],
  ["Rita Gomes", "Administrador"],
  ["Caio Alves", "Gerente"],
  ["Tania Reis", "Vendedor"],
];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome === "get_admin_customers_paged") {
        return Promise.resolve({
          data: {
            data: clientes,
            total_count: 4,
            stats: {
              total_customers: 4,
              global_ltv: 150.5,
              global_orders: 3,
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
            full_name: NOME_DA_FICHA,
            role: h.papelDaFicha,
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: h.linhasDoCarrinho.map((l, i) => ({
            id: `ci-${i}`,
            product_id: l.product_id,
            quantity: l.quantity,
            created_at: "2026-09-01T00:00:00Z",
          })),
          addresses: [],
        },
        error: null,
      });
    },
    from: () => ({
      select: () => {
        const resposta = Promise.resolve({ data: [], error: null });
        return Object.assign(resposta, {
          in: () => resposta,
          eq: () => resposta,
          order: () => resposta,
        });
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
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: vi.fn(),
    prefetchImage: vi.fn(),
  }),
}));
// Os itens do menu renderizam sempre (sem abrir o dropdown por pointer).
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

let AdminCustomersView: typeof TipoClientes;
let AdminUserDetailView: typeof TipoFicha;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
}, 60_000);

describe("Clientes no celular (J4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.papelDaFicha = "customer";
    h.linhasDoCarrinho = [{ product_id: "p-1", quantity: 3 }];
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    // O modo é lido na montagem da tela (depois do `beforeEach`): o
    // `getItem` consulta `h.modo` na hora, não uma cópia feita aqui.
    vi.stubGlobal("localStorage", {
      getItem: (c: string) =>
        c === "admin_customers_view_mode" ? h.modo : null,
      setItem: () => {},
      removeItem: () => {},
    });
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

  async function abrirLista() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch sai de um timer de 320 ms dentro da tela.
    await act(async () => {
      await esperar(500);
    });
  }

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

  /** O selo de papel de CADA linha da lista, achado pelo nome da pessoa
   * (o `h4` e o selo dividem o mesmo contêiner nos dois modos). */
  function selosPorNome(): Map<string, string> {
    const mapa = new Map<string, string>();
    for (const h4 of hospedeiro.querySelectorAll("h4")) {
      const selo = h4.parentElement?.querySelector('[data-slot="badge"]');
      if (selo) mapa.set(h4.textContent?.trim() ?? "", selo.textContent ?? "");
    }
    return mapa;
  }

  it("(a) a lista compacta mostra o papel EXATO de cada linha, em português", async () => {
    h.modo = "compact";
    await abrirLista();

    const selos = selosPorNome();
    for (const [nome, papel] of PAPEL_ESPERADO_POR_NOME) {
      expect(selos.get(nome), nome).toBe(papel);
    }
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/customer/i);
    expect(texto).not.toMatch(/\badmin\b/);
  });

  it("(a) o modo detalhado também mostra o papel exato de cada linha", async () => {
    h.modo = "detailed";
    await abrirLista();

    const selos = selosPorNome();
    for (const [nome, papel] of PAPEL_ESPERADO_POR_NOME) {
      expect(selos.get(nome), nome).toBe(papel);
    }
    expect(hospedeiro.textContent ?? "").not.toMatch(/customer/i);
  });

  it("(b) a linha de baixo do cartão compacto empilha no celular e vira par a partir de xs", async () => {
    h.modo = "compact";
    await abrirLista();

    // Sobe do rótulo "Total já comprado" (span > coluna > linha de KPIs).
    const rotuloTotal = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Total já comprado",
    );
    expect(rotuloTotal).toBeDefined();
    const linha = rotuloTotal!.parentElement?.parentElement;
    // Abaixo de 480px: uma coluna só ("Total já comprado" não quebra no meio
    // da palavra); de `xs` para cima volta ao par lado a lado.
    expect(linha?.className).toContain("grid-cols-1");
    expect(linha?.className).toContain("xs:grid-cols-[minmax(0,1fr)_auto]");
    expect(linha?.className).toContain("xs:items-end");

    expect(rotuloTotal!.className).not.toContain("tracking-[0.2em]");
    expect(rotuloTotal!.className).toContain("tracking-wide");
    expect(rotuloTotal!.className).toContain("break-words");
    expect(rotuloTotal!.className).toContain("min-w-0");

    // O número de "Pedidos" continua DENTRO do mesmo cartão, ao lado do
    // rótulo (primeira linha: 3 pedidos).
    const rotuloPedidos = [...linha!.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === "Pedidos",
    );
    expect(rotuloPedidos).toBeDefined();
    const cartao = linha!.closest('[role="button"]');
    expect(cartao).not.toBeNull();
    expect(cartao!.contains(rotuloPedidos!)).toBe(true);
    expect(rotuloPedidos!.nextElementSibling?.textContent?.trim()).toBe("3");
    expect(cartao!.contains(rotuloPedidos!.nextElementSibling)).toBe(true);
  });

  it("o menu diz 'Ver ficha do cliente' e não mais 'Ver Perfil Elite'", async () => {
    h.modo = "compact";
    await abrirLista();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Ver ficha do cliente");
    expect(texto).not.toContain("Perfil Elite");
  });

  /** O selo de papel da ficha: está no mesmo contêiner do nome (CardTitle). */
  function seloDaFicha(): string | undefined {
    const titulo = [
      ...hospedeiro.querySelectorAll('[data-slot="card-title"]'),
    ].find((t) => t.textContent?.trim() === NOME_DA_FICHA);
    return titulo?.parentElement?.querySelector('[data-slot="badge"]')
      ?.textContent;
  }

  async function abrirAbaCarrinho() {
    const aba = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Carrinho"),
    );
    expect(aba).toBeDefined();
    await act(async () => {
      // Radix troca a aba no mousedown, não no click.
      aba!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      aba!.click();
      await esperar(20);
    });
  }

  it("(c) a ficha de um administrador mostra 'Administrador' no selo, e não 'Cliente'", async () => {
    h.papelDaFicha = "admin";
    await abrirFicha();

    expect(seloDaFicha()).toBe("Administrador");
    expect(hospedeiro.textContent ?? "").not.toMatch(/\badmin\b/);
  });

  it("(c) a ficha de um cliente mostra 'Cliente' no selo, nunca o valor cru", async () => {
    h.papelDaFicha = "customer";
    await abrirFicha();

    expect(seloDaFicha()).toBe("Cliente");
    expect(hospedeiro.textContent ?? "").not.toMatch(/customer/i);
  });

  it("(c) a aba do carrinho fala 'carrinho' e conta produtos, no singular", async () => {
    h.papelDaFicha = "customer";
    // Uma linha com quantidade 3: a aba diz "1 produto" (linhas); o resumo do
    // topo é quem conta unidades ("3 itens").
    h.linhasDoCarrinho = [{ product_id: "p-1", quantity: 3 }];
    await abrirFicha();
    await abrirAbaCarrinho();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Carrinho do cliente");
    expect(texto).toContain("O que está no carrinho agora");
    expect(texto).toContain("1 produto");
    expect(texto).not.toContain("1 produtos");
    expect(texto).not.toContain("estrutura de checkout");
    expect(texto).not.toContain("Elementos");
    expect(texto).not.toContain("Auditoria de Carrinho");
  });

  it("(c) com duas linhas no carrinho a aba diz '2 produtos'", async () => {
    h.papelDaFicha = "customer";
    h.linhasDoCarrinho = [
      { product_id: "p-1", quantity: 1 },
      { product_id: "p-2", quantity: 1 },
    ];
    await abrirFicha();
    await abrirAbaCarrinho();

    expect(hospedeiro.textContent ?? "").toContain("2 produtos");
  });
});
