// @vitest-environment jsdom
//
// O hook `addMerchantReply` recusa resposta acima de 2000 caracteres ANTES de
// chamar a RPC: o `maxLength` do campo não segura texto colado, então o teto
// tem de valer também aqui (a resposta vira texto público na vitrine).
import { useReviews } from "@/hooks/useReviews";
import { limparCachesDeAdmin } from "@/utils/admin_cache";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const TETO = 2000;

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-ficticio" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: h.erro, success: h.sucesso } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    // A conferência de "a avaliação ainda existe" depois da RPC.
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [{ id: "r-1" }], error: null }),
      }),
    }),
  },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let r: ReturnType<typeof useReviews>;
function Sonda() {
  const avaliacoes = useReviews();
  useEffect(() => {
    r = avaliacoes;
  });
  return null;
}

beforeEach(async () => {
  limparCachesDeAdmin();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.rpc.mockResolvedValue({ data: null, error: null });
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(<Sonda />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  limparCachesDeAdmin();
  vi.restoreAllMocks();
});

it("resposta acima do teto: recusa sem chamar a RPC e diz o motivo", async () => {
  let resultado: boolean | undefined;
  await act(async () => {
    resultado = await r.addMerchantReply("r-1", "R".repeat(TETO + 1));
  });
  expect(resultado).toBe(false);
  expect(h.rpc).not.toHaveBeenCalled();
  expect(h.erro).toHaveBeenCalledWith(
    expect.stringContaining(`${TETO} caracteres`),
  );
  expect(h.sucesso).not.toHaveBeenCalled();
});

it("controle: exatamente no teto vai para a RPC", async () => {
  await act(async () => {
    await r.addMerchantReply("r-1", "R".repeat(TETO));
  });
  expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(h.rpc).toHaveBeenCalledWith(
    "reply_review_atomic",
    expect.objectContaining({ p_review_id: "r-1" }),
  );
});
