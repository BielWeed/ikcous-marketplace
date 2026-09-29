// @vitest-environment jsdom
//
// Lote pdv-c5, tarefa C5.3 — o botão "Ler com a câmera" (LeitorDeCodigo do
// PDV em modo "unico", carregado por import dinâmico) e a opção "Tirar foto"
// (input separado com capture="environment"; a galeria continua sem capture,
// e os dois inputs compartilham o mesmo handler).
//
// Os casos são a especificação de frentes/pdv-c5.json (tarefa C5.3, bloco de
// testes 1–6). O arquivo original ficou AUSENTE nesta cópia (a pasta
// wip/novos não veio na passagem de bastão) — reconstruído a partir da
// especificação e do molde admin-product-form-draft-e-duplo-clique.test.tsx.
// O LeitorDeCodigo é substituído por um dublê que expõe as props recebidas
// (o modo vai num data-attribute) e entrega uma leitura pelo botão "bipar" —
// o import real é dinâmico (React.lazy) e o vi.mock o intercepta igual.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();
const rpcDoSupabase = vi.fn();

// O caso 6 prova que os dois inputs de imagem compartilham o handler pela
// guarda offline (o mesmo toast para os dois) — por isso o mock precisa ser
// mutável por teste.
let estaOffline = false;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estaOffline,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
}));

