// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  return {
    user: { id: "conta-a" } as { id: string } | null,
    resposta: Promise.resolve({ data: [] as unknown[], error: null }),
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: rede.user, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => rede.resposta,
      };
      return builder;
    },
  },
}));

import { useReviews } from "@/hooks/useReviews";
import {
  esquecerAvaliacoesGuardadas,
  getReviewsCache,
} from "@/lib/cache-de-avaliacoes";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const privada = {
  id: "privada",
  product_id: "produto",
  user_id: "conta-a",
  status: "pendente",
  rating: 5,
  comment: "Ainda não publicada",
  helpful: 0,
  created_at: "2026-10-16T10:00:00Z",
};
const espelho: { atual: ReturnType<typeof useReviews> | null } = {
  atual: null,
};
function Sonda() {
  const hook = useReviews();
  useEffect(() => {
    espelho.atual = hook;
  });
  return null;
}

describe("useReviews — a lista privada não volta após trocar de conta", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    esquecerAvaliacoesGuardadas();
    rede.user = { id: "conta-a" };
    rede.resposta = Promise.resolve({ data: [privada], error: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
    esquecerAvaliacoesGuardadas();
    espelho.atual = null;
  });
  async function renderizar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }
  async function trocar(user: { id: string } | null) {
    // A limpeza real já acontece no AuthContext antes de publicar a sessão.
    esquecerAvaliacoesGuardadas();
    rede.user = user;
    await renderizar();
  }

  it.each([null, { id: "conta-b" }])(
    "limpa o estado quando a sessão vira %s",
    async (user) => {
      await renderizar();
      await act(async () => {
        await espelho.atual!.getReviewsByProduct("produto");
      });
      expect(espelho.atual!.reviews).toHaveLength(1);
      await trocar(user);
      expect(espelho.atual!.reviews).toEqual([]);
    },
  );

  it("uma consulta privada em voo não repõe estado nem cache depois do logout", async () => {
    await renderizar();
    let responder: (valor: { data: unknown[]; error: null }) => void = () => {};
    rede.resposta = new Promise((resolve) => {
      responder = resolve;
    });
    let antiga: Promise<void> | undefined;
    await act(async () => {
      antiga = espelho.atual!.getReviewsByProduct("produto");
    });
    await trocar(null);
    await act(async () => {
      responder({ data: [privada], error: null });
      await antiga;
    });
    expect(espelho.atual!.reviews).toEqual([]);
    expect(getReviewsCache("produto")).toBeNull();
  });
});
