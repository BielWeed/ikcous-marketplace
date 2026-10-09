// @vitest-environment jsdom
//
// Frente B (cupons visíveis no checkout), lado do hook do painel: o "alcance"
// do cupom (codigo | vitrine | exclusivo) e a lista de clientes do exclusivo.
//
// O que este teste tranca, além do caminho feliz:
//   - o painel NOVO convive com o banco ANTIGO (sem a coluna `alcance`, antes
//     da migration 20261208000000): criar e editar cupom SECRETO nunca manda
//     a coluna, senão o banco responde 42703 e a lojista não consegue mais
//     salvar nenhum cupom. Lojas de teste recebem só o site, então essa
//     combinação é PERMANENTE nelas.
//   - voltar um cupom de "exclusivo" para "secreto" NÃO pode ser engolido pelo
//     atalho acima (a tela diria "atualizado" e o cupom seguiria exclusivo).
//   - a lista de clientes nunca carrega CPF, mesmo que a RPC devolva a mais.
//   - o erro do banco (42501: administradora rebaixada) chega à tela COM o
//     código, para ela poder dizer o motivo real.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const rpc = vi.fn();
let linhasDoBanco: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: linhasDoBanco, error: null }),
      }),
      insert: (linhas: unknown) => {
        insert(linhas);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: { id: "novo" }, error: null }),
          }),
        };
      },
      update: (payload: unknown) => {
        update(payload);
        return { eq: (...args: unknown[]) => eq(...args) };
      },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof import("@/hooks/useCoupons")["useCoupons"]>;

const cupomSecreto = {
  id: "c-secreto",
  code: "SECRETO",
  type: "percentage",
  value: 10,
  active: true,
  usage_count: 0,
  alcance: "codigo",
};
const cupomExclusivo = {
  id: "c-exclusivo",
  code: "VIP",
  type: "fixed",
  value: 20,
  active: true,
  usage_count: 0,
  alcance: "exclusivo",
};

