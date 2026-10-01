// @vitest-environment jsdom
//
// Frente A (28/09/2026) — o PIX com QR ponta a ponta na tela Vender, com a
// view REAL, a máquina REAL e as seções reais; Supabase e a edge são dublês.
//
//   1. a opção "PIX com QR" só aparece com o PIX pelo app ligado;
//   2. "Gerar PIX" chama `iniciar_venda_presencial_pix` com a chave PRÓPRIA
//      do PIX (nunca a do cupom) e abre o QR da edge, com valor e contagem;
//   3. o banco confirmando o pagamento (releitura da linha) leva ao recibo
//      "PIX com QR no balcão" — e o comprovante sai só depois disso;
//   4. "Cancelar este PIX" volta ao fechamento com o cupom intacto;
//   5. "Registrar venda" em dinheiro depois disso usa a chave do CUPOM.
//
// Prontidão (01/10/2026, migration 20261186000000 + acao "prontidao" da edge):
//   6. ficha ligada mas servidor não pronto — `pronto:false`, 400/401/404,
//      rede caída, resposta sem `pronto: true` ou sem resposta no prazo — a
//      opção APARECE desabilitada com a explicação em português, nenhuma
//      venda nasce e as outras formas seguem usáveis;
//   7. `pronto:true` habilita;
//   8. "Gerar PIX" confere a prontidão DE NOVO antes de criar a venda; se
//      ela caiu nesse meio-tempo, nenhuma RPC de criação é chamada e o aviso
//      aparece.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock, linhaRef, pixLigadoRef } = vi.hoisted(
  () => ({
    rpcMock: vi.fn(),
    invokeMock: vi.fn(),
    fromMock: vi.fn(),
    linhaRef: {
      atual: {
        payment_status: "aguardando",
        status: "pending",
        expires_at: "2026-09-28T15:30:00.000Z",
      } as Record<string, unknown>,
    },
    pixLigadoRef: { atual: true },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock }, from: fromMock },
}));
vi.mock("@/config/configuracaoDaLoja", () => ({
  pagamentoOnlineLigado: () => pixLigadoRef.atual,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({ aberto, aoLer }: any) =>
    aberto ? (
      <button
        type="button"
        onClick={() => aoLer({ codigo: "78912345", formato: "ean_13" })}
      >
        bipar
      </button>
    ) : null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const PEDIDO = "0f0f0f0f-1111-4222-8333-abcdefabcdef";
const PRODUTO = {
  encontrado: true,
  origem: "produto",
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

function respostaDaEdge(extra: Record<string, unknown> = {}) {
  return {
    data: {
      situacao: "aguardando",
      total: 39.9,
      expiraEm: "2026-09-28T15:30:00.000Z",
      agoraServidor: "2026-09-28T15:00:00.000Z",
      qrCode: "00020126PIXCOPIAECOLA",
      qrCodeBase64: "iVBORw0KGgo=",
      ...extra,
    },
    error: null,
  };
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function radio(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("[role=radio]")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** A explicação da opção desabilitada (frase da tela, em português). */
const EXPLICACAO = /PIX com QR ainda não está pronto/;

/** Nome de exceção/mensagem crua: nunca na tela. */
const ERRO_CRU = [
  "FunctionsHttpError",
  "FunctionsFetchError",
  "Failed to",
  "TypeError",
  "status code",
  "Só a loja cobra",
];
/** Detalhe interno: nunca na explicação ao caixa. */
const DETALHE_INTERNO = [
  ...ERRO_CRU,
  "credencial",
  "banco",
  "404",
  "401",
  "400",
];

/** Chamadas da edge com a ação de prontidão. */
function chamadasDeProntidao() {
  return invokeMock.mock.calls.filter(
    ([n, a]) => n === "cobrar-pix-no-balcao" && a?.body?.acao === "prontidao",
  );
}

/** Formato do supabase-js v2 para resposta não-2xx da edge. */
function erroHttp(status: number, corpo: Record<string, unknown>) {
  return {
    data: null,
    error: Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      {
        name: "FunctionsHttpError",
        context: { status, json: async () => corpo },
      },
    ),
  };
}

/** Troca SÓ a resposta da prontidão; o resto da edge segue o padrão. */
function prontidaoResponde(resposta: (n: number) => Promise<unknown>) {
  const padrao = invokeMock.getMockImplementation();
  let n = 0;
  invokeMock.mockImplementation((nome: string, args: any) => {
    if (nome === "cobrar-pix-no-balcao" && args?.body?.acao === "prontidao")
      return resposta(++n);
    return padrao?.(nome, args);
  });
}

/** A opção aparece, desabilitada, com a explicação ligada a ela. */
function exigirOpcaoIndisponivel() {
  const opcao = radio(container, "PIX com QR");
  expect(opcao, "a opção APARECE quando a ficha liga").toBeDefined();
  expect(opcao?.disabled, "a opção fica desabilitada").toBe(true);
  expect(container.textContent).toMatch(EXPLICACAO);
  const idDaExplicacao = opcao?.getAttribute("aria-describedby");
  expect(idDaExplicacao, "a explicação é ligada à opção").toBeTruthy();
  const explicacao =
    document.getElementById(String(idDaExplicacao))?.textContent ?? "";
  expect(explicacao).toMatch(EXPLICACAO);
  for (const termo of DETALHE_INTERNO)
    expect(explicacao, `a explicação vazou "${termo}"`).not.toContain(termo);
  for (const termo of ERRO_CRU)
    expect(container.textContent, `a tela vazou "${termo}"`).not.toContain(
      termo,
    );
}

let container: HTMLDivElement;
let root: Root;

async function clicar(el: HTMLElement | undefined) {
  expect(el).toBeDefined();
  await act(async () => {
    el?.click();
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montarAteOFechamento() {
  await act(async () => {
    root.render(<AdminPdvView onNavigate={() => {}} active />);
  });
  await clicar(botao(container, "bipar"));
  await avancar(10);
  await clicar(botao(container, "Fechar venda") ?? botao(container, "Fechar"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date("2026-09-28T15:00:00.000Z"));
  localStorage.clear();
  pixLigadoRef.atual = true;
  linhaRef.atual = {
    payment_status: "aguardando",
    status: "pending",
    expires_at: "2026-09-28T15:30:00.000Z",
  };
  rpcMock.mockReset();
  invokeMock.mockReset();
  fromMock.mockReset();
  rpcMock.mockImplementation(async (nome: string, params: any) => {
    if (nome === "buscar_por_codigo_barras")
      return { data: PRODUTO, error: null };
    if (nome === "fin_caixa_atual")
      return { data: { id: "caixa" }, error: null };
    if (nome === "iniciar_venda_presencial_pix") {
      return {
        data: {
          ja_existia: false,
          order: { id: PEDIDO, payment_status: "aguardando" },
          items: [],
          _params: params,
        },
        error: null,
      };
    }
    if (nome === "registrar_venda_presencial") {
      return {
        data: {
          ja_existia: false,
          order: {
            id: "pedido-dinheiro",
            created_at: "2026-09-28T15:01:00.000Z",
            total: 39.9,
            subtotal: 39.9,
            discount: 0,
            payment_method: "cash",
            user_id: null,
            customer_name: "Venda no balcão",
            customer_data: null,
          },
          items: [
            {
              product_id: "produto-1",
              variant_id: null,
              quantity: 1,
              price: 39.9,
              product_name: "Camiseta Lisa",
            },
          ],
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  invokeMock.mockImplementation(async (nome: string, { body }: any) => {
    // Padrão: servidor PRONTO — os testes de venda abaixo valem como antes.
    if (nome === "cobrar-pix-no-balcao" && body.acao === "prontidao")
      return { data: { pronto: true }, error: null };
    if (nome === "cobrar-pix-no-balcao" && body.acao === "gerar")
      return respostaDaEdge();
    if (nome === "cobrar-pix-no-balcao" && body.acao === "cancelar") {
      return respostaDaEdge({
        situacao: "cancelado",
        qrCode: null,
        qrCodeBase64: null,
      });
    }
    return { data: {}, error: null };
  });
  fromMock.mockImplementation((tabela: string) => {
    const itensGravados = [
      {
        product_id: "produto-1",
        variant_id: null,
        quantity: 1,
        price: 39.9,
        product_name: "Camiseta Lisa",
      },
    ];
    // Itens: `.select().eq()` é aguardado direto (devolve a Promise).
    if (tabela === "marketplace_order_items") {
      return {
        select: () => ({
          eq: async () => ({ data: itensGravados, error: null }),
        }),
      };
    }
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: {
          ...linhaRef.atual,
          id: PEDIDO,
          created_at: "2026-09-28T15:00:00.000Z",
          total: 39.9,
          subtotal: 39.9,
          discount: 0,
          payment_method: "online",
          user_id: null,
          customer_name: "Venda no balcão",
          customer_data: null,
        },
        error: null,
      }),
    };
    return q;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("PIX com QR na tela Vender", () => {
  it("sem o PIX pelo app ligado, a opção nem aparece", async () => {
    pixLigadoRef.atual = false;
    await montarAteOFechamento();
    expect(botao(container, "PIX com QR")).toBeUndefined();
    expect(botao(container, "PIX na chave da loja")).toBeDefined();
  });

  it("gera o PIX com a chave própria, mostra QR/valor/contagem e, pago no banco, abre o recibo", async () => {
    await montarAteOFechamento();
    await clicar(botao(container, "PIX com QR"));
    await clicar(botao(container, "Gerar PIX de R$ 39,90"));
    await avancar(10);

    const chamada = rpcMock.mock.calls.find(
      ([n]) => n === "iniciar_venda_presencial_pix",
    );
    expect(chamada).toBeDefined();
    const params = chamada?.[1];
    expect(params.p_itens).toEqual([
      { product_id: "produto-1", variant_id: null, quantity: 1 },
    ]);
    expect(typeof params.p_idempotency_key).toBe("string");
    const rascunho = JSON.parse(
      localStorage.getItem("admin_pdv_venda_draft") ?? "null",
    );
    expect(params.p_idempotency_key).not.toBe(rascunho?.chaveDeIdempotencia);

    const img = container.querySelector(
      "img[alt^='QR code do PIX']",
    ) as HTMLImageElement;
    expect(img?.src).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(container.textContent).toContain("R$ 39,90");
    expect(container.textContent).toContain("Vence em 30:00");
    expect(container.textContent).toContain("Aguardando pagamento…");
    expect(container.textContent).toContain("00020126PIXCOPIAECOLA");
    // cupom só de leitura: o cupom some da tela enquanto o QR espera
    expect(botao(container, "Fechar venda")).toBeUndefined();

    await avancar(5000);
    expect(container.textContent).toContain("Vence em 29:55");
    expect(
      invokeMock.mock.calls.some(([n]) => n === "send-order-confirmation"),
      "comprovante NÃO sai antes do pago",
    ).toBe(false);

    linhaRef.atual = {
      payment_status: "pago",
      status: "delivered",
      expires_at: "2026-09-28T15:30:00.000Z",
    };
    await avancar(3100);
    await avancar(10);

    expect(container.textContent).toContain("Compra na loja");
    expect(container.textContent).toContain("PIX com QR no balcão");
    expect(
      botao(container, "Anular venda"),
      "PIX com QR volta pelo estorno do Mercado Pago, não pela anulação",
    ).toBeUndefined();
    expect(
      invokeMock.mock.calls.some(([n]) => n === "send-order-confirmation"),
    ).toBe(true);
  });

  it("cancelar o PIX volta ao fechamento com o cupom intacto, e o dinheiro usa a chave do cupom", async () => {
    await montarAteOFechamento();
    await clicar(botao(container, "PIX com QR"));
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    const chaveDoPix = rpcMock.mock.calls.find(
      ([n]) => n === "iniciar_venda_presencial_pix",
    )?.[1].p_idempotency_key;

    await clicar(botao(container, "Cancelar este PIX"));
    await avancar(10);
    expect(
      invokeMock.mock.calls.find(([, a]) => a.body.acao === "cancelar")?.[1]
        .body.orderId,
    ).toBe(PEDIDO);
    expect(container.textContent).toContain("Fechar venda");
    expect(container.textContent).toContain("Camiseta Lisa");

    await clicar(botao(container, "Dinheiro"));
    await clicar(botao(container, "Registrar venda"));
    await avancar(10);
    const dinheiro = rpcMock.mock.calls.find(
      ([n]) => n === "registrar_venda_presencial",
    )?.[1];
    expect(dinheiro.p_pagamento).toBe("cash");
    expect(dinheiro.p_idempotency_key).not.toBe(chaveDoPix);
    expect(container.textContent).toContain("Compra na loja");
  });

  it("maquininha só registra depois de 'Conferi o comprovante'", async () => {
    await montarAteOFechamento();
    await clicar(botao(container, "Cartão na maquininha"));
    expect(botao(container, "Registrar venda")?.disabled).toBe(true);
    const caixa = container.querySelector(
      "input[type=checkbox]",
    ) as HTMLInputElement;
    await act(async () => caixa.click());
    expect(botao(container, "Registrar venda")?.disabled).toBe(false);
  });
  it("anular no recibo: pede motivo, chama a RPC e diz quanto devolver; PIX com QR não oferece", async () => {
    await montarAteOFechamento();
    await clicar(botao(container, "Dinheiro"));
    await clicar(botao(container, "Registrar venda"));
    await avancar(10);
    await clicar(botao(container, "Anular venda"));
    const confirmar = botao(container, "Confirmar anulação");
    expect(confirmar?.disabled).toBe(true);
    const campo = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, "cliente desistiu");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicar(botao(container, "Confirmar anulação"));
    await avancar(10);
    const chamada = rpcMock.mock.calls.find(
      ([n]) => n === "anular_venda_presencial",
    );
    expect(chamada?.[1]).toEqual({
      p_order_id: "pedido-dinheiro",
      p_motivo: "cliente desistiu",
    });
    expect(container.textContent).toContain("Venda anulada");
    expect(container.textContent).toContain("Devolva R$ 39,90 ao cliente.");
  });

  it("recusa do servidor ao gerar (22023) destrava o cupom; o próximo PIX usa outra chave", async () => {
    let tentativas = 0;
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras")
        return { data: PRODUTO, error: null };
      if (nome === "iniciar_venda_presencial_pix") {
        tentativas++;
        return {
          data: null,
          error: {
            code: "22023",
            message: "Estoque insuficiente para o produto Camiseta Lisa",
            _k: params.p_idempotency_key,
          },
        };
      }
      return { data: null, error: null };
    });
    await montarAteOFechamento();
    await clicar(botao(container, "PIX com QR"));
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    expect(tentativas).toBe(1);
    expect(container.textContent).toContain("Estoque insuficiente");
    expect(container.textContent).not.toContain("A conexão caiu");
    await clicar(botao(container, "Dinheiro"));
    expect(
      [...container.querySelectorAll("[role=radio]")]
        .find((b) => b.textContent?.includes("Dinheiro"))
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it('queda de rede ao gerar ({code: ""}): a chave do PIX fica, o cupom trava e o retry usa a MESMA chave', async () => {
    const chaves: string[] = [];
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras")
        return { data: PRODUTO, error: null };
      if (nome === "iniciar_venda_presencial_pix") {
        chaves.push(params.p_idempotency_key);
        return {
          data: null,
          error: {
            message: "TypeError: Failed to fetch",
            details: "",
            hint: "",
            code: "",
          },
        };
      }
      return { data: null, error: null };
    });
    await montarAteOFechamento();
    await clicar(botao(container, "PIX com QR"));
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    expect(container.textContent).toContain(
      "A conexão caiu enquanto o PIX era gerado",
    );
    expect(container.textContent).not.toContain("TypeError");
    await clicar(botao(container, "Dinheiro"));
    expect(
      [...container.querySelectorAll("[role=radio]")]
        .find((b) => b.textContent?.includes("PIX com QR"))
        ?.getAttribute("aria-checked"),
      "cupom travado: a forma não troca",
    ).toBe("true");
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    expect(chaves).toHaveLength(2);
    expect(chaves[1]).toBe(chaves[0]);
  });
});

/** Ninguém respondeu: a promessa nunca resolve (o prazo é da tela). */
const nuncaResponde = () => new Promise<never>(() => {});
/** Prazo máximo que a tela pode esperar pela prontidão antes de desistir. */
const PRAZO_DA_PRONTIDAO_MS = 10_000;

const NAO_PRONTO: ReadonlyArray<[string, () => Promise<unknown>]> = [
  [
    "pronto:false (banco)",
    async () => ({ data: { pronto: false, motivo: "banco" }, error: null }),
  ],
  [
    "pronto:false (credencial)",
    async () => ({
      data: { pronto: false, motivo: "credencial" },
      error: null,
    }),
  ],
  [
    "400 (edge antiga, sem a ação)",
    async () => erroHttp(400, { error: "Ação inválida." }),
  ],
  [
    "401",
    async () =>
      erroHttp(401, {
        error: "Só a loja cobra venda no balcão.",
        terminal: true,
      }),
  ],
  [
    "404 (edge não publicada)",
    async () => erroHttp(404, { error: "Requested function was not found" }),
  ],
  [
    "rede caída (FunctionsFetchError)",
    async () => ({
      data: null,
      error: Object.assign(
        new Error("Failed to send a request to the Edge Function"),
        {
          name: "FunctionsFetchError",
          context: new TypeError("Failed to fetch"),
        },
      ),
    }),
  ],
  ["invoke rejeita", () => Promise.reject(new TypeError("Failed to fetch"))],
  ["resposta sem pronto", async () => ({ data: {}, error: null })],
  [
    'pronto:"true" (texto, não booleano)',
    async () => ({ data: { pronto: "true" }, error: null }),
  ],
];

/** As outras formas seguem usáveis: dinheiro registra a venda. */
async function exigirDinheiroUsavel() {
  await clicar(radio(container, "Dinheiro"));
  expect(radio(container, "Dinheiro")?.getAttribute("aria-checked")).toBe(
    "true",
  );
  await clicar(botao(container, "Registrar venda"));
  await avancar(10);
  expect(
    rpcMock.mock.calls.find(([n]) => n === "registrar_venda_presencial")?.[1]
      .p_pagamento,
  ).toBe("cash");
}

function criouVendaDoPix() {
  return rpcMock.mock.calls.some(([n]) => n === "iniciar_venda_presencial_pix");
}

describe("prontidão do PIX com QR (ficha ligada, servidor confere)", () => {
  it("ficha desligada: a opção nem aparece e a prontidão nem é perguntada", async () => {
    pixLigadoRef.atual = false;
    await montarAteOFechamento();
    expect(radio(container, "PIX com QR")).toBeUndefined();
    expect(container.textContent).not.toMatch(EXPLICACAO);
    expect(chamadasDeProntidao()).toHaveLength(0);
  });

  it("pronto:true habilita a opção, sem explicação", async () => {
    await montarAteOFechamento();
    expect(chamadasDeProntidao().length).toBeGreaterThanOrEqual(1);
    expect(chamadasDeProntidao()[0][1].body).toEqual({ acao: "prontidao" });
    const opcao = radio(container, "PIX com QR");
    expect(opcao?.disabled).toBe(false);
    expect(container.textContent).not.toMatch(EXPLICACAO);
    await clicar(opcao);
    expect(opcao?.getAttribute("aria-checked")).toBe("true");
    expect(botao(container, "Gerar PIX de R$ 39,90")?.disabled).toBe(false);
  });

  it.each(NAO_PRONTO)(
    "%s: a opção aparece desabilitada com explicação, nenhuma venda nasce e o dinheiro segue",
    async (_rotulo, resposta) => {
      prontidaoResponde(resposta);
      await montarAteOFechamento();
      await avancar(10);
      exigirOpcaoIndisponivel();
      await clicar(radio(container, "PIX com QR"));
      expect(
        radio(container, "PIX com QR")?.getAttribute("aria-checked"),
        "opção desabilitada não é escolhida",
      ).toBe("false");
      expect(botao(container, "Gerar PIX")).toBeUndefined();
      expect(criouVendaDoPix()).toBe(false);
      await exigirDinheiroUsavel();
      expect(criouVendaDoPix()).toBe(false);
    },
  );

  it("sem resposta no prazo: desabilitada enquanto espera e, vencido o prazo, explica", async () => {
    prontidaoResponde(nuncaResponde);
    await montarAteOFechamento();
    expect(
      radio(container, "PIX com QR")?.disabled,
      "sem confirmação, a opção não habilita",
    ).toBe(true);
    await avancar(PRAZO_DA_PRONTIDAO_MS);
    await avancar(10);
    exigirOpcaoIndisponivel();
    expect(criouVendaDoPix()).toBe(false);
    await exigirDinheiroUsavel();
  });

  it("Gerar PIX confere a prontidão DE NOVO antes de criar a venda", async () => {
    await montarAteOFechamento();
    await clicar(radio(container, "PIX com QR"));
    const antes = chamadasDeProntidao().length;
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    expect(criouVendaDoPix()).toBe(true);
    expect(chamadasDeProntidao().length).toBeGreaterThan(antes);
    const ordensDaEdge = [...invokeMock.mock.invocationCallOrder];
    const ordemDaProntidao = invokeMock.mock.calls
      .map((c) => [c, ordensDaEdge.shift()] as const)
      .filter(
        ([[n, a]]) =>
          n === "cobrar-pix-no-balcao" && a?.body?.acao === "prontidao",
      )
      .map(([, ordem]) => ordem);
    const ordensDasRpcs = [...rpcMock.mock.invocationCallOrder];
    const ordemDaCriacao = rpcMock.mock.calls
      .map((c) => [c, ordensDasRpcs.shift()] as const)
      .find(([[n]]) => n === "iniciar_venda_presencial_pix")?.[1];
    if (ordemDaCriacao === undefined) {
      throw new Error(
        "a venda PIX não foi criada no teste de controle positivo",
      );
    }
    expect(
      ordemDaProntidao.slice(antes).at(0),
      "a repetição vem ANTES da RPC que cria a venda",
    ).toBeLessThan(ordemDaCriacao);
  });

  it.each([
    ...NAO_PRONTO,
    ["sem resposta no prazo", nuncaResponde] as [
      string,
      () => Promise<unknown>,
    ],
  ])(
    "caiu na repetição (%s): nenhuma RPC de criação, o aviso aparece e o cupom segue livre",
    async (_rotulo, falha) => {
      let caiu = false;
      prontidaoResponde(() =>
        caiu
          ? falha()
          : Promise.resolve({ data: { pronto: true }, error: null }),
      );
      await montarAteOFechamento();
      await clicar(radio(container, "PIX com QR"));
      caiu = true;
      await clicar(botao(container, "Gerar PIX"));
      await avancar(PRAZO_DA_PRONTIDAO_MS);
      await avancar(10);
      expect(criouVendaDoPix(), "nenhuma venda nasce").toBe(false);
      expect(
        botao(container, "Gerando o PIX"),
        "o botão não fica preso",
      ).toBeUndefined();
      exigirOpcaoIndisponivel();
      await exigirDinheiroUsavel();
      expect(criouVendaDoPix()).toBe(false);
    },
  );

  it("retry com chave preservada também confere prontidão antes de criar outra venda", async () => {
    let pronta = true;
    prontidaoResponde(async () => ({ data: { pronto: pronta }, error: null }));
    const original = rpcMock.getMockImplementation();
    let tentativas = 0;
    rpcMock.mockImplementation((nome: string, params: unknown) => {
      if (nome === "iniciar_venda_presencial_pix") {
        tentativas++;
        return Promise.resolve({
          data: null,
          error: { code: "", message: "TypeError: Failed to fetch" },
        });
      }
      return original?.(nome, params);
    });

    await montarAteOFechamento();
    await clicar(radio(container, "PIX com QR"));
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    expect(tentativas).toBe(1);

    pronta = false;
    await clicar(botao(container, "Gerar PIX"));
    await avancar(10);
    expect(
      tentativas,
      "a chave guardada não dispensa a verificação da Edge",
    ).toBe(1);
    exigirOpcaoIndisponivel();
  });
});
