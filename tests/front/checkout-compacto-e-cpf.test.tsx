// @vitest-environment jsdom
//
// CHECKOUT COMPACTO + CPF (23/09/2026, pedido do dono): "Dados de
// Identificação" e "Seus Endereços" viraram UMA seção só ("Seus dados e
// entrega"), com resumo compacto quando preenchidos, e ganhou o campo de
// CPF do destinatário — exigido só quando a entrega escolhida é
// TRANSPORTADORA (o Melhor Envio exige `to.document` para emitir a
// etiqueta). Este arquivo prova o CONTRATO da tela nova, não a regra de
// frete × pagamento (isso já está em checkout-transportadora-exige-
// antecipado.test.tsx) nem a reconciliação de CEP (checkout-frete-
// automatico-troca-de-endereco.test.tsx, de onde este harness foi
// herdado).
//
// A ShippingCalculator é a REAL (com `modoResumo`, só como o checkout
// passa) — só assim dá para provar que trocar de opção/endereço RECOTA de
// verdade (o `invoke` do calculate-shipping recebe o CEP novo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const {
  estadoEnderecos,
  contaEstavel,
  invoke,
  espelho,
  createOrder,
  toastError,
  estadoLoja,
  cpfDaConta,
} = vi.hoisted(() => ({
  estadoEnderecos: { lista: [] as Address[] },
  contaEstavel: {
    user: { id: "user-1", user_metadata: { name: "Cliente Teste" } },
    profile: { full_name: "", whatsapp: "" },
  },
  invoke: vi.fn(),
  espelho: {
    selecionada: null as ShippingOption | null,
    shippingCep: null as string | null,
  },
  createOrder: vi.fn(),
  toastError: vi.fn(),
  estadoLoja: { isLoaded: true },
  cpfDaConta: { ler: vi.fn(), gravar: vi.fn() },
}));

const produto: Product = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 100,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CARRINHO: CartItem[] = [{ product: produto, quantity: 1 }];

const CASA: Address = {
  id: "end-casa",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
};
const TRABALHO: Address = {
  id: "end-trabalho",
  user_id: "user-1",
  name: "Trabalho",
  recipient_name: "Cliente Teste",
  cep: "01001-000",
  street: "Praça da Sé",
  number: "1",
  complement: "",
  neighborhood: "Sé",
  city: "São Paulo",
  state: "SP",
  reference: "",
  is_default: false,
};

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 5,
  deliveryDays: 1,
  provider: "local",
};
const PAC_SP: ShippingOption = {
  id: "melhorenvio-pac",
  name: "PAC",
  price: 30,
  deliveryDays: 6,
  provider: "melhor_envio",
};
const SEDEX_SP: ShippingOption = {
  id: "melhorenvio-sedex",
  name: "SEDEX",
  price: 54,
  deliveryDays: 3,
  provider: "melhor_envio",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: estadoLoja.isLoaded,
  }),
}));

// CPF da conta (get_my_cpf/set_my_cpf) — dublê controlável por teste. O
// padrão (beforeEach) é leitura que FALHA: o checkout se comporta como se
// não soubesse se a conta tem CPF (não preenche, não mostra a caixa, não
// grava), que é o que os testes mais antigos deste arquivo esperam.
vi.mock("@/lib/cpf-da-conta", () => ({
  lerCpfDaConta: (...a: unknown[]) => cpfDaConta.ler(...a),
  gravarCpfDaConta: (...a: unknown[]) => cpfDaConta.gravar(...a),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: contaEstavel.user,
    profile: contaEstavel.profile,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useEffect, useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    useEffect(() => {
      espelho.selecionada = selecionada;
      espelho.shippingCep = shippingCep;
    }, [selecionada, shippingCep]);
    return {
      cart: CARRINHO,
      cartTotal: 100,
      shippingFee: selecionada?.price ?? 0,
      freteIndefinido: !selecionada,
      freteGratis: false,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: selecionada,
      shippingCep,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
      setSelectedShippingOption: setSelecionada,
      setShippingCep,
    };
  }
  return { useCart: useCartComEstado };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});
