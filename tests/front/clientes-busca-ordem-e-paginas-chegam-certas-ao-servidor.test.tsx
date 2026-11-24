// @vitest-environment jsdom
//
// Caça por mutação na lista de Clientes do painel (24/11/2026). A busca, a
// ordem e a página são decididas NO SERVIDOR (`get_admin_customers_paged`),
// então o que a tela precisa acertar é o que ela PEDE:
//   - o texto digitado vai sem espaço sobrando e com `%`, `_` e `\` literais
//     (senão "50%" vira curinga e acha a base inteira);
//   - cada chip de ordem pede o par campo/direção certo;
//   - trocar a busca ou a ordem volta para a página 1 (p_page 0);
//   - a página tem 12 clientes;
//   - a mensagem de lista vazia muda conforme existe busca ou não.
// Só fixtures inventadas.
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

/** Resposta do servidor: 12 clientes na página e `total` no recorte. */
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
// Modo de exibição lembrado pelo aparelho; os cabeçalhos clicáveis só existem
// no modo "detailed".
let modoSalvo: string | null = null;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
}, 60_000);

describe("Clientes — o que a tela pede ao servidor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    limparCachesDeAdmin();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    modoSalvo = null;
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) =>
        chave === "admin_customers_view_mode" ? modoSalvo : null,
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

  async function digitarBusca(termo: string) {
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#customers-search");
    const atribuir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!campo || !atribuir) throw new Error("Campo de busca não encontrado");
    await act(async () => {
      atribuir.call(campo, termo);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // 300 ms de debounce do campo + 320 ms da consulta.
    await avancar(300);
    await avancar(320);
  }

  function chip(rotulo: string): HTMLButtonElement {
    const grupo = hospedeiro.querySelector(
      '[role="group"][aria-label="Ordenar clientes"]',
    );
    const achado = [...(grupo?.querySelectorAll("button") ?? [])].find((b) =>
      (b.textContent ?? "").includes(rotulo),
    );
    if (!achado) throw new Error(`Chip "${rotulo}" não está na tela`);
    return achado;
  }

  async function tocarChip(rotulo: string) {
    await act(async () => {
      chip(rotulo).click();
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

  it("a primeira consulta pede a página 0, com 12 por página, maior total primeiro e busca vazia", async () => {
    rpc.mockResolvedValue(resposta(1));
    await montar();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("get_admin_customers_paged");
    expect(ultimosArgs()).toEqual({
      p_search: "",
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
      p_page: 0,
      p_page_size: 12,
    });
  });

  it("o texto digitado vai sem espaço sobrando e com % e _ como texto comum, não curinga", async () => {
    rpc.mockResolvedValue(resposta(1));
    await montar();

    await digitarBusca("  50%   de_desconto  ");

    expect(ultimosArgs()).toMatchObject({
      p_search: "50\\% de\\_desconto",
      p_page: 0,
    });
  });

  it("cada chip de ordem pede o campo e a direção do próprio rótulo", async () => {
    rpc.mockResolvedValue(resposta(1));
    await montar();

    await tocarChip("Mais pedidos");
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "orders_count",
      p_sort_direction: "desc",
    });

    await tocarChip("A–Z");
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "full_name",
      p_sort_direction: "asc",
    });

    await tocarChip("Administradores primeiro");
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "role",
      p_sort_direction: "asc",
    });

    await tocarChip("Maior total comprado");
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
  });

  it("só o chip da ordem em uso aparece marcado, e muda junto com a escolha", async () => {
    rpc.mockResolvedValue(resposta(1));
    await montar();

    expect(chip("Maior total comprado").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(chip("Mais pedidos").getAttribute("aria-pressed")).toBe("false");

    await tocarChip("Mais pedidos");

    expect(chip("Maior total comprado").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(chip("Mais pedidos").getAttribute("aria-pressed")).toBe("true");
  });

  it("trocar a ordem na página 2 volta para a página 1", async () => {
    rpc.mockResolvedValue(resposta(30));
    await montar();

    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({ p_page: 1 });

    await tocarChip("A–Z");
    expect(ultimosArgs()).toMatchObject({
      p_page: 0,
      p_sort_field: "full_name",
    });
  });

  it("buscar na página 3 volta para a página 1", async () => {
    rpc.mockResolvedValue(resposta(30));
    await montar();

    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({ p_page: 2 });

    await digitarBusca("Maria");
    expect(ultimosArgs()).toMatchObject({ p_search: "Maria", p_page: 0 });
  });

  it("os botões de página andam de um em um e param nas pontas (30 clientes = 3 páginas)", async () => {
    rpc.mockResolvedValue(resposta(30));
    await montar();

    expect(hospedeiro.textContent).toContain("1 de 3");
    expect(botaoPorTexto("Anterior").disabled).toBe(true);

    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    expect(hospedeiro.textContent).toContain("2 de 3");

    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    expect(hospedeiro.textContent).toContain("3 de 3");
    expect(botaoPorTexto("Próximo").disabled).toBe(true);

    await act(async () => {
      botaoPorTexto("Anterior").click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({ p_page: 1 });
  });

  it("exatamente 12 clientes cabem numa página só (sem botões de página)", async () => {
    rpc.mockResolvedValue(
      resposta(
        12,
        Array.from({ length: 12 }, (_, i) => `Cliente ${i + 1}`),
      ),
    );
    await montar();

    expect(hospedeiro.textContent).toContain("Exibindo 1 - 12 de 12");
    expect(hospedeiro.textContent).not.toContain("Próximo");
  });

  it("13 clientes já pedem uma segunda página", async () => {
    rpc.mockResolvedValue(
      resposta(
        13,
        Array.from({ length: 12 }, (_, i) => `Cliente ${i + 1}`),
      ),
    );
    await montar();

    expect(hospedeiro.textContent).toContain("1 de 2");
  });

  it("clicar duas vezes no cabeçalho 'Total já comprado' inverte a ordem e o chip 'Maior total comprado' deixa de aparecer marcado", async () => {
    modoSalvo = "detailed";
    rpc.mockResolvedValue(resposta(1));
    await montar();

    const cabecalho = [
      ...hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ].find((el) => (el.textContent ?? "").trim() === "Total já comprado");
    if (!cabecalho) throw new Error("Cabeçalho não está na tela");

    await act(async () => {
      cabecalho.click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
    expect(chip("Maior total comprado").getAttribute("aria-pressed")).toBe(
      "true",
    );

    await act(async () => {
      cabecalho.click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({
      p_sort_field: "total_spent",
      p_sort_direction: "asc",
    });
    // Mesmo campo, direção contrária: o chip "maior primeiro" não vale mais.
    expect(chip("Maior total comprado").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("lista vazia SEM busca diz 'Nenhum cliente ainda' e não oferece limpar", async () => {
    rpc.mockResolvedValue(resposta(0, []));
    await montar();

    expect(hospedeiro.textContent).toContain("Nenhum cliente ainda");
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente retornado");
    expect(hospedeiro.textContent).not.toContain("Limpar tudo");
  });

  it("lista vazia COM busca diz 'Nenhum cliente retornado' e oferece limpar", async () => {
    rpc.mockResolvedValueOnce(resposta(1));
    await montar();
    rpc.mockResolvedValue(resposta(0, []));

    await digitarBusca("ninguem-assim");

    expect(hospedeiro.textContent).toContain("Nenhum cliente retornado");
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente ainda");
    expect(hospedeiro.textContent).toContain("Limpar tudo");
  });

  it("lista vazia só por trocar a ordem (sem busca) continua dizendo 'Nenhum cliente ainda', mas oferece limpar a ordem", async () => {
    rpc.mockResolvedValueOnce(resposta(1));
    await montar();
    rpc.mockResolvedValue(resposta(0, []));

    await tocarChip("A–Z");

    expect(hospedeiro.textContent).toContain("Nenhum cliente ainda");
    expect(hospedeiro.textContent).toContain("Limpar tudo");
  });

  it("'Limpar tudo' numa página além do fim do recorte volta para a página 1", async () => {
    rpc.mockResolvedValue(resposta(30));
    await montar();
    await digitarBusca("Maria");

    // Página 2 chega vazia (o recorte encolheu), mas ainda existe: não é
    // "além do fim", então a tela mostra o vazio com o botão de limpar.
    rpc.mockResolvedValue(resposta(30, []));
    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
    expect(ultimosArgs()).toMatchObject({ p_search: "Maria", p_page: 1 });
    expect(hospedeiro.textContent).toContain("Nenhum cliente retornado");

    rpc.mockResolvedValue(resposta(30));
    await act(async () => {
      botaoPorTexto("Limpar tudo").click();
    });
    await avancar(320);

    expect(ultimosArgs()).toMatchObject({ p_search: "", p_page: 0 });
  });

  it("'Limpar tudo' zera a busca e a ordem e pede de novo a lista padrão", async () => {
    rpc.mockResolvedValueOnce(resposta(1));
    await montar();
    rpc.mockResolvedValue(resposta(0, []));
    await digitarBusca("ninguem-assim");
    await tocarChip("A–Z");

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
  });
});
