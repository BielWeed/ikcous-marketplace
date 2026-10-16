// @vitest-environment jsdom
import { useReviews } from "@/hooks/useReviews";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), cache: vi.fn() }));
vi.hoisted(() => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
});
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-teste" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: h.cache,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let hook: ReturnType<typeof useReviews>;
let raiz: Root;
let hospedeiro: HTMLDivElement;
function Capturador() {
  const atual = useReviews();
  useEffect(() => {
    hook = atual;
  });
  return <>{atual.adminReviews.map((r) => r.comment).join(",")}</>;
}
function pendente() {
  let resolver!: (r: unknown) => void;
  const promessa = new Promise((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}
const resposta = (comment: string) => ({
  error: null,
  data: { data: [{ id: comment, comment }], total_count: 1 },
});
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Capturador />);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
});

it("a resposta de ab não substitui lista e cache depois da resposta de abc", async () => {
  const ab = pendente();
  const abc = pendente();
  h.rpc.mockReturnValueOnce(ab.promessa).mockReturnValueOnce(abc.promessa);
  let antiga!: ReturnType<typeof hook.getAllReviews>;
  let nova!: ReturnType<typeof hook.getAllReviews>;
  act(() => {
    antiga = hook.getAllReviews(0, 10, { search: "ab" });
    nova = hook.getAllReviews(0, 10, { search: "abc" });
  });
  await act(async () => {
    abc.resolver(resposta("abc"));
    await nova;
  });
  await act(async () => {
    ab.resolver(resposta("ab"));
    await antiga;
  });
  expect(hospedeiro.textContent).toBe("abc");
  expect(h.cache).toHaveBeenCalledTimes(1);
  expect(h.cache.mock.calls[0][0][0].comment).toBe("abc");
});

it("uma busca antiga terminando não encerra o carregamento da atual", async () => {
  const ab = pendente();
  const abc = pendente();
  h.rpc.mockReturnValueOnce(ab.promessa).mockReturnValueOnce(abc.promessa);
  let antiga!: ReturnType<typeof hook.getAllReviews>;
  let nova!: ReturnType<typeof hook.getAllReviews>;
  act(() => {
    antiga = hook.getAllReviews(0, 10, { search: "ab" });
    nova = hook.getAllReviews(0, 10, { search: "abc" });
  });
  await act(async () => {
    ab.resolver(resposta("ab"));
    await antiga;
  });
  expect(hook.loading).toBe(true);
  expect(hospedeiro.textContent).toBe("");
  await act(async () => {
    abc.resolver(resposta("abc"));
    await nova;
  });
  expect(hook.loading).toBe(false);
});

it("falha atual avisa e remove a lista anterior, inclusive do cache", async () => {
  h.rpc.mockResolvedValueOnce(resposta("ab"));
  await act(async () => {
    await hook.getAllReviews(0, 10, { search: "ab" });
  });
  h.rpc.mockResolvedValueOnce({ data: null, error: new Error("rede") });
  await act(async () => {
    await hook.getAllReviews(0, 10, { search: "abc" });
  });
  expect(hospedeiro.textContent).toBe("");
  expect(h.cache).toHaveBeenLastCalledWith([]);
  expect(toast.error).toHaveBeenCalledWith("Erro ao carregar avaliações.");
});

it("falha superada não apaga a resposta atual nem mostra aviso antigo", async () => {
  const ab = pendente();
  h.rpc.mockReturnValueOnce(ab.promessa).mockResolvedValueOnce(resposta("abc"));
  let antiga!: ReturnType<typeof hook.getAllReviews>;
  act(() => {
    antiga = hook.getAllReviews(0, 10, { search: "ab" });
  });
  await act(async () => {
    await hook.getAllReviews(0, 10, { search: "abc" });
  });
  await act(async () => {
    ab.resolver({ data: null, error: new Error("rede") });
    await antiga;
  });
  expect(hospedeiro.textContent).toBe("abc");
  expect(toast.error).not.toHaveBeenCalled();
});
