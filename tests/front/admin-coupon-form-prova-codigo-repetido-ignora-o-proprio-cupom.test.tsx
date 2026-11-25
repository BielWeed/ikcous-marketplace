// @vitest-environment jsdom
//
// Prova da conferência "Já existe um cupom com esse código" do formulário de
// cupom. Ela compara sem diferenciar maiúscula de minúscula, mas NUNCA contra o
// próprio cupom que está sendo editado:
//   - um cupom antigo guardado em minúsculas ("promo10") reaberto e salvo com
//     "PROMO10" é o MESMO cupom: salva, e a lojista não fica presa numa recusa
//     que aponta para ele mesmo;
//   - o código de OUTRO cupom (em qualquer caixa) continua recusado, na edição e
//     na criação, e nada vai ao banco.
// Formulário e hook REAIS; só a fronteira com o banco é simulada.
import { setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AVISO = "Já existe um cupom com esse código.";

const remendos: Record<string, unknown>[] = [];
const insercoes: unknown[] = [];
const navegar = vi.fn();
const erro = vi.fn();
let noBanco: Record<string, unknown>[];

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { formasPagamentoEntrega: ["cash"] } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => erro(...args),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: async () => ({ error: null }),
        order: async () => ({
          data: noBanco.map((c) => ({ ...c })),
          error: null,
        }),
      }),
      insert: (linhas: unknown) => {
        insercoes.push(linhas);
        return {
          select: () => ({
            single: async () => ({ data: null, error: new Error("sem banco") }),
          }),
        };
      },
      update: (remendo: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            remendos.push(remendo);
            return { data: [{ id: "cupom-1" }], error: null };
          },
        }),
      }),
    }),
    rpc: async () => ({ data: [], error: null }),
  },
}));

const cupom = (id: string, code: string) => ({
  id,
  code,
  type: "percentage",
  value: 10,
  minPurchase: 0,
  usageLimit: 0,
  usageCount: 0,
  validUntil: undefined,
  active: true,
  alcance: "codigo",
});

let raiz: Root;
let tela: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  remendos.length = 0;
  insercoes.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const antigo = cupom("cupom-1", "promo10");
  const outro = cupom("cupom-2", "OUTRO20");
  noBanco = [
    {
      id: "cupom-1",
      code: "promo10",
      type: "percentage",
      value: 10,
      min_purchase: 0,
      usage_limit: 0,
      usage_count: 0,
      valid_until: null,
      active: true,
      alcance: "codigo",
    },
    {
      id: "cupom-2",
      code: "OUTRO20",
      type: "percentage",
      value: 10,
      min_purchase: 0,
      usage_limit: 0,
      usage_count: 0,
      valid_until: null,
      active: true,
      alcance: "codigo",
    },
  ];
  setCachedCouponsData([antigo, outro] as never);
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  setCachedCouponsData(null);
  vi.restoreAllMocks();
});

async function abrir(couponId?: string) {
  await act(async () => {
    raiz.render(
      <AdminCouponFormView
        couponId={couponId}
        onNavigate={navegar}
        onSetDirty={() => {}}
      />,
    );
  });
  await act(async () => {});
}

async function digitar(seletor: string, valor: string) {
  const campo = tela.querySelector(seletor);
  if (!campo) throw new Error(`Campo não encontrado: ${seletor}`);
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

async function salvar() {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith("Salvar Cupom"),
  ) as HTMLButtonElement;
  expect(botao).toBeDefined();
  await act(async () => botao.click());
}

const avisos = () =>
  [...tela.querySelectorAll('[role="alert"]')].map((e) => e.textContent);

describe("cupom: conferência de código repetido", () => {
  it("editar: o cupom antigo em minúsculas reaberto com o mesmo código em maiúsculas NÃO é repetido (é ele mesmo)", async () => {
    await abrir("cupom-1");
    await digitar("#coupon-code", "PROMO10");
    await salvar();

    expect(erro).not.toHaveBeenCalledWith(AVISO);
    expect(avisos()).not.toContain(AVISO);
    expect(remendos).toEqual([{ code: "PROMO10" }]);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });

  it("editar: trocar para o código de OUTRO cupom (em outra caixa) é recusado e nada vai ao banco", async () => {
    await abrir("cupom-1");
    await digitar("#coupon-code", "outro20");
    await salvar();

    expect(erro).toHaveBeenCalledWith(AVISO);
    expect(avisos()).toContain(AVISO);
    expect(remendos).toEqual([]);
    expect(navegar).not.toHaveBeenCalled();
  });

  it("criar: usar o código de um cupom que já existe é recusado, mesmo sem nada mais preenchido", async () => {
    await abrir();
    await digitar("#coupon-code", "outro 20");
    await salvar();

    expect(erro).toHaveBeenCalledWith(AVISO);
    expect(avisos()).toContain(AVISO);
    expect(insercoes).toEqual([]);
  });

  it("criar: um código que ninguém usa passa da conferência (a próxima recusa é a do valor)", async () => {
    await abrir();
    await digitar("#coupon-code", "sexta 70");
    await salvar();

    expect(erro).not.toHaveBeenCalledWith(AVISO);
    expect(erro).toHaveBeenCalledWith(
      "O valor do desconto deve ser maior que zero.",
    );
  });
});
