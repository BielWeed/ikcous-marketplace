// @vitest-environment jsdom
//
// Lote 260 (caça 14-C, item 2) — salvar um cupom aberto há tempo religava o
// cupom que a lojista desligou em outro aparelho.
//
// O formulário se preenche UMA vez, do que estava na memória da aba, e o
// salvar mandava o formulário INTEIRO. Cenário: ela abre o BLACK50 no
// computador (ativo, limite 100); no celular desliga o cupom e baixa o limite
// para 10; de volta ao computador muda só a validade e salva → o cupom voltava
// a valer, com o limite antigo, e a tela dizia "Cupom atualizado".
//
// Formulário e hook REAIS; só a fronteira com o banco é simulada, e ela
// REGISTRA o que de fato chega ao `update` (dublê com causalidade: o "banco"
// aplica o remendo por cima do que tinha, como o UPDATE de verdade).
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remendos: Record<string, unknown>[] = [];
const gravarClientes = vi.fn();
const navegar = vi.fn();
const sucesso = vi.fn();
const erro = vi.fn();
let cupomNoBanco: Record<string, unknown>;
let clientesNoBanco: string[];

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
            return { data: [{ id: "c1" }], error: null };
          },
        }),
      }),
    }),
    rpc: async (nome: string, args: { p_clientes?: string[] }) => {
      if (nome === "admin_cupom_clientes") {
        return {
          data: clientesNoBanco.map((id) => ({
            user_id: id,
            nome: id === "u-ana" ? "Ana" : "Bia",
            email: null,
          })),
          error: null,
        };
      }
      if (nome === "admin_cupom_definir_clientes") {
        gravarClientes(args.p_clientes);
        clientesNoBanco = [...(args.p_clientes ?? [])];
        return { error: null };
      }
      if (nome === "get_admin_customers_paged") {
        return {
          data: { data: [{ id: "u-bia", full_name: "Bia", email: null }] },
          error: null,
        };
      }
      throw new Error(`RPC inesperada: ${nome}`);
    },
  },
}));

const EM_30_DIAS = new Date(Date.now() + 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);

// O que a aba do computador tem na memória: o retrato de quando abriu.
const retratoAntigo = {
  id: "cupom-1",
  code: "BLACK50",
  type: "percentage",
  value: 50,
  minPurchase: 100,
  usageLimit: 100,
  usageCount: 3,
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
  // O banco de AGORA: no celular ela desligou o cupom e baixou o limite.
  cupomNoBanco = {
    id: "cupom-1",
    code: "BLACK50",
    type: "percentage",
    value: 50,
    min_purchase: 100,
    usage_limit: 10,
    usage_count: 3,
    valid_until: null,
    active: false,
    alcance: "codigo",
  };
  clientesNoBanco = ["u-ana"];
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
  // A leitura nova do banco chega DEPOIS de o formulário já estar preenchido.
  await act(async () => {});
}

async function escolherValidade(dia: string) {
  const campo = tela.querySelector("#coupon-valid-until") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, dia);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

describe("editar cupom manda SÓ o que a lojista mexeu", () => {
  it("muda só a validade: o cupom desligado no celular continua desligado", async () => {
    await abrir();
    // A tela mostra o retrato antigo (cupom ativo) — é o cenário do defeito.
    expect(
      (tela.querySelector("#coupon-active") as HTMLElement).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");

    await escolherValidade(EM_30_DIAS);
    await clicar("Salvar Cupom");

    expect(remendos).toHaveLength(1);
    expect(Object.keys(remendos[0])).toEqual(["valid_until"]);
    // O "banco" de verdade: segue desligado, com o limite novo.
    expect(cupomNoBanco.active).toBe(false);
    expect(cupomNoBanco.usage_limit).toBe(10);
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });

  it("liga/desliga de propósito: vai só o 'ativo'", async () => {
    await abrir();
    await act(async () =>
      (tela.querySelector("#coupon-active") as HTMLElement).click(),
    );
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ active: false }]);
  });

  it("muda só o limite de uso: vai só o limite", async () => {
    await abrir();
    await digitar("#coupon-usage-limit", "250");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ usage_limit: 250 }]);
  });

  it("limpar a validade que a tela leu continua gravando vazio de verdade", async () => {
    setCachedCouponsData([
      { ...retratoAntigo, validUntil: "2030-01-31T23:59:59.999Z" },
    ] as never);
    await abrir();
    await clicar("Limpar validade");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ valid_until: null }]);
  });

  it("muda o código: vai o código novo normalizado, e só ele", async () => {
    await abrir();
    await digitar("#coupon-code", "sexta 70");
    await clicar("Salvar Cupom");

    expect(remendos).toEqual([{ code: "SEXTA70" }]);
  });

  it("nada mudou: não faz update vazio e fecha a tela", async () => {
    await abrir();
    await clicar("Salvar Cupom");

    expect(remendos).toHaveLength(0);
    expect(erro).not.toHaveBeenCalled();
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
    // O banco ficou como o outro aparelho deixou.
    expect(cupomNoBanco.active).toBe(false);
  });

  it("validade que já passou continua pedindo confirmação, e o remendo é só a validade", async () => {
    await abrir();
    await escolherValidade("2020-01-02");
    await clicar("Salvar Cupom");
    expect(document.body.textContent).toContain("Essa data já passou");
    expect(remendos).toHaveLength(0);

    await act(async () => botao("Salvar mesmo assim").click());
    expect(remendos).toHaveLength(1);
    expect(Object.keys(remendos[0])).toEqual(["valid_until"]);
  });

  it("só a lista de clientes mudou: grava a lista e não manda update vazio", async () => {
    cupomNoBanco.alcance = "exclusivo";
    setCachedCouponsData([{ ...retratoAntigo, alcance: "exclusivo" }] as never);
    await abrir();
    await digitar("#coupon-clientes-busca", "bi");
    await clicar("Bia");
    await clicar("Salvar Cupom");

    expect(remendos).toHaveLength(0);
    expect(gravarClientes).toHaveBeenCalledWith(["u-ana", "u-bia"]);
    expect(erro).not.toHaveBeenCalled();
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
    expect(cachedCouponsData).not.toBeNull();
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
    await digitar("#coupon-code", "NOVO10");
    await digitar("#coupon-value", "10");
    await clicar("Salvar Cupom");

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      code: "NOVO10",
      type: "percentage",
      value: 10,
      active: true,
      usage_limit: 0,
      min_purchase: 0,
    });
  });
});
