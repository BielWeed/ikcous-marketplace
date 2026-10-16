import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
// @vitest-environment jsdom
// Formulário e hook reais: só a fronteira com o banco é simulada.
// Antes da correção, a falha da RPC mostrava sucesso e saía da edição;
// a troca otimista de alcance ainda podia recarregar a lista antiga.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gravarCupom = vi.fn();
const gravarClientes = vi.fn();
const consultarCupons = vi.fn();
const listarClientes = vi.fn();
const sucesso = vi.fn();
const erro = vi.fn();
const navegar = vi.fn();
const marcarSujo = vi.fn();
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
        order: async () => {
          consultarCupons();
          return { data: [{ ...cupomNoBanco }], error: null };
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          const resposta = await gravarCupom(patch);
          if (!resposta.error) cupomNoBanco = { ...cupomNoBanco, ...patch };
          return resposta;
        },
      }),
    }),
    rpc: async (nome: string, args: { p_clientes?: string[] }) => {
      if (nome === "admin_cupom_clientes") {
        listarClientes();
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
        const resposta = await gravarClientes(args.p_clientes);
        if (!resposta.error) clientesNoBanco = [...(args.p_clientes ?? [])];
        return resposta;
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

let raiz: Root;
let tela: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  gravarCupom.mockReset().mockResolvedValue({ error: null });
  gravarClientes.mockReset().mockResolvedValue({ error: null });
  setCachedCouponsData(null);
  cupomNoBanco = {
    id: "cupom-1",
    code: "VIP",
    type: "percentage",
    value: 10,
    active: true,
    usage_count: 0,
    alcance: "exclusivo",
    min_purchase: 0,
    usage_limit: 0,
    valid_until: null,
  };
  clientesNoBanco = ["u-ana"];
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

async function montar() {
  await act(async () => {
    raiz.render(
      <AdminCouponFormView
        couponId="cupom-1"
        onNavigate={navegar}
        onSetDirty={marcarSujo}
      />,
    );
  });
}

function botao(nome: string): HTMLButtonElement {
  const encontrado = [...tela.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome ||
      b.textContent?.trim().startsWith(nome),
  );
  if (!encontrado) throw new Error(`Botão não encontrado: ${nome}`);
  return encontrado;
}

async function clicar(nome: string) {
  await act(async () => botao(nome).click());
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

async function escolherBia() {
  await digitar("#coupon-clientes-busca", "bi");
  await clicar("Bia");
}

function listaNaTela() {
  return tela.querySelector('[aria-label="Clientes que podem usar"]')
    ?.textContent;
}

function esperarFalhaSemPerderCampos() {
  expect(erro).toHaveBeenCalledTimes(1);
  expect(erro).toHaveBeenCalledWith(
    "Não foi possível salvar o cupom. Confira e tente de novo.",
  );
  expect(sucesso).not.toHaveBeenCalled();
  expect(navegar).not.toHaveBeenCalled();
  expect(marcarSujo).toHaveBeenLastCalledWith(true);
  expect((tela.querySelector("#coupon-code") as HTMLInputElement).value).toBe(
    "VIPNOVO",
  );
  expect(botao("Salvar Cupom").disabled).toBe(false);
}

describe("edição do cupom — confirmação das regras e dos clientes", () => {
  it.each(["erro do servidor", "rede caiu"])(
    "falha nos clientes (%s) mantém a edição e permite tentar de novo",
    async (falha) => {
      if (falha === "rede caiu") {
        gravarClientes.mockRejectedValueOnce(new Error("rede"));
      } else {
        gravarClientes.mockResolvedValueOnce({ error: { code: "42501" } });
      }
      await montar();
      await escolherBia();
      await digitar("#coupon-code", "VIPNOVO");
      await clicar("Salvar Cupom");

      esperarFalhaSemPerderCampos();
      expect(listaNaTela()).toContain("Bia");
      expect(listaNaTela()).toContain("Ana");
      // Falha parcial: o UPDATE já chegou ao banco, mas não é sucesso do formulário.
      expect(cupomNoBanco.code).toBe("VIPNOVO");
      expect(clientesNoBanco).toEqual(["u-ana"]);
      expect(cachedCouponsData?.[0].code).toBe("VIP");
      expect(consultarCupons).toHaveBeenCalledTimes(1);

      await clicar("Salvar Cupom");
      expect(clientesNoBanco).toEqual(["u-ana", "u-bia"]);
      expect(sucesso).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith("admin-coupons");
      expect(marcarSujo).toHaveBeenLastCalledWith(false);
    },
  );

  it("falha no cupom não grava os clientes nem descarta o que foi digitado", async () => {
    gravarCupom.mockResolvedValueOnce({ error: { code: "PGRST000" } });
    await montar();
    await escolherBia();
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");
    esperarFalhaSemPerderCampos();
    expect(listaNaTela()).toContain("Bia");
    expect(gravarClientes).not.toHaveBeenCalled();
    expect(cupomNoBanco.code).toBe("VIP");
    expect(clientesNoBanco).toEqual(["u-ana"]);
  });

  it("trocar para exclusivo espera a lista sem recarregar os clientes antigos", async () => {
    cupomNoBanco.alcance = "codigo";
    let resolver!: (resposta: { error: null }) => void;
    gravarClientes.mockReturnValueOnce(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await montar();
    await clicar("Clientes escolhidos");
    await escolherBia();
    await clicar("Salvar Cupom");
    expect(sucesso).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
    expect(consultarCupons).toHaveBeenCalledTimes(1);
    expect(listarClientes).not.toHaveBeenCalled();
    expect(cachedCouponsData?.[0].alcance).toBe("codigo");
    expect(listaNaTela()).toContain("Bia");
    expect(listaNaTela()).not.toContain("Ana");
    await act(async () => resolver({ error: null }));
    expect(clientesNoBanco).toEqual(["u-bia"]);
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });

  it("trocar para exclusivo e falhar não substitui o rascunho pela lista antiga", async () => {
    cupomNoBanco.alcance = "codigo";
    gravarClientes.mockResolvedValueOnce({ error: { code: "PGRST000" } });
    await montar();
    await clicar("Clientes escolhidos");
    await escolherBia();
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");
    esperarFalhaSemPerderCampos();
    expect(listaNaTela()).toContain("Bia");
    expect(listaNaTela()).not.toContain("Ana");
    expect(listarClientes).not.toHaveBeenCalled();
    expect(cachedCouponsData?.[0].alcance).toBe("codigo");
  });

  it("falha ao limpar clientes ao sair do exclusivo também impede sucesso", async () => {
    gravarClientes.mockResolvedValueOnce({ error: { code: "PGRST000" } });
    await montar();
    await clicar("Quem tiver o código");
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");
    esperarFalhaSemPerderCampos();
    expect(clientesNoBanco).toEqual(["u-ana"]);
    expect(cupomNoBanco.alcance).toBe("codigo");
    await clicar("Salvar Cupom");
    expect(clientesNoBanco).toEqual([]);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });
});
