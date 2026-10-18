// @vitest-environment jsdom
// Sem o aviso e a chave da consulta, a falha mostra vazio ou outra busca.
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

import type { Customer } from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));
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
    email: `${id}@example.com`,
    phone: null,
    role: "customer",
    created_at: "2026-10-01T12:00:00Z",
    orders_count: 1,
    total_spent: 50,
  };
}

function sucesso(clientes: Customer[], total = clientes.length) {
  return {
    data: {
      data: clientes,
      total_count: total,
      stats: {
        total_customers: 24,
        global_ltv: 1200,
        global_orders: 24,
        new_customers_30d: 0,
      },
    },
    error: null,
  };
}

const falha = { data: null, error: { message: "Falha simulada" } };
let AdminCustomersView: typeof TipoClientes;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
}, 60_000);

describe("Clientes — falha de leitura não vira vazio nem resultado de outra consulta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function abrirTela() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    await avancar(320);
  }

  function botao(rotulo: string) {
    const encontrado = Array.from(hospedeiro.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === rotulo,
    );
    if (!encontrado) throw new Error(`Botão não encontrado: ${rotulo}`);
    return encontrado;
  }

  async function clicar(rotulo: string) {
    await act(async () => botao(rotulo).click());
  }

  async function buscarMaria() {
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#customers-search");
    const atribuir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!campo || !atribuir) throw new Error("Campo de busca não encontrado");
    await act(async () => {
      atribuir.call(campo, "Maria");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // O campo tem 300 ms de debounce; a consulta espera outros 320 ms.
    await avancar(300);
    await avancar(320);
    return campo;
  }

  function esperarFalhaSemResultadoAntigo() {
    expect(hospedeiro.querySelector("[data-barra-de-busca]")).not.toBeNull();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os clientes agora.",
    );
    expect(botao("Tentar de novo").disabled).toBe(false);
    expect(botao("Tentar de novo").getAttribute("aria-label")).toBe(
      "Tentar carregar os clientes de novo",
    );
    expect(hospedeiro.textContent).toContain("Falha ao atualizar clientes");
    expect(hospedeiro.textContent).not.toContain(
      "contas no app · Sincronizado",
    );
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente retornado");
    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(
      hospedeiro.querySelector('[data-testid="paginacao-admin"]'),
    ).toBeNull();
  }

  it("na primeira leitura com falha, oferece nova tentativa sem afirmar que não há clientes", async () => {
    rpc.mockResolvedValueOnce(falha);

    await abrirTela();

    esperarFalhaSemResultadoAntigo();
    const metricas = hospedeiro.querySelector(
      'section[aria-label="Métricas de Clientes"]',
    )!;
    expect(metricas.querySelector('[role="status"]')?.textContent).toContain(
      "Aguardando métricas",
    );
    expect(
      [...metricas.querySelectorAll("h3")].map((el) => el.textContent),
    ).toEqual(["—", "—", "—", "—"]);
  });

  it.each(["compact", "detailed"] as const)(
    "busca Maria falha após carregar a lista: oculta clientes e total anteriores no modo %s",
    async (modo) => {
      vi.stubGlobal("localStorage", {
        getItem: (chave: string) =>
          chave === "admin_customers_view_mode" ? modo : null,
        setItem: () => {},
        removeItem: () => {},
      });
      rpc.mockResolvedValueOnce(sucesso([cliente("joao", "João Silva")], 24));
      rpc.mockResolvedValueOnce(falha);
      await abrirTela();
      expect(hospedeiro.textContent).toContain("João Silva");
      expect(
        hospedeiro.querySelector('[data-testid="paginacao-admin"]'),
      ).not.toBeNull();

      const campo = await buscarMaria();

      expect(campo.value).toBe("Maria");
      esperarFalhaSemResultadoAntigo();
    },
  );

  it("Tentar de novo repete a busca e remove o aviso quando ela carrega", async () => {
    rpc.mockResolvedValueOnce(sucesso([cliente("joao", "João Silva")], 24));
    rpc.mockResolvedValueOnce(falha);
    await abrirTela();
    const campo = await buscarMaria();
    esperarFalhaSemResultadoAntigo();
    let concluir: (resposta: ReturnType<typeof sucesso>) => void = () => {
      throw new Error("Nova tentativa ainda não foi iniciada");
    };
    rpc.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof sucesso>>((resolve) => {
          concluir = resolve;
        }),
    );

    await clicar("Tentar de novo");
    expect(botao("Tentar de novo").disabled).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => concluir(sucesso([cliente("maria", "Maria Souza")])));

    expect(campo.value).toBe("Maria");
    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente retornado");
    expect(
      hospedeiro.querySelector('[data-testid="paginacao-admin"]')?.textContent,
    ).toContain("Exibindo 1 - 1 de 1");
    expect(rpc).toHaveBeenLastCalledWith(
      "get_admin_customers_paged",
      expect.objectContaining({ p_search: "Maria", p_page: 0 }),
    );
  });

  it.each(["Próximo", "A–Z"])(
    "falha ao mudar %s não reapresenta a consulta anterior",
    async (rotulo) => {
      rpc.mockResolvedValueOnce(sucesso([cliente("joao", "João Silva")], 24));
      rpc.mockResolvedValueOnce(falha);
      await abrirTela();

      await clicar(rotulo);
      await avancar(320);

      esperarFalhaSemResultadoAntigo();
    },
  );

  it("leitura bem-sucedida sem clientes continua mostrando o estado vazio", async () => {
    rpc.mockResolvedValueOnce(sucesso([]));

    await abrirTela();

    expect(hospedeiro.textContent).toContain("Nenhum cliente retornado");
    expect(hospedeiro.textContent).toContain(
      "Revise os filtros ou sua pesquisa.",
    );
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
  });

  it("folha mantém as três ordenações, e limpar no vazio restaura busca e ordem sem mudar o modo", async () => {
    rpc.mockResolvedValue(sucesso([]));
    await abrirTela();
    const filtros = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Filtros"]',
    )!;
    await act(async () => filtros.click());
    const folha = document.querySelector('[role="dialog"]')!;
    expect(folha.querySelector("legend")?.textContent).toBe("Ordenar por");
    expect(
      [...folha.querySelectorAll("button[aria-pressed]")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["Maior total comprado", "Mais pedidos", "A–Z"]);
    const alfabetica = [
      ...folha.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent === "A–Z")!;
    await act(async () => alfabetica.click());
    await avancar(320);
    expect(rpc).toHaveBeenLastCalledWith(
      "get_admin_customers_paged",
      expect.objectContaining({
        p_sort_field: "full_name",
        p_sort_direction: "asc",
        p_page: 0,
      }),
    );
    await act(async () =>
      folha
        .querySelector<HTMLButtonElement>('[aria-label="Fechar filtros"]')!
        .click(),
    );
    await buscarMaria();
    expect(hospedeiro.textContent).toContain("Nenhum cliente retornado");
    await clicar("Limpar tudo");
    await avancar(320);
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#customers-search")?.value,
    ).toBe("");
    expect(rpc).toHaveBeenLastCalledWith(
      "get_admin_customers_paged",
      expect.objectContaining({
        p_search: "",
        p_sort_field: "total_spent",
        p_sort_direction: "desc",
        p_page: 0,
      }),
    );
    expect(
      hospedeiro
        .querySelector('[aria-label="Mostrar detalhado"]')
        ?.hasAttribute("aria-pressed"),
    ).toBe(false);
  });

  it("mostra o resumo antes da busca, com os modos nomeados e a seleção explícita", async () => {
    rpc.mockResolvedValue(sucesso([cliente("joao", "João Silva")], 24));
    await abrirTela();
    const metricas = hospedeiro.querySelector(
      '[aria-label="Métricas de Clientes"]',
    )!;
    const busca = hospedeiro.querySelector("#customers-search")!;
    expect(metricas).not.toBeNull();
    expect(
      metricas.compareDocumentPosition(busca) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const acoes = hospedeiro.querySelector(
      '[aria-label="Ações dos clientes"]',
    )!;
    // Sem a casca do painel o componente usa o rodapé sticky de desktop.
    // Dentro do AdminLayout, o teste da barra prova o portal na pílula.
    expect(acoes.className).toContain("admin-acao-inline");
    expect(acoes.className).not.toContain("fixed");
    expect(acoes.querySelectorAll("button")).toHaveLength(2);
    for (const acao of acoes.querySelectorAll("button"))
      expect(acao.className).toContain("min-h-14");
    const modo = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Mostrar detalhado"]',
    )!;
    expect(modo.hasAttribute("aria-pressed")).toBe(false);
    expect(hospedeiro.querySelectorAll("[data-barra-de-busca]")).toHaveLength(
      1,
    );
    await act(async () => modo.click());
    expect(modo.getAttribute("aria-label")).toBe("Mostrar compacto");
    expect(
      hospedeiro.querySelectorAll('button[aria-label^="Mostrar"]'),
    ).toHaveLength(1);
    expect(botao("Maior total comprado").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(hospedeiro.textContent).toContain(
      "Primeira página · Anterior indisponível",
    );
    // Trocar a apresentação não refaz nem altera a consulta.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("expande as quatro métricas em ordem, com um único botão para recolher", async () => {
    rpc.mockResolvedValue(sucesso([]));
    await abrirTela();
    await clicar("Expandir");
    const metricas = hospedeiro.querySelector(
      '[aria-label="Métricas de Clientes"]',
    )!;
    expect(metricas.querySelectorAll("[data-metrica]")).toHaveLength(4);
    expect(metricas.textContent).toContain("Valor médio por venda");
    expect(
      [...metricas.querySelectorAll("article")].map((el) =>
        el.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Total Clientes",
      "Novos (30 dias)",
      "Valor médio por venda",
      "Pedidos Totais",
    ]);
    expect(metricas.querySelectorAll("button")).toHaveLength(1);
    expect(metricas.querySelector("button")?.textContent).toContain("Recolher");
    expect(
      metricas.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(metricas.textContent).not.toContain("Carrossel");
    expect(
      metricas.querySelector('[aria-label^="Mostrar o grupo"]'),
    ).toBeNull();
    expect(
      metricas.querySelector('[aria-label="Grupo anterior de métricas"]'),
    ).toBeNull();
  });

  it("depois de expandir as métricas, Recolher sempre volta aos quatro números do resumo", async () => {
    rpc.mockResolvedValue(sucesso([]));
    await abrirTela();
    const metricas = () =>
      hospedeiro.querySelector('[aria-label="Métricas de Clientes"]')!;
    expect(metricas().querySelectorAll("[data-metrica]")).toHaveLength(0);

    await clicar("Expandir");
    expect(metricas().querySelectorAll("[data-metrica]")).toHaveLength(4);
    await clicar("Recolher");
    expect(metricas().querySelectorAll("[data-metrica]")).toHaveLength(0);
    expect(metricas().querySelectorAll('[role="group"]')).toHaveLength(4);
    expect(
      metricas().querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("false");

    await clicar("Expandir");
    expect(metricas().querySelectorAll("[data-metrica]")).toHaveLength(4);
    await clicar("Recolher");
    expect(metricas().querySelectorAll("[data-metrica]")).toHaveLength(0);
    expect(metricas().querySelectorAll('[role="group"]')).toHaveLength(4);
    expect(hospedeiro.textContent).toContain("Expandir");
  });

  it("o raio aparece apenas no cliente com aviso ativo, nos dois modos", async () => {
    rpc.mockResolvedValue(
      sucesso([
        { ...cliente("joao", "João Silva"), is_push_subscribed: true },
        { ...cliente("maria", "Maria Souza"), is_push_subscribed: false },
      ]),
    );
    await abrirTela();
    for (const modo of ["compact", "detailed"]) {
      if (modo === "detailed") {
        await act(async () =>
          hospedeiro
            .querySelector<HTMLButtonElement>(
              '[aria-label="Mostrar detalhado"]',
            )!
            .click(),
        );
      }
      const raios = hospedeiro.querySelectorAll('[aria-label="Avisos ativos"]');
      expect(raios).toHaveLength(1);
      expect(raios[0].closest('[role="button"]')?.textContent).toContain(
        "João Silva",
      );
      const maria = hospedeiro
        .querySelector('[aria-label="Gestão de Cliente: Maria Souza"]')!
        .closest('[role="button"]')!;
      expect(maria.querySelector('[aria-label="Avisos ativos"]')).toBeNull();
    }
  });

  it("cliente sem raio mantém o menu nomeado e as duas ações com o mesmo destinatário", async () => {
    const navegar = vi.fn();
    rpc.mockResolvedValue(sucesso([cliente("joao", "João Silva")]));
    await act(async () =>
      raiz.render(<AdminCustomersView active onNavigate={navegar} />),
    );
    await avancar(320);
    expect(hospedeiro.querySelector('[aria-label="Avisos ativos"]')).toBeNull();
    const menu = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Gestão de Cliente: João Silva"]',
    )!;
    await act(async () => menu.click());
    const dialogo = document.body.querySelector('[role="dialog"]')!;
    expect(dialogo.textContent).toContain(
      "Sem avisos ativos. Notificação Push continua disponível.",
    );
    const acoes = Array.from(dialogo.querySelectorAll("button"));
    expect(
      acoes.some((b) => b.textContent?.includes("Ver ficha do cliente")),
    ).toBe(true);
    const push = acoes.find((b) =>
      b.textContent?.includes("Notificação Push"),
    )!;
    await act(async () => push.click());
    expect(navegar).toHaveBeenCalledExactlyOnceWith("admin-push", "joao");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
