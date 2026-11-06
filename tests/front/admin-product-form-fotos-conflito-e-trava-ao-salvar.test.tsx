// @vitest-environment jsdom
//
// Três defeitos da tela de editar produto, todos na hora de salvar:
//
// (A) Fotos: quem salvava por último apagava, em silêncio, as fotos que o outro
//     aparelho acabara de mexer (a lista de fotos vai inteira e a conferência de
//     versão só existia para o estoque). Agora mexer nas fotos também confere a
//     versão: o salvar com cópia velha é recusado e a tela recarrega o produto
//     (as fotos do outro aparelho aparecem; a exclusão que a lojista fez fica).
// (B) Depois do aviso "alterado em outro aparelho", a tela oferecia OUTRO aviso
//     ("Rascunho não salvo encontrado"), sobre o que a lojista já tem na tela.
// (C) Enquanto aparece "Salvando..." e "Salvo" dava para editar campos e
//     excluir foto; o que se fazia nesse tempo nunca era salvo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  filtros: [] as Array<Array<[string, unknown]>>,
  patches: [] as Array<Record<string, unknown>>,
  variacoes: [] as Record<string, any>[],
  chamadasRpc: [] as any[],
  gravacoes: 0,
  versao: 0,
  portao: null as Promise<void> | null,
  toastError: vi.fn(),
  toastInfo: vi.fn(),
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
    info: banco.toastInfo,
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function avancarVersao() {
  banco.produto.ultima_atualizacao = `2026-10-21T13:00:0${++banco.versao}.123456+00:00`;
}

