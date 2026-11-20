// @vitest-environment jsdom
//
// Cupom editado em dois aparelhos: tipo (R$ / %) e valor do desconto são UM par.
//
// Se tipo OU valor mudou, os dois vão juntos. Isso não autoriza uma edição
// aberta em "R$ 10" a repor o tipo fixo depois de outro aparelho salvar
// "10%": o UPDATE só grava se o par antigo ainda estiver no banco.
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
const gravarClientes = vi.fn();
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
      update: (remendo: Record<string, unknown>) => {
        const filtros = new Map<string, unknown>();
        const gravacao = {
          eq: (coluna: string, valor: unknown) => {
            filtros.set(coluna, valor);
            return gravacao;
          },
          select: async () => {
            const colunas = new Map(Object.entries(cupomNoBanco));
            if (
              [...filtros].some(
                ([coluna, valor]) => colunas.get(coluna) !== valor,
              )
            ) {
              return { data: [], error: null };
            }
            remendos.push(remendo);
            cupomNoBanco = { ...cupomNoBanco, ...remendo };
            return { data: [{ id: "cupom-1" }], error: null };
          },
        };
        return gravacao;
      },
    }),
    rpc: async (nome: string) => {
      if (nome === "admin_cupom_clientes") return { data: [], error: null };
      if (nome === "admin_cupom_definir_clientes") return gravarClientes();
      if (nome === "get_admin_customers_paged") {
        return {
          data: { data: [{ id: "u-ana", full_name: "Ana", email: null }] },
          error: null,
        };
      }
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
  gravarClientes.mockReset().mockResolvedValue({ error: null });
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
  it("muda SÓ o valor (R$ 10 -> R$ 50) mesmo se o contador de usos avançou", async () => {
    cupomNoBanco.type = "fixed";
    await abrir();
    await digitar("#coupon-value", "50");
    cupomNoBanco.usage_count = 1;
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ type: "fixed", value: 50 }]);
    // O banco de verdade: R$ 50, como a tela confirmou — nunca 50%.
    expect(cupomNoBanco.type).toBe("fixed");
    expect(cupomNoBanco.value).toBe(50);
    expect(cupomNoBanco.usage_count).toBe(1);
    expect(sucesso).toHaveBeenCalledTimes(1);
  });

  it("recusa o valor digitado se outro aparelho mudou apenas o tipo depois da abertura", async () => {
    cupomNoBanco.type = "fixed";
    await abrir();
    await digitar("#coupon-value", "20");
    cupomNoBanco.type = "percentage";
    cupomNoBanco.usage_count = 1;
    await clicar("Salvar Cupom");

    expect(cupomNoBanco).toMatchObject({
      type: "percentage",
      value: 10,
      usage_count: 1,
    });
    expect(erro).toHaveBeenCalledWith(
      "Este cupom mudou em outro aparelho. Recarregue antes de salvar.",
    );
    expect(sucesso).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });

  it("recusa o tipo digitado se outro aparelho mudou apenas o valor depois da abertura", async () => {
    cupomNoBanco.type = "fixed";
    await abrir();
    await clicar("% Percentual");
    cupomNoBanco.value = 15;
    await clicar("Salvar Cupom");

    expect(cupomNoBanco).toMatchObject({ type: "fixed", value: 15 });
    expect(erro).toHaveBeenCalledWith(
      "Este cupom mudou em outro aparelho. Recarregue antes de salvar.",
    );
    expect(sucesso).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });

  it("depois que só a lista falha, a nova tentativa não regrava o desconto", async () => {
    cupomNoBanco.type = "fixed";
    gravarClientes.mockResolvedValueOnce({ error: { code: "42501" } });
    await abrir();
    await clicar("Clientes escolhidos");
    await digitar("#coupon-clientes-busca", "an");
    await clicar("Ana");
    await digitar("#coupon-value", "20");
    await clicar("Salvar Cupom");

    expect(cupomNoBanco.value).toBe(20);
    expect(gravarClientes).toHaveBeenCalledTimes(1);
    expect(sucesso).not.toHaveBeenCalled();

    cupomNoBanco.value = 30; // Outro aparelho editou após o primeiro salvar.
    await clicar("Salvar Cupom");

    expect(cupomNoBanco.value).toBe(30);
    expect(remendos.filter((remendo) => "value" in remendo)).toHaveLength(1);
    expect(gravarClientes).toHaveBeenCalledTimes(2);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });

  it("muda SÓ o tipo (fixo -> percentual): o valor que ela viu vai junto", async () => {
    cupomNoBanco.type = "fixed";
    await abrir();
    await clicar("% Percentual");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ type: "percentage", value: 10 }]);
  });

  it("muda tipo E valor: vão os dois, sem chave repetida", async () => {
    cupomNoBanco.type = "fixed";
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
    cupomNoBanco.type = "fixed";
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
