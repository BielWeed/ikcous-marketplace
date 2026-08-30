// @vitest-environment jsdom
//
// Prova da garantia central da Task 5: com PAGAMENTO_ONLINE_LIGADO desligada
// (VITE_PAGAMENTO_ONLINE fixada em "false" pelo beforeEach — mesma leitura
// de import.meta.env que o build usa), o CheckoutView tem que continuar
// idêntico ao de hoje: sem a opção "Pagar agora" na lista de meios de
// pagamento, sempre chamando a v23 (via createOrder(..., { comPagamentoOnline:
// false })) e nunca mostrando a tela de "Finalize o pagamento".
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO O DUBLÊ DE REACT
// de create-order-rpc.test.ts: aquele teste mocka useState/useEffect porque só
// precisa executar o CORPO de createOrder uma vez, síncrono. Aqui o objetivo é
// diferente — provar que a ÁRVORE renderizada muda (ou não muda) com a flag,
// e isso só existe no ciclo de vida real do React: form.formState.isValid
// precisa reagir a eventos de input de verdade, e o botão "Finalizar Pedido"
// só aparece depois que useDeferredRender(380) resolve.
//
// Todos os hooks que o CheckoutView consome de Context/Supabase são
// substituídos por dublês — o que resta é o próprio componente, o
// react-hook-form e o zodResolver de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-123" });
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
        product: {
          id: "prod-1",
          name: "Produto Teste",
          description: "",
          price: 100,
          images: [],
          category: "geral",
          stock: 10,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    clearCart,
    selectedShippingOption: null,
    shippingCep: "38500-000",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// `useOrders` mockado por completo: o que este arquivo testa é o que o
// CheckoutView PASSA para createOrder, não a escolha de RPC em si — essa já
// tem prova própria em create-order-rpc.test.ts (Task 3), com o supabase.rpc
// real mockado.
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));

// CHECKOUT-070 (#197): CheckoutView passou a importar `@/lib/supabase`
// direto (releitura de status no cancelamento) — sem mock aqui o import
// tentaria criar um client de verdade e explodiria em jsdom ("Web Worker is
// not supported"). Este arquivo não exercita o botão de cancelar, então o
// dublê nunca precisa responder nada.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// canvas-confetti tentaria abrir um canvas 2D que o jsdom não implementa —
// não é o que este arquivo testa, e o disparo dele aqui só serve de sinal de
// que o caminho de sucesso (não o de aguardando pagamento) foi tomado.
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// pagamento-online.test.tsx: sem ela o React reclama "not configured to
// support act(...)" em todo render, mesmo dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Simula digitação de verdade: seta o valor pelo setter nativo do input (não
 * pelo `.value =` do React, que o próprio React ignora) e dispara `input` —
 * é o evento que o `register()`/`Controller` do react-hook-form escuta. */
function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// O botão vive na barra inferior, que o componente monta via
// `createPortal(..., document.body)` — NÃO é descendente do host de render,
// por isso a busca é em `document.body`, não em `hospedeiro`.
function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView com PAGAMENTO_ONLINE_LIGADO desligada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // A PREMISSA DESTE ARQUIVO, FIXADA EM VEZ DE TORCIDA POR ELA.
    //
    // `PAGAMENTO_ONLINE_LIGADO` é calculada no topo de `src/lib/flags.ts`, a
    // partir de `import.meta.env.VITE_PAGAMENTO_ONLINE`. O Vite monta esse
    // objeto a partir dos arquivos `.env*` da raiz — inclusive `.env.local`,
    // que é ignorado pelo git e existe só na máquina de quem desenvolve.
    //
    // Medido em 23/08/2026: com `VITE_PAGAMENTO_ONLINE=true` no `.env.local`
    // desta máquina, este teste reprovava ("expected ... not to contain
    // 'Pagar agora'") enquanto o CI, que não tem `.env.local`, passava verde.
    // A suíte ficava vermelha por causa de um arquivo que o repositório nem
    // versiona — e o mesmo mecanismo poderia, no sentido contrário, deixar
    // este teste passar por acaso.
    //
    // O `stubEnv` roda ANTES do `await import("@/views/customer/CheckoutView")`
    // do corpo do teste, que é quando `flags.ts` é avaliado pela primeira vez.
    // Por isso o módulo REAL continua no caminho: o que se prova aqui ainda é
    // a leitura de verdade de `import.meta.env`, e não um dublê de `flags.ts`
    // como fazem os arquivos irmãos de flag LIGADA.
    vi.stubEnv("VITE_PAGAMENTO_ONLINE", "false");
    createOrder.mockClear();
    clearCart.mockClear();
    // O jsdom desta versão não expõe `window.localStorage` como Storage de
    // verdade (`getItem is not a function`) — o CheckoutView usa para
    // lembrar o último CEP digitado. Um dublê em memória é suficiente aqui.
    const armazem = new Map<string, string>();
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
    // `restoreAllMocks` NÃO desfaz `stubEnv` — são registros separados no
    // Vitest. Sem esta linha o valor fixado vazaria para qualquer teste que
    // viesse depois neste mesmo arquivo.
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("não mostra 'Pagar agora', chama createOrder com comPagamentoOnline:false e nunca mostra a tela de aguardando pagamento", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // Falha fechada, ponta a ponta: a opção só existiria com a flag ligada.
    expect(hospedeiro.textContent).not.toContain("Pagar agora");

    // Correção de 19/08/2026: CEP, cidade e estado do convidado deixaram de
    // vir pré-preenchidos com "38500-000"/"Monte Carmelo"/"MG" — o endereço é
    // de quem compra, e quem digita agora é o cliente. Sem estes três campos o
    // formulário fica inválido e o botão nasce apagado, que é o motivo pelo
    // qual este teste passou a falhar. Mesma correção já feita em
    // checkout-view-flag-on.test.tsx no commit 95e07b0.
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-city", "Cidade Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-state", "SP");
      await esperarMicrotarefas();
    });

    // O botão "Finalizar Pedido" só existe depois que useDeferredRender(380)
    // resolve — espera o tempo real, como o componente exige.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botao = localizarBotaoFinalizar();
    expect(botao).toBeDefined();
    expect(botao!.disabled).toBe(false);

    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(expect.anything(), {
      comPagamentoOnline: false,
    });
    expect(clearCart).toHaveBeenCalledTimes(1);

    // A garantia central: nunca a tela de "aguardando pagamento" — sempre o
    // caminho de sucesso de sempre.
    expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
    expect(hospedeiro.textContent).toContain("Pedido Celebrado!");
  });
});
