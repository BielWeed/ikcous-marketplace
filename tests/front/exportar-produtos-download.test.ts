import { exportarProdutosPlanilha } from "@/lib/exportar-produtos-planilha";
import * as planilha from "@/lib/planilha-xlsx";
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
    expect(await exportarProdutosPlanilha(opcoes)).toBe("xlsx");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
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
      /^produtos-loja-arvore-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:arquivo-de-teste");
  });
  it("falha do gerador baixa CSV automaticamente, com extensão e MIME próprios", async () => {
    rpc.mockReturnValue(resposta({ data: [linha("p1")], total_count: 1 }));
    vi.spyOn(planilha, "gerarXlsx").mockImplementationOnce(() => {
      throw new Error("não foi possível gerar");
    });
    expect(await exportarProdutosPlanilha(opcoes)).toBe("csv");
    expect(links).toHaveLength(1);
    expect(links[0].download).toMatch(/\.csv$/);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
  });
  it("texto acima do limite do Excel usa o CSV sem truncar o catálogo", async () => {
    rpc.mockReturnValue(
      resposta({
        data: [{ ...linha("p1"), nome: "a".repeat(32768) }],
        total_count: 1,
      }),
    );
    expect(await exportarProdutosPlanilha(opcoes)).toBe("csv");
    expect(links[0].download).toMatch(/\.csv$/);
  });
  it("permissão perdida na geração do XLSX impede também o fallback e o download", async () => {
    rpc.mockReturnValue(resposta({ data: [linha("p1")], total_count: 1 }));
    vi.spyOn(planilha, "gerarXlsx").mockImplementationOnce(() => {
      opcoes.podeContinuar = () => false;
      throw new Error("geração interrompida");
    });
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(links).toHaveLength(0);
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
