// @vitest-environment jsdom
//
// Quando o carregamento do Início falha e não há retrato nenhum, o gráfico de
// 14 dias dizia "Sem vendas registradas nos últimos 14 dias" — uma afirmação
// sobre a loja que ninguém conferiu (o erro estava só no aviso lá em cima).
// Com erro, o gráfico diz que não conseguiu carregar; sem vendas de verdade
// (retrato que chegou, série vazia) segue dizendo "Sem vendas".
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  resposta: { data: null, error: null } as {
    data: unknown;
    error: unknown;
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) =>
      Promise.resolve(
        nome === "painel_inicio" ? h.resposta : { data: null, error: null },
      ),
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
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

const FALHOU = "Não consegui carregar as vendas dos últimos 14 dias.";
const SEM_VENDAS = "Sem vendas registradas nos últimos 14 dias.";

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarAte: não aconteceu em ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("SerieDe14Dias — a peça sozinha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("falhou: diz que não conseguiu carregar e NÃO diz que não houve vendas", async () => {
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={[]} carregando={false} falhou />),
    );
    expect(hospedeiro.textContent).toContain(FALHOU);
    expect(hospedeiro.textContent).not.toContain("Sem vendas registradas");
  });

  it("falhou: o total do cabeçalho vira '—', nunca R$ 0,00", async () => {
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={[]} carregando={false} falhou />),
    );
    expect(hospedeiro.querySelector("p[aria-live]")?.textContent).toBe("—");
  });

  it("controle: série vazia SEM falha segue dizendo que não houve vendas", async () => {
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={[]} carregando={false} />),
    );
    expect(hospedeiro.textContent).toContain(SEM_VENDAS);
    expect(hospedeiro.textContent).not.toContain("Não consegui");
  });

  it("controle: ainda carregando, mostra o esqueleto (nem aviso de erro, nem 'sem vendas')", async () => {
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={[]} carregando falhou={false} />),
    );
    expect(hospedeiro.textContent).not.toContain("Não consegui");
    expect(hospedeiro.textContent).not.toContain("Sem vendas registradas");
  });

  it("falhou, mas a série velha ainda está em mãos: o gráfico aparece, sem a frase de erro", async () => {
    const serie = Array.from({ length: 14 }, (_, i) => ({
      dia: `2026-10-${String(i + 1).padStart(2, "0")}`,
      receita: i,
    }));
    await act(async () =>
      raiz.render(<SerieDe14Dias serie={serie} carregando={false} falhou />),
    );
    expect(
      hospedeiro.querySelectorAll('[data-testid="serie-14d-coluna"]'),
    ).toHaveLength(14);
    expect(hospedeiro.textContent).not.toContain(FALHOU);
  });
});

describe("Início — a fiação do erro até o gráfico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // O cache do Início é de módulo: cada teste parte de um módulo novo.
    vi.resetModules();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrirInicio() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
    });
  }

  it("painel_inicio falhou: o gráfico diz que não conseguiu carregar", async () => {
    h.resposta = { data: null, error: { message: "boom" } };
    await abrirInicio();
    await esperarAte(() => hospedeiro.textContent?.includes(FALHOU) ?? false);
    expect(hospedeiro.textContent).not.toContain("Sem vendas registradas");
  });

  it("painel_inicio chegou sem vendas: o gráfico diz que não houve vendas", async () => {
    h.resposta = { data: {}, error: null };
    await abrirInicio();
    await esperarAte(
      () => hospedeiro.textContent?.includes(SEM_VENDAS) ?? false,
    );
    expect(hospedeiro.textContent).not.toContain(FALHOU);
  });
});
