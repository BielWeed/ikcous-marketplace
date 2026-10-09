// @vitest-environment jsdom
//
// F7 do painel simples — na ficha de uma venda do balcão (canal "presencial")
// o bloco Pagamento explica "Anular" × "Cancelar". SÓ TEXTO: a regra do botão
// (`podeAnularVendaDoBalcao`), a peça de pdv/ e a chamada ao banco não mudam.
//  - mesmo dia: uma linha antes do botão "Anular venda";
//  - outro dia: a 1ª frase LITERAL da recusa da migration 20261204 ("Só dá
//    para anular no mesmo dia da venda.") e, no lugar da 2ª ("registre uma
//    devolução" — o lojista NÃO tem como abrir devolução de balcão no painel:
//    `solicitar_devolucao` exige o cliente logado), o que resta: com cliente
//    vinculado, troca/reparo pedidos por ele no app; sem cliente, nada.
//
// Molde de montagem: ficha-do-pedido-anular-venda-do-balcao.test.tsx.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
// Com cliente vinculado (user_id nasce em registrar_venda_presencial): no
// balcão não há arrependimento (solicitar_devolucao exige canal 'online'),
// só troca/vício, e quem pede é o cliente logado.
const COM_CLIENTE =
  "Depois disso, a troca ou o reparo de defeito só podem ser pedidos pelo cliente, no app, dentro do prazo da loja.";
// Sem cliente vinculado: não há vínculo posterior, a venda nunca será de
// ninguém — mandar "pedir ao cliente" seria falso.
const SEM_CLIENTE =
  "Esta venda não está na conta de nenhum cliente: o app não abre devolução para ela.";
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

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
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
    expect(bloco.textContent).not.toContain(COM_CLIENTE);
    expect(bloco.textContent).not.toContain(SEM_CLIENTE);
  });

  it("(a2) anulou com sucesso e o tempo real ainda não trouxe o cancelamento: a linha 'anule hoje' some (nem durante a chamada ela fica)", async () => {
    let responder: (v: unknown) => void = () => {};
    rpcMock.mockImplementation((nome: string) =>
      nome === "anular_venda_presencial"
        ? new Promise((resolve) => {
            responder = resolve;
          })
        : Promise.resolve({ data: null, error: null }),
    );
    await renderizar(pedido());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    expect(hospedeiro.textContent).toContain("Anulando");
    expect(hospedeiro.textContent).not.toContain(LINHA_DE_HOJE);

    await act(async () => {
      responder({
        data: { order_id: "ped-balcao-1", ja_anulada: false },
        error: null,
      });
    });
    // o `order` continua entregue (o hook não mexe no pedido local)
    await renderizar(pedido());
    expect(hospedeiro.textContent).toContain("Venda anulada: o estoque voltou");
    expect(hospedeiro.textContent).not.toContain(LINHA_DE_HOJE);
  });

  it("(b) balcão de ontem COM cliente vinculado: a frase literal da migration, troca/reparo pelo cliente no app, e nenhum botão", async () => {
    await renderizar(pedido({ ...DE_ONTEM, userId: "cliente-1" }));
    const texto = blocoDoDinheiro().textContent ?? "";
    expect(texto).toContain(`${FRASE_DO_DIA} ${COM_CLIENTE}`);
    expect(texto).not.toContain(SEM_CLIENTE);
    expect(texto).not.toContain("registre uma devolução");
    expect(texto).not.toContain(LINHA_DE_HOJE);
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
  });

  it("(b2) balcão de ontem SEM cliente vinculado: a frase literal e que o app não abre devolução para ela", async () => {
    for (const userId of [undefined, null] as const) {
      await renderizar(
        // `null` também chega do banco (user_id NULL), apesar do tipo
        pedido({
          ...DE_ONTEM,
          userId: userId as unknown as string | undefined,
        }),
      );
      const texto = blocoDoDinheiro().textContent ?? "";
      expect(texto).toContain(`${FRASE_DO_DIA} ${SEM_CLIENTE}`);
      expect(texto).not.toContain(COM_CLIENTE);
      expect(texto).not.toContain("registre uma devolução");
      expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
    }
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
      expect(texto).not.toContain(COM_CLIENTE);
      expect(texto).not.toContain(SEM_CLIENTE);
    }
  });

  it("(d) guarda: a 1ª frase da tela é o começo da recusa da migration 20261204 (linha 315), com e sem cliente", async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de um arquivo do próprio repositório, não entrada de usuário
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../supabase/migrations/20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
      ),
      "utf8",
    );
    const linha315 = sql.split("\n")[314] ?? "";
    const doBanco = /MESSAGE='([^']+)'/.exec(linha315)?.[1];
    expect(doBanco).toBeDefined();

    for (const [userId, segunda] of [
      ["cliente-1", COM_CLIENTE],
      [undefined, SEM_CLIENTE],
    ] as const) {
      await renderizar(pedido({ ...DE_ONTEM, userId }));
      const explicacao = [...blocoDoDinheiro().querySelectorAll("p")].find(
        (p) => p.textContent?.includes(segunda),
      );
      const primeiraFrase = /^[^.]*\./.exec(
        explicacao?.textContent?.trim() ?? "",
      )?.[0];
      expect(primeiraFrase).toBe(FRASE_DO_DIA);
      expect(doBanco?.startsWith(primeiraFrase as string)).toBe(true);
    }
  });

  it("(e) renderizar a explicação não chama a anulação", async () => {
    await renderizar(pedido());
    await renderizar(pedido(DE_ONTEM));
    await renderizar(pedido({ id: "ped-balcao-2" }));
    expect(chamadasDeAnular()).toBe(0);
  });
});
