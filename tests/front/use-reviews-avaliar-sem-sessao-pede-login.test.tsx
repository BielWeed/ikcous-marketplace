// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  from: vi.fn(),
  insert: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: h.from },
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: h.sucesso, info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let atual: ReturnType<typeof useReviews>;
function Sonda() {
  const retorno = useReviews();
  useEffect(() => {
    atual = retorno;
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user = null;
  h.insert.mockReturnValue({
    select: () => ({
      single: async () => ({ data: { id: "rev-1" }, error: null }),
    }),
  });
  h.from.mockReturnValue({
    insert: h.insert,
    select: (colunas?: string) =>
      colunas === "id"
        ? {
            eq: () => ({
              eq: () => ({ limit: async () => ({ data: [], error: null }) }),
            }),
          }
        : {
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          },
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

it("visitante recebe orientação de login sem consultar o banco; com sessão consegue avaliar", async () => {
  await act(async () => raiz.render(<Sonda />));
  const avaliacao = {
    productId: "prod-1",
    rating: 5,
    comment: "Gostei do produto",
  };
  let resultado: unknown;
  await act(async () => {
    resultado = await atual.addReview(avaliacao);
  });
  expect(h.erro).toHaveBeenCalledExactlyOnceWith(
    "Você precisa estar logado para avaliar.",
  );
  expect(resultado).toBeNull();
  expect(h.from).not.toHaveBeenCalled();
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.sucesso).not.toHaveBeenCalled();

  // Controle positivo: não basta bloquear todo envio.
  h.user = { id: "comprador-1" };
  h.erro.mockClear();
  await act(async () => raiz.render(<Sonda />));
  await act(async () => {
    resultado = await atual.addReview(avaliacao);
  });
  expect(resultado).toEqual({ id: "rev-1" });
  expect(h.from).toHaveBeenCalledWith("reviews");
  expect(h.insert).toHaveBeenCalledExactlyOnceWith({
    product_id: "prod-1",
    user_id: "comprador-1",
    rating: 5,
    comment: "Gostei do produto",
    status: "pendente",
  });
  expect(h.sucesso).toHaveBeenCalledTimes(1);
  expect(h.erro).not.toHaveBeenCalled();
});