// Dublê do leitor: expõe o modo recebido num data-attribute (prova do
// modo="unico") e entrega uma leitura pronta pelo botão "bipar".
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    modo,
    aoLer,
    aoFechar,
  }: {
    modo?: string;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
    aoFechar: () => void;
  }) => (
    <div data-testid="duble-leitor" data-modo={modo ?? ""}>
      <button
        type="button"
        onClick={() => aoLer({ codigo: "7891234567890", formato: "ean_13" })}
      >
        bipar
      </button>
      <button type="button" onClick={aoFechar}>
        fechar leitor
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    name?: string;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

const toastInfo = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão do
// molde admin-product-form-draft-e-duplo-clique.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `navigator.mediaDevices` não existe no jsdom; o botão "Ler com a câmera"
// só existe quando `navigator.mediaDevices?.getUserMedia` é função. Um só
// defineProperty cobre os dois estados (com e sem câmera) — sem `delete`
// (regra noDelete do biome) e com `writable` para poder trocar entre testes.
function definirCamera(comCamera: boolean): void {
  Object.defineProperty(navigator, "mediaDevices", {
    value: comCamera ? { getUserMedia: vi.fn() } : undefined,
    configurable: true,
    writable: true,
  });
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotoesPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement[] {
  return [...raizDom.querySelectorAll("button")].filter((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement[];
}

function localizarBotaoUnico(texto: string): HTMLButtonElement {
  const botoes = localizarBotoesPorTexto(document, texto);
  if (botoes.length !== 1) {
    throw new Error(
      `esperava exatamente 1 botão "${texto}", achei ${botoes.length}`,
    );
  }
  return botoes[0];
}

function campoPorId(id: string): HTMLInputElement {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) {
    throw new Error(`campo ausente nesta tela: #${id}`);
  }
  return el;
}

function respostaLivre() {
  return {
    data: {
      encontrado: false,
      origem: null,
      codigo: "",
      produto: null,
      variante: null,
      preco: null,
      estoque: null,
      variacoes: [],
    },
    error: null,
  };
}

const produtoDoBanco = {
  id: "prod-edit-1",
  name: "Produto Existente",
  description: "Descrição existente",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

describe("AdminProductFormView — C5.3 ler com a câmera e tirar foto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    estaOffline = false;
    addProduct.mockResolvedValue({ id: "novo-produto-1" });
    updateProduct.mockResolvedValue({ id: "prod-edit-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue(respostaLivre());
    definirCamera(true);
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    definirCamera(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montarFormNovo() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );

    await act(async () => {
      raiz.render(
        <AdminProductFormView
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
  }

  async function abrirModalDeVariante() {
    await act(async () => {
      localizarBotaoUnico("+ Novo").click();
      await esperarMicrotarefas();
    });
  }

  it("1. o botão 'Ler com a câmera' aparece no produto e, no modal, na variação", async () => {
    await montarFormNovo();

    expect(localizarBotoesPorTexto(document, "Ler com a câmera").length).toBe(
      1,
    );

    await abrirModalDeVariante();
    expect(localizarBotoesPorTexto(document, "Ler com a câmera").length).toBe(
      2,
    );
  });

  it("2. sem câmera (sem mediaDevices) o botão não aparece", async () => {
    definirCamera(false);
    await montarFormNovo();

    expect(localizarBotoesPorTexto(document, "Ler com a câmera").length).toBe(
      0,
    );
  });

  it("3. clicar abre o leitor carregado sob demanda em modo 'unico'", async () => {
    await montarFormNovo();

    expect(document.querySelector('[data-testid="duble-leitor"]')).toBeNull();

    await act(async () => {
      localizarBotaoUnico("Ler com a câmera").click();
      // Flush do import dinâmico (React.lazy) atrás do Suspense.
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const duble = document.querySelector(
      '[data-testid="duble-leitor"]',
    ) as HTMLElement | null;
    expect(duble).not.toBeNull();
    expect(duble!.getAttribute("data-modo")).toBe("unico");
  });

  it("4. bipar preenche o campo do produto, fecha o leitor e dispara a checagem de duplicidade", async () => {
    await montarFormNovo();

    await act(async () => {
      localizarBotaoUnico("Ler com a câmera").click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    await act(async () => {
      localizarBotaoUnico("bipar").click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(campoPorId("product-codigo-barras").value).toBe("7891234567890");
    expect(document.querySelector('[data-testid="duble-leitor"]')).toBeNull();
    expect(rpcDoSupabase).toHaveBeenCalledWith("buscar_por_codigo_barras", {
      p_codigo: "7891234567890",
    });
  });

  it("5. bipar no modal preenche o campo da variação e dispara a mesma checagem", async () => {
    await montarFormNovo();
    await abrirModalDeVariante();

    // Com o modal aberto existem DOIS botões "Ler com a câmera" (produto e
    // variação); o do modal é o último no document (createPortal no body).
    const botoesDaCamera = localizarBotoesPorTexto(
      document,
      "Ler com a câmera",
    );
    expect(botoesDaCamera.length).toBe(2);

    await act(async () => {
      botoesDaCamera[botoesDaCamera.length - 1].click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    await act(async () => {
      localizarBotaoUnico("bipar").click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(campoPorId("variant-codigo-barras").value).toBe("7891234567890");
    expect(document.querySelector('[data-testid="duble-leitor"]')).toBeNull();
    expect(rpcDoSupabase).toHaveBeenCalledWith("buscar_por_codigo_barras", {
      p_codigo: "7891234567890",
    });
  });

  it("6. 'Tirar foto' é input com capture='environment' e compartilha o handler da galeria", async () => {
    // A prova do handler compartilhado usa a guarda offline: com a tela
    // offline, enviar por QUALQUER um dos dois inputs produz o MESMO toast
    // de recusa — antes de qualquer processamento de arquivo.
    estaOffline = true;
    await montarFormNovo();

    const captura = campoPorId("product-image-capture");
    const galeria = campoPorId("product-image-upload");
    expect(captura.getAttribute("capture")).toBe("environment");
    expect(galeria.getAttribute("capture")).toBeNull();

    const recusas = () =>
      toastError.mock.calls.filter(
        (chamada) =>
          chamada[0] === "Não é possível enviar imagens em modo offline.",
      ).length;

    await act(async () => {
      captura.dispatchEvent(new Event("change", { bubbles: true }));
      await esperarMicrotarefas();
    });
    expect(recusas()).toBe(1);

    await act(async () => {
      galeria.dispatchEvent(new Event("change", { bubbles: true }));
      await esperarMicrotarefas();
    });
    expect(recusas()).toBe(2);
  });

  it("7. o leitor abre dentro de um overlay fixo acima dos modais (z-[120])", async () => {
    // Achado BLOQUEIA da revisão em contexto limpo: sem o overlay, o painel
    // do leitor nasce no fim do fluxo da página — fora da vista no alvo
    // produto e ATRÁS do overlay do modal de variação (z-[100]). O jsdom não
    // faz empilhamento visual, então a prova aqui é estrutural: o leitor
    // precisa ter um ancestral com overlay fixo z-[120] enquanto aberto.
    await montarFormNovo();

    await act(async () => {
      localizarBotaoUnico("Ler com a câmera").click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const container = document.querySelector(
      '[data-testid="container-do-leitor"]',
    );
    expect(container).not.toBeNull();
    expect(container!.className).toContain("fixed");
    expect(container!.className).toContain("z-[120]");
    // O dublê do leitor vive DENTRO desse container, não solto na página.
    expect(
      container!.querySelector('[data-testid="duble-leitor"]'),
    ).not.toBeNull();
  });
});