describe("useCoupons — alcance e clientes do cupom", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    insert.mockClear();
    update.mockClear();
    eq.mockReset();
    eq.mockResolvedValue({ error: null });
    rpc.mockReset();
    linhasDoBanco = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  /** Monta o hook com os hooks do React vivos e devolve um acessor ao estado mais novo. */
  async function montar(autoFetch = true): Promise<() => Hook> {
    const { useCoupons } = await import("@/hooks/useCoupons");
    let atual!: Hook;
    function Sonda() {
      const valor = useCoupons(autoFetch);
      useEffect(() => {
        atual = valor;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {});
    return () => atual;
  }

  const novoCupom = (extra: Record<string, unknown> = {}) =>
    ({
      code: "NOVO",
      type: "percentage",
      value: 10,
      minPurchase: 0,
      usageLimit: 0,
      active: true,
      ...extra,
    }) as Parameters<Hook["addCoupon"]>[0];

  describe("addCoupon", () => {
    it("cupom secreto NÃO manda a coluna alcance (banco antigo continua aceitando)", async () => {
      const hook = await montar();
      await act(async () => {
        await hook().addCoupon(novoCupom({ alcance: "codigo" }));
      });
      expect(insert).toHaveBeenCalledTimes(1);
      expect("alcance" in insert.mock.calls[0][0][0]).toBe(false);
    });

    it("cupom sem alcance nenhum (chamador antigo) também não manda", async () => {
      const hook = await montar();
      await act(async () => {
        await hook().addCoupon(novoCupom());
      });
      expect("alcance" in insert.mock.calls[0][0][0]).toBe(false);
    });

    it.each(["vitrine", "exclusivo"] as const)(
      "cupom %s manda o alcance",
      async (alcance) => {
        const hook = await montar();
        await act(async () => {
          await hook().addCoupon(novoCupom({ alcance }));
        });
        expect(insert.mock.calls[0][0][0].alcance).toBe(alcance);
      },
    );
  });

  describe("updateCoupon", () => {
    it("patch sem a chave alcance não manda a coluna (ligar/desligar o cupom)", async () => {
      linhasDoBanco = [cupomSecreto];
      const hook = await montar();
      await act(async () => {
        await hook().updateCoupon("c-secreto", { active: false });
      });
      expect(update).toHaveBeenCalledWith({ active: false });
    });

    it("secreto -> exclusivo manda o alcance", async () => {
      linhasDoBanco = [cupomSecreto];
      const hook = await montar();
      await act(async () => {
        await hook().updateCoupon("c-secreto", { alcance: "exclusivo" });
      });
      expect(update).toHaveBeenCalledWith({ alcance: "exclusivo" });
    });

    it("secreto -> secreto (formulário que reenvia tudo) NÃO manda a coluna", async () => {
      linhasDoBanco = [cupomSecreto];
      const hook = await montar();
      await act(async () => {
        await hook().updateCoupon("c-secreto", {
          alcance: "codigo",
          value: 12,
        });
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect("alcance" in update.mock.calls[0][0]).toBe(false);
      expect(update.mock.calls[0][0]).toEqual({ value: 12 });
    });

    it("exclusivo -> secreto MANDA o alcance (voltar para secreto não é engolido)", async () => {
      linhasDoBanco = [cupomExclusivo];
      const hook = await montar();
      await act(async () => {
        await hook().updateCoupon("c-exclusivo", { alcance: "codigo" });
      });
      expect(update).toHaveBeenCalledWith({ alcance: "codigo" });
    });

    it("cupom que não está na lista carregada: o 'codigo' PEDIDO vai (o anterior é desconhecido)", async () => {
      linhasDoBanco = [];
      const hook = await montar();
      await act(async () => {
        await hook().updateCoupon("fora-da-lista", { alcance: "codigo" });
      });
      expect(update).toHaveBeenCalledWith({ alcance: "codigo" });
    });

    it("banco sem a coluna (linha sem alcance) lido como secreto: secreto -> secreto não manda", async () => {
      const { alcance: _tirada, ...semAlcance } = cupomSecreto;
      linhasDoBanco = [semAlcance];
      const hook = await montar();
      await act(async () => {
        await hook().updateCoupon("c-secreto", { alcance: "codigo" });
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect("alcance" in update.mock.calls[0][0]).toBe(false);
    });
  });

  describe("listarClientesDoCupom", () => {
    it("pergunta pela RPC do painel e devolve id, nome e e-mail", async () => {
      rpc.mockResolvedValue({
        data: [
          { user_id: "u1", nome: "Ana", email: "ana@prova.teste" },
          { user_id: "u2", nome: null, email: null },
        ],
        error: null,
      });
      const hook = await montar(false);
      const lista = await hook().listarClientesDoCupom("c-exclusivo");
      expect(rpc).toHaveBeenCalledWith("admin_cupom_clientes", {
        p_coupon_id: "c-exclusivo",
      });
      expect(lista).toEqual([
        { id: "u1", nome: "Ana", email: "ana@prova.teste" },
        { id: "u2", nome: null, email: null },
      ]);
    });

    it("lista vazia (data null) vira []", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      const hook = await montar(false);
      expect(await hook().listarClientesDoCupom("c")).toEqual([]);
    });

    it("NUNCA repassa CPF, mesmo que a RPC devolva campo a mais", async () => {
      rpc.mockResolvedValue({
        data: [
          {
            user_id: "u1",
            nome: "Ana",
            email: null,
            cpf: "123.456.789-09",
            cpf_digits: "12345678909",
          },
        ],
        error: null,
      });
      const hook = await montar(false);
      const [linha] = await hook().listarClientesDoCupom("c");
      expect(Object.keys(linha).sort()).toEqual(["email", "id", "nome"]);
      expect(JSON.stringify(linha)).not.toContain("12345678909");
      expect(JSON.stringify(linha)).not.toContain("123.456");
    });

    it("administradora rebaixada (42501): lança o erro COM o código, sem engolir", async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied" },
      });
      const hook = await montar(false);
      await expect(hook().listarClientesDoCupom("c")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  describe("definirClientesDoCupom", () => {
    it("troca a lista inteira pela RPC, com os ids recebidos", async () => {
      rpc.mockResolvedValue({ data: 2, error: null });
      const hook = await montar(false);
      await hook().definirClientesDoCupom("c-exclusivo", ["u1", "u2"]);
      expect(rpc).toHaveBeenCalledWith("admin_cupom_definir_clientes", {
        p_coupon_id: "c-exclusivo",
        p_clientes: ["u1", "u2"],
      });
    });

    it("lista vazia é legítima (tirar todo mundo)", async () => {
      rpc.mockResolvedValue({ data: 0, error: null });
      const hook = await montar(false);
      await hook().definirClientesDoCupom("c", []);
      expect(rpc).toHaveBeenCalledWith("admin_cupom_definir_clientes", {
        p_coupon_id: "c",
        p_clientes: [],
      });
    });

    it("falha do banco lança (a tela precisa saber que a lista NÃO foi gravada)", async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied" },
      });
      const hook = await montar(false);
      await expect(
        hook().definirClientesDoCupom("c", ["u1"]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("buscarClientesParaCupom", () => {
    it("usa a busca paginada do painel e devolve só id, nome e e-mail", async () => {
      rpc.mockResolvedValue({
        data: {
          data: [
            {
              id: "u1",
              full_name: "Ana",
              email: "ana@prova.teste",
              cpf: "12345678909",
              phone: "11999999999",
            },
            { id: 7, full_name: 12, email: undefined },
          ],
        },
        error: null,
      });
      const hook = await montar(false);
      const achados = await hook().buscarClientesParaCupom("an");
      expect(rpc).toHaveBeenCalledWith("get_admin_customers_paged", {
        p_search: "an",
        p_sort_field: "created_at",
        p_sort_direction: "desc",
        p_page: 0,
        p_page_size: 8,
      });
      expect(achados).toEqual([
        { id: "u1", full_name: "Ana", email: "ana@prova.teste" },
        { id: "7", full_name: null, email: null },
      ]);
      expect(JSON.stringify(achados)).not.toContain("12345678909");
    });

    it("resposta sem linhas (null) vira []", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      const hook = await montar(false);
      expect(await hook().buscarClientesParaCupom("zz")).toEqual([]);
    });

    it("erro do banco lança", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
      const hook = await montar(false);
      await expect(hook().buscarClientesParaCupom("an")).rejects.toMatchObject({
        code: "42501",
      });
    });
  });
});
