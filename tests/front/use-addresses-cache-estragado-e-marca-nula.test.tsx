// @vitest-environment jsdom
//
// DADO QUE JÁ ESTAVA LÁ ANTES: cache de endereços estragado no aparelho e linha
// antiga do banco com a marca de principal nula.
//
// Caça por mutação em `useAddresses`. Duas fronteiras que nenhum teste pisava:
//   1. O cache em disco (`ikcous_addresses_cache_<conta>`) é lido NA PRIMEIRA
//      RENDERIZAÇÃO. Se o texto guardado for lixo (JSON quebrado), ou JSON válido
//      que não é lista (`{}`, `null`, texto, número), a tela começa com a lista
//      VAZIA — nunca com um objeto no lugar da lista (quebraria quem faz
//      `addresses.map`/`.length`), e nunca derruba a tela.
//   2. Endereço gravado antes de a coluna `is_default` existir pode voltar do
//      banco com a marca `null`: a lista da tela e o cache dizem `false`
//      (boolean de verdade), não `null`, senão "principal ou não" vira
//      comparação frouxa em quem a lê.
// Só endereços fictícios.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

const banco = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => {
  const cadeia: any = {
    eq: () => cadeia,
    order: () => cadeia,
    // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: banco.linhas, error: null }).then(ok, ko),
  };
  return {
    supabase: {
      from: () => ({ select: () => cadeia }),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const CHAVE = "ikcous_addresses_cache_conta-a";

function linha(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: "conta-a",
    name: `Endereço ${id}`,
    recipient_name: "Ana",
    cep: "38500-001",
    street: `Rua ${id}`,
    number: "1",
    complement: null,
    neighborhood: "Centro",
    city: "Cidade Exemplo",
    state: "MG",
    reference: null,
    is_default: false,
    ...extra,
  };
}

describe("useAddresses — cache estragado e marca nula", () => {
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

  async function montar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  it("cache em lista válida: aparece já na primeira renderização, antes de ler o servidor", async () => {
    localStorage.setItem(CHAVE, JSON.stringify([linha("a")]));
    await montar();
    expect(hook.addresses.map((a) => a.id)).toEqual(["a"]);
  });

  it.each([
    ["JSON quebrado", "{ruim"],
    ["objeto, não lista", '{"id":"a"}'],
    ["objeto vazio", "{}"],
    ["null", "null"],
    ["texto", '"endereços"'],
    ["número", "42"],
    ["booleano verdadeiro", "true"],
  ])(
    "cache com %s: a tela começa com a lista VAZIA, sem derrubar",
    async (_nome, bruto) => {
      localStorage.setItem(CHAVE, bruto);
      await montar();
      expect(Array.isArray(hook.addresses)).toBe(true);
      expect(hook.addresses).toEqual([]);
    },
  );

  it("linha antiga com is_default nulo ou ausente chega como `false` de verdade, na tela e no cache", async () => {
    banco.linhas = [
      linha("nula", { is_default: null }),
      linha("ausente", { is_default: undefined }),
      linha("principal", { is_default: true }),
    ];
    await montar();
    await act(async () => {
      await hook.fetchAddresses();
    });

    const porId = new Map(hook.addresses.map((a) => [a.id, a.is_default]));
    expect(porId.get("nula")).toBe(false);
    expect(porId.get("ausente")).toBe(false);
    expect(porId.get("principal")).toBe(true);

    const gravado = JSON.parse(localStorage.getItem(CHAVE) ?? "[]") as Array<{
      id: string;
      is_default: unknown;
    }>;
    expect(gravado.find((a) => a.id === "nula")?.is_default).toBe(false);
    expect(gravado.find((a) => a.id === "ausente")?.is_default).toBe(false);
  });
});
