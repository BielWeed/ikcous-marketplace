// @vitest-environment jsdom
//
// Lote pdv-c5, tarefa C5.2 — o campo "Código de barras" no formulário de
// produto (no produto e em cada variação), com formato, duplicidade (na tela
// e pela RPC buscar_por_codigo_barras), rascunho e payload.
//
// Os casos desta fila são a especificação de frentes/pdv-c5.json (tarefa
// C5.2, itens 1–9 do bloco de testes, mais o teste do payload da VARIAÇÃO
// anotado pela revisão). O arquivo original desta sessão ficou AUSENTE nesta
// cópia (a pasta wip/novos não veio na passagem de bastão) — este foi
// reconstruído a partir da especificação e do molde
// admin-product-form-draft-e-duplo-clique.test.tsx (createRoot + act, sem
// @testing-library/react; LocalBufferedInput com debounce de 200ms; RPC do
// PDV mockada em @/lib/supabase).
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
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

// A duplicidade contra o catálogo inteiro é checada pela MESMA RPC do PDV
// (buscar_por_codigo_barras). A view importa o cliente Supabase por import
// DINÂMICO dentro de conferirCodigoNoBanco — o mock abaixo intercepta essa
// importação tardia do mesmo jeito que interceptaria um import estático.
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function campoPorId(id: string): HTMLInputElement {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) {
    throw new Error(`campo ausente nesta tela: #${id}`);
  }
  return el;
}