// O dublê só grava quando TODOS os filtros do UPDATE casam, como no banco.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
    // Caminho com grade: uma só RPC, que confere a versão no banco (PRD01).
    rpc: async (_nome: string, parametros: any) => {
      banco.chamadasRpc.push(structuredClone(parametros));
      if (
        parametros.p_base_atualizado_em !== null &&
        parametros.p_base_atualizado_em !== banco.produto.ultima_atualizacao
      )
        return { data: null, error: { code: "PRD01" } };
      Object.assign(banco.produto, parametros.p_produto);
      banco.gravacoes++;
      avancarVersao();
      return {
        data: {
          ultima_atualizacao: banco.produto.ultima_atualizacao,
          apagadas: [],
          recusadas: [],
        },
        error: null,
      };
    },
    from: (tabela: string) => {
      if (tabela === "product_variants") {
        return {
          select: () => ({
            eq: () =>
              Object.assign(
                Promise.resolve({
                  data: structuredClone(banco.variacoes),
                  error: null,
                }),
                { in: async () => ({ data: [], error: null }) },
              ),
          }),
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
              data: structuredClone(banco.produto),
              error: null,
            }),
            maybeSingle: async () => ({
              data: structuredClone(banco.produto),
              error: null,
            }),
          };
          return consulta;
        },
        update: (patch: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];
          banco.filtros.push(filtros);
          banco.patches.push(structuredClone(patch));
          const executar = async () => {
            if (banco.portao) await banco.portao;
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

const A = "https://cdn.teste/a.jpg";
const B = "https://cdn.teste/b.jpg";
const C = "https://cdn.teste/c.jpg";
const TEXTO_DO_CONFLITO =
  "Este produto foi alterado em outro aparelho enquanto você editava (estoque ou fotos). Os dados foram recarregados; confira e salve de novo.";

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
    const botao = [...host.querySelectorAll("button")].find((b) =>
      /^(Salvar alterações|Salvando|Salvo)/.test(b.textContent?.trim() ?? ""),
    );
    expect(botao).toBeDefined();
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
const botaoDaFoto = (titulo: string) =>
  document.querySelector<HTMLButtonElement>(`button[title="${titulo}"]`);
async function excluirAFotoEmFoco() {
  await act(async () => {
    botaoDaFoto("Excluir")!.click();
  });
}
const fotosNaTela = () =>
  [
    ...document.querySelectorAll(
      '[aria-label="Galeria de fotos do produto"] img',
    ),
  ].map((i) => i.getAttribute("src"));
function outroAparelhoAdicionaFoto(url: string) {
  banco.produto.imagem_urls = [...banco.produto.imagem_urls, url];
  avancarVersao();
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
    imagem_urls: [A, B],
    imagem_url: A,
    ultima_atualizacao: "2026-10-21T13:00:00.123456+00:00",
  };
  banco.filtros = [];
  banco.patches = [];
  banco.variacoes = [];
  banco.chamadasRpc = [];
  banco.gravacoes = 0;
  banco.versao = 0;
  banco.portao = null;
  banco.refresh.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  sessionStorage.clear();
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

describe("(A) mexer nas fotos confere a versão lida na abertura", () => {
  it("excluir foto com a cópia velha é recusado: não grava e não apaga a foto que o outro aparelho pôs", async () => {
    await montar();
    expect(fotosNaTela()).toEqual([A, B]);
    await excluirAFotoEmFoco();
    outroAparelhoAdicionaFoto(C);

    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(banco.produto.imagem_urls).toEqual([A, B, C]);
    expect(banco.toastError).toHaveBeenCalledWith(TEXTO_DO_CONFLITO);
  });

  it("depois da recusa a tela mostra a foto do outro aparelho, mantém a exclusão e o salvar seguinte não apaga a foto nova", async () => {
    await montar();
    await excluirAFotoEmFoco(); // tira A
    outroAparelhoAdicionaFoto(C);
    await salvar();
    expect(banco.gravacoes).toBe(0);

    expect(fotosNaTela()).toEqual([B, C]);

    const versaoAtual = banco.produto.ultima_atualizacao;
    await salvar();
    expect(banco.gravacoes).toBe(1);
    expect(banco.produto.imagem_urls).toEqual([B, C]);
    expect(banco.filtros[1]).toContainEqual([
      "ultima_atualizacao",
      versaoAtual,
    ]);
  });

  it("foto que o outro aparelho TIROU não volta pelo salvar com a lista velha", async () => {
    await montar();
    await excluirAFotoEmFoco(); // a lojista tira A
    banco.produto.imagem_urls = [A]; // o outro aparelho tirou B
    avancarVersao();
    await salvar();
    expect(banco.gravacoes).toBe(0);
    // A já tinha saído daqui; B saiu de lá: sobra nada de B, e A não volta.
    expect(fotosNaTela()).toEqual([]);
  });

  it("mexer nas fotos com a versão em dia grava e confere a versão", async () => {
    await montar();
    await excluirAFotoEmFoco();
    await salvar();
    expect(banco.gravacoes).toBe(1);
    expect(banco.produto.imagem_urls).toEqual([B]);
    expect(banco.filtros[0]).toContainEqual([
      "ultima_atualizacao",
      "2026-10-21T13:00:00.123456+00:00",
    ]);
    expect(banco.toastError).not.toHaveBeenCalled();
  });

  it("mexer só no preço, sem fotos nem estoque, segue sem conferir versão (as fotos do outro ficam)", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    outroAparelhoAdicionaFoto(C);
    await salvar();
    expect(banco.gravacoes).toBe(1);
    expect(banco.produto.preco_venda).toBe(60);
    expect(banco.produto.imagem_urls).toEqual([A, B, C]);
    expect(banco.filtros[0]).toEqual([
      ["id", "p-1"],
      ["deleted_at", null],
    ]);
    expect(banco.patches[0]).not.toHaveProperty("imagem_urls");
    expect(banco.toastError).not.toHaveBeenCalled();
  });
});

