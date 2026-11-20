// @vitest-environment jsdom
import { useProducts } from "@/hooks/useProducts";
import { chaveDoRascunhoDoProduto } from "@/lib/rascunho-do-produto";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  variacoes: [] as Record<string, any>[],
  filtros: [] as Array<Array<[string, unknown]>>,
  gravacoes: 0,
  gravacoesDeVariacoes: 0,
  versao: 0,
  falharVariacoes: false,
  chamadasRpc: [] as any[],
  conferirCodigo: vi.fn(),
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
      if (nome === "buscar_por_codigo_barras") {
        return banco.conferirCodigo(parametros);
      }
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
                ([campo, valor]) =>
                  (valoresAtuais.get(campo) ?? null) === valor,
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
            // `deleted_at IS NULL`: o produto do dublê nunca foi excluído.
            is: (campo: string, valor: unknown) => {
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
      (b) => b.textContent?.trim() === "Salvar alterações",
    );
    expect(botao?.disabled).toBe(false);
    botao!.click();
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function confirmarPrecoDigitado() {
  const botao = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Confirmar preço digitado",
  );
  expect(botao).toBeDefined();
  await act(async () => botao!.click());
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
  it("se a rede cai durante a conferência do código, não dá Salvo nem perde o rascunho", async () => {
    banco.produto.codigo_barras = "7890000000001";
    const rede = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let liberarConferencia!: () => void;
    banco.conferirCodigo.mockReturnValueOnce(
      new Promise((resolve) => {
        liberarConferencia = () =>
          resolve({ data: { encontrado: false }, error: null });
      }),
    );

    await montar();
    await digitar("product-name", "Camiseta editada");
    const chave = chaveDoRascunhoDoProduto("lojista-1", "p-1");
    const fila = "products_offline_updates_queue:lojista-1";
    const barra = host.querySelector('[aria-label="Ações do produto"]');
    if (!chave || !barra) throw new Error("Formulário de edição incompleto");
    const botao = [...barra.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar alterações",
    );
    if (!botao) throw new Error("Botão Salvar não está na tela");
    expect(botao.disabled).toBe(false);

    vi.useFakeTimers();
    try {
      await act(async () => botao.click());
      expect(banco.conferirCodigo).toHaveBeenCalledWith({
        p_codigo: "7890000000001",
      });
      expect(botao.textContent).toContain("Salvando");
      expect(JSON.parse(localStorage.getItem(chave) ?? "{}").name).toBe(
        "Camiseta editada",
      );

      rede.mockReturnValue(false);
      await act(async () => liberarConferencia());
      await act(async () => vi.advanceTimersByTimeAsync(2000));

      expect.soft(barra.textContent).not.toContain("Salvo");
      expect.soft(botao.textContent?.trim()).toBe("Salvar alterações");
      expect.soft(botao.disabled).toBe(false);
      expect
        .soft(JSON.parse(localStorage.getItem(chave) ?? "{}").name)
        .toBe("Camiseta editada");
      expect.soft(navegar).not.toHaveBeenCalled();
      expect.soft(localStorage.getItem(fila)).toBeNull();
      expect.soft(banco.gravacoes).toBe(0);
      expect
        .soft(banco.toastError)
        .toHaveBeenCalledWith(
          expect.stringMatching(/Sem conexão.*não foi salvo/),
        );
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem conexão ao gravar, recusa sem tentar reler o produto", async () => {
    await montar();
    await digitar("product-name", "Camiseta editada");
    const chave = chaveDoRascunhoDoProduto("lojista-1", "p-1")!;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { supabase } = await import("@/lib/supabase");
    const consultarBanco = vi.spyOn(supabase, "from");
    await salvar();

    expect(consultarBanco).not.toHaveBeenCalled();
    expect(banco.toastError).toHaveBeenCalledWith(
      expect.stringMatching(/Sem conexão.*não foi salvo/),
    );
    expect(banco.gravacoes).toBe(0);
    expect(host.textContent).not.toContain("Salvo · voltando à lista");
    expect(localStorage.getItem(chave)).not.toBeNull();
    expect(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Salvar alterações",
      )?.disabled,
    ).toBe(false);
    expect(navegar).not.toHaveBeenCalled();
  });

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
    await escolherAtributo(0, "Cor", "variant-name", digitar);
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
    // A nova já tem o id real e nenhuma das duas foi mexida desde a releitura:
    // nada de variação no segundo salvar (nem uma linha sem id, que duplicaria).
    expect(banco.chamadasRpc[1].p_variantes).toEqual([]);
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
      (b) => b.textContent?.trim() === "Salvar alterações",
    );
    expect(botao?.disabled).toBe(true);
  });

  it("online ao editar só o nome não manda base nem o estoque velho da grade", async () => {
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
    await digitar("product-name", "Camiseta de algodão");
    banco.variacoes[0].stock_increment = 9;
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBeNull();
    expect(banco.produto.nome).toBe("Camiseta de algodão");
    // A variação não foi mexida: não viaja, e o estoque dela (9) fica o do banco.
    expect(banco.chamadasRpc[0].p_variantes).toEqual([]);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.variacoes[0].stock_increment).toBe(9);
  });

  it("offline com grade não enfileira o preço nem grava a grade separadamente", async () => {
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
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await digitar("product-sale-price", "60,00");
    await salvar();
    expect(banco.chamadasRpc).toEqual([]);
    expect(banco.gravacoesDeVariacoes).toBe(0);
    expect(
      localStorage.getItem("products_offline_updates_queue:lojista-1"),
    ).toBeNull();
    const chave = chaveDoRascunhoDoProduto("lojista-1", "p-1")!;
    expect(JSON.parse(localStorage.getItem(chave) ?? "{}").price).toBe("60.00");
  });

  it.each([
    { inicial: 10, digitado: [], saldo: 9, esperado: 9 },
    { inicial: 10, digitado: [], saldo: 0, esperado: 0 },
    { inicial: 0, digitado: [], saldo: 9, esperado: 9 },
    { inicial: 10, digitado: ["8"], saldo: 9, esperado: 8 },
    { inicial: 10, digitado: ["8", "10"], saldo: 9, esperado: 10 },
  ])(
    "após conflito, usa $esperado na primeira variação e no produto (de $inicial para $saldo, digitado $digitado)",
    async ({ inicial, digitado, saldo, esperado }) => {
      banco.produto.estoque = inicial;
      await montar();
      await act(async () => {
        [...host.querySelectorAll("button")]
          .find((b) => b.textContent?.includes("+ Novo"))!
          .click();
      });
      const estoque =
        document.querySelector<HTMLInputElement>("#variant-stock")!;
      expect(estoque.value).toBe(String(inicial));
      // Entrar e sair do campo sem digitar não transforma a herança em edição.
      await act(async () => {
        estoque.focus();
        estoque.blur();
      });
      await escolherAtributo(0, "Cor", "variant-name", digitar);
      await digitar("variant-value", "Rosa");
      for (const quantidade of digitado) {
        await digitar("variant-stock", quantidade);
      }
      await act(async () => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent?.trim() === "Salvar variação")!
          .click();
      });

      banco.produto.estoque = saldo;
      avancarVersao();
      await salvar();
      expect(banco.gravacoes).toBe(0);
      expect(banco.chamadasRpc).toHaveLength(1);
      expect(
        document.querySelector<HTMLInputElement>("#product-stock")?.value,
      ).toBe(String(esperado));

      await salvar();
      expect(banco.gravacoes).toBe(1);
      expect(banco.produto.estoque).toBe(esperado);
      expect(banco.variacoes).toHaveLength(1);
      expect(banco.variacoes[0].stock_increment).toBe(esperado);
    },
  );

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
    // Depois da recusa a tela mostra o estoque atual (9); sem nada mudado, o
    // segundo toque nem faz UPDATE (um UPDATE vazio não é pedido válido).
    expect(banco.filtros).toHaveLength(1);
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
    await confirmarPrecoDigitado();
    await salvar();
    expect(banco.gravacoes).toBe(1);
    expect(banco.variacoes[0].stock_increment).toBe(7);
    expect(banco.produto.estoque).toBe(7);
    expect(banco.produto.preco_venda).toBe(60);
    expect(banco.chamadasRpc[1].p_base_atualizado_em).toBe(versaoAtual);
    expect(banco.filtros).toEqual([]);
  });

  // A recusa traz o produto de hoje. A variação que OUTRO aparelho criou
  // nesse meio-tempo tem de aparecer no formulário: se ficar de fora, o
  // rascunho que a tela grava logo depois guarda "base com a D, grade sem a D",
  // e Restaurar + Salvar a trataria como exclusão da lojista e a apagaria.
  it("a recusa traz ao formulário a variação criada em outro aparelho, sem mandá-la apagar", async () => {
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
    // O preço digitado é o que deixa o formulário "sujo" depois da recusa
    // (o estoque volta ao do banco) e, por isso, o que gera o rascunho.
    await digitar("product-sale-price", "60,00");
    await editarVariacao();
    banco.variacoes.push({
      id: "v-2",
      product_id: "p-1",
      name: "Cor",
      value: "Azul",
      stock_increment: 4,
      active: true,
    });
    banco.produto.estoque = 14;
    avancarVersao();

    await salvar();
    expect(banco.gravacoes).toBe(0);
    expect(
      host.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ).toHaveLength(2);

    // O autosave grava o rascunho depois de ~1 s: ele tem de levar as duas.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
    const bruto = localStorage.getItem(
      chaveDoRascunhoDoProduto("lojista-1", "p-1") as string,
    );
    expect(bruto).not.toBeNull();
    const rascunho = JSON.parse(bruto as string);
    const ids = (rascunho.variants ?? []).map((v: { id: string }) => v.id);
    expect(ids).toContain("v-2");
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
      "Este produto foi alterado em outro aparelho enquanto você editava (estoque ou fotos). Os dados foram recarregados; confira e salve de novo.",
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

  it.each([
    ["product-sale-price", { preco_venda: 50 }, "105,00", { preco_venda: 120 }],
    ["product-cost-price", { custo: 10 }, "15,00", { custo: 20 }],
    [
      "product-original-price",
      { preco_original: 60 },
      "105,00",
      { preco_original: 120 },
    ],
  ])(
    "editar só o campo %s na aba antiga não apaga o valor salvo pela outra pessoa",
    async (campo, valoresNaAbertura, digitado, valoresConcorrentes) => {
      Object.assign(banco.produto, valoresNaAbertura);
      await montar();
      await digitar(campo, digitado);
      Object.assign(banco.produto, valoresConcorrentes);
      avancarVersao();

      await salvar();

      expect(banco.produto).toMatchObject(valoresConcorrentes);
      expect(banco.gravacoes).toBe(0);
      expect(banco.filtros[0]).toContainEqual([
        "ultima_atualizacao",
        "2026-10-21T13:00:00.123456+00:00",
      ]);
      expect(banco.toastError).toHaveBeenCalledWith(
        "Outra pessoa alterou este produto depois que você abriu. Recarregue e confira o preço antes de salvar.",
      );
      expect((document.getElementById(campo) as HTMLInputElement).value).toBe(
        digitado,
      );
      expect(navegar).not.toHaveBeenCalled();

      // Atualizar estoque e fotos no aviso não atualiza o preço na tela.
      await salvar();
      expect(banco.gravacoes).toBe(0);
      expect(banco.produto).toMatchObject(valoresConcorrentes);
    },
  );

  it("grava só o preço quando a versão ainda é a da abertura", async () => {
    await montar();
    await digitar("product-sale-price", "105,00");

    await salvar();

    expect(banco.produto.preco_venda).toBe(105);
    expect(banco.produto.estoque).toBe(10);
    expect(banco.gravacoes).toBe(1);
    expect(banco.filtros[0]).toContainEqual([
      "ultima_atualizacao",
      "2026-10-21T13:00:00.123456+00:00",
    ]);
    expect(banco.toastError).not.toHaveBeenCalled();
  });

  describe("preço do produto com grade existente", () => {
    beforeEach(() => {
      banco.produto.preco_venda = 100;
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
    });

    async function editarPrecoEmDuasAbas() {
      await montar();
      await digitar("product-sale-price", "110,00");
      banco.produto.preco_venda = 120;
      avancarVersao();
      await salvar();
    }

    it("mostra os dois preços sem gravar e preserva o rascunho", async () => {
      await editarPrecoEmDuasAbas();

      expect(banco.produto.preco_venda).toBe(120);
      expect(banco.gravacoes).toBe(0);
      expect(banco.gravacoesDeVariacoes).toBe(0);
      expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(
        "2026-10-21T13:00:00.123456+00:00",
      );
      const aviso = host.querySelector('[role="alert"]');
      expect(aviso?.textContent).toContain(
        "Este produto mudou depois que você abriu a tela. Nada foi salvo.",
      );
      expect(aviso?.textContent).toMatch(/Atual:.*120,00.*Digitado:.*110,00/s);
      expect(
        (document.getElementById("product-sale-price") as HTMLInputElement)
          .value,
      ).toBe("110,00");
      expect(
        JSON.parse(
          localStorage.getItem(chaveDoRascunhoDoProduto("lojista-1", "p-1")!)!,
        ).price,
      ).toBe("110.00");
      expect(navegar).not.toHaveBeenCalled();
    });

    it("grava o preço com a versão da abertura quando ninguém mais salvou", async () => {
      await montar();
      await digitar("product-sale-price", "110,00");
      await salvar();

      expect(banco.produto.preco_venda).toBe(110);
      expect(banco.gravacoes).toBe(1);
      expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(
        "2026-10-21T13:00:00.123456+00:00",
      );
      expect(banco.toastError).not.toHaveBeenCalled();
    });

    it("grava só a descrição sem exigir versão nem repor o preço antigo", async () => {
      await montar();
      const campo = document.querySelector<HTMLTextAreaElement>(
        "#product-description",
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(campo, "Algodão macio");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
      });
      banco.produto.preco_venda = 120;
      avancarVersao();
      await salvar();

      expect(banco.produto).toMatchObject({
        descricao: "Algodão macio",
        preco_venda: 120,
      });
      expect(banco.chamadasRpc[0]).toMatchObject({
        p_base_atualizado_em: null,
        p_produto: { descricao: "Algodão macio" },
      });
      expect(banco.chamadasRpc[0].p_produto).not.toHaveProperty("preco_venda");
      expect(banco.toastError).not.toHaveBeenCalled();
    });

    it("segundo clique e envio por teclado não gravam o preço sem confirmação", async () => {
      await editarPrecoEmDuasAbas();

      const botao = [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Salvar alterações",
      );
      expect(botao?.disabled).toBe(true);
      await act(async () => {
        botao!.click();
        host
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(banco.produto.preco_venda).toBe(120);
      expect(banco.gravacoes).toBe(0);
      expect(banco.chamadasRpc).toHaveLength(1);
    });

    it("após confirmar, salva na versão exibida sem repor o custo que ela não editou", async () => {
      banco.produto.custo = 20;
      await montar();
      await digitar("product-sale-price", "110,00");
      Object.assign(banco.produto, { preco_venda: 120, custo: 25 });
      avancarVersao();
      await salvar();
      const versaoConferida = banco.produto.ultima_atualizacao;
      await confirmarPrecoDigitado();
      expect(banco.gravacoes).toBe(0);
      await salvar();

      expect(banco.produto.preco_venda).toBe(110);
      expect(banco.gravacoes).toBe(1);
      expect(banco.chamadasRpc[1].p_base_atualizado_em).toBe(versaoConferida);
      expect(banco.chamadasRpc[1].p_produto).not.toHaveProperty("custo");
      expect(banco.produto.custo).toBe(25);
    });

    it("se outro preço chegar após o aviso, confirmar não dá permissão para sobrescrevê-lo", async () => {
      await editarPrecoEmDuasAbas();
      banco.produto.preco_venda = 130;
      avancarVersao();
      await confirmarPrecoDigitado();
      await salvar();

      expect(banco.produto.preco_venda).toBe(130);
      expect(banco.gravacoes).toBe(0);
      expect(host.querySelector('[role="alert"]')?.textContent).toMatch(
        /Atual:.*130,00.*Digitado:.*110,00/s,
      );
    });
  });

  it("preço junto com estoque continua recusando a edição desatualizada", async () => {
    await montar();
    await digitar("product-sale-price", "105,00");
    await digitar("product-stock", "8");
    banco.produto.preco_venda = 120;
    banco.produto.estoque = 9;
    avancarVersao();

    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(banco.produto).toMatchObject({ preco_venda: 120, estoque: 9 });

    await digitar("product-stock", "7");
    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(banco.produto).toMatchObject({ preco_venda: 120, estoque: 9 });
  });

  it("outro campo continua salvando após uma venda sem repor estoque nem preço", async () => {
    await montar();
    await digitar("product-name", "Camiseta de algodão");
    banco.produto.estoque = 9;
    banco.produto.preco_venda = 120;
    avancarVersao();

    await salvar();

    expect(banco.produto.nome).toBe("Camiseta de algodão");
    expect(banco.produto.estoque).toBe(9);
    expect(banco.produto.preco_venda).toBe(120);
    expect(banco.filtros[0]).toEqual([
      ["id", "p-1"],
      ["deleted_at", null],
    ]);
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
