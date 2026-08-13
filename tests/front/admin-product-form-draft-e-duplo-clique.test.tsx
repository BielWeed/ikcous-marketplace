// @vitest-environment jsdom
//
// Issue #98 (ADMIN-060) — dois defeitos do ciclo de vida do formulário de
// produto, cobertos neste arquivo:
//
// 1. Duplo clique em "Publicar"/"Salvar" cria produto duplicado: depois do
//    sucesso, `setIsSubmitting(false)` roda ANTES do `setTimeout` de
//    navegação (1,5s) — nessa janela o botão mostra "Salvo" mas o `disabled`
//    só olhava `isSubmitting`, não `showSuccess`. Segundo clique real,
//    disparado pelo próprio DOM, reentra em `handleSubmit`.
// 2. Ao ABRIR um produto para edição, `formData` nasce igual a `initialData`
//    (os dois vêm do mesmo `product` carregado). O efeito de auto-save (a
//    cada 1s) via `isProductFormDirty(formData, initialData)` conclui que o
//    formulário está "limpo" e removia a chave do rascunho do localStorage —
//    enquanto o toast "Rascunho não salvo encontrado" ainda promete
//    restauração por 10s. O consertado: o auto-save nunca remove a chave;
//    remoção só acontece por decisão explícita (Restaurar ou Descartar).
//
// Segue o padrão já usado em address-form-cep-race.test.tsx e
// checkout-view-flag-on.test.tsx: sem @testing-library/react (não instalado
// neste projeto) — createRoot + act do React puro, localStorage stubado com
// um Map de verdade (não um mock estático), e os hooks de dados
// (useProducts, useCategories, useOnlineStatus, useStore) mockados para
// isolar exatamente o estado do componente que tem o bug.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

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

// Isola o teste da implementação real do Radix Select (que precisa de
// ResizeObserver/PointerEvent para abrir o dropdown em jsdom) — o que este
// arquivo testa é o ciclo de vida do formulário, não o componente de select.
// Um <select> nativo tem a mesma interface observável (value + onChange) que
// o handleSubmit e o auto-save precisam.
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
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