describe("(A) o mesmo com grade (uma só RPC que confere a versão)", () => {
  beforeEach(() => {
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

  it("excluir foto com a cópia velha: a RPC leva a versão da abertura, é recusada e as fotos do outro ficam", async () => {
    await montar();
    await excluirAFotoEmFoco();
    outroAparelhoAdicionaFoto(C);

    await salvar();

    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(
      "2026-10-21T13:00:00.123456+00:00",
    );
    expect(banco.gravacoes).toBe(0);
    expect(banco.produto.imagem_urls).toEqual([A, B, C]);
    expect(fotosNaTela()).toEqual([B, C]);
  });

  it("mexer só no preço, com grade, continua indo sem versão para conferir", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    await salvar();
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBeNull();
    expect(banco.gravacoes).toBe(1);
  });
});

describe("(B) conflito: só UM aviso, o do conflito", () => {
  async function guardarRascunhoDoPreco() {
    await montar();
    await digitar("product-sale-price", "60,00");
    // O salvamento automático grava o rascunho depois de ~1 s.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
  }
  const ofertasDeRascunho = () =>
    banco.toastInfo.mock.calls.filter((c) =>
      String(c[0]).includes("Rascunho não salvo encontrado"),
    );

  it("depois da recusa não aparece a oferta de restaurar rascunho", async () => {
    await guardarRascunhoDoPreco();
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();

    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(banco.toastError).toHaveBeenCalledTimes(1);
    expect(ofertasDeRascunho()).toHaveLength(0);
    // O que ela digitou continua na tela.
    expect(
      (document.getElementById("product-sale-price") as HTMLInputElement).value,
    ).toContain("60");
  });

  it("abrir o produto de novo, com rascunho guardado, continua oferecendo restaurar", async () => {
    await guardarRascunhoDoPreco();
    expect(ofertasDeRascunho()).toHaveLength(0);
    act(() => raiz.unmount());
    raiz = createRoot(host);
    await montar();
    expect(ofertasDeRascunho()).toHaveLength(1);
  });

  it("um segundo conflito também passa sem a oferta (o ref é consumido a cada vez, sem ficar preso)", async () => {
    await guardarRascunhoDoPreco();
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    await digitar("product-stock", "7");
    banco.produto.estoque = 6;
    avancarVersao();
    await salvar();
    expect(banco.toastError).toHaveBeenCalledTimes(2);
    expect(ofertasDeRascunho()).toHaveLength(0);
  });
});

describe("(C) enquanto salva, a edição fica travada", () => {
  const campo = () => document.getElementById("product-sale-price")!;
  const travado = (el: Element | null) =>
    el?.closest("fieldset")?.hasAttribute("disabled") ?? false;
  let soltar: () => void;
  beforeEach(() => {
    banco.portao = new Promise<void>((resolve) => {
      soltar = resolve;
    });
  });

  it("durante 'Salvando…' os campos e os botões da foto ficam desligados; recusado, voltam a ligar", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    expect(travado(campo())).toBe(false);
    expect(botaoDaFoto("Excluir")!.disabled).toBe(false);
    expect(botaoDaFoto("Ajustar e Cortar")!.disabled).toBe(false);

    // Venda externa: a gravação vai ser recusada (estoque mexido + versão velha).
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(host.textContent).toContain("Salvando...");
    expect(travado(campo())).toBe(true);
    expect(botaoDaFoto("Excluir")!.disabled).toBe(true);
    expect(botaoDaFoto("Ajustar e Cortar")!.disabled).toBe(true);

    await act(async () => {
      soltar();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(banco.gravacoes).toBe(0);
    expect(travado(campo())).toBe(false);
    expect(botaoDaFoto("Excluir")!.disabled).toBe(false);
    expect(botaoDaFoto("Ajustar e Cortar")!.disabled).toBe(false);
  });

  it("depois de gravar, durante o 'Salvo' (antes de voltar à lista) segue travado", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    await salvar();
    await act(async () => {
      soltar();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(banco.gravacoes).toBe(1);
    expect(host.textContent).toContain("Salvo");
    expect(travado(campo())).toBe(true);
    expect(botaoDaFoto("Excluir")!.disabled).toBe(true);
    expect(botaoDaFoto("Ajustar e Cortar")!.disabled).toBe(true);
  });

  it("o botão de salvar e o resto fora do corpo do formulário não ficam dentro da trava", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    await salvar();
    const rodape = [...host.querySelectorAll("button")].find((b) =>
      /^Salvando/.test(b.textContent?.trim() ?? ""),
    );
    expect(rodape).toBeDefined();
    expect(rodape!.closest("fieldset")).toBeNull();
    const cabecalho = host.querySelector("header");
    expect(cabecalho?.closest("fieldset")).toBeNull();
  });
});
