import { erroDeConsultaSemResposta } from "@/lib/prazo-da-requisicao";
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
        eq: () => ({
          select: async () => {
            const resposta = await gravarCupom(patch);
            if (!resposta.error) cupomNoBanco = { ...cupomNoBanco, ...patch };
            return { data: [{ id: "c1" }], ...resposta };
          },
        }),
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

const SALVO_SEM_A_LISTA = "O cupom foi salvo, mas a lista de clientes NÃO.";

// `descricao`: o trecho que diz a ela o que fazer. Sem ele, o aviso é o genérico
// de quando NADA foi gravado (as regras falharam antes da lista).
function esperarFalhaSemPerderCampos(descricao?: string) {
  expect(erro).toHaveBeenCalledTimes(1);
  if (descricao === undefined) {
    expect(erro).toHaveBeenCalledWith(
      "Não foi possível salvar o cupom. Confira e tente de novo.",
    );
  } else {
    expect(erro).toHaveBeenCalledWith(
      SALVO_SEM_A_LISTA,
      expect.objectContaining({
        description: expect.stringContaining(descricao),
      }),
    );
  }
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

      // As regras já estão no banco: o aviso diz isso e que a lista NÃO foi,
      // e o motivo real quando é permissão (entrar de novo, não "tentar").
      esperarFalhaSemPerderCampos(
        falha === "rede caiu"
          ? "continua na tela"
          : "não tem mais permissão de administrador",
      );
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

  it("código repetido em cupom exclusivo diz o motivo, não o aviso genérico", async () => {
    gravarCupom.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    await montar();
    await escolherBia();
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");
    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith("Já existe um cupom com este código.");
    expect(sucesso).not.toHaveBeenCalled();
    expect(gravarClientes).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
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
    esperarFalhaSemPerderCampos("continua na tela");
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
    esperarFalhaSemPerderCampos("continua na tela");
    expect(clientesNoBanco).toEqual(["u-ana"]);
    expect(cupomNoBanco.alcance).toBe("codigo");
    await clicar("Salvar Cupom");
    expect(clientesNoBanco).toEqual([]);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });

  it("só a lista mudou e ela falha: nada do cupom foi gravado, então o aviso NÃO diz que o cupom foi salvo", async () => {
    gravarClientes.mockRejectedValueOnce(new Error("rede"));
    await montar();
    await escolherBia();
    await clicar("Salvar Cupom");

    expect(gravarCupom).not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith(
      "Não foi possível salvar o cupom. Confira e tente de novo.",
    );
    expect(listaNaTela()).toContain("Bia");
    expect(navegar).not.toHaveBeenCalled();
  });

  it("sem resposta da rede na lista, depois de salvar as regras: diz que o cupom foi salvo, mantém a tela e não recarrega por cima", async () => {
    gravarClientes.mockRejectedValueOnce(erroDeConsultaSemResposta());
    await montar();
    await escolherBia();
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");

    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith(
      expect.stringContaining("O cupom foi salvo"),
      expect.objectContaining({
        description: expect.stringContaining("continua na tela"),
      }),
    );
    expect(cupomNoBanco.code).toBe("VIPNOVO");
    expect(listaNaTela()).toContain("Bia");
    expect(listaNaTela()).toContain("Ana");
    expect(navegar).not.toHaveBeenCalled();
    // Nada de reler os cupons por cima do que ela escolheu.
    expect(consultarCupons).toHaveBeenCalledTimes(1);
    expect((tela.querySelector("#coupon-code") as HTMLInputElement).value).toBe(
      "VIPNOVO",
    );
  });

  it("sem resposta, mas a lista chegou ao banco: no novo salvar a tela confere, mostra a lista certa e o toque seguinte conclui", async () => {
    gravarClientes.mockImplementationOnce(async (lista: string[]) => {
      // A gravação chegou ao servidor, só a resposta se perdeu.
      clientesNoBanco = [...lista];
      throw erroDeConsultaSemResposta();
    });
    await montar();
    await escolherBia();
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");
    expect(clientesNoBanco).toEqual(["u-ana", "u-bia"]);
    erro.mockClear();

    // Segundo toque: a conferência acha a lista diferente da que a tela leu
    // ao abrir; não grava nada e mostra a lista que o banco já tem.
    await clicar("Salvar Cupom");
    expect(erro).toHaveBeenCalledTimes(1);
    expect(String(erro.mock.calls[0][0])).toContain("mudou em outro aparelho");
    expect(listaNaTela()).toContain("Ana");
    expect(listaNaTela()).toContain("Bia");
    expect(navegar).not.toHaveBeenCalled();

    // Terceiro toque: lista já igual à do banco, conclui sem erro.
    erro.mockClear();
    await clicar("Salvar Cupom");
    expect(erro).not.toHaveBeenCalled();
    expect(clientesNoBanco).toEqual(["u-ana", "u-bia"]);
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });
});
