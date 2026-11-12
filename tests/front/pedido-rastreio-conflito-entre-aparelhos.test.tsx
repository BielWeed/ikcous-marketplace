// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  codigo: null as string | null,
  escritas: 0,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      update: (valores: { tracking_code: string | null }) => {
        const filtros = new Map<string, unknown>();
        let vazio = false;
        const cadeia = {
          eq: (coluna: string, valor: unknown) => {
            filtros.set(coluna, valor);
            return cadeia;
          },
          is: (coluna: string, valor: null) => {
            filtros.set(coluna, valor);
            return cadeia;
          },
          or: (filtro: string) => {
            expect(filtro).toBe("tracking_code.is.null,tracking_code.eq.");
            vazio = true;
            return cadeia;
          },
          select: async () => {
            const confere = vazio
              ? banco.codigo === null || banco.codigo === ""
              : !filtros.has("tracking_code") ||
                banco.codigo === filtros.get("tracking_code");
            if (!confere) return { data: [], error: null };
            banco.codigo = valores.tracking_code;
            banco.escritas++;
            return { data: [{ id: "A" }], error: null };
          },
        };
        return cadeia;
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              tabela === "marketplace_orders"
                ? { tracking_code: banco.codigo }
                : null,
            error: null,
          }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const hospedeiro = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.clearAllMocks();
});

async function abrir(codigo: string | null) {
  banco.codigo = codigo;
  banco.escritas = 0;
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  const order: Order = {
    id: "A",
    trackingCode: codigo || undefined,
    customer: { name: "Pessoa Fixture", whatsapp: "11900000000" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-11T10:00:00Z",
    updatedAt: "2026-11-11T10:00:00Z",
    cancelledAfterShipping: false,
  };
  await act(async () => {
    raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
  });
  await clicar(codigo ? "Editar Código" : "Adicionar rastreio");
}

async function clicar(texto: string) {
  const botao = [...hospedeiro.querySelectorAll("button")].find(
    (b) => b.textContent === texto || b.getAttribute("title") === texto,
  );
  if (!botao) throw new Error(`Botão ausente: ${texto}`);
  await act(async () => botao.click());
}

function campo() {
  const input = hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
  if (!input) throw new Error("Editor fechado");
  return input;
}

function digitar(texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo(), texto);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("rastreio salvo em outro aparelho", () => {
  it.each(["ANTIGO", null, ""])(
    "anterior %s: não sobrescreve outro código; relê o salvo e mantém o rascunho",
    async (anterior) => {
      await abrir(anterior);
      digitar("RASCUNHO");
      banco.codigo = "OUTRO-APARELHO";
      await clicar("Salvar");

      expect(banco.codigo).toBe("OUTRO-APARELHO");
      expect(banco.escritas).toBe(0);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        "O código de rastreio mudou em outro aparelho. O que você digitou foi mantido. Confira antes de salvar de novo.",
      );
      expect(campo().value).toBe("RASCUNHO");
      expect(campo().disabled).toBe(false);
      const cancelar = hospedeiro.querySelector<HTMLButtonElement>(
        '[aria-label="Cancelar edição do código"]',
      );
      if (!cancelar) throw new Error("Cancelar ausente");
      await act(async () => cancelar.click());
      expect(hospedeiro.textContent).toContain("OUTRO-APARELHO");
    },
  );

  it.each(["ANTIGO", null, ""])(
    "salva normalmente quando o anterior é %s",
    async (anterior) => {
      await abrir(anterior);
      digitar("NOVO");
      await clicar("Salvar");
      expect(banco.codigo).toBe("NOVO");
      expect(banco.escritas).toBe(1);
      expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
      expect(hospedeiro.querySelector("#tracking-input")).toBeNull();
    },
  );

  it("salvar o mesmo código não é conflito", async () => {
    await abrir("IGUAL");
    await clicar("Salvar");
    expect(banco.codigo).toBe("IGUAL");
    expect(toast.success).toHaveBeenCalledWith("Código de rastreio salvo!");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
