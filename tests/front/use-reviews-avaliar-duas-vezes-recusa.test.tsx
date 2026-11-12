// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

const h = vi.hoisted(() => ({
  consulta: { data: [] as { id: string }[] | null, error: null as unknown },
  select: vi.fn(),
  eq: vi.fn(),
  limit: vi.fn(),
  insert: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "comprador-teste" }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: h.select, insert: h.insert }),
  },
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

const avaliacao = {
  productId: "produto-teste",
  rating: 5,
  comment: "Gostei do produto",
};

beforeEach(async () => {
  vi.clearAllMocks();
  h.consulta = { data: [], error: null };
  h.limit.mockImplementation(async () => h.consulta);
  const filtro = {
    eq: h.eq,
    limit: h.limit,
    order: async () => ({ data: [], error: null }),
  };
  h.eq.mockReturnValue(filtro);
  h.select.mockReturnValue(filtro);
  h.insert.mockReturnValue({
    select: () => ({
      single: async () => ({ data: { id: "nova-avaliacao" }, error: null }),
    }),
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function enviar() {
  let resultado: unknown;
  await act(async () => {
    resultado = await atual.addReview(avaliacao);
  });
  return resultado;
}

it.each([
  ["uma avaliação pendente", [{ id: "anterior" }]],
  ["duas duplicatas antigas", [{ id: "anterior" }, { id: "duplicada" }]],
])("recusa quando já existe %s do próprio autor", async (_nome, linhas) => {
  h.consulta.data = linhas;
  expect(await enviar()).toEqual({ jaAvaliado: true });
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.erro).toHaveBeenCalledExactlyOnceWith(
    "Você já avaliou este produto.",
  );
  expect(h.sucesso).not.toHaveBeenCalled();
  expect(h.select).toHaveBeenCalledExactlyOnceWith("id");
  expect(h.eq.mock.calls).toEqual([
    ["product_id", avaliacao.productId],
    ["user_id", "comprador-teste"],
  ]);
  expect(h.limit).toHaveBeenCalledExactlyOnceWith(1);
});

it("sem avaliação anterior insere exatamente uma avaliação pendente", async () => {
  expect(await enviar()).toEqual({ id: "nova-avaliacao" });
  expect(h.insert).toHaveBeenCalledExactlyOnceWith({
    product_id: avaliacao.productId,
    user_id: "comprador-teste",
    rating: avaliacao.rating,
    comment: avaliacao.comment,
    status: "pendente",
  });
  expect(h.limit).toHaveBeenCalledExactlyOnceWith(1);
  expect(h.erro).not.toHaveBeenCalled();
});

it("erro na consulta não impede o envio da avaliação", async () => {
  h.consulta = { data: null, error: { message: "falha de rede" } };
  expect(await enviar()).toEqual({ id: "nova-avaliacao" });
  expect(h.insert).toHaveBeenCalledTimes(1);
  expect(h.limit).toHaveBeenCalledExactlyOnceWith(1);
  expect(h.erro).not.toHaveBeenCalled();
});
