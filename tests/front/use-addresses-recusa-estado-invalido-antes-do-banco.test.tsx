// @vitest-environment jsdom
//
// ESTADO INVÁLIDO É RECUSADO ANTES DE IR AO BANCO (r136-b).
//
// `addAddress` e `updateAddress` conferem a UF (`ufBrasileiraValida`) e
// recusam com o aviso "Estado inválido" ANTES de qualquer chamada a
// `supabase.from("user_addresses")`. Nenhum outro teste derrubava essas duas
// guardas: o formulário já valida a UF por conta própria, então o gancho
// parecia coberto -- mas outras telas chamam o gancho direto. Aqui o dublê do
// banco registra TODA chamada (inclusive o `from`), e o que se afirma é o
// retorno, o aviso e a ausência total de ida ao banco.
//
// A régua `ufBrasileiraValida` aparara espaços e ignora caixa: " sp " vale
// como SP (e vai ao banco do jeito que veio -- ver o CONTROLE abaixo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

const banco = vi.hoisted(() => ({
  tabelas: [] as string[],
  operacoes: [] as Array<{ op: string; payload?: unknown }>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

const avisos = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: avisos }));

vi.mock("@/lib/supabase", () => {
  const consulta = (op: string, payload?: unknown) => {
    const executar = () => {
      banco.operacoes.push({ op, payload });
      const linha = {
        id: "end-1",
        user_id: "conta-a",
        name: "Casa",
        recipient_name: "Ana",
        cep: "38500-001",
        street: "Rua Um",
        number: "1",
        complement: null,
        neighborhood: "Centro",
        city: "Monte Carmelo",
        state: "SP",
        reference: null,
        is_default: false,
        ...(payload as Record<string, unknown> | undefined),
      };
      return op === "select"
        ? { data: [], error: null }
        : { data: linha, error: null };
    };
    const cadeia: any = {
      eq: () => cadeia,
      order: () => cadeia,
      select: () => cadeia,
      single: async () => executar(),
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, ko),
    };
    return cadeia;
  };
  return {
    supabase: {
      from: (tabela: string) => {
        banco.tabelas.push(tabela);
        return {
          select: () => consulta("select"),
          insert: (p: unknown) => consulta("insert", p),
          update: (p: unknown) => consulta("update", p),
          delete: () => consulta("delete"),
        };
      },
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const endereco = {
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-001",
  street: "Rua Um",
  number: "1",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "SP",
  reference: null,
  is_default: false,
};

const INVALIDOS = ["XX", "S", ""];

describe("useAddresses — estado inválido é recusado antes do banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook: Hook;

  function Sonda() {
    guardar(useAddresses());
    return null;
  }
  function guardar(h: Hook) {
    hook = h;
  }

  beforeEach(async () => {
    banco.tabelas.length = 0;
    banco.operacoes.length = 0;
    avisos.success.mockClear();
    avisos.error.mockClear();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    // A leitura inicial da lista não conta: só o que a chamada abaixo fizer.
    banco.tabelas.length = 0;
    banco.operacoes.length = 0;
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const escritas = () => banco.operacoes.filter((o) => o.op !== "select");

  describe("addAddress", () => {
    it.each(INVALIDOS)(
      "estado %j: devolve null, avisa 'Estado inválido' e não chama o banco",
      async (state) => {
        let retorno: unknown;
        await act(async () => {
          retorno = await hook.addAddress({ ...endereco, state });
        });

        expect(retorno).toBeNull();
        expect(avisos.error).toHaveBeenCalledTimes(1);
        expect(avisos.error).toHaveBeenCalledWith("Estado inválido");
        expect(avisos.success).not.toHaveBeenCalled();
        expect(banco.tabelas).toEqual([]);
        expect(banco.operacoes).toEqual([]);
      },
    );

    it.each(["SP", " sp "])(
      "CONTROLE: estado %j passa pela guarda, grava uma vez e avisa sucesso",
      async (state) => {
        let retorno: unknown;
        await act(async () => {
          retorno = await hook.addAddress({ ...endereco, state });
        });

        expect(retorno).not.toBeNull();
        expect(escritas()).toHaveLength(1);
        expect(escritas()[0].op).toBe("insert");
        expect(banco.tabelas).toContain("user_addresses");
        expect(avisos.error).not.toHaveBeenCalled();
        expect(avisos.success).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("updateAddress", () => {
    it.each(INVALIDOS)(
      "estado %j: devolve false, avisa 'Estado inválido' e não chama o banco",
      async (state) => {
        let retorno: unknown;
        await act(async () => {
          retorno = await hook.updateAddress("end-1", { state });
        });

        expect(retorno).toBe(false);
        expect(avisos.error).toHaveBeenCalledTimes(1);
        expect(avisos.error).toHaveBeenCalledWith("Estado inválido");
        expect(banco.tabelas).toEqual([]);
        expect(banco.operacoes).toEqual([]);
      },
    );

    it.each(["SP", " sp "])(
      "CONTROLE: estado %j passa pela guarda e a edição vai ao banco uma vez",
      async (state) => {
        let retorno: unknown;
        await act(async () => {
          retorno = await hook.updateAddress("end-1", { state });
        });

        expect(retorno).toBe(true);
        expect(escritas()).toHaveLength(1);
        expect(escritas()[0].op).toBe("update");
        expect(avisos.error).not.toHaveBeenCalled();
      },
    );

    it("CONTROLE: edição que não mexe no estado (state ausente) não é barrada", async () => {
      let retorno: unknown;
      await act(async () => {
        retorno = await hook.updateAddress("end-1", { complement: "Apto 2" });
      });

      expect(retorno).toBe(true);
      expect(escritas()).toHaveLength(1);
      expect(avisos.error).not.toHaveBeenCalled();
    });
  });
});
