import { exportarProdutosPlanilha } from "@/lib/exportar-produtos-planilha";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, sessao } = vi.hoisted(() => ({ rpc: vi.fn(), sessao: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: sessao,
}));

let opcoes: Parameters<typeof exportarProdutosPlanilha>[0];
let links: HTMLAnchorElement[];
const linha = (id: string) => ({
  id,
  nome: "Produto de teste",
  preco_venda: 10,
  custo: 3,
  estoque: 20,
  ativo: true,
  product_variants: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  sessao.mockResolvedValue(true);
  opcoes = {
    conta: "conta-teste",
    nomeLoja: "Loja Árvore",
    comCustos: true,
    sinal: new AbortController().signal,
    podeContinuar: () => true,
  };
  links = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    links.push(this);
  });
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => "blob:arquivo-de-teste"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function resposta(data: unknown) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error: null }) };
}

describe("download do catálogo pela porta já usada no painel", () => {
  it("usa a RPC sem filtros da tela e consulta a próxima página", async () => {
    rpc.mockImplementation((_nome, args) =>
      resposta({
        data: [linha(String(args.p_page))],
        total_count: 2,
      }),
    );
    await exportarProdutosPlanilha(opcoes);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_admin_products_paged", {
      p_search: "",
      p_category: "all",
      p_status: "all",
      p_stock: "all",
      p_page: 0,
      p_page_size: 200,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_admin_products_paged",
      expect.objectContaining({ p_page: 1 }),
    );
    expect(sessao).toHaveBeenCalledWith("conta-teste");
    expect(links).toHaveLength(1);
    expect(links[0].download).toMatch(
      /^produtos-loja-arvore-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:arquivo-de-teste");
  });
  it("sem sessão vigente não consulta nem baixa", async () => {
    sessao.mockResolvedValue(false);
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(links).toHaveLength(0);
  });
  it("falha na página posterior não baixa a primeira como se fosse tudo", async () => {
    rpc.mockImplementation((_nome, args) =>
      args.p_page === 0
        ? resposta({ data: [linha("p1")], total_count: 2 })
        : {
            abortSignal: vi
              .fn()
              .mockResolvedValue({ data: null, error: new Error("falha") }),
          },
    );
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow("falha");
    expect(links).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("permissão perdida depois da leitura impede criar arquivo baixável", async () => {
    rpc.mockImplementation(() => {
      opcoes.podeContinuar = () => false;
      return resposta({ data: [linha("p1")], total_count: 1 });
    });
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("perder permissão enquanto a sessão final responde também impede o download", async () => {
    rpc.mockReturnValue(resposta({ data: [linha("p1")], total_count: 1 }));
    sessao.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
      opcoes.podeContinuar = () => false;
      return true;
    });
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("resposta sem contagem não é tratada como catálogo vazio", async () => {
    rpc.mockReturnValue(resposta({ data: [], total_count: null }));
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("abortada antes da leitura não baixa", async () => {
    opcoes.sinal = AbortSignal.abort();
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(links).toHaveLength(0);
  });
});
