// @vitest-environment jsdom
//
// EDITAR UM ENDEREÇO PARA TORNÁ-LO O PRINCIPAL: ELE VAI PARA A FRENTE DA LISTA.
//
// Caça por mutação em `useAddresses.updateAddress`. O banco devolve a lista com
// o principal primeiro, e é dela que o carrinho tira o endereço de entrega
// quando a cliente não escolheu nenhum. Quando a edição marca outro endereço
// como principal, a lista LOCAL precisa ficar na mesma ordem que o servidor
// devolveria (novo principal na frente, os demais na ordem em que estavam) —
// senão a tela mostra uma ordem e, ao recarregar, aparece outra. Um comparador
// invertido mandaria o principal para o FIM da lista e passava em todos os
// testes. Só o principal antigo perde a marca; ninguém mais muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

const banco = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  contador: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => {
  const ordenadas = () =>
    [...banco.linhas].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return (b.created_at as number) - (a.created_at as number);
    });
  const consulta = (op: "select" | "update", payload?: unknown) => {
    let idAlvo: unknown;
    const executar = () => {
      if (op === "select") return { data: ordenadas(), error: null };
      const linha = banco.linhas.find((l) => l.id === idAlvo);
      if (!linha) return { data: [], error: null };
      Object.assign(linha, payload as object);
      // Imita o gatilho do banco: a linha que vira principal desmarca as outras.
      if (linha.is_default) {
        for (const outra of banco.linhas) {
          if (outra !== linha) outra.is_default = false;
        }
      }
      return { data: [linha], error: null };
    };
    const cadeia: any = {
      eq: (campo: string, valor: unknown) => {
        if (campo === "id") idAlvo = valor;
        return cadeia;
      },
      order: () => cadeia,
      select: () => cadeia,
      single: async () => {
        const r = executar();
        return { data: r.data[0] ?? null, error: r.error };
      },
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, ko),
    };
    return cadeia;
  };
  return {
    supabase: {
      from: () => ({
        select: () => consulta("select"),
        update: (p: unknown) => consulta("update", p),
      }),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

function semear(...nomes: Array<[string, boolean]>) {
  // `created_at` decrescente na ordem dada: o 1º é o mais novo.
  const total = nomes.length;
  banco.linhas = nomes.map(([name, is_default], i) => ({
    id: `end-${name}`,
    user_id: "conta-a",
    name,
    recipient_name: "Ana",
    cep: "38500-001",
    street: `Rua ${name}`,
    number: "1",
    complement: null,
    neighborhood: "Centro",
    city: "Cidade Exemplo",
    state: "MG",
    reference: null,
    is_default,
    created_at: total - i,
  }));
}

describe("useAddresses — editar para virar o principal", () => {
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

  beforeEach(() => {
    banco.linhas = [];
    banco.contador = 0;
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function abrir() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await hook.fetchAddresses();
    });
  }

  it("o endereço editado como principal sobe para a frente; os outros mantêm a ordem e perdem a marca", async () => {
    semear(["Casa", true], ["Trabalho", false], ["Sitio", false]);
    await abrir();
    expect(hook.addresses.map((a) => a.name)).toEqual([
      "Casa",
      "Trabalho",
      "Sitio",
    ]);

    let ok = false;
    await act(async () => {
      ok = await hook.updateAddress("end-Sitio", { is_default: true });
    });

    expect(ok).toBe(true);
    expect(hook.addresses.map((a) => a.name)).toEqual([
      "Sitio",
      "Casa",
      "Trabalho",
    ]);
    expect(hook.addresses.map((a) => a.is_default)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("a ordem local é a mesma que o servidor devolve ao reler", async () => {
    semear(["Casa", true], ["Trabalho", false], ["Sitio", false]);
    await abrir();

    await act(async () => {
      await hook.updateAddress("end-Trabalho", { is_default: true });
    });
    const local = hook.addresses.map((a) => a.name);

    await act(async () => {
      await hook.fetchAddresses();
    });
    expect(hook.addresses.map((a) => a.name)).toEqual(local);
    expect(local[0]).toBe("Trabalho");
  });
});
