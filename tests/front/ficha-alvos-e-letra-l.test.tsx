// @vitest-environment jsdom
//
// Painel simples, onda L (L3) — alvos de toque e letra da ficha do cliente:
//   - as 4 abas (Pedidos/Carrinho/Endereços/Voz do Cliente) têm `min-h-11`;
//   - os botões de copiar e-mail e telefone têm `min-h-11 min-w-11`, `type="button"`
//     e nome acessível igual ao `title`;
//   - o botão do código do cliente (copia o ID) tem `min-h-11`;
//   - a aba "Voz do Cliente" não tem texto abaixo de 11px.
// O jsdom não aplica CSS: a prova de toque é sobre a classe; a medida real é do
// render.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê o fonte da própria aba (caminho constante deste teste, não entrada de usuário); regex constante, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Marina Souza",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: () => {
      const resposta = Promise.resolve({ data: [], error: null });
      return {
        select: () =>
          Object.assign(resposta, {
            in: () => resposta,
            eq: () => resposta,
            order: () => resposta,
          }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    functions: {
      invoke: () => Promise.resolve({ data: { success: true }, error: null }),
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { executive: { totalOrders: 3, avgTicket: 120 } },
    fetchExecutiveSummary: vi.fn(),
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: vi.fn(),
    prefetchImage: vi.fn(),
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

let AdminUserDetailView: typeof TipoFicha;

beforeAll(async () => {
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
}, 60_000);

const classesDe = (el: Element | undefined | null) =>
  (el?.className ?? "").toString().split(/\s+/);

const fonteDaVoz = () =>
  readFileSync(
    join(__dirname, "..", "..", "src/components/admin/users/VozClienteTab.tsx"),
    "utf8",
  );

describe("ficha do cliente — alvos de 44px (onda L)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("as 4 abas da ficha têm min-h-11 e mantêm os rótulos curtos", async () => {
    await abrirFicha();

    const abas = [...hospedeiro.querySelectorAll('[role="tab"]')];
    expect(abas).toHaveLength(4);
    for (const rotulo of ["Ped.", "Carr.", "End.", "Voz"]) {
      const aba = abas.find((a) => a.textContent?.includes(rotulo));
      expect(aba, `aba ${rotulo}`).toBeDefined();
      expect(classesDe(aba), `aba ${rotulo}`).toContain("min-h-11");
    }
  });

  it("copiar e-mail e copiar telefone têm min-h-11 min-w-11, type=button e nome", async () => {
    await abrirFicha();

    for (const nome of ["Copiar e-mail", "Copiar telefone"]) {
      const botao = hospedeiro.querySelector(`button[title="${nome}"]`);
      expect(botao, nome).not.toBeNull();
      expect(classesDe(botao), nome).toContain("min-h-11");
      expect(classesDe(botao), nome).toContain("min-w-11");
      expect(botao?.getAttribute("type"), nome).toBe("button");
      expect(botao?.getAttribute("aria-label"), nome).toBe(nome);
    }
  });

  it("o botão do código do cliente (copia o ID) tem min-h-11", async () => {
    await abrirFicha();

    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "cliente-1",
    );
    expect(botao, "botão do código").toBeDefined();
    expect(classesDe(botao)).toContain("min-h-11");
  });
});

describe("Voz do cliente — letra e toque (onda L)", () => {
  it("a aba não tem texto abaixo de 11px", () => {
    const pequenos = fonteDaVoz().match(
      /text-\[(?:[0-9]|10)(?:\.[0-9]+)?px\]/g,
    );
    expect(pequenos).toBeNull();
  });

  it("o botão 'Tentar novamente' da aba tem min-h-11", () => {
    const fonte = fonteDaVoz();
    const fim = fonte.indexOf("Tentar novamente");
    expect(fim).toBeGreaterThan(0);
    const trecho = fonte.slice(fonte.lastIndexOf("<button", fim), fim);
    expect(trecho).toContain("min-h-11");
  });
});
