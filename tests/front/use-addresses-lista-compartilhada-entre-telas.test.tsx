// @vitest-environment jsdom
//
// UMA LISTA POR CONTA, VÁRIAS TELAS (frete automático, 22/09/2026): cada
// tela que usa `useAddresses` tem o próprio estado, e o carrinho continua
// montado atrás do checkout. Sem aviso entre as instâncias, o endereço
// criado ou editado no checkout (ou na tela de endereço) não existia para o
// carrinho — que seguia cotando o frete do endereço principal, com o
// endereço novo já escolhido no checkout.
//
// Contrato: toda lista gravada por uma instância (inclusão, edição, remoção,
// busca) chega às outras instâncias DA MESMA CONTA.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

const { sessao, respostas } = vi.hoisted(() => ({
  sessao: { usuario: { id: "conta-a" } as { id: string } | null },
  // Fila de respostas do dublê do supabase, consumida na ordem.
  respostas: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: sessao.usuario }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => {
  // Uma promessa de verdade por chamada a `from()`, que aceita o
  // encadeamento do PostgREST (cada método devolve ela mesma) e resolve com
  // a próxima resposta da fila.
  function cadeia() {
    const promessa = Promise.resolve().then(
      () => respostas.shift() ?? { data: null, error: null },
    );
    const encadeavel = Object.assign(promessa, {
      select: () => encadeavel,
      insert: () => encadeavel,
      update: () => encadeavel,
      delete: () => encadeavel,
      eq: () => encadeavel,
      order: () => encadeavel,
      single: () => encadeavel,
    });
    return encadeavel;
  }
  return { supabase: { from: () => cadeia() } };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CASA: Address = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  is_default: true,
};

type Hook = {
  addresses: Address[];
  fetchAddresses: () => Promise<void>;
  addAddress: (e: Omit<Address, "id" | "user_id">) => Promise<Address | null>;
  updateAddress: (id: string, m: Partial<Address>) => Promise<boolean>;
  deleteAddress: (id: string) => Promise<boolean>;
};

describe("useAddresses — a lista gravada numa tela chega às outras telas da mesma conta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const telas: { checkout: Hook | null; carrinho: Hook | null } = {
    checkout: null,
    carrinho: null,
  };

  beforeEach(() => {
    sessao.usuario = { id: "conta-a" };
    respostas.length = 0;
    armazem = new Map<string, string>();
    armazem.set("ikcous_addresses_cache_conta-a", JSON.stringify([CASA]));
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    telas.checkout = null;
    telas.carrinho = null;
  });

  async function montarDuasTelas() {
    const { useAddresses } = await import("@/hooks/useAddresses");
    // Espelho em efeito — o render é imutável (react-hooks/immutability).
    function TelaDoCheckout() {
      const hook = useAddresses();
      useEffect(() => {
        telas.checkout = hook;
      });
      return null;
    }
    function TelaDoCarrinho() {
      const hook = useAddresses();
      useEffect(() => {
        telas.carrinho = hook;
      });
      return null;
    }
    await act(async () => {
      raiz.render(
        <>
          <TelaDoCarrinho />
          <TelaDoCheckout />
        </>,
      );
    });
  }

  it("endereço ADICIONADO no checkout aparece no carrinho (e no disco)", async () => {
    await montarDuasTelas();
    expect(telas.carrinho?.addresses.map((a) => a.id)).toEqual(["end-casa"]);

    respostas.push({
      data: {
        id: "end-trabalho",
        user_id: "conta-a",
        name: "Trabalho",
        recipient_name: "Ana",
        cep: "01001-000",
        street: "Praça da Sé",
        number: "1",
        neighborhood: "Sé",
        city: "São Paulo",
        state: "SP",
        is_default: false,
      },
      error: null,
    });
    await act(async () => {
      await telas.checkout?.addAddress({
        name: "Trabalho",
        recipient_name: "Ana",
        cep: "01001-000",
        street: "Praça da Sé",
        number: "1",
        neighborhood: "Sé",
        city: "São Paulo",
        state: "SP",
        is_default: false,
      });
    });

    expect(telas.carrinho?.addresses.map((a) => a.id)).toEqual([
      "end-casa",
      "end-trabalho",
    ]);
    const disco = JSON.parse(
      armazem.get("ikcous_addresses_cache_conta-a") ?? "[]",
    ) as Address[];
    expect(disco.map((a) => a.id)).toEqual(["end-casa", "end-trabalho"]);
  });

  it("CEP EDITADO no checkout chega ao carrinho (o destino do frete muda nas duas telas)", async () => {
    await montarDuasTelas();

    respostas.push({
      data: { ...CASA, cep: "38400-100", city: "Uberlândia" },
      error: null,
    });
    await act(async () => {
      await telas.checkout?.updateAddress("end-casa", {
        cep: "38400-100",
        city: "Uberlândia",
      });
    });

    expect(telas.carrinho?.addresses[0]?.cep).toBe("38400-100");
  });

  it("endereço REMOVIDO numa tela some da outra", async () => {
    await montarDuasTelas();

    respostas.push({ data: null, error: null });
    await act(async () => {
      await telas.checkout?.deleteAddress("end-casa");
    });

    expect(telas.carrinho?.addresses).toEqual([]);
  });

  it("a BUSCA feita por uma tela atualiza a outra", async () => {
    await montarDuasTelas();

    respostas.push({
      data: [CASA, { ...CASA, id: "end-mae", name: "Mãe", is_default: false }],
      error: null,
    });
    await act(async () => {
      await telas.checkout?.fetchAddresses();
    });

    expect(telas.carrinho?.addresses.map((a) => a.id)).toEqual([
      "end-casa",
      "end-mae",
    ]);
  });
});
