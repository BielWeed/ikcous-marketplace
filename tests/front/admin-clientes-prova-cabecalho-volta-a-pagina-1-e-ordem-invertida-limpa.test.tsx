// @vitest-environment jsdom
//
// Prova forte da lista de Clientes do painel (25/11/2026, caça por mutação).
// Dois defeitos de uma linha que os testes vizinhos deixavam passar:
//   1. clicar no CABEÇALHO de uma coluna estando na página 2 ou 3 pedia a
//      ordem nova mas ficava na mesma página (os chips já voltavam à página 1);
//   2. depois de inverter a ordem pelo cabeçalho ("Total já comprado" duas
//      vezes = menor primeiro), a tela não oferecia "Limpar tudo", porque só
//      a COLUNA diferente do padrão contava como ordem escolhida, e a direção
//      invertida não.
// Mesmo molde de clientes-busca-ordem-e-paginas-chegam-certas-ao-servidor:
// a view de verdade, o servidor (`get_admin_customers_paged`) dublado, valores
// escritos à mão e só fixtures inventadas.
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

import { type Customer, limparCachesDeAdmin } from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cliente(id: string, nome: string): Customer {
  return {
    id,
    full_name: nome,
    email: `${id}@fixture.invalid`,
    phone: null,
    role: "customer",
    created_at: "2026-10-01T12:00:00Z",
    orders_count: 1,
    total_spent: 50,
  };
}

/** Resposta do servidor com `total` no recorte e as linhas pedidas. */
function resposta(total: number, nomes: string[] = ["Cliente de Teste"]) {
  return {
    data: {
      data: nomes.map((nome, i) => cliente(`cli-${i}`, nome)),
      total_count: total,
      stats: {
        total_customers: total,
        global_ltv: 1200,
        global_orders: 24,
        new_customers_30d: 0,
      },
    },
    error: null,
  };
}

let AdminCustomersView: typeof TipoClientes;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
}, 60_000);

describe("Clientes — cabeçalho de coluna e ordem invertida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    limparCachesDeAdmin();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // Os cabeçalhos clicáveis só existem no modo detalhado.
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) =>
        chave === "admin_customers_view_mode" ? "detailed" : null,
      setItem: () => {},
      removeItem: () => {},
    });
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    limparCachesDeAdmin();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    await avancar(320);
  }

  function cabecalho(rotulo: string): HTMLElement {
    const achado = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find((el) => (el.textContent ?? "").trim() === rotulo);
    if (!achado) throw new Error(`Cabeçalho "${rotulo}" não está na tela`);
    return achado;
  }

  async function tocarCabecalho(rotulo: string) {
    await act(async () => {
      cabecalho(rotulo).click();
    });
    await avancar(320);
  }

  function botaoPorTexto(texto: string): HTMLButtonElement {
    const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(texto),
    );
    if (!achado) throw new Error(`Botão "${texto}" não está na tela`);
    return achado;
  }

  function ultimosArgs() {
    return rpc.mock.calls.at(-1)?.[1];
  }

  async function irParaPagina2() {
    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({ p_page: 1 });
  }

  it.each([
    { rotulo: "Cliente", campo: "full_name", direcao: "asc" },
    { rotulo: "Pedidos", campo: "orders_count", direcao: "desc" },
    { rotulo: "Contato / Tipo de conta", campo: "role", direcao: "asc" },
  ])(
    "estando na página 2, clicar no cabeçalho '$rotulo' pede a ordem nova e volta para a página 1",
    async ({ rotulo, campo, direcao }) => {
      rpc.mockResolvedValue(resposta(30));
      await montar();
      await irParaPagina2();

      await tocarCabecalho(rotulo);

      expect(ultimosArgs()).toEqual({
        p_search: "",
        p_sort_field: campo,
        p_sort_direction: direcao,
        p_page: 0,
        p_page_size: 12,
      });
    },
  );

  it("o cabeçalho 'Total já comprado' clicado de novo (menor primeiro) na página 2 também volta para a página 1", async () => {
    rpc.mockResolvedValue(resposta(30));
    await montar();
    // 1º clique: continua "maior primeiro" (o padrão), sem mudar nada.
    await tocarCabecalho("Total já comprado");
    await irParaPagina2();

    // 2º clique: inverte a direção, e a lista recomeça da página 1.
    await tocarCabecalho("Total já comprado");

    expect(ultimosArgs()).toEqual({
      p_search: "",
      p_sort_field: "total_spent",
      p_sort_direction: "asc",
      p_page: 0,
      p_page_size: 12,
    });
  });

  it("com a ordem invertida pelo cabeçalho (menor total primeiro) e a lista vazia, a tela oferece 'Limpar tudo' e ele devolve a ordem padrão", async () => {
    rpc.mockResolvedValueOnce(resposta(1));
    await montar();
    expect(hospedeiro.textContent).not.toContain("Limpar tudo");

    rpc.mockResolvedValue(resposta(0, []));
    await tocarCabecalho("Total já comprado");
    await tocarCabecalho("Total já comprado");
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "asc",
    });
    expect(hospedeiro.textContent).toContain("Nenhum cliente ainda");
    expect(hospedeiro.textContent).toContain("Limpar tudo");

    rpc.mockResolvedValue(resposta(1));
    await act(async () => {
      botaoPorTexto("Limpar tudo").click();
    });
    await avancar(320);

    expect(ultimosArgs()).toEqual({
      p_search: "",
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
      p_page: 0,
      p_page_size: 12,
    });
    expect(hospedeiro.textContent).not.toContain("Limpar tudo");
  });
});
