// @vitest-environment jsdom
//
// A busca da tela Perguntas escapa `%` e `_` antes de ir ao banco. A get_admin_questions_paged concatena o termo
// em `ILIKE '%' || termo || '%'` (escape padrão `\`, igual às buscas de pedidos e cupons): `_` cru casa qualquer
// letra e `100%` cru casa qualquer coisa que comece com "100". O hook passa o termo por
// `prepararTextoDeBuscaDoPainel`, o mesmo das outras buscas do painel.
// Roda o hook de verdade com o Supabase dublado e lê o que a RPC recebeu.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

const h = vi.hoisted(() => ({
  chamadas: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, argumentos: Record<string, unknown>) => {
      h.chamadas.push([nome, argumentos]);
      return {
        abortSignal: () =>
          Promise.resolve({ data: { data: [], total_count: 0 }, error: null }),
      };
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { limparCachesDeAdmin } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let atual: ReturnType<typeof useQuestions>;

function Componente() {
  const q = useQuestions();
  useEffect(() => {
    atual = q;
  });
  return null;
}

async function buscar(texto: string): Promise<unknown> {
  await act(async () => {
    await atual.getAllQuestions(0, 10, "all", texto);
  });
  const chamada = h.chamadas.at(-1);
  expect(chamada?.[0]).toBe("get_admin_questions_paged");
  return chamada?.[1].p_search;
}

beforeEach(async () => {
  h.chamadas = [];
  limparCachesDeAdmin();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Componente />);
  });
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("useQuestions — a busca do painel escapa os curingas do ILIKE", () => {
  it("buscar `_` não manda o curinga cru", async () => {
    expect(await buscar("_")).toBe("\\_");
  });

  it("buscar `100%` manda o porcento escapado", async () => {
    expect(await buscar("100%")).toBe("100\\%");
  });

  it("texto comum segue igual, e busca vazia segue vazia", async () => {
    expect(await buscar("frete")).toBe("frete");
    expect(await buscar("")).toBe("");
  });
});
