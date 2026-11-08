// @vitest-environment jsdom
// Formulário e hook reais: só a fronteira com o banco é simulada.
//
// A lista de clientes de um cupom exclusivo é lida ao abrir a tela e gravada
// INTEIRA no salvar (o banco apaga quem não está nela). Se a lojista mexeu na
// lista em outro aparelho nesse meio-tempo, salvar apagava a mudança de lá e a
// tela dizia "Cupom atualizado". Agora a tela relê a lista ANTES de gravar
// qualquer coisa: se ela mudou, não grava nada, junta o que veio do outro
// aparelho com o que a lojista mexeu e pede para conferir.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";

const gravarCupom = vi.fn();
const gravarClientes = vi.fn();
const listarClientes = vi.fn();
const sucesso = vi.fn();
const erro = vi.fn();
const navegar = vi.fn();
let cupomNoBanco: Record<string, unknown>;
let clientesNoBanco: string[];
let falhaNaProximaLeitura: boolean;

const NOMES = new Map([
  ["u-ana", "Ana"],
  ["u-bia", "Bia"],
  ["u-caio", "Caio"],
]);

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
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            const resposta = await gravarCupom(patch);
            if (!resposta.error) cupomNoBanco = { ...cupomNoBanco, ...patch };
            return { data: [{ id: "cupom-1" }], ...resposta };
          },
        }),
      }),
    }),
    rpc: async (nome: string, args: { p_clientes?: string[] }) => {
      if (nome === "admin_cupom_clientes") {
        listarClientes();
        if (falhaNaProximaLeitura) {
          falhaNaProximaLeitura = false;
          return { data: null, error: { code: "PGRST000", message: "rede" } };
        }
        return {
          data: clientesNoBanco.map((id) => ({
            user_id: id,
            nome: NOMES.get(id),
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
          data: {
            data: [{ id: "u-caio", full_name: "Caio", email: null }],
            total_count: 1,
          },
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
  falhaNaProximaLeitura = false;
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
        onSetDirty={() => {}}
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

async function acrescentarCaio() {
  await digitar("#coupon-clientes-busca", "ca");
  await clicar("Caio");
}

function listaNaTela(): string {
  return (
    tela.querySelector('[aria-label="Clientes que podem usar"]')?.textContent ??
    ""
  );
}

function avisoDeOutroAparelho(): boolean {
  return erro.mock.calls.some((c) =>
    String(c[0]).includes("mudou em outro aparelho"),
  );
}

describe("lista de clientes do cupom exclusivo — mudou em outro aparelho", () => {
  it("outro aparelho acrescentou Bia: salvar NÃO apaga a Bia, não grava nada e pede para conferir", async () => {
    await montar();
    expect(listaNaTela()).toContain("Ana");
    // O outro aparelho acrescenta Bia enquanto esta tela está aberta.
    clientesNoBanco = ["u-ana", "u-bia"];

    await digitar("#coupon-code", "VIPNOVO");
    await acrescentarCaio();
    await clicar("Salvar Cupom");

    // Nada foi gravado: nem as regras, nem a lista.
    expect(gravarCupom).not.toHaveBeenCalled();
    expect(gravarClientes).not.toHaveBeenCalled();
    expect(clientesNoBanco).toEqual(["u-ana", "u-bia"]);
    expect(sucesso).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
    // Avisa em português simples, uma vez só.
    expect(avisoDeOutroAparelho()).toBe(true);
    expect(erro).toHaveBeenCalledTimes(1);
    // A tela mostra a lista do banco + o que ela acrescentou, e mantém o que digitou.
    expect(listaNaTela()).toContain("Ana");
    expect(listaNaTela()).toContain("Bia");
    expect(listaNaTela()).toContain("Caio");
    expect((tela.querySelector("#coupon-code") as HTMLInputElement).value).toBe(
      "VIPNOVO",
    );
    expect(botao("Salvar Cupom").disabled).toBe(false);

    // Conferida a lista, o próximo salvar grava as três contas.
    await clicar("Salvar Cupom");
    expect(gravarClientes).toHaveBeenCalledTimes(1);
    expect(gravarClientes).toHaveBeenCalledWith(["u-ana", "u-bia", "u-caio"]);
    expect(clientesNoBanco).toEqual(["u-ana", "u-bia", "u-caio"]);
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
  });

  it("ela tira a Ana e o outro aparelho acrescentou a Bia: a Ana sai e a Bia fica", async () => {
    await montar();
    clientesNoBanco = ["u-ana", "u-bia"];

    await clicar("Tirar Ana da lista");
    await acrescentarCaio();
    await clicar("Salvar Cupom");

    expect(gravarClientes).not.toHaveBeenCalled();
    expect(avisoDeOutroAparelho()).toBe(true);
    expect(listaNaTela()).not.toContain("Ana");
    expect(listaNaTela()).toContain("Bia");
    expect(listaNaTela()).toContain("Caio");

    await clicar("Salvar Cupom");
    expect(gravarClientes).toHaveBeenCalledWith(["u-bia", "u-caio"]);
    expect(clientesNoBanco).toEqual(["u-bia", "u-caio"]);
  });

  it("o outro aparelho já fez a mesma mudança: avisa, não grava de novo e a tela fica igual ao banco", async () => {
    await montar();
    // O outro aparelho acrescentou justamente o Caio que ela vai acrescentar.
    clientesNoBanco = ["u-ana", "u-caio"];
    await acrescentarCaio();
    await clicar("Salvar Cupom");

    expect(avisoDeOutroAparelho()).toBe(true);
    // A lista da tela agora é igual à do banco: nada sobra para gravar.
    expect(gravarClientes).not.toHaveBeenCalled();
    expect(listaNaTela()).toContain("Ana");
    expect(listaNaTela()).toContain("Caio");
    expect(clientesNoBanco).toEqual(["u-ana", "u-caio"]);
  });

  it("ninguém mexeu na lista em outro aparelho: salva direto, sem aviso", async () => {
    await montar();
    await acrescentarCaio();
    await clicar("Salvar Cupom");

    expect(avisoDeOutroAparelho()).toBe(false);
    expect(erro).not.toHaveBeenCalled();
    expect(gravarClientes).toHaveBeenCalledWith(["u-ana", "u-caio"]);
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-coupons");
    // Abriu a tela e conferiu antes de gravar.
    expect(listarClientes).toHaveBeenCalledTimes(2);
  });

  it("não deu para conferir a lista: nada é gravado e o que ela digitou fica", async () => {
    await montar();
    await digitar("#coupon-code", "VIPNOVO");
    await acrescentarCaio();
    falhaNaProximaLeitura = true;
    await clicar("Salvar Cupom");

    expect(gravarCupom).not.toHaveBeenCalled();
    expect(gravarClientes).not.toHaveBeenCalled();
    expect(sucesso).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalledTimes(1);
    expect(String(erro.mock.calls[0][0])).toContain("Nada foi salvo");
    expect(listaNaTela()).toContain("Caio");
    expect((tela.querySelector("#coupon-code") as HTMLInputElement).value).toBe(
      "VIPNOVO",
    );
    expect(botao("Salvar Cupom").disabled).toBe(false);

    // Tentar de novo (agora a conferência responde) grava normalmente.
    await clicar("Salvar Cupom");
    expect(gravarClientes).toHaveBeenCalledWith(["u-ana", "u-caio"]);
    expect(sucesso).toHaveBeenCalledTimes(1);
  });

  it("mexeu só no código, sem tocar na lista: não relê nem regrava a lista", async () => {
    await montar();
    clientesNoBanco = ["u-ana", "u-bia"];
    await digitar("#coupon-code", "VIPNOVO");
    await clicar("Salvar Cupom");

    // A lista não é dela neste salvar: a Bia do outro aparelho fica intacta.
    expect(gravarClientes).not.toHaveBeenCalled();
    expect(clientesNoBanco).toEqual(["u-ana", "u-bia"]);
    expect(gravarCupom).toHaveBeenCalledTimes(1);
    expect(avisoDeOutroAparelho()).toBe(false);
    expect(sucesso).toHaveBeenCalledTimes(1);
  });
});
