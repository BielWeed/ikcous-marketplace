// @vitest-environment jsdom
//
// Cadastro e edição de produto com rede "pendurada" (conecta e não responde).
//
// O defeito: o INSERT/UPDATE/RPC esperava sem prazo e o botão ficava em
// "Salvando…" para sempre, sem erro. Pior: o produto novo podia já ter sido
// criado no servidor; o rascunho só some depois que o cadastro volta, então ela
// reabria "Novo produto", publicava de novo e a loja ganhava o produto em
// DOBRO. Depois da gravação ainda havia esperas (reler o catálogo inteiro,
// copiar para o backup a foto removida) que também seguravam o botão.
//
// O prazo só encerra a ESPERA DA TELA: o servidor pode ter gravado. Por isso a
// frase NÃO afirma que falhou nem que deu certo — diz que não há resposta e
// manda CONFERIR a lista antes de repetir. Hook REAL, Supabase simulado, relógio
// simulado.
import { useProducts } from "@/hooks/useProducts";
import {
  MENSAGEM_PRODUTO_EDICAO_SEM_RESPOSTA,
  MENSAGEM_PRODUTO_LEITURA_SEM_RESPOSTA,
  MENSAGEM_PRODUTO_NOVO_GRADE_SEM_RESPOSTA,
  MENSAGEM_PRODUTO_NOVO_SEM_RESPOSTA,
  PRAZO_DE_CONFERIR_O_SKU_MS,
  PRAZO_DE_GRAVAR_O_PRODUTO_MS,
  PRAZO_DE_LER_O_PRODUTO_MS,
  PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS,
  ehConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  insereProduto: vi.fn(),
  insereVariantes: vi.fn(),
  atualizaProduto: vi.fn(),
  leProduto: vi.fn(),
  leVariantes: vi.fn(),
  leSkus: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  copy: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
  produtosDoContexto: [] as any[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: banco.produtosDoContexto,
    loadingProducts: false,
    fetchProducts: banco.refresh,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (linha: any) => ({
    ...linha,
    variants: linha.product_variants ?? [],
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: banco.sucesso, error: banco.erro },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: banco.rpc,
    from: (tabela: string) => {
      if (tabela === "vw_produtos_admin") {
        return {
          insert: (payload: unknown) => ({
            select: () => ({ single: () => banco.insereProduto(payload) }),
          }),
          update: (patch: unknown) => {
            const cadeia: any = {
              eq: () => cadeia,
              is: () => cadeia,
              select: () => cadeia,
              single: () => banco.atualizaProduto(patch),
              maybeSingle: () => banco.atualizaProduto(patch),
            };
            return cadeia;
          },
          select: () => {
            const cadeia: any = {
              eq: () => cadeia,
              is: () => cadeia,
              single: () => banco.leProduto(),
            };
            return cadeia;
          },
        };
      }
      if (tabela === "product_variants") {
        return {
          insert: (linhas: unknown) => ({
            select: () => banco.insereVariantes(linhas),
          }),
          select: () => ({
            in: (coluna: string, valores: string[]) =>
              coluna === "sku"
                ? banco.leSkus(valores)
                : Promise.resolve({ data: [], error: null }),
            eq: () =>
              Object.assign(banco.leVariantes(), {
                in: () => Promise.resolve({ data: [], error: null }),
              }),
          }),
        };
      }
      throw new Error(`Tabela inesperada: ${tabela}`);
    },
    storage: {
      from: () => ({
        copy: banco.copy,
        getPublicUrl: () => ({ data: { publicUrl: "backup" } }),
      }),
    },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useProducts>;
let raiz: Root;
let host: HTMLDivElement;
function Sonda() {
  const produtos = useProducts();
  useEffect(() => {
    api = produtos;
  });
  return null;
}

const PENDURADO = () => new Promise<never>(() => {});
const FOTO = "https://loja.test/storage/v1/object/public/products/a.jpg";
const BASE = "2026-11-08T10:00:00.123456+00:00";

const dadosNovos = (extra: Record<string, unknown> = {}) =>
  ({
    name: "Camiseta",
    description: "Algodão",
    price: 50,
    stock: 3,
    category: "Geral",
    images: [],
    isActive: true,
    sold: 0,
    isBestseller: false,
    freeShipping: false,
    tags: [],
    ...extra,
  }) as any;

const linhaCriada = () => ({
  id: "novo-1",
  nome: "Camiseta",
  preco_venda: 50,
  estoque: 3,
  images: [],
});

/** Dispara a ação e devolve como ela terminou (resolve, rejeita ou pendura). */
function disparar<T>(acao: () => Promise<T>) {
  const desfecho: { settled: boolean; valor?: T; erro?: unknown } = {
    settled: false,
  };
  const promessa = acao().then(
    (valor) => {
      desfecho.settled = true;
      desfecho.valor = valor;
    },
    (erro: unknown) => {
      desfecho.settled = true;
      desfecho.erro = erro;
    },
  );
  return { desfecho, promessa };
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Gravar e abrir produto no painel: a espera da tela tem prazo", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    banco.produtosDoContexto = [
      {
        id: "p-1",
        name: "Camiseta",
        price: 50,
        costPrice: 20,
        stock: 10,
        images: [FOTO],
        updatedAt: BASE,
      },
    ];
    banco.insereProduto.mockResolvedValue({
      data: linhaCriada(),
      error: null,
    });
    banco.insereVariantes.mockResolvedValue({ data: [], error: null });
    banco.atualizaProduto.mockResolvedValue({
      data: { id: "p-1", nome: "Camiseta", preco_venda: 60, estoque: 10 },
      error: null,
    });
    banco.leProduto.mockResolvedValue({
      data: { id: "p-1", nome: "Camiseta", updatedAt: BASE },
      error: null,
    });
    banco.leVariantes.mockResolvedValue({ data: [], error: null });
    banco.leSkus.mockResolvedValue({ data: [], error: null });
    banco.rpc.mockResolvedValue({
      data: { ultima_atualizacao: BASE, apagadas: [], recusadas: [] },
      error: null,
    });
    banco.refresh.mockResolvedValue(undefined);
    banco.copy.mockResolvedValue({ error: null });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("produto NOVO", () => {
    it("o INSERT pendurado solta no prazo e a frase não diz que falhou nem que salvou", async () => {
      banco.insereProduto.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() => api.addProduct(dadosNovos()));

      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS - 1);
      expect(desfecho.settled).toBe(false);
      await passar(1);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
      expect(banco.erro).toHaveBeenCalledTimes(1);
      const [frase] = banco.erro.mock.calls[0];
      expect(frase).toBe(MENSAGEM_PRODUTO_NOVO_SEM_RESPOSTA);
      // Confere a lista antes de publicar de novo (senão a loja ganha o
      // produto em dobro), e não afirma nenhum dos dois desfechos.
      expect(frase).toContain("lista de Produtos");
      expect(frase).toContain("publicar de novo");
      expect(frase).not.toMatch(/não foi (salvo|cadastrado|criado)\b/i);
      expect(banco.sucesso).not.toHaveBeenCalled();
      expect(banco.insereVariantes).not.toHaveBeenCalled();
      expect(banco.refresh).not.toHaveBeenCalled();
    });

    it("a resposta que chega DEPOIS do prazo não grava a grade, não avisa e não mexe na tela", async () => {
      let liberar: (v: unknown) => void = () => {};
      banco.insereProduto.mockImplementation(
        () => new Promise((resolve) => (liberar = resolve)),
      );
      const { desfecho } = disparar(() =>
        api.addProduct(
          dadosNovos({
            variants: [
              {
                id: "temp-1",
                name: "Cor",
                value: "Rosa",
                stockIncrement: 1,
                active: true,
              },
            ],
          }),
        ),
      );
      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS);
      expect(desfecho.settled).toBe(true);

      await act(async () => {
        liberar({ data: linhaCriada(), error: null });
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(banco.insereVariantes).not.toHaveBeenCalled();
      expect(banco.sucesso).not.toHaveBeenCalled();
      expect(banco.refresh).not.toHaveBeenCalled();
      expect(banco.erro).toHaveBeenCalledTimes(1);
    });

    it("resposta um instante ANTES do prazo é sucesso normal (sem falso estouro)", async () => {
      banco.insereProduto.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ data: linhaCriada(), error: null }),
              PRAZO_DE_GRAVAR_O_PRODUTO_MS - 1,
            ),
          ),
      );
      const { desfecho } = disparar(() => api.addProduct(dadosNovos()));
      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS - 1);
      await passar(PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS);

      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.id).toBe("novo-1");
      expect(banco.sucesso).toHaveBeenCalledWith(
        "Produto cadastrado com sucesso!",
      );
      expect(banco.erro).not.toHaveBeenCalled();
    });

    it("recusa DO SERVIDOR continua com o aviso de antes (uma frase só, sem opções novas)", async () => {
      banco.insereProduto.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied" },
      });
      const { desfecho } = disparar(() => api.addProduct(dadosNovos()));
      await passar(0);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(false);
      expect(banco.erro).toHaveBeenCalledExactlyOnceWith(
        "Sua sessão expirou ou você não tem permissão para salvar. Saia da conta, entre de novo e tente outra vez.",
      );
    });

    it("as variações penduradas depois do produto criado também soltam, dizendo que o produto existe", async () => {
      banco.insereVariantes.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() =>
        api.addProduct(
          dadosNovos({
            variants: [
              {
                id: "temp-1",
                name: "Cor",
                value: "Rosa",
                stockIncrement: 1,
                active: true,
              },
            ],
          }),
        ),
      );
      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
      expect(banco.erro).toHaveBeenCalledTimes(1);
      // O produto existe (isso se sabe); o que não se sabe é se a grade entrou.
      const [frase] = banco.erro.mock.calls[0];
      expect(frase).toBe(MENSAGEM_PRODUTO_NOVO_GRADE_SEM_RESPOSTA);
      expect(frase).toContain("publicar de novo");
      expect(banco.sucesso).not.toHaveBeenCalled();
    });

    it("reler o catálogo pendurado NÃO segura o cadastro: o produto já foi criado, mostra Salvo", async () => {
      banco.refresh.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() => api.addProduct(dadosNovos()));

      await passar(PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS);

      expect(desfecho.settled).toBe(true);
      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.id).toBe("novo-1");
      expect(banco.sucesso).toHaveBeenCalledWith(
        "Produto cadastrado com sucesso!",
      );
      expect(banco.erro).not.toHaveBeenCalled();
    });

    it("reler o catálogo que FALHA não vira 'não consegui cadastrar' (o produto existe: repetir duplicaria)", async () => {
      banco.refresh.mockRejectedValue(new Error("Failed to fetch"));
      const { desfecho } = disparar(() => api.addProduct(dadosNovos()));
      await passar(0);

      expect(desfecho.settled).toBe(true);
      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.id).toBe("novo-1");
      expect(banco.erro).not.toHaveBeenCalled();
      expect(banco.sucesso).toHaveBeenCalledWith(
        "Produto cadastrado com sucesso!",
      );
    });

    it("conferir o SKU pendurado não segura o cadastro: sem veredito, o cadastro segue", async () => {
      banco.leSkus.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() =>
        api.addProduct(
          dadosNovos({
            variants: [
              {
                id: "temp-1",
                name: "Cor",
                value: "Rosa",
                sku: "AB-1",
                stockIncrement: 1,
                active: true,
              },
            ],
          }),
        ),
      );

      await passar(PRAZO_DE_CONFERIR_O_SKU_MS - 1);
      expect(banco.insereProduto).not.toHaveBeenCalled();
      await passar(1);
      expect(banco.insereProduto).toHaveBeenCalledTimes(1);
      await passar(PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS);

      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.id).toBe("novo-1");
    });

    it("depois de um estouro, tentar de novo é uma chamada nova e independente", async () => {
      banco.insereProduto.mockImplementationOnce(PENDURADO);
      const primeira = disparar(() => api.addProduct(dadosNovos()));
      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS);
      expect(primeira.desfecho.settled).toBe(true);

      const segunda = disparar(() => api.addProduct(dadosNovos()));
      await passar(0);
      expect(segunda.desfecho.erro).toBeUndefined();
      expect((segunda.desfecho.valor as any)?.id).toBe("novo-1");
      expect(banco.insereProduto).toHaveBeenCalledTimes(2);
    });
  });

  describe("produto EXISTENTE (updateProduct)", () => {
    it("o UPDATE pendurado solta no prazo, diz para conferir o produto e não relê nada", async () => {
      banco.atualizaProduto.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() =>
        api.updateProduct("p-1", { price: 60 }),
      );

      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS - 1);
      expect(desfecho.settled).toBe(false);
      await passar(1);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
      expect(banco.erro).toHaveBeenCalledTimes(1);
      expect(banco.erro.mock.calls[0][0]).toBe(
        MENSAGEM_PRODUTO_EDICAO_SEM_RESPOSTA,
      );
      expect(banco.sucesso).not.toHaveBeenCalled();
      expect(banco.refresh).not.toHaveBeenCalled();
    });

    it("catálogo pendurado E cópia de backup da foto removida pendurada: o salvar fecha em até 5 s", async () => {
      banco.refresh.mockImplementation(PENDURADO);
      banco.copy.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() =>
        api.updateProduct("p-1", { images: [] }),
      );

      await passar(PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS);

      expect(desfecho.settled).toBe(true);
      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.id).toBe("p-1");
      expect(banco.sucesso).toHaveBeenCalledWith("Produto atualizado!");
      expect(banco.erro).not.toHaveBeenCalled();
    });

    it("o caminho normal segue igual: copia a foto removida e relê o catálogo ANTES de dizer Salvo", async () => {
      const { desfecho } = disparar(() =>
        api.updateProduct("p-1", { images: [] }),
      );
      await passar(0);

      expect(desfecho.erro).toBeUndefined();
      expect(banco.copy).toHaveBeenCalledTimes(1);
      expect(banco.refresh).toHaveBeenCalledTimes(1);
      expect(banco.sucesso).toHaveBeenCalledWith("Produto atualizado!");
    });
  });

  describe("produto com grade (salvarProdutoComGrade)", () => {
    const grade = {
      baseUpdatedAt: BASE,
      variantes: [
        {
          id: "temp-nova",
          name: "Cor",
          value: "Azul",
          stockIncrement: 0,
          active: true,
        },
      ],
      apagar: [] as string[],
    };

    it("a RPC pendurada solta no prazo; uma resposta tardia dela não relê nem avisa", async () => {
      let liberar: (v: unknown) => void = () => {};
      banco.rpc.mockImplementation(
        () => new Promise((resolve) => (liberar = resolve)),
      );
      const { desfecho } = disparar(() =>
        api.salvarProdutoComGrade("p-1", { price: 60 }, grade),
      );

      await passar(PRAZO_DE_GRAVAR_O_PRODUTO_MS - 1);
      expect(desfecho.settled).toBe(false);
      await passar(1);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
      expect((desfecho.erro as any).gradeGravada).toBeUndefined();
      expect(banco.erro).toHaveBeenCalledTimes(1);
      expect(banco.erro.mock.calls[0][0]).toBe(
        MENSAGEM_PRODUTO_EDICAO_SEM_RESPOSTA,
      );

      await act(async () => {
        liberar({
          data: { ultima_atualizacao: BASE, apagadas: [], recusadas: [] },
          error: null,
        });
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(banco.refresh).not.toHaveBeenCalled();
      expect(banco.sucesso).not.toHaveBeenCalled();
      expect(banco.erro).toHaveBeenCalledTimes(1);
    });

    it("RPC ok e catálogo pendurado: devolve o produto relido e Salvo em até 5 s", async () => {
      banco.refresh.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() =>
        api.salvarProdutoComGrade("p-1", { price: 60 }, grade),
      );

      await passar(PRAZO_DO_QUE_SOBRA_APOS_GRAVAR_O_PRODUTO_MS);

      expect(desfecho.settled).toBe(true);
      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.produto?.id).toBe("p-1");
      expect(banco.sucesso).toHaveBeenCalledWith("Produto atualizado!");
      expect(banco.erro).not.toHaveBeenCalled();
    });

    it("RPC ok e a RELEITURA do produto pendurada: trava a repetição (grade já gravada), não fica girando", async () => {
      banco.leProduto.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() =>
        api.salvarProdutoComGrade("p-1", { price: 60 }, grade),
      );

      await passar(PRAZO_DE_LER_O_PRODUTO_MS);

      expect(desfecho.settled).toBe(true);
      expect((desfecho.erro as any)?.gradeGravada).toBe(true);
      expect(banco.erro).toHaveBeenCalledTimes(1);
      expect(String(banco.erro.mock.calls[0][0])).toContain(
        "As variações novas já foram gravadas",
      );
    });
  });

  describe("abrir o produto (fetchProduct)", () => {
    it("consulta pendurada vira erro de 'sem resposta' no prazo (a tela mostra Recarregar)", async () => {
      banco.leProduto.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() => api.fetchProduct("p-1"));

      await passar(PRAZO_DE_LER_O_PRODUTO_MS - 1);
      expect(desfecho.settled).toBe(false);
      await passar(1);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
      expect((desfecho.erro as Error).message).toBe(
        MENSAGEM_PRODUTO_LEITURA_SEM_RESPOSTA,
      );
    });

    it("as DUAS consultas dividem UM prazo: a segunda pendurada estoura no mesmo relógio, não 15 s depois", async () => {
      banco.leProduto.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  data: { id: "p-1", nome: "Camiseta" },
                  error: null,
                }),
              10_000,
            ),
          ),
      );
      banco.leVariantes.mockImplementation(PENDURADO);
      const { desfecho } = disparar(() => api.fetchProduct("p-1"));

      await passar(PRAZO_DE_LER_O_PRODUTO_MS - 1);
      expect(desfecho.settled).toBe(false);
      await passar(1);

      expect(desfecho.settled).toBe(true);
      expect(ehConsultaSemResposta(desfecho.erro)).toBe(true);
    });

    it("produto que responde dentro do prazo abre normalmente", async () => {
      const { desfecho } = disparar(() => api.fetchProduct("p-1"));
      await passar(0);

      expect(desfecho.erro).toBeUndefined();
      expect((desfecho.valor as any)?.id).toBe("p-1");
    });
  });
});
