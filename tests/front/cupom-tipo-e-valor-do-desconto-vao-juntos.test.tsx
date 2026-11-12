// @vitest-environment jsdom
//
// Cupom editado em dois aparelhos: tipo (R$ / %) e valor do desconto são UM par.
//
// A edição manda só o que a lojista mexeu. Cenário do defeito: o cupom é
// "R$ 10" (fixo). No aparelho A ela troca SÓ o tipo para percentual e salva
// (banco: percentual/10). O aparelho B ainda tem a tela antiga (fixo/10); ela
// muda SÓ o valor para 50 e salva. Só `value` viajava, e o banco terminava em
// 50% embora a tela de B tenha confirmado "R$ 50". Agora, se tipo OU valor
// mudou, os dois vão juntos.
//
// Formulário e hook REAIS; só a fronteira com o banco é simulada, com
// causalidade: o "banco" aplica o remendo por cima do que tinha.
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remendos: Record<string, unknown>[] = [];
const navegar = vi.fn();
const sucesso = vi.fn();
const erro = vi.fn();
let cupomNoBanco: Record<string, unknown>;

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { formasPagamentoEntrega: ["cash"] } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => sucesso(...args),
    error: (...args: unknown[]) => erro(...args),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: async () => ({ error: null }),
        order: async () => ({ data: [{ ...cupomNoBanco }], error: null }),
      }),
      update: (remendo: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            remendos.push(remendo);
            cupomNoBanco = { ...cupomNoBanco, ...remendo };
            return { data: [{ id: "cupom-1" }], error: null };
          },
        }),
      }),
    }),
    rpc: async (nome: string) => {
      if (nome === "admin_cupom_clientes") return { data: [], error: null };
      throw new Error(`RPC inesperada: ${nome}`);
    },
  },
}));

// O que a aba do aparelho B tem na memória: o retrato de quando abriu.
const retratoAntigo = {
  id: "cupom-1",
  code: "TESTE10",
  type: "fixed",
  value: 10,
  minPurchase: 0,
  usageLimit: 100,
  usageCount: 0,
  validUntil: undefined,
  active: true,
  alcance: "codigo",
};

let raiz: Root;
let tela: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  remendos.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // O banco de AGORA: no aparelho A ela já trocou o tipo para percentual.
  cupomNoBanco = {
    id: "cupom-1",
    code: "TESTE10",
    type: "percentage",
    value: 10,
    min_purchase: 0,
    usage_limit: 100,
    usage_count: 0,
    valid_until: null,
    active: true,
    alcance: "codigo",
  };
  setCachedCouponsData([retratoAntigo] as never);
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

async function abrir() {
  await act(async () => {
    raiz.render(
      <AdminCouponFormView
        couponId="cupom-1"
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

function botao(nome: string): HTMLButtonElement {
  const achado = [...document.body.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome ||
      b.textContent?.trim().startsWith(nome),
  );
  if (!achado) throw new Error(`Botão não encontrado: ${nome}`);
  return achado;
}

const clicar = (nome: string) => act(async () => botao(nome).click());

describe("editar cupom: tipo e valor do desconto vão juntos", () => {
  it("muda SÓ o valor (R$ 10 -> R$ 50): o tipo que ela viu vai junto e o banco não vira 50%", async () => {
    await abrir();
    await digitar("#coupon-value", "50");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ type: "fixed", value: 50 }]);
    // O banco de verdade: R$ 50, como a tela confirmou — nunca 50%.
    expect(cupomNoBanco.type).toBe("fixed");
    expect(cupomNoBanco.value).toBe(50);
    expect(sucesso).toHaveBeenCalledTimes(1);
  });

  it("muda SÓ o tipo (fixo -> percentual): o valor que ela viu vai junto", async () => {
    await abrir();
    await clicar("% Percentual");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ type: "percentage", value: 10 }]);
  });

  it("muda tipo E valor: vão os dois, sem chave repetida", async () => {
    await abrir();
    await clicar("% Percentual");
    await digitar("#coupon-value", "15");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ type: "percentage", value: 15 }]);
  });

  it("muda só o limite de uso: NEM tipo NEM valor viajam (o banco de A fica como está)", async () => {
    await abrir();
    await digitar("#coupon-usage-limit", "250");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ usage_limit: 250 }]);
    expect(cupomNoBanco.type).toBe("percentage");
    expect(cupomNoBanco.value).toBe(10);
  });

  it("nada mudou: não faz update e não manda tipo nem valor", async () => {
    await abrir();
    await clicar("Salvar Cupom");

    expect(remendos).toHaveLength(0);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
    expect(cupomNoBanco.type).toBe("percentage");
  });

  it("voltar o valor ao que a tela leu (mexeu e desmexeu): nada vai", async () => {
    await abrir();
    await digitar("#coupon-value", "50");
    await digitar("#coupon-value", "10");
    await clicar("Salvar Cupom");

    expect(remendos).toHaveLength(0);
  });

  it("valor mexido + limite mexido: o par vai e o resto só o que mexeu", async () => {
    await abrir();
    await digitar("#coupon-value", "50");
    await digitar("#coupon-usage-limit", "250");
    await clicar("Salvar Cupom");

    expect(remendos).toHaveLength(1);
    expect(remendos[0]).toEqual({
      type: "fixed",
      value: 50,
      usage_limit: 250,
    });
  });

  it("cupom NOVO continua mandando tudo", async () => {
    const inserts: Record<string, unknown>[] = [];
    const { supabase } = await import("@/lib/supabase");
    vi.spyOn(supabase, "from").mockImplementation((() => ({
      select: () => ({
        limit: async () => ({ error: null }),
        order: async () => ({ data: [], error: null }),
      }),
      insert: ([linha]: Record<string, unknown>[]) => {
        inserts.push(linha);
        return {
          select: () => ({
            single: async () => ({ data: { id: "novo" }, error: null }),
          }),
        };
      },
    })) as never);
    setCachedCouponsData([]);
    await act(async () => {
      raiz.render(
        <AdminCouponFormView onNavigate={navegar} onSetDirty={() => {}} />,
      );
    });
    await act(async () => {});
    await clicar("R$ Fixo");
    await digitar("#coupon-code", "NOVO50");
    await digitar("#coupon-value", "50");
    await clicar("Salvar Cupom");

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      code: "NOVO50",
      type: "fixed",
      value: 50,
      active: true,
    });
    expect(cachedCouponsData).not.toBeNull();
  });
});
