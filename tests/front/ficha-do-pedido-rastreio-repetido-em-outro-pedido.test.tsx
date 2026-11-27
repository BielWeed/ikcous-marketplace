// @vitest-environment jsdom
/**
 * 27/11/2026 (caça): a ficha do pedido aceitava, sem aviso, um código de
 * rastreio que já estava em OUTRO pedido da loja (colado do pedido errado, por
 * exemplo). A cliente deste pedido passava a acompanhar o pacote de outra
 * pessoa.
 *
 * Agora, antes de gravar, a ficha procura outro pedido (id diferente) com o
 * mesmo código já limpo; se achar, pergunta "Esse código já está no pedido
 * #XXXX. Usar mesmo assim?". Não bloqueia: dois pedidos no mesmo pacote
 * (envio conjunto) são legítimos. Se a procura falhar, o salvamento segue como
 * antes — a pergunta é uma ajuda, e ela nunca pode impedir a loja de salvar.
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { atualizar, procuras, procura } = vi.hoisted(() => ({
  atualizar: vi.fn(),
  procuras: [] as Array<Array<[string, ...unknown[]]>>,
  procura: {
    resposta: { data: [], error: null } as {
      data: Array<{ id: string }> | null;
      error: unknown;
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        const chamadas: Array<[string, ...unknown[]]> = [["select", colunas]];
        const cadeia: Record<string, unknown> = {
          eq: (...a: unknown[]) => {
            chamadas.push(["eq", ...a]);
            return cadeia;
          },
          neq: (...a: unknown[]) => {
            chamadas.push(["neq", ...a]);
            return cadeia;
          },
          limit: (...a: unknown[]) => {
            chamadas.push(["limit", ...a]);
            return cadeia;
          },
          maybeSingle: () =>
            Promise.resolve({
              data:
                tabela === "config_mototaxi"
                  ? { whatsapp: null, nome: null }
                  : null,
              error: null,
            }),
          // biome-ignore lint/suspicious/noThenProperty: dubla o query builder thenable do Supabase
          then: (
            res: (v: unknown) => unknown,
            rej?: (e: unknown) => unknown,
          ) => {
            if (tabela === "marketplace_orders") procuras.push(chamadas);
            return Promise.resolve(procura.resposta).then(res, rej);
          },
        };
        return cadeia;
      },
      update: (valores: unknown) => {
        atualizar(tabela, valores);
        const cadeia = {
          eq: () => cadeia,
          or: () => cadeia,
          select: () => Promise.resolve({ data: [{ id: "A" }], error: null }),
        };
        return cadeia;
      },
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));

import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ESTE = "aaaaaaaa-1111-4111-8111-11111111aaaa";
const OUTRO = "bbbbbbbb-2222-4222-8222-2222224f5a6b";

function pedido(trackingCode: string): Order {
  return {
    id: ESTE,
    notes: "",
    trackingCode,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-27T10:00:00Z",
    updatedAt: "2026-11-27T10:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — código de rastreio que já está em outro pedido", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    procuras.length = 0;
    procura.resposta = { data: [], error: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  const caixa = () =>
    document.querySelector<HTMLElement>('[role="alertdialog"]');
  const botaoEm = (onde: ParentNode, texto: string) =>
    [...onde.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );

  async function salvarCodigo(salvo: string, digitado: string) {
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedido(salvo)} onStatusChange={vi.fn()} />,
      );
    });
    act(() => botaoEm(hospedeiro, "Editar Código")?.click());
    const campo = hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    if (!campo) throw new Error("Campo ausente: #tracking-input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(campo, digitado);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const salvar = botaoEm(hospedeiro, "Salvar");
    if (!salvar) throw new Error("Botão ausente: Salvar");
    await act(async () => {
      salvar.click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("código já usado em outro pedido: pergunta antes, sem gravar nada ainda", async () => {
    procura.resposta = { data: [{ id: OUTRO }], error: null };
    await salvarCodigo("CODIGO-ANTIGO", "aa 123 456 789 br");

    // A procura é pelo código LIMPO, em OUTRO pedido (id diferente deste).
    expect(procuras).toHaveLength(1);
    expect(procuras[0]).toContainEqual([
      "eq",
      "tracking_code",
      "AA123456789BR",
    ]);
    expect(procuras[0]).toContainEqual(["neq", "id", ESTE]);
    expect(caixa()).not.toBeNull();
    expect(caixa()?.textContent).toContain(
      "Esse código já está no pedido #4F5A6B. Usar mesmo assim?",
    );
    expect(atualizar).not.toHaveBeenCalled();
  });

  it("'Usar mesmo assim' grava o código (envio conjunto é permitido)", async () => {
    procura.resposta = { data: [{ id: OUTRO }], error: null };
    await salvarCodigo("CODIGO-ANTIGO", "AA123456789BR");
    const usar = caixa() && botaoEm(caixa() as HTMLElement, "Usar mesmo assim");
    expect(usar).toBeTruthy();
    await act(async () => {
      (usar as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledWith("marketplace_orders", {
      tracking_code: "AA123456789BR",
    });
    expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
  });

  it("'Voltar' não grava e mantém o rascunho no campo", async () => {
    procura.resposta = { data: [{ id: OUTRO }], error: null };
    await salvarCodigo("CODIGO-ANTIGO", "AA123456789BR");
    const voltar = caixa() && botaoEm(caixa() as HTMLElement, "Voltar");
    expect(voltar).toBeTruthy();
    await act(async () => {
      (voltar as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(caixa()).toBeNull();
    expect(atualizar).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input")?.value,
    ).toBe("AA123456789BR");
    // O botão volta a funcionar (não fica preso em "salvando").
    expect(botaoEm(hospedeiro, "Salvar")?.disabled).toBe(false);
  });

  it("código que nenhum outro pedido usa: grava direto, sem pergunta", async () => {
    await salvarCodigo("CODIGO-ANTIGO", "AA123456789BR");

    expect(procuras).toHaveLength(1);
    expect(caixa()).toBeNull();
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("a procura falhou: grava mesmo assim (a pergunta nunca impede salvar)", async () => {
    procura.resposta = { data: null, error: { message: "fora do ar" } };
    await salvarCodigo("CODIGO-ANTIGO", "AA123456789BR");

    expect(caixa()).toBeNull();
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("código igual ao já salvo neste pedido, ou campo apagado: nem procura", async () => {
    await salvarCodigo("AA123456789BR", "AA123456789BR");
    expect(procuras).toHaveLength(0);
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);

    await salvarCodigo("AA123456789BR", "");
    expect(procuras).toHaveLength(0);
    expect(atualizar).toHaveBeenLastCalledWith("marketplace_orders", {
      tracking_code: null,
    });
  });
});
