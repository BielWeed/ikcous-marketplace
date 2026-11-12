// @vitest-environment jsdom
//
// Painel de clientes: um cadastro cujo nome é só espaço ou caractere invisível
// (U+200B) é "verdadeiro" para o `||` e impedia o "Usuário" de reserva — o
// título do cartão e da ficha ficava visualmente em branco. Agora a decisão é
// a de `nomeTemConteudoVisivel` (a mesma do resto do app) e o nome válido sai
// aparado. Os invisíveis entram por escape \uXXXX, nunca pelo caractere.
import { CartaoCliente } from "@/components/admin/users/CartaoCliente";
import type { Customer } from "@/utils/admin_cache";
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
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

const { estado } = vi.hoisted(() => ({
  estado: { profile: {} as Record<string, unknown> },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: estado.profile,
          orders: [],
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let TelaFicha: typeof TipoTelaFicha;

beforeAll(async () => {
  ({ AdminUserDetailView: TelaFicha } = await import(
    "@/views/admin/AdminUserDetailView"
  ));
});

function cliente(full_name: string): Customer {
  return {
    id: "c-1",
    full_name,
    email: "maria@exemplo.fixture.invalid",
    phone: null,
    role: "customer",
    created_at: "2026-02-07T12:00:00Z",
    orders_count: 0,
    total_spent: 0,
  };
}

const NOMES_SEM_CONTEUDO = [
  ["só espaços", "   "],
  ["U+200B (largura zero)", "\u200B"],
  ["espaços e U+200B", " \u200B  \u200B "],
] as const;

describe("nome invisível cai no 'Usuário' — cartão e ficha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function mostrarCartao(nome: string) {
    await act(async () => {
      raiz.render(
        <CartaoCliente
          customer={cliente(nome)}
          detalhado={true}
          onNavigate={vi.fn()}
          onPrefetch={vi.fn()}
        />,
      );
    });
    return {
      titulo: hospedeiro.querySelector("h4")?.textContent,
      rotuloDoMenu: hospedeiro
        .querySelector("button[aria-label^='Gestão de Cliente']")
        ?.getAttribute("aria-label"),
    };
  }

  async function mostrarFicha(nome: string) {
    estado.profile = {
      id: "cliente-1",
      full_name: nome,
      role: "customer",
      email: "maria@exemplo.fixture.invalid",
    };
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return [...hospedeiro.querySelectorAll("[data-slot='card-title']")].map(
      (el) => el.textContent,
    );
  }

  it.each(NOMES_SEM_CONTEUDO)(
    "cartão com nome %s: título e rótulo do menu dizem 'Usuário'",
    async (_rotulo, nome) => {
      const { titulo, rotuloDoMenu } = await mostrarCartao(nome);
      expect(titulo).toBe("Usuário");
      expect(rotuloDoMenu).toBe("Gestão de Cliente: Usuário");
    },
  );

  it.each(NOMES_SEM_CONTEUDO)(
    "ficha com nome %s: o título diz 'Usuário Não-Nomeado'",
    async (_rotulo, nome) => {
      expect(await mostrarFicha(nome)).toContain("Usuário Não-Nomeado");
    },
  );

  it("controle: nome normal com espaços nas pontas aparece aparado no cartão e na ficha", async () => {
    const { titulo, rotuloDoMenu } = await mostrarCartao("  Maria Souza  ");
    expect(titulo).toBe("Maria Souza");
    expect(rotuloDoMenu).toBe("Gestão de Cliente: Maria Souza");
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    const titulos = await mostrarFicha("  Maria Souza  ");
    expect(titulos).toContain("Maria Souza");
    expect(titulos).not.toContain("Usuário Não-Nomeado");
  });
});