vi.mock("@/hooks/useEconomiaDoFreteExibida", () => ({
  useEconomiaDoFreteExibida: () => 0,
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Diferente do dublê "em voo" de checkout-frete-automatico-troca-de-
 * endereco.test.tsx (que este harness herdou): aqui a cotação resolve NA
 * HORA para cada CEP conhecido — os testes deste arquivo são sobre a
 * seção "Seus dados e entrega" e o CPF, não sobre corrida de respostas. */
function cotacoesControladas(porCep: Record<string, ShippingOption[]>) {
  const mapa = new Map(Object.entries(porCep));
  invoke.mockImplementation(
    (_nome: string, opts: { body: { cep?: string; action?: string } }) => {
      if (opts.body.action === "revisao_config_frete") {
        return Promise.resolve({
          data: { revisaoConfig: "rev-fixa" },
          error: null,
        });
      }
      const cep = opts.body.cep as string;
      const opcoes = mapa.get(cep);
      if (!opcoes) {
        return Promise.resolve({
          data: { options: [], cotacaoIncompleta: false },
          error: null,
        });
      }
      return Promise.resolve({
        data: { options: opcoes, revisaoConfig: "rev-fixa" },
        error: null,
      });
    },
  );
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function cabecalhoDaSecao(): HTMLButtonElement {
  return document.getElementById(
    "cabecalho-dados-e-entrega",
  ) as HTMLButtonElement;
}

function corpoDaSecao(): HTMLElement {
  return document.getElementById("secao-dados-e-entrega") as HTMLElement;
}

function botaoFinalizar(): HTMLButtonElement {
  return document.querySelector(
    'button[aria-label="Finalizar pedido"]',
  ) as HTMLButtonElement;
}

/** O `disabled` do DOM ignora `.click()` (a trava REAL de UI): quem prova
 * a guarda INTERNA de `handleSubmitEvent` (redundante de propósito, ver o
 * comentário dela em CheckoutView.tsx) é o handler capturado dos props do
 * React — mesmo padrão de checkout-transportadora-exige-antecipado.test.tsx. */
function capturarOnClickFinalizar(botao: HTMLButtonElement): () => void {
  const chaveProps = Object.keys(botao).find((k) =>
    k.startsWith("__reactProps$"),
  );
  expect(chaveProps, "botão sem props do React (__reactProps$)").toBeDefined();
  const onClick = (botao as unknown as Record<string, unknown>)[chaveProps!] as
    | { onClick?: () => void }
    | undefined;
  expect(typeof onClick?.onClick, "botão sem onClick capturado").toBe(
    "function",
  );
  return onClick!.onClick!;
}

function trocarFrete(): HTMLButtonElement | undefined {
  const secao = document.querySelector('section[aria-label="Entrega e frete"]');
  return [...(secao?.querySelectorAll("button") ?? [])].find((b) =>
    b.textContent?.includes("Trocar"),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — checkout compacto (Seus dados e entrega) + CPF do destinatário", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazemSessao: Map<string, string>;

  beforeEach(() => {
    estadoEnderecos.lista = [CASA, TRABALHO];
    contaEstavel.user = {
      id: "user-1",
      user_metadata: { name: "Cliente Teste" },
    };
    contaEstavel.profile = { full_name: "", whatsapp: "" };
    espelho.selecionada = null;
    espelho.shippingCep = null;
    invoke.mockReset();
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-1" });
    toastError.mockReset();
    estadoLoja.isLoaded = true;
    cpfDaConta.ler.mockReset();
    cpfDaConta.ler.mockResolvedValue({ ok: false, motivo: "falha" });
    cpfDaConta.gravar.mockReset();
    cpfDaConta.gravar.mockResolvedValue({ ok: true });
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
    armazemSessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => armazemSessao.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazemSessao.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazemSessao.delete(chave);
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
  });

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await drenar();
  }

  async function escolherEndereco(apelido: string) {
    const cartao = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>('[role="button"]'),
    ).find((el) => el.textContent?.includes(apelido));
    expect(cartao, `cartão do endereço ${apelido}`).toBeDefined();
    await act(async () => {
      cartao?.click();
    });
    await drenar();
  }

  it("nasce SEMPRE recolhida (revisão do dono, 23/09) — mesmo antes de preencher nome/WhatsApp; preenchida, o resumo mostra nome, WhatsApp abreviado e o endereço escolhido", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();

    // Recolhida desde o primeiro paint, mesmo com nome/WhatsApp vazios —
    // não existe mais heurística "abre se incompleto".
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");
    expect(corpoDaSecao().hidden).toBe(true);

    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();

    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");
    expect(corpoDaSecao().hidden).toBe(true);
    const resumo = hospedeiro.textContent ?? "";
    expect(resumo).toContain("Maria Teste");
    // Abreviado: DDD + últimos 4, nunca o número inteiro no resumo.
    expect(resumo).toContain("(34)");
    expect(resumo).toContain("8888");
    expect(resumo).not.toContain("999998888");
    expect(resumo).toContain("Casa");
  });

  it("resumo recolhido aponta CADA pendência — nome, WhatsApp e endereço (guest) faltando", async () => {
    contaEstavel.user = null as any;
    contaEstavel.profile = null as any;
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();

    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-nome"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-whatsapp"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-endereco"]'),
    ).not.toBeNull();

    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await drenar();
    // Preencheu o nome: a pendência dele some, as outras continuam.
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-nome"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-whatsapp"]'),
    ).not.toBeNull();
  });

  it("cabeçalho é um <button type=button> com aria-expanded/aria-controls corretos, e clicar alterna — a MESMA seção que o teclado nativo de um <button> já ativa por Enter/Espaço", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();

    const cabecalho = cabecalhoDaSecao();
    expect(cabecalho.tagName).toBe("BUTTON");
    expect(cabecalho.getAttribute("type")).toBe("button");
    expect(cabecalho.getAttribute("aria-controls")).toBe(
      "secao-dados-e-entrega",
    );
    expect(corpoDaSecao().getAttribute("aria-labelledby")).toBe(
      "cabecalho-dados-e-entrega",
    );

    // Preenche até recolher sozinho...
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");

    // ...e o clique no cabeçalho reabre.
    await act(async () => {
      cabecalho.click();
    });
    await drenar();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");
    expect(corpoDaSecao().hidden).toBe(false);

    // Clicar de novo recolhe.
    await act(async () => {
      cabecalho.click();
    });
    await drenar();
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
  });

  it("trocar de endereço pelo resumo recota: o calculate-shipping recebe o CEP novo", async () => {
    cotacoesControladas({
      "38500000": [LOCAL],
      "01001000": [PAC_SP],
    });
    await montar();
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");
    expect(espelho.selecionada?.id).toBe("local-delivery");

    // "Trocar" do resumo do endereço reabre a seção para escolher outro.
    const trocarEndereco = botaoPorTexto("Trocar");
    expect(trocarEndereco).toBeDefined();
    await act(async () => {
      trocarEndereco?.click();
    });
    await drenar();
    expect(corpoDaSecao().hidden).toBe(false);

    await escolherEndereco("Trabalho");

    const chamouComCepNovo = invoke.mock.calls.some(
      (chamada) =>
        (chamada[1] as { body?: { cep?: string } })?.body?.cep === "01001000",
    );
    expect(chamouComCepNovo).toBe(true);
    expect(espelho.selecionada?.id).toBe("melhorenvio-pac");
  });

  it("trocar a opção de frete pelo resumo da ShippingCalculator: escolhe outra opção sem esconder a lista permanentemente", async () => {
    cotacoesControladas({ "38500000": [PAC_SP, SEDEX_SP] });
    await montar();

    // Opção pronta + auto-selecionada (primeira da lista) — a calculadora
    // resume atrás de "Trocar" (modoResumo, só no checkout).
    expect(espelho.selecionada?.id).toBe("melhorenvio-pac");
    const trocar = trocarFrete();
    expect(trocar).toBeDefined();

    await act(async () => {
      trocar?.click();
    });
    await drenar();
    const sedex = botaoPorTexto("SEDEX");
    expect(sedex).toBeDefined();
    await act(async () => {
      sedex?.click();
    });
    await drenar();

    expect(espelho.selecionada?.id).toBe("melhorenvio-sedex");
  });

  it("dados incompletos: a seção já nasce recolhida, e submeter abre e marca o campo inválido — trava o Finalizar, sem criar pedido", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await drenar();
    // Nasce recolhida mesmo com nome/WhatsApp vazios (revisão do dono,
    // 23/09/2026) — é o SUBMIT que reabre, não uma heurística de
    // completude.
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");

    const botao = botaoFinalizar();
    expect(botao.disabled).toBe(true);
    const onClickReal = capturarOnClickFinalizar(botao);
    await act(async () => {
      onClickReal();
    });
    await drenar();

    expect(toastError).toHaveBeenCalledWith(
      "Por favor, preencha todos os campos obrigatórios corretamente.",
    );
    expect(createOrder).not.toHaveBeenCalled();
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("true");
    expect(corpoDaSecao().hidden).toBe(false);
    const nomeInput = document.getElementById("checkout-name");
    expect(nomeInput?.getAttribute("aria-invalid")).toBe("true");
  });

  it("CPF inválido BLOQUEIA o Finalizar com transportadora, e NÃO bloqueia com entrega local", async () => {
    cotacoesControladas({
      "38500000": [LOCAL],
      "01001000": [PAC_SP],
    });
    await montar();
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
    // Local: sem campo de CPF, sem exigência — Finalizar livre (pagamento
    // "na entrega" ainda precisa ser escolhido).
    expect(document.getElementById("checkout-cpf")).toBeNull();
    await act(async () => {
      botaoPorTexto("Dinheiro na Entrega")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(false);

    // Troca para o Trabalho (transportadora): agora o CPF é exigido, e
    // ainda não foi preenchido — Finalizar trava de novo.
    const trocarEndereco = botaoPorTexto("Trocar");
    await act(async () => {
      trocarEndereco?.click();
    });
    await drenar();
    await escolherEndereco("Trabalho");
    await act(async () => {
      botaoPorTexto("Pagar agora com PIX")?.click();
    });
    await drenar();
    expect(document.getElementById("checkout-cpf")).not.toBeNull();
    expect(botaoFinalizar().disabled).toBe(true);
    // Revisão do dono (23/09/2026): escolher endereço volta a RECOLHER
    // sempre, mesmo com o CPF passando a faltar — o resumo recolhido é
    // quem avisa a pendência (substitui a revisão anterior que forçava a
    // seção aberta nesse caso).
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("false");
    expect(corpoDaSecao().hidden).toBe(true);
    expect(
      document.querySelector('[data-testid="checkout-resumo-falta-cpf"]'),
    ).not.toBeNull();
    const avisoNaBarra = document.querySelector<HTMLButtonElement>(
      '[data-testid="checkout-pendencia-identificacao"]',
    );
    expect(avisoNaBarra?.textContent).toContain("Informe o CPF de quem recebe");

    // O aviso na barra leva ao campo oculto sem liberar pedido sem CPF.
    await act(async () => {
      avisoNaBarra?.click();
    });
    await drenar();
    expect(cabecalhoDaSecao().getAttribute("aria-expanded")).toBe("true");
    expect(corpoDaSecao().hidden).toBe(false);
    expect(document.activeElement?.id).toBe("checkout-cpf");

    // CPF com dígito verificador errado: continua bloqueado.
    await act(async () => {
      digitar("checkout-cpf", "11144477736");
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("CPF válido chega em createOrder como 11 dígitos em customer.cpf, e nunca aparece nas notas do pedido", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    // Já chega no destino de transportadora (Trabalho não é o padrão, mas
    // this teste seleciona explicitamente).
    await montar();
    await escolherEndereco("Trabalho");
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await act(async () => {
      digitar("checkout-cpf", "111.444.777-35");
    });
    await drenar();
    await act(async () => {
      botaoPorTexto("Pagar agora com PIX")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(false);

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.customer.cpf).toBe("11144477735");
    const notas = String(pedido.notes ?? "");
    expect(notas).not.toContain("111.444.777-35");
    expect(notas).not.toContain("11144477735");
  });

  it("addressData leva {cpf} (11 dígitos) pronto para a RPC em transportadora — 23/09/2026, migration 20261172", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await escolherEndereco("Trabalho");
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await act(async () => {
      digitar("checkout-cpf", "111.444.777-35");
    });
    await drenar();
    await act(async () => {
      botaoPorTexto("Pagar agora com PIX")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(false);

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    // Cliente logado: o endereço em si viaja por addressId (endereço já
    // salvo) — addressData carrega SÓ o CPF, sempre em dígitos, nunca a
    // máscara. É este objeto que a migration 20261172 espera em
    // p_address_data para gravar em customer_data.cpf.
    expect(pedido.addressData).toEqual({ cpf: "11144477735" });
  });

  it("addressData NÃO ganha a chave cpf em entrega local — nem a exigência, nem o envio à RPC", async () => {
    cotacoesControladas({ "38500000": [LOCAL] });
    await montar();
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await drenar();
    await act(async () => {
      botaoPorTexto("Dinheiro na Entrega")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(false);

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    // Local: nunca exigido, então customerInfo.cpf é undefined e o gate
    // `exigeCpfDoDestinatario && customerInfo.cpf` some — addressData
    // continua exatamente como era antes do CPF (null para logado).
    expect(pedido.addressData).toBeNull();
  });

  it("CPF digitado em transportadora e depois troca para entrega local: o CPF NÃO viaja (revisão Opus 23/09)", async () => {
    cotacoesControladas({
      "38500000": [LOCAL],
      "01001000": [PAC_SP],
    });
    await montar();
    await escolherEndereco("Trabalho");
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await act(async () => {
      digitar("checkout-cpf", "111.444.777-35");
    });
    await drenar();

    // Volta para a Casa (entrega local): o CPF já digitado continua no
    // formulário, mas a exigência acabou — não pode ir para a RPC.
    const trocar = botaoPorTexto("Trocar");
    if (trocar) {
      await act(async () => {
        trocar.click();
      });
      await drenar();
    }
    await escolherEndereco("Casa");
    await act(async () => {
      botaoPorTexto("Dinheiro na Entrega")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(false);

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedido] = createOrder.mock.calls[0];
    expect(pedido.addressData).toBeNull();
    expect(JSON.stringify(pedido.addressData ?? {})).not.toContain(
      "11144477735",
    );
  });

  it("CPF NUNCA entra no rascunho da sessão (sessionStorage) — nome/WhatsApp/endereço continuam sobrevivendo à volta ao carrinho", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await escolherEndereco("Trabalho");
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    await act(async () => {
      digitar("checkout-cpf", "111.444.777-35");
    });
    await drenar();

    const chaves = [...armazemSessao.keys()];
    expect(chaves.length).toBeGreaterThan(0);
    const bruto = chaves
      .map((chave) => armazemSessao.get(chave) ?? "")
      .join("\n");
    // Nem a máscara nem os dígitos crus do CPF, em nenhuma chave gravada.
    expect(bruto).not.toContain("111.444.777-35");
    expect(bruto).not.toContain("11144477735");
    // Controle: o resto do formulário SOBREVIVE de propósito (regressão do
    // próprio rascunho, que este teste não deve quebrar).
    expect(bruto).toContain("Maria Teste");
  });

  // ─── CPF da conta no checkout (23/09/2026, revisão de segurança + dono) ───
  // O campo é o CPF do DESTINATÁRIO (pode ser um presenteado). Ele sempre vai
  // no pedido; só vai para a CONTA com a confirmação explícita "Este CPF é
  // meu e quero salvá-lo na minha conta", desmarcada por padrão, e só quando
  // a conta está sem CPF.

  async function finalizarComTransportadora(cpfDigitado?: string) {
    await escolherEndereco("Trabalho");
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
    });
    await act(async () => {
      digitar("checkout-tel", "34999998888");
    });
    if (cpfDigitado) {
      await act(async () => {
        digitar("checkout-cpf", cpfDigitado);
      });
    }
    await drenar();
    await act(async () => {
      botaoPorTexto("Pagar agora com PIX")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(false);
  }

  function caixaSalvarNaConta(): HTMLInputElement | null {
    return document.getElementById(
      "checkout-salvar-cpf-na-conta",
    ) as HTMLInputElement | null;
  }

  it("conta SEM CPF: a caixa 'Este CPF é meu' aparece DESMARCADA; finalizar sem marcar manda o CPF no pedido e NÃO grava na conta", async () => {
    cpfDaConta.ler.mockResolvedValue({ ok: true, cpf: null });
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await finalizarComTransportadora("111.444.777-35");

    expect(caixaSalvarNaConta()).not.toBeNull();
    expect(caixaSalvarNaConta()?.checked).toBe(false);
    expect(caixaSalvarNaConta()?.closest("label")?.textContent).toContain(
      "Este CPF é meu e quero salvá-lo na minha conta",
    );

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].addressData).toEqual({
      cpf: "11144477735",
    });
    expect(cpfDaConta.gravar).not.toHaveBeenCalled();
  });

  it("conta SEM CPF + caixa MARCADA: depois do pedido grava na conta o mesmo CPF (11 dígitos), uma vez", async () => {
    cpfDaConta.ler.mockResolvedValue({ ok: true, cpf: null });
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await finalizarComTransportadora("111.444.777-35");

    await act(async () => {
      caixaSalvarNaConta()?.click();
    });
    expect(caixaSalvarNaConta()?.checked).toBe(true);

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(cpfDaConta.gravar).toHaveBeenCalledTimes(1);
    expect(cpfDaConta.gravar).toHaveBeenCalledWith("11144477735");
  });

  it("conta JÁ com CPF: o campo vem preenchido, a caixa não aparece e nada é gravado na conta", async () => {
    cpfDaConta.ler.mockResolvedValue({ ok: true, cpf: "52998224725" });
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await finalizarComTransportadora();

    const campo = document.getElementById("checkout-cpf") as HTMLInputElement;
    expect(campo.value).toBe("529.982.247-25");
    expect(caixaSalvarNaConta()).toBeNull();

    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();

    expect(createOrder.mock.calls[0][0].addressData).toEqual({
      cpf: "52998224725",
    });
    expect(cpfDaConta.gravar).not.toHaveBeenCalled();
  });

  it("CPF da conta carregado depois do frete libera Finalizar sem redigitar o campo", async () => {
    let resolverCpf!: (resultado: { ok: true; cpf: string }) => void;
    cpfDaConta.ler.mockReturnValue(
      new Promise((resolve) => {
        resolverCpf = resolve;
      }),
    );
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await escolherEndereco("Trabalho");
    await act(async () => {
      digitar("checkout-name", "Maria Teste");
      digitar("checkout-tel", "34999998888");
      botaoPorTexto("Pagar agora com PIX")?.click();
    });
    await drenar();
    expect(botaoFinalizar().disabled).toBe(true);

    await act(async () => {
      resolverCpf({ ok: true, cpf: "52998224725" });
    });
    await drenar();
    expect(
      (document.getElementById("checkout-cpf") as HTMLInputElement).value,
    ).toBe("529.982.247-25");
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("leitura da conta FALHA: a caixa não aparece e nada é gravado (não sabe se a conta tem CPF)", async () => {
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await finalizarComTransportadora("111.444.777-35");

    expect(caixaSalvarNaConta()).toBeNull();
    await act(async () => {
      botaoFinalizar().click();
    });
    await drenar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(cpfDaConta.gravar).not.toHaveBeenCalled();
  });

  it("config da loja chega DEPOIS do CPF da conta: o reset tardio não apaga o CPF já preenchido", async () => {
    estadoLoja.isLoaded = false;
    cpfDaConta.ler.mockResolvedValue({ ok: true, cpf: "52998224725" });
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await drenar();

    estadoLoja.isLoaded = true;
    await montar();
    await escolherEndereco("Trabalho");

    const campo = document.getElementById("checkout-cpf") as HTMLInputElement;
    expect(campo.value).toBe("529.982.247-25");
  });

  it("troca de conta com o checkout aberto: o 'sem CPF' da conta anterior não vale para a nova (caixa some enquanto a nova leitura não volta)", async () => {
    cpfDaConta.ler.mockResolvedValueOnce({ ok: true, cpf: null });
    cotacoesControladas({ "01001000": [PAC_SP] });
    await montar();
    await escolherEndereco("Trabalho");
    expect(caixaSalvarNaConta()).not.toBeNull();

    cpfDaConta.ler.mockReturnValueOnce(new Promise(() => {}));
    contaEstavel.user = {
      id: "user-2",
      user_metadata: { name: "Outra Pessoa" },
    };
    await montar();
    await drenar();

    expect(caixaSalvarNaConta()).toBeNull();
  });
});
