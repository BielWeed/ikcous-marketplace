// @vitest-environment jsdom
// Protege o que o download da planilha de produtos faz DEPOIS de gerar o
// arquivo: como o nome da loja vira nome de arquivo (acento, símbolo, espaço
// repetido, nome comprido, nome sem nenhuma letra), quando o endereço do
// arquivo é liberado (só depois do navegador ter tempo de iniciar o download)
// e se o link escondido entra na página antes do clique e sai depois. Também
// protege a conferência de sessão no caminho do catálogo vazio.
import { exportarProdutosPlanilha } from "@/lib/exportar-produtos-planilha";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, sessao } = vi.hoisted(() => ({ rpc: vi.fn(), sessao: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: sessao,
}));

interface Clique {
  link: HTMLAnchorElement;
  ligadoNaPaginaNoClique: boolean;
}

let opcoes: Parameters<typeof exportarProdutosPlanilha>[0];
let cliques: Clique[];

const linha = (id: string) => ({
  id,
  nome: "Produto inventado",
  preco_venda: 10,
  custo: 3,
  estoque: 20,
  ativo: true,
  product_variants: [],
});

function resposta(data: unknown) {
  return { abortSignal: vi.fn().mockResolvedValue({ data, error: null }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessao.mockResolvedValue(true);
  rpc.mockReturnValue(resposta({ data: [linha("p1")], total_count: 1 }));
  opcoes = {
    conta: "conta-teste",
    nomeLoja: "Loja Árvore",
    comCustos: true,
    sinal: new AbortController().signal,
    podeContinuar: () => true,
  };
  cliques = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    cliques.push({ link: this, ligadoNaPaginaNoClique: this.isConnected });
  });
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => "blob:arquivo-de-teste"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-19T15:00:00Z"));
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nome do arquivo da planilha de produtos", () => {
  it.each([
    ["  ¡Loja Árvore!!  ", "loja-arvore"],
    ["Loja     Árvore", "loja-arvore"],
    ["Ação & Cia.", "acao-cia"],
    ["---Loja---", "loja"],
    ["MAIÚSCULAS 2", "maiusculas-2"],
  ])("nome da loja %j vira '%s' sem hífen sobrando", async (nomeLoja, slug) => {
    opcoes.nomeLoja = nomeLoja;
    expect(await exportarProdutosPlanilha(opcoes)).toBe("xlsx");
    expect(cliques[0].link.download).toBe(`produtos-${slug}-2026-08-19.xlsx`);
  });

  it.each(["", "!!!", "   ", "🌻🌻"])(
    "nome da loja %j, sem nenhuma letra ou número, cai em 'loja'",
    async (nomeLoja) => {
      opcoes.nomeLoja = nomeLoja;
      await exportarProdutosPlanilha(opcoes);
      expect(cliques[0].link.download).toBe("produtos-loja-2026-08-19.xlsx");
    },
  );

  it("nome comprido é cortado em exatamente 80 caracteres", async () => {
    opcoes.nomeLoja = "a".repeat(100);
    await exportarProdutosPlanilha(opcoes);
    expect(cliques[0].link.download).toBe(
      `produtos-${"a".repeat(80)}-2026-08-19.xlsx`,
    );
  });

  it("nome com exatamente 80 caracteres não perde nenhum", async () => {
    opcoes.nomeLoja = "b".repeat(80);
    await exportarProdutosPlanilha(opcoes);
    expect(cliques[0].link.download).toBe(
      `produtos-${"b".repeat(80)}-2026-08-19.xlsx`,
    );
  });
});

describe("limpeza depois de baixar a planilha de produtos", () => {
  it("o endereço do arquivo só é liberado 30 segundos depois, não na hora", async () => {
    await exportarProdutosPlanilha(opcoes);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:arquivo-de-teste",
    );
  });

  it("o link escondido já está na página quando recebe o clique e sai dela depois", async () => {
    await exportarProdutosPlanilha(opcoes);
    expect(cliques).toHaveLength(1);
    // Firefox ignora clique em link que não está na página.
    expect(cliques[0].ligadoNaPaginaNoClique).toBe(true);
    expect(cliques[0].link.isConnected).toBe(false);
    expect(document.body.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("clique que lança erro ainda tira o link da página e agenda a liberação", async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(
      function (this: HTMLAnchorElement) {
        cliques.push({ link: this, ligadoNaPaginaNoClique: this.isConnected });
        throw new Error("o navegador recusou o clique");
      },
    );
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow(
      "o navegador recusou o clique",
    );
    expect(cliques[0].link.isConnected).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:arquivo-de-teste",
    );
  });
});

describe("catálogo vazio e sessão", () => {
  it("catálogo vazio, mas a sessão mudou na conferência final: erro, não 'vazio'", async () => {
    rpc.mockReturnValue(resposta({ data: [], total_count: 0 }));
    // 1ª conferência (antes da leitura) vale; a 2ª (depois do 'vazio') não.
    sessao.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(exportarProdutosPlanilha(opcoes)).rejects.toThrow(
      "A sessão mudou.",
    );
    expect(cliques).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("controle: catálogo vazio com sessão firme devolve 'vazio' e confere a sessão duas vezes", async () => {
    rpc.mockReturnValue(resposta({ data: [], total_count: 0 }));
    expect(await exportarProdutosPlanilha(opcoes)).toBe("vazio");
    expect(sessao).toHaveBeenCalledTimes(2);
  });
});