// LocalBufferedInput/LocalBufferedTextarea só propagam o valor digitado para
// o estado depois do debounce (200ms por padrão).
function digitarInput(id: string, valor: string) {
  const el = campoPorId(id);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// O onBlur do campo de código de barras (que dispara a RPC de duplicidade) é
// implementado pelo React sobre o evento nativo focusout — que borbulha, ao
// contrário do blur. Sair do campo = despachar focusout borbulhante.
function sairDoCampo(id: string) {
  campoPorId(id).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

// Resposta "livre" da RPC: as mesmas nove chaves de RespostaDoCodigo.
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

function respostaDeProduto(id: string, nome: string) {
  return {
    data: {
      encontrado: true,
      origem: "produto",
      codigo: "7891234567890",
      produto: {
        id,
        nome,
        ativo: true,
        preco_venda: 100,
        estoque: 1,
        imagem: null,
        codigo_barras: "7891234567890",
        tem_variantes: false,
      },
      variante: null,
      preco: 100,
      estoque: 1,
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

describe("AdminProductFormView — C5.2 campo Código de barras (produto e variação)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-produto-1" });
    updateProduct.mockResolvedValue({ id: "prod-edit-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue(respostaLivre());
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

  async function montarFormEdicao() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );

    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="prod-edit-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });

    // Flush do loadProduct() (fire-and-forget no useEffect de montagem).
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  // Preenche o mínimo para o botão "Publicar" habilitar. O debounce de
  // 200ms do LocalBufferedInput é flushado por uma espera real de 300ms.
  async function preencherFormularioValido(codigoBarras?: string) {
    await montarFormNovo();

    await act(async () => {
      digitarInput("product-name", "Produto Teste");
      digitarTextarea("product-description", "Descrição de teste");
      digitarInput("product-sale-price", "1000"); // vira R$ 10,00 (máscara)
      digitarInput("product-stock", "5");
      selecionarCategoria("Geral");
      if (codigoBarras !== undefined) {
        digitarInput("product-codigo-barras", codigoBarras);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  async function abrirModalDeVariante() {
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "+ Novo")!.click();
      await esperarMicrotarefas();
    });
  }

  // Efetiva uma variação com o código informado (o modal fecha ao final).
  // O modal vive num createPortal em document.body — a busca do botão é no
  // document inteiro, não no hospedeiro.
  async function efetivarVarianteComCodigo(codigo: string) {
    await abrirModalDeVariante();
    await act(async () => {
      digitarInput("variant-name", "Tamanho");
      digitarInput("variant-value", "PP");
      digitarInput("variant-codigo-barras", codigo);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await act(async () => {
      localizarBotaoPorTexto(document, "Efetivar Variante")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("1. o campo aparece no produto e, no modal, também na variação", async () => {
    await montarFormNovo();

    expect(campoPorId("product-codigo-barras")).toBeDefined();
    expect(
      campoPorId("product-codigo-barras").getAttribute("data-testid"),
    ).toBe("codigo-barras-produto");

    await abrirModalDeVariante();
    expect(campoPorId("variant-codigo-barras")).toBeDefined();
    expect(
      campoPorId("variant-codigo-barras").getAttribute("data-testid"),
    ).toBe("codigo-barras-variacao");
  });

  it("2. digitar '789 1234 567890' grava codigoBarras '7891234567890' no payload", async () => {
    await preencherFormularioValido("789 1234 567890");

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Publicar")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0].codigoBarras).toBe("7891234567890");
  });

  it("3. código curto demais mostra o erro de formato e bloqueia o salvar", async () => {
    await preencherFormularioValido("abc");

    expect(document.body.textContent).toContain(
      "Só letras, números e hífen, de 4 a 64 caracteres.",
    );

    const botao = localizarBotaoPorTexto(hospedeiro, "Publicar")!;
    expect(botao.disabled).toBe(true);

    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
    expect(addProduct).not.toHaveBeenCalled();
  });

  it("4. mesmo código no produto e na variação: duplicidade na tela bloqueia o salvar", async () => {
    await preencherFormularioValido("7891234567890");
    await efetivarVarianteComCodigo("7891234567890");

    expect(document.body.textContent).toContain(
      "Este código já está em outra variação deste produto.",
    );
    expect(localizarBotaoPorTexto(hospedeiro, "Publicar")!.disabled).toBe(true);

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Publicar")!.click();
      await esperarMicrotarefas();
    });
    expect(addProduct).not.toHaveBeenCalled();
  });

  it("5. RPC acha o código em outro produto: erro nomeia o produto e o salvar não chama o hook", async () => {
    rpcDoSupabase.mockResolvedValue(
      respostaDeProduto("outro-produto", "Camiseta Azul"),
    );
    await montarFormEdicao();

    await act(async () => {
      digitarInput("product-codigo-barras", "7891234567890");
    });
    await act(async () => {
      sairDoCampo("product-codigo-barras");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(document.body.textContent).toContain(
      "Este código já está em Camiseta Azul",
    );

    const botao = localizarBotaoPorTexto(hospedeiro, "Salvar")!;
    expect(botao.disabled).toBe(true);
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("6. RPC acha o PRÓPRIO produto em edição: sem erro e o salvar chama o hook", async () => {
    rpcDoSupabase.mockResolvedValue(
      respostaDeProduto("prod-edit-1", "Produto Existente"),
    );
    await montarFormEdicao();

    await act(async () => {
      digitarInput("product-codigo-barras", "7891234567890");
    });
    await act(async () => {
      sairDoCampo("product-codigo-barras");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(document.body.textContent).not.toContain("Este código já está em");

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Salvar")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][1].codigoBarras).toBe("7891234567890");
  });

  it("7. RPC fora do ar: não bloqueia — aviso discreto e o salvar chama o hook", async () => {
    const avisoConsole = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcDoSupabase.mockRejectedValue(new Error("fora do ar"));
    await preencherFormularioValido("7891234567890");

    await act(async () => {
      sairDoCampo("product-codigo-barras");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(document.body.textContent).toContain("Não consegui conferir agora");
    expect(document.body.textContent).not.toContain("Este código já está em");

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Publicar")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(addProduct).toHaveBeenCalledTimes(1);
    avisoConsole.mockRestore();
  });

  it("8. rascunho guarda e restaura o codigoBarras", async () => {
    vi.useFakeTimers();
    await montarFormNovo();

    await act(async () => {
      digitarInput("product-name", "Produto Teste");
      digitarInput("product-codigo-barras", "7891234567890");
      // Flush do debounce (200ms) do LocalBufferedInput.
      await vi.advanceTimersByTimeAsync(300);
    });

    // O auto-save agenda setTimeout(1000) quando o formulário está sujo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    const gravado = armazem.get("ikcous_product_form_draft");
    expect(gravado).toBeDefined();
    expect(JSON.parse(gravado!).codigoBarras).toBe("7891234567890");

    // Reabrir o formulário de produto novo restaura o rascunho no campo.
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await montarFormNovo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(campoPorId("product-codigo-barras").value).toBe("7891234567890");
  });

  it("9. mudar só o código de barras deixa o formulário sujo (onSetDirty true)", async () => {
    await montarFormNovo();

    await act(async () => {
      digitarInput("product-codigo-barras", "7891234567890");
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(onSetDirty).toHaveBeenCalledWith(true);
  });

  it("10. payload da VARIAÇÃO leva codigoBarras no variants[0] do addProduct", async () => {
    await preencherFormularioValido();
    await efetivarVarianteComCodigo("7892222222222");

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Publicar")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(addProduct.mock.calls[0][0].variants[0].codigoBarras).toBe(
      "7892222222222",
    );
  });
});

describe("AdminProductFormView — C5.2 ressalva da revisão: salvar espera a checagem em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-produto-1" });
    updateProduct.mockResolvedValue({ id: "prod-edit-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // RPC pendente até o teste resolver: é a checagem "em voo". O resolve só
  // existe quando a RPC for chamada de verdade — por isso o portal devolve
  // uma função que o lê NA HORA, não o valor (ainda indefinido) de agora.
  function rpcPendente(): (resposta: unknown) => void {
    const portal: { liberar?: (resposta: unknown) => void } = {};
    rpcDoSupabase.mockImplementation(
      () =>
        new Promise((resolve) => {
          portal.liberar = resolve;
        }),
    );
    return (resposta: unknown) => portal.liberar!(resposta);
  }

  async function preencherComCodigo() {
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

    await act(async () => {
      digitarInput("product-name", "Produto Teste");
      digitarTextarea("product-description", "Descrição de teste");
      digitarInput("product-sale-price", "1000");
      digitarInput("product-stock", "5");
      selecionarCategoria("Geral");
      digitarInput("product-codigo-barras", "7891234567890");
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  it("11. clique em Publicar com checagem em voo não grava: espera o veredito e bloqueia se duplicado", async () => {
    const liberar = rpcPendente();
    await preencherComCodigo();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Publicar")!.click();
      // Só microtarefas — a RPC continua PENDENTE (ninguém resolveu).
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // Checagem em voo: o hook NÃO pode ter sido chamado ainda.
    expect(addProduct).not.toHaveBeenCalled();

    await act(async () => {
      liberar(respostaDeProduto("outro-produto", "Camiseta Azul"));
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // Veredito chegou DUPLICADO: o salvar continua sem gravar e o erro
    // nomeia o produto dono do código.
    expect(addProduct).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Este código já está em Camiseta Azul",
    );
  });

  it("12. veredito em voo 'livre': o salvar segue depois da resposta", async () => {
    const liberar = rpcPendente();
    await preencherComCodigo();

    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Publicar")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(addProduct).not.toHaveBeenCalled();

    await act(async () => {
      liberar(respostaLivre());
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
  });
});

describe("AdminProductFormView — C5.2 ressalva da revisão: erro da variação não vaza ao reabrir o modal", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  const produtoComVariante = {
    ...produtoDoBanco,
    variants: [
      {
        id: "var-1",
        productId: "prod-edit-1",
        name: "Tamanho",
        value: "PP",
        sku: "",
        stockIncrement: 0,
        active: true,
        imageUrl: "",
        priceOverride: null,
        codigoBarras: "7891234567890",
      },
    ] as unknown[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-produto-1" });
    updateProduct.mockResolvedValue({ id: "prod-edit-1" });
    fetchProduct.mockResolvedValue(produtoComVariante);
    // A RPC acha o código em OUTRO produto: a variação editada não é a dona.
    rpcDoSupabase.mockResolvedValue(
      respostaDeProduto("outro-produto", "Camiseta Azul"),
    );
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function botaoEditarDaVariante(): HTMLButtonElement {
    const rotulo = document.querySelector(
      '[data-testid="variante-cadastrada"]',
    );
    if (!rotulo) throw new Error("nenhuma variação cadastrada na tela");
    const linha = rotulo.closest("div.group");
    if (!linha) throw new Error("linha da variação não encontrada");
    return linha.querySelector("button") as HTMLButtonElement;
  }

  async function montarFormEdicaoComVariante() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );

    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="prod-edit-1"
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });

    // Flush do loadProduct() e da renderização da lista de variações.
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("13. cancelar e reabrir a MESMA variação não mostra o erro antigo", async () => {
    await montarFormEdicaoComVariante();

    // Abre a variação em edição e sai do campo: a RPC acusa duplicado.
    await act(async () => {
      botaoEditarDaVariante().click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      sairDoCampo("variant-codigo-barras");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(document.body.textContent).toContain(
      "Este código já está em Camiseta Azul",
    );

    // Cancela (o botão do modal é o último "Cancelar" no document — o modal
    // vive num createPortal ao fim do body) e reabre a MESMA variação.
    await act(async () => {
      const cancelares = [...document.querySelectorAll("button")].filter((b) =>
        b.textContent?.includes("Cancelar"),
      );
      cancelares[cancelares.length - 1].click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      botaoEditarDaVariante().click();
      await esperarMicrotarefas();
    });

    // O erro antigo não pode ter sobrevivido: o campo nem chegou a ser
    // conferido de novo, e o valor do código não mudou entre as aberturas.
    expect(document.body.textContent).not.toContain("Este código já está em");
  });

  it("14. erro achado pelo SALVAR (com o modal fechado) não vaza para o próximo '+ Novo'", async () => {
    // Achado ANTES DE CRESCER da revisão: o gate do salvar escreve o erro de
    // duplicidade no estado do MODAL de variação — e o modal está fechado
    // durante o salvar. Sem limpar no "+ Novo", uma variação nova e inocente
    // abre bloqueada pelo erro de outro código.
    await montarFormEdicaoComVariante();

    // Salvar direto: a variação var-1 tem código que a RPC acusa duplicado.
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Salvar")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    // O salvar abortou com o veredito de duplicidade...
    expect(toastError).toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();

    // ...e o modal NOVO de variação abre limpo, sem o erro antigo.
    await act(async () => {
      const botaoNovo = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("+ Novo"),
      );
      botaoNovo!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(document.body.textContent).not.toContain("Este código já está em");
  });
});