// LocalBufferedInput/LocalBufferedTextarea só propagam o valor digitado para
// `formData` depois de `delay` (200ms por padrão) — bater o "input" e seguir
// em frente não é o que um usuário real alcança nem o que o componente lê.
function digitarInput(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
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

describe("AdminProductFormView — #98 duplo clique cria produto duplicado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-produto-1" });
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

  async function preencherFormularioValido() {
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
      digitarInput("product-sale-price", "1000"); // vira R$ 10,00 (mask currency)
      digitarInput("product-stock", "5");
      selecionarCategoria("Geral");
      // Flush do debounce (200ms) do LocalBufferedInput/LocalBufferedTextarea.
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  it("clicar duas vezes rápido em Publicar chama addProduct UMA vez só", async () => {
    await preencherFormularioValido();

    const botao = localizarBotaoPorTexto(hospedeiro, "Publicar")!;
    expect(botao).toBeDefined();
    expect(botao.disabled).toBe(false);

    // Primeiro clique: submete, addProduct resolve, e entra na janela de
    // "Salvo" (showSuccess=true) que dura 1,5s antes de navegar.
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(botao.textContent).toContain("Salvo");

    // Critério de aceite: o disabled do botão inclui showSuccess — na janela
    // "Salvo" o botão tem de estar desabilitado, não só durante isSubmitting.
    expect(botao.disabled).toBe(true);

    // Segundo clique, ainda dentro da janela de 1,5s. Um botão disabled não
    // dispara onClick nem em jsdom nem em navegador real — é exatamente essa
    // barreira que faltava antes do conserto.
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
  });

  it("desmontar durante a janela de 'Salvo' cancela a navegação pendente", async () => {
    // preencherFormularioValido() espera 300ms REAIS para o debounce do
    // LocalBufferedInput flushar — vira fake timers só DEPOIS disso, senão
    // aquele setTimeout nunca dispara e o teste trava até o timeout do
    // runner (foi exatamente isso que aconteceu na primeira versão deste
    // arquivo).
    await preencherFormularioValido();
    vi.useFakeTimers();

    const botao = localizarBotaoPorTexto(hospedeiro, "Publicar")!;

    await act(async () => {
      botao.click();
      // addProduct() é uma Promise nativa (microtarefa) — não depende de
      // timer nenhum, então basta ceder o loop de eventos, não avançar
      // tempo fake.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();

    // Sai da tela ANTES do setTimeout de 1,5s dar a navegação por conta
    // própria — como um admin que clica em "Voltar" logo depois de salvar.
    await act(async () => {
      raiz.unmount();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Critério de aceite: o setTimeout de navegação é guardado em ref e
    // cancelado no unmount — sem isso, onNavigate dispararia depois que a
    // tela já não existe mais.
    expect(onNavigate).not.toHaveBeenCalled();

    // Recria a raiz para o afterEach não tentar desmontar de novo.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  // Achado da re-revisão (antes de crescer): o `else` que a #98 removeu era
  // o único coletor de lixo da chave de rascunho de produto NOVO. O
  // `handleSubmit` remove a chave antes de o timer de auto-save já agendado
  // (schedulado na última edição, antes do clique) disparar — e esse timer
  // grava tudo de volta 1s depois, porque `isDirty` compara `formData` (que
  // ainda tem os dados digitados) contra o `initialData` de nascença
  // (formulário vazio), não contra o produto recém-publicado.
  //
  // Fake timers ATIVADOS ANTES do render (não depois) — é essa ordem que
  // faz o setTimeout(1s) do auto-save existir de verdade no relógio fake,
  // em vez de ficar preso no relógio real e nunca disparar dentro da vida
  // do teste.
  it("publicar não deixa o auto-save já agendado replantar o rascunho depois", async () => {
    vi.useFakeTimers();

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
      digitarInput("product-sale-price", "1000"); // vira R$ 10,00 (mask currency)
      digitarInput("product-stock", "5");
      selecionarCategoria("Geral");
      // Flush do debounce (200ms) do LocalBufferedInput/LocalBufferedTextarea
      // — o auto-save agenda seu próprio setTimeout(1000) logo em seguida,
      // AINDA PENDENTE quando o clique abaixo acontece.
      await vi.advanceTimersByTimeAsync(300);
    });

    const botao = localizarBotaoPorTexto(hospedeiro, "Publicar")!;
    expect(botao.disabled).toBe(false);

    await act(async () => {
      botao.click();
      // addProduct() é uma Promise nativa — basta ceder o loop de eventos
      // para o handleSubmit terminar o bloco try/catch, sem depender de
      // avançar tempo fake.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(armazem.has("ikcous_product_form_draft")).toBe(false);

    // Avança além de 1s: o timer de auto-save agendado ANTES do clique
    // dispara agora.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Critério de aceite: a chave não voltou — não que foi removida no
    // instante do clique (isso já acontecia antes do conserto), mas que
    // ela continua ausente depois que o timer pendente tinha a chance de
    // regravá-la.
    expect(armazem.has("ikcous_product_form_draft")).toBe(false);
  });
});

describe("AdminProductFormView — #98 auto-save apaga rascunho ao abrir para edição", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const draftKey = "ikcous_product_form_draft_edit_prod-edit-1";
  const rascunhoDivergente = {
    name: "Produto Editado (rascunho não salvo)",
  };

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

  beforeEach(() => {
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoDoBanco);
    armazem = new Map();
    armazem.set(draftKey, JSON.stringify(rascunhoDivergente));
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

  // `comFakeTimers`: o efeito de auto-save agenda o próprio setTimeout(1s)
  // assim que o componente monta — para o teste de 30s conseguir avançar ESSE
  // timer específico com `vi.advanceTimersByTimeAsync`, os fake timers têm
  // que estar ativos ANTES do render, não depois. (Ativar depois deixa aquele
  // setTimeout(1s) preso no relógio REAL, e o teste passaria por acidente,
  // sem nunca deixar o auto-save rodar de verdade — foi o que aconteceu na
  // primeira versão deste arquivo.) Os outros três testes deste describe não
  // dependem desse timer específico, então usam o flush por microtarefa real
  // de sempre.
  async function abrirProdutoParaEdicao({ comFakeTimers = false } = {}) {
    if (comFakeTimers) vi.useFakeTimers();

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

    // Flush do loadProduct() (fire-and-forget dentro do useEffect) e do
    // efeito de verificação do rascunho, que depende de isLoading virar
    // false.
    await act(async () => {
      if (comFakeTimers) {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await esperarMicrotarefas();
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      }
    });
  }

  it("o toast de rascunho pendente aparece ao abrir o produto", async () => {
    await abrirProdutoParaEdicao();

    expect(toastInfo).toHaveBeenCalledWith(
      "Rascunho não salvo encontrado para este produto",
      expect.objectContaining({ duration: 10000 }),
    );
  });

  it("#98 espera 30s sem digitar nada: o rascunho continua no localStorage, intocado", async () => {
    await abrirProdutoParaEdicao({ comFakeTimers: true });

    // Sanidade: neste ponto formData === initialData (o produto acabou de
    // carregar), então o auto-save calcula isDirty=false — é exatamente a
    // condição que antes disparava o `localStorage.removeItem(draftKey)`.
    expect(armazem.get(draftKey)).toBe(JSON.stringify(rascunhoDivergente));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    // Critério de aceite da #98: abrir um produto com rascunho pendente,
    // esperar 30s (bem mais que o debounce de 1s do auto-save) sem digitar
    // nada — o rascunho ainda está lá, intocado, porque o formulário nunca
    // ficou sujo (isDirty=false). O auto-save NUNCA remove; só uma decisão
    // explícita do usuário (Restaurar/Descartar) remove.
    expect(armazem.has(draftKey)).toBe(true);
    expect(armazem.get(draftKey)).toBe(JSON.stringify(rascunhoDivergente));
  });

  it("achado que bloqueou a #99: digitar enquanto o toast de rascunho está aberto (sem decisão) volta a gravar a cada 1s", async () => {
    // Este é o teste que prova o conserto do achado que bloqueou a revisão:
    // uma versão anterior baixava `draftResolvedRef.current` para `false` ao
    // detectar o rascunho divergente e só voltava a `true` nos onClick dos
    // botões do toast (Restaurar/Descartar). O toast tem `duration: 10000` e
    // nenhum onAutoClose — se o admin não clicasse em nada, a flag ficava
    // presa em `false` pelo RESTO da sessão de edição, e o efeito de
    // auto-save (que checava a flag) retornava cedo em toda mudança de
    // `formData` dali em diante. Resultado: o admin digitava por 15 minutos e
    // nada era gravado — o `localStorage` continuava com o rascunho de ontem.
    //
    // Este teste falha se a guarda da flag voltar: ela nunca sobe para
    // `true` sem um clique explícito no toast, então o `setItem` abaixo
    // jamais aconteceria e o `armazem.get(draftKey)` continuaria igual ao
    // rascunho antigo.
    await abrirProdutoParaEdicao({ comFakeTimers: true });

    // Sanidade: o toast de rascunho pendente está aberto, ninguém decidiu.
    expect(toastInfo).toHaveBeenCalledWith(
      "Rascunho não salvo encontrado para este produto",
      expect.objectContaining({ duration: 10000 }),
    );
    expect(armazem.get(draftKey)).toBe(JSON.stringify(rascunhoDivergente));

    // Admin digita, sem clicar em nada do toast.
    await act(async () => {
      digitarInput("product-name", "Editado depois de 15 minutos");
      // Flush do debounce de 200ms do LocalBufferedInput.
      await vi.advanceTimersByTimeAsync(200);
    });

    // Flush do debounce de 1s do auto-save.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const gravado = armazem.get(draftKey);
    expect(gravado).toBeDefined();
    expect(gravado).not.toBe(JSON.stringify(rascunhoDivergente));
    expect(JSON.parse(gravado!).name).toBe("Editado depois de 15 minutos");
  });

  it("Restaurar aplica o rascunho no formulário (decisão explícita nº1)", async () => {
    await abrirProdutoParaEdicao();

    const chamada = toastInfo.mock.calls.find(
      (c) => c[0] === "Rascunho não salvo encontrado para este produto",
    );
    expect(chamada).toBeDefined();
    const acaoRestaurar = chamada![1].action;
    expect(acaoRestaurar.label).toBe("Restaurar");

    await act(async () => {
      acaoRestaurar.onClick();
    });

    const nome = document.getElementById("product-name") as HTMLInputElement;
    expect(nome.value).toBe(rascunhoDivergente.name);
  });

  it("Descartar remove o rascunho do localStorage (decisão explícita nº2)", async () => {
    await abrirProdutoParaEdicao();

    const chamada = toastInfo.mock.calls.find(
      (c) => c[0] === "Rascunho não salvo encontrado para este produto",
    );
    const acaoDescartar = chamada![1].cancel;
    expect(acaoDescartar).toBeDefined();
    expect(acaoDescartar.label).toBe("Descartar");

    expect(armazem.has(draftKey)).toBe(true);

    await act(async () => {
      acaoDescartar.onClick();
    });

    // Aqui a remoção É esperada — não é o auto-save fazendo isso sozinho, é
    // a decisão explícita do usuário.
    expect(armazem.has(draftKey)).toBe(false);
  });
});
