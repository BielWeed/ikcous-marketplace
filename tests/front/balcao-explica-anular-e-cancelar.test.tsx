// @vitest-environment jsdom
//
// F7 do painel simples — na ficha de uma venda do balcão (canal "presencial")
// o bloco Pagamento explica "Anular" × "Cancelar". SÓ TEXTO: a regra do botão
// (`podeAnularVendaDoBalcao`), a peça de pdv/ e a chamada ao banco não mudam.
//  - mesmo dia: uma linha antes do botão "Anular venda";
//  - outro dia: a 1ª frase LITERAL da recusa da migration 20261204 ("Só dá
//    para anular no mesmo dia da venda.") e, no lugar da 2ª ("registre uma
//    devolução" — o lojista NÃO tem como abrir devolução de balcão no painel:
//    `solicitar_devolucao` exige o cliente logado), quem pode pedir.
//
// Molde de montagem: ficha-do-pedido-anular-venda-do-balcao.test.tsx.
import { readFileSync } from "node:fs";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 08/10/2026, 15:00 em São Paulo.
const AGORA = new Date("2026-10-08T18:00:00.000Z");

const FRASE_DO_DIA = "Só dá para anular no mesmo dia da venda.";
const QUEM_PEDE_DEVOLUCAO =
  "Depois disso, a devolução só pode ser pedida pelo cliente que tem conta no app.";
const LINHA_DE_HOJE = "Venda do balcão não se cancela";

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "ped-balcao-1",
    customer: {
      name: "Venda no balcão",
      whatsapp: "",
      address: "",
      number: "",
      neighborhood: "",
      city: "",
      state: "",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: "2026-10-08T14:00:00.000Z",
    pagamentoRecebidoPor: null,
    canal: "presencial",
    ...parcial,
  };
}

const DE_ONTEM = {
  createdAt: "2026-10-07T14:00:00.000Z",
  updatedAt: "2026-10-07T14:00:00.000Z",
  pagamentoRecebidoEm: "2026-10-07T14:00:00.000Z",
} satisfies Partial<Order>;

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function chamadasDeAnular(): number {
  return rpcMock.mock.calls.filter(([n]) => n === "anular_venda_presencial")
    .length;
}

describe("ficha do balcão — explica Anular × Cancelar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  function blocoDoDinheiro(): HTMLElement {
    const bloco = hospedeiro.querySelector<HTMLElement>(
      '[data-testid="bloco-dinheiro"]',
    );
    expect(bloco).not.toBeNull();
    return bloco as HTMLElement;
  }

  it("(a) balcão do mesmo dia: a linha que explica vem ANTES do botão 'Anular venda', dentro do bloco Pagamento", async () => {
    await renderizar(pedido());
    const bloco = blocoDoDinheiro();
    const linha = [...bloco.querySelectorAll("p")].find((p) =>
      p.textContent?.includes(LINHA_DE_HOJE),
    );
    const anular = botao(bloco, "Anular venda");
    expect(linha).toBeDefined();
    expect(anular).toBeDefined();
    expect(linha?.textContent).toContain("anule hoje");
    // antes do botão, na ordem do documento
    expect(
      (linha as HTMLElement).compareDocumentPosition(anular as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // a frase do dia que passou NÃO aparece no mesmo dia
    expect(bloco.textContent).not.toContain(FRASE_DO_DIA);
    expect(bloco.textContent).not.toContain(QUEM_PEDE_DEVOLUCAO);
  });

  it("(b) balcão de ontem: a frase literal da migration, quem pode pedir a devolução, e nenhum botão", async () => {
    await renderizar(pedido(DE_ONTEM));
    const texto = blocoDoDinheiro().textContent ?? "";
    expect(texto).toContain(`${FRASE_DO_DIA} ${QUEM_PEDE_DEVOLUCAO}`);
    expect(texto).not.toContain("registre uma devolução");
    expect(texto).not.toContain(LINHA_DE_HOJE);
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
  });

  it("(c) pedido do app entregue (e balcão cancelado): nenhum dos dois textos", async () => {
    for (const parcial of [
      { canal: "online", paymentStatus: "pago", paymentMethod: "online" },
      { canal: undefined, paymentStatus: "pago", paymentMethod: "online" },
      { canal: "online", paymentStatus: "recebido_na_entrega" },
      { canal: "online", ...DE_ONTEM },
      { status: "cancelled", paymentStatus: "estornado" },
      { status: "cancelled", paymentStatus: "estornado", ...DE_ONTEM },
    ] satisfies Partial<Order>[]) {
      await renderizar(pedido(parcial));
      const texto = hospedeiro.textContent ?? "";
      expect(texto).not.toContain(LINHA_DE_HOJE);
      expect(texto).not.toContain(FRASE_DO_DIA);
      expect(texto).not.toContain(QUEM_PEDE_DEVOLUCAO);
    }
  });

  it("(d) guarda: a 1ª frase da tela é o começo da recusa da migration 20261204 (linha 315)", async () => {
    // Caminho literal a partir da raiz (o vitest roda dela); no jsdom o
    // `import.meta.url` não é `file:`.
    const sql = readFileSync(
      "supabase/migrations/20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
      "utf8",
    );
    const linha315 = sql.split("\n")[314] ?? "";
    const doBanco = /MESSAGE='([^']+)'/.exec(linha315)?.[1];
    expect(doBanco).toBeDefined();

    await renderizar(pedido(DE_ONTEM));
    const explicacao = [...blocoDoDinheiro().querySelectorAll("p")].find((p) =>
      p.textContent?.includes(QUEM_PEDE_DEVOLUCAO),
    );
    const primeiraFrase = /^[^.]*\./.exec(
      explicacao?.textContent?.trim() ?? "",
    )?.[0];
    expect(primeiraFrase).toBe(FRASE_DO_DIA);
    expect(doBanco?.startsWith(primeiraFrase as string)).toBe(true);
  });

  it("(e) renderizar a explicação não chama a anulação", async () => {
    await renderizar(pedido());
    await renderizar(pedido(DE_ONTEM));
    await renderizar(pedido({ id: "ped-balcao-2" }));
    expect(chamadasDeAnular()).toBe(0);
  });
});
