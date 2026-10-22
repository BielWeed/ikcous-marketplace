// @vitest-environment jsdom
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  variacoes: [] as Record<string, any>[],
  filtros: [] as Array<Array<[string, unknown]>>,
  gravacoes: 0,
  gravacoesDeVariacoes: 0,
  versao: 0,
  falharVariacoes: false,
  chamadasRpc: [] as any[],
  recusadas: [] as string[],
  falharReleitura: false,
  toastError: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "lojista-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: banco.refresh,
    config: { shippingCoverage: "national" },
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: banco.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function avancarVersao() {
  banco.produto.ultima_atualizacao = `2026-10-21T13:00:0${++banco.versao}.123456+00:00`;
}

// O dublê só grava quando TODOS os filtros do UPDATE casam, como no banco.
// Venda externa muda tanto o estoque quanto a versão; não há erro programado.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: async (nome: string, parametros: any) => {
      expect(nome).toBe("salvar_produto_com_grade");
      banco.chamadasRpc.push(structuredClone(parametros));
      if (
        parametros.p_base_atualizado_em !== null &&
        parametros.p_base_atualizado_em !== banco.produto.ultima_atualizacao
      )
        return { data: null, error: { code: "PRD01" } };
      if (banco.falharVariacoes)
        return { data: null, error: { code: "42501" } };
      Object.assign(banco.produto, parametros.p_produto);
      banco.gravacoes++;
      banco.variacoes = banco.variacoes.filter(
        (v) =>
          !parametros.p_apagar.includes(v.id) || banco.recusadas.includes(v.id),
      );
      for (const linha of parametros.p_variantes) {
        const atual = banco.variacoes.find((v) => v.id === linha.id);
        if (atual) Object.assign(atual, linha);
        else
          banco.variacoes.push({ id: "v-gerada", product_id: "p-1", ...linha });
      }
      if (parametros.p_variantes.length) banco.gravacoesDeVariacoes++;
      avancarVersao();
      return {
        data: {
          ultima_atualizacao: banco.produto.ultima_atualizacao,
          apagadas: parametros.p_apagar.filter(
            (id: string) => !banco.recusadas.includes(id),
          ),
          recusadas: banco.recusadas.filter((id) =>
            parametros.p_apagar.includes(id),
          ),
        },
        error: null,
      };
    },
    from: (tabela: string) => {
      if (tabela === "product_variants") {
        return {
          select: () => {
            return {
              eq: () =>
                Object.assign(
                  Promise.resolve({
                    data: structuredClone(banco.variacoes),
                    error: null,
                  }),
                  {
                    in: async (_: string, ids: string[]) => ({
                      data: structuredClone(
                        banco.variacoes.filter((v) => ids.includes(v.id)),
                      ),
                      error: null,
                    }),
                  },
                ),
            };
          },
          upsert: async (linhas: Record<string, any>[]) => {
            banco.gravacoesDeVariacoes++;
            if (banco.falharVariacoes) return { error: { code: "42501" } };
            for (const linha of linhas) {
              Object.assign(
                banco.variacoes.find((v) => v.id === linha.id)!,
                linha,
              );
            }
            avancarVersao();
            return { error: null };
          },
        };
      }
      if (tabela !== "vw_produtos_admin")
        throw new Error(`Tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const consulta = {
            eq: () => consulta,
            is: () => consulta,
            single: async () => ({
              data:
                banco.falharReleitura && banco.chamadasRpc.length > 0
                  ? null
                  : structuredClone(banco.produto),
              error:
                banco.falharReleitura && banco.chamadasRpc.length > 0
                  ? { code: "PGRST116" }
                  : null,
            }),
            maybeSingle: async () => ({
              data:
                banco.falharReleitura && banco.chamadasRpc.length > 0
                  ? null
                  : structuredClone(banco.produto),
              error:
                banco.falharReleitura && banco.chamadasRpc.length > 0
                  ? { code: "PGRST116" }
                  : null,
            }),
          };
          return consulta;
        },
        update: (patch: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];
          banco.filtros.push(filtros);
          const executar = async () => {
            const valoresAtuais = new Map(Object.entries(banco.produto));
            if (
              !filtros.every(
                ([campo, valor]) => valoresAtuais.get(campo) === valor,
              )
            ) {
              return { data: null, error: null };
            }
            banco.gravacoes++;
            Object.assign(banco.produto, patch);
            avancarVersao();
            return {
              data: structuredClone({
                ...banco.produto,
                product_variants: banco.variacoes,
              }),
              error: null,
            };
          };
          const consulta = {
            eq: (campo: string, valor: unknown) => {
              filtros.push([campo, valor]);
              return consulta;
            },
            select: () => consulta,
            single: executar,
            maybeSingle: executar,
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useProducts>;
function SondaDoHook() {
  const produtos = useProducts({ autoFetch: false });
  useEffect(() => {
    api = produtos;
  });
  return null;
}

const navegar = vi.fn();
const marcarSujo = vi.fn();
let raiz: Root;
let host: HTMLDivElement;

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  expect(campo).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}
async function salvar() {
  await act(async () => {
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    );
    expect(botao?.disabled).toBe(false);
    botao!.click();
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function montar() {
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <AdminProductFormView
        productId="p-1"
        onNavigate={navegar}
        onSetDirty={marcarSujo}
        userId="lojista-1"
      />,
    );
  });
}
async function editarVariacao() {
  await act(async () => {
    const linha = host.querySelector('[data-testid="variante-cadastrada"]');
    (
      linha?.closest("div.group")?.querySelector("button") as HTMLButtonElement
    ).click();
  });
  await digitar("variant-stock", "8");
  await act(async () => {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar variação",
    );
    botao!.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.produto = {
    id: "p-1",
    nome: "Camiseta",
    descricao: "Algodão",
    preco_venda: 50,
    estoque: 10,
    categoria: "Geral",
    ativo: true,
    imagem_urls: [],
    ultima_atualizacao: "2026-10-21T13:00:00.123456+00:00",
  };
  banco.variacoes = [];
  banco.filtros = [];
  banco.chamadasRpc = [];
  banco.recusadas = [];
  banco.falharReleitura = false;
  sessionStorage.clear();
  banco.gravacoes = 0;
  banco.gravacoesDeVariacoes = 0;
  banco.versao = 0;
  banco.falharVariacoes = false;
  banco.refresh.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("salvar estoque confere a versão lida na abertura", () => {
  it("online com grade faz uma só RPC, sem PATCH nem upsert avulso", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await editarVariacao();
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0]).toMatchObject({
      p_produto_id: "p-1",
      p_base_atualizado_em: "2026-10-21T13:00:00.123456+00:00",
      p_produto: { estoque: 8 },
      p_variantes: [{ id: "v-1", stock_increment: 8 }],
      p_apagar: [],
    });
    expect(banco.filtros).toEqual([]);
  });

  it("online só com exclusão usa a RPC e repõe a recusada na lista sem repetir a exclusão", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    banco.recusadas = ["v-1"];
    await montar();
    await act(async () => {
      (
        host.querySelector(
          '[aria-label="Excluir variação Rosa"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Excluir Variante")!
        .click();
    });
    await salvar();
    expect(banco.chamadasRpc[0].p_variantes).toEqual([]);
    expect(banco.chamadasRpc[0].p_apagar).toEqual(["v-1"]);
    expect(
      host.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ).toHaveLength(1);
    expect(
      banco.toastError.mock.calls.some(([texto]) => /Rosa/.test(texto)),
    ).toBe(true);
    expect(navegar).not.toHaveBeenCalled();
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(2);
    expect(banco.chamadasRpc[1].p_apagar).toEqual([]);
    expect(banco.chamadasRpc[1].p_base_atualizado_em).toBeNull();
  });

  it("nova variação recebe o id do banco mesmo com exclusão recusada; repetir não duplica", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    banco.recusadas = ["v-1"];
    await montar();
    await act(async () => {
      (
        host.querySelector(
          '[aria-label="Excluir variação Rosa"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Excluir Variante")!
        .click();
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("+ Novo"))!
        .click();
    });
    await digitar("variant-name", "Cor");
    await digitar("variant-value", "Azul");
    await digitar("variant-stock", "4");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Salvar variação")!
        .click();
    });
    await salvar();
    expect(banco.chamadasRpc[0].p_variantes[0]).not.toHaveProperty("id");
    expect(banco.variacoes).toHaveLength(2);
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(2);
    expect(
      banco.chamadasRpc[1].p_variantes.map((v: any) => v.id).sort(),
    ).toEqual(["v-1", "v-gerada"]);
    expect(banco.variacoes).toHaveLength(2);
  });

  it("falha de releitura após commit bloqueia outro salvar para não duplicar a grade", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await editarVariacao();
    const chaveDoRascunho = "ikcous_product_form_draft_edit_p-1:lojista-1";
    localStorage.setItem(
      chaveDoRascunho,
      JSON.stringify({ variants: [{ id: "temp-nova" }] }),
    );
    banco.falharReleitura = true;
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.gravacoes).toBe(1);
    expect(localStorage.getItem(chaveDoRascunho)).toBeNull();
    expect(
      banco.toastError.mock.calls.some(([texto]) => /Recarregue/.test(texto)),
    ).toBe(true);
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    );
    expect(botao?.disabled).toBe(true);
  });

  it("online sem mexer no estoque da grade não manda base nem o estoque velho", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await digitar("product-sale-price", "60,00");
    banco.variacoes[0].stock_increment = 9;
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBeNull();
    expect(banco.chamadasRpc[0].p_variantes[0]).not.toHaveProperty(
      "stock_increment",
    );
    expect(banco.produto.estoque).toBe(9);
    expect(banco.variacoes[0].stock_increment).toBe(9);
  });

  it("offline com grade mantém fila do produto e caminho antigo, sem RPC", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await digitar("product-sale-price", "60,00");
    await salvar();
    expect(banco.chamadasRpc).toEqual([]);
    const fila = JSON.parse(
      localStorage.getItem("products_offline_updates_queue:lojista-1") ?? "[]",
    );
    expect(fila).toHaveLength(1);
    expect(fila[0].updates.price).toBe(60);
  });

  it("recusa estoque mexido após venda e avisa sem gravar produto nem variações", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await editarVariacao();
    banco.produto.estoque = 9;
    banco.variacoes[0].stock_increment = 9;
    avancarVersao();

    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(banco.gravacoesDeVariacoes).toBe(0);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.toastError).toHaveBeenCalledWith(
      "O produto mudou enquanto você editava. Recarregue a página e confira antes de salvar de novo.",
    );
  });

  it("depois da recusa mostra o estoque atual, mantém o preço digitado e permite redigitar e salvar", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();
    const versaoAtual = banco.produto.ultima_atualizacao;
    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(
      (document.getElementById("product-stock") as HTMLInputElement).value,
    ).toBe("9");
    expect(
      (document.getElementById("product-sale-price") as HTMLInputElement).value,
    ).toContain("60");
    await digitar("product-stock", "7");
    await salvar();
    expect(banco.gravacoes).toBe(1);
    expect(banco.produto.estoque).toBe(7);
    expect(banco.produto.preco_venda).toBe(60);
    expect(banco.filtros[1]).toContainEqual([
      "ultima_atualizacao",
      versaoAtual,
    ]);
  });

  it("um segundo toque sem redigitar não reenvia o estoque recusado", async () => {
    await montar();
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(
      (document.getElementById("product-stock") as HTMLInputElement).value,
    ).toBe("9");
    await salvar();
    expect(banco.produto.estoque).toBe(9);
    expect(banco.filtros[1]).toEqual([["id", "p-1"]]);
    expect(banco.toastError).toHaveBeenCalledTimes(1);
  });

  it("a recusa também repõe o estoque atual das variações sem apagar o preço digitado", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await digitar("product-sale-price", "60,00");
    await editarVariacao();
    banco.produto.estoque = 9;
    banco.variacoes[0].stock_increment = 9;
    avancarVersao();
    const versaoAtual = banco.produto.ultima_atualizacao;
    await salvar();
    expect(
      (document.getElementById("product-stock") as HTMLInputElement).value,
    ).toBe("9");

    await act(async () => {
      const linha = host.querySelector('[data-testid="variante-cadastrada"]');
      (
        linha
          ?.closest("div.group")
          ?.querySelector("button") as HTMLButtonElement
      ).click();
    });
    expect(
      (document.getElementById("variant-stock") as HTMLInputElement).value,
    ).toBe("9");
    await digitar("variant-stock", "7");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Salvar variação")!
        .click();
    });
    await salvar();
    expect(banco.gravacoes).toBe(1);
    expect(banco.variacoes[0].stock_increment).toBe(7);
    expect(banco.produto.estoque).toBe(7);
    expect(banco.produto.preco_venda).toBe(60);
    expect(banco.chamadasRpc[1].p_base_atualizado_em).toBe(versaoAtual);
    expect(banco.filtros).toEqual([]);
  });

  it("duas gravações seguidas aceitam a versão devolvida pelo primeiro salvar", async () => {
    await act(async () => raiz.render(<SondaDoHook />));
    let primeira: Awaited<ReturnType<typeof api.updateProduct>>;
    await act(async () => {
      primeira = await api.updateProduct(
        "p-1",
        { stock: 8 },
        {
          baseUpdatedAt: banco.produto.ultima_atualizacao,
        },
      );
    });
    expect(primeira!.stock).toBe(8);
    const versao = primeira!.updatedAt;
    expect(versao).toBe(banco.produto.ultima_atualizacao);

    await act(async () => {
      const segunda = await api.updateProduct(
        "p-1",
        { stock: 7 },
        {
          baseUpdatedAt: versao,
        },
      );
      expect(segunda!.stock).toBe(7);
    });
    expect(banco.gravacoes).toBe(2);
    expect(banco.filtros[1]).toContainEqual(["ultima_atualizacao", versao]);
    expect(banco.toastError).not.toHaveBeenCalled();
  });

  it("produto sem variação também recusa a contagem que ficou velha", async () => {
    await montar();
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(banco.gravacoes).toBe(0);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.toastError).toHaveBeenCalledWith(
      "O estoque deste produto mudou enquanto você editava (agora está 9). Confira e salve de novo.",
    );
  });

  it("falha da RPC não grava nem produto nem grade; repetir usa a mesma base", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await editarVariacao();
    banco.falharVariacoes = true;
    await salvar();
    expect(banco.gravacoes).toBe(0);
    expect(banco.gravacoesDeVariacoes).toBe(0);
    const versaoDoPrimeiroSalvar = banco.produto.ultima_atualizacao;

    banco.falharVariacoes = false;
    await salvar();

    expect(banco.gravacoes).toBe(1);
    expect(banco.chamadasRpc[1].p_base_atualizado_em).toBe(
      versaoDoPrimeiroSalvar,
    );
    expect(banco.filtros).toEqual([]);
    expect(banco.variacoes[0].stock_increment).toBe(8);
  });

  it("grava estoque mexido se a versão ainda é a da abertura, sem perder microssegundos", async () => {
    await montar();
    await digitar("product-stock", "8");
    await salvar();
    expect(banco.produto.estoque).toBe(8);
    expect(banco.gravacoes).toBe(1);
    expect(banco.filtros[0]).toContainEqual([
      "ultima_atualizacao",
      "2026-10-21T13:00:00.123456+00:00",
    ]);
  });

  it("só preço continua salvando mesmo com venda externa, sem conferir versão", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(banco.produto.preco_venda).toBe(60);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.filtros[0]).toEqual([["id", "p-1"]]);
    expect(banco.toastError).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "também recusa estoque da variação quando ela está ligada=%s",
    async (active) => {
      banco.variacoes = [
        {
          id: "v-1",
          product_id: "p-1",
          name: "Cor",
          value: "Rosa",
          stock_increment: 10,
          active,
        },
      ];
      await montar();
      await editarVariacao();
      avancarVersao();
      await salvar();
      expect(banco.gravacoes).toBe(0);
      expect(banco.gravacoesDeVariacoes).toBe(0);
      expect(banco.toastError).toHaveBeenCalled();
    },
  );
});
