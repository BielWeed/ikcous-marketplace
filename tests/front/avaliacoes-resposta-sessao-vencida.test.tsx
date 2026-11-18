import { useReviews } from "@/hooks/useReviews";
import { MENSAGEM_SESSAO_OU_PERMISSAO } from "@/lib/erro-de-sessao-do-painel";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  erro: null as unknown,
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: h.rpc },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-teste" },
    isAdmin: true,
    loading: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let responder: ReturnType<typeof useReviews>["addMerchantReply"];
let raiz: Root;
let host: HTMLDivElement;
function Capturador() {
  const resposta = useReviews().addMerchantReply;
  useEffect(() => {
    responder = resposta;
  }, [resposta]);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.rpc.mockImplementation(() => Promise.resolve({ error: h.erro }));
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Capturador />));
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it.each([
  { status: 401 },
  { status: 403 },
  { message: "JWT expired" },
  { code: "PGRST301" },
  { code: "PGRST303" },
  { code: "42501" },
])("orienta a entrar de novo sem indicar sucesso: %j", async (erro) => {
  h.erro = erro;
  let sucesso: boolean | undefined;
  await act(async () => {
    sucesso = await responder("avaliacao-teste", "Obrigada pela avaliação!");
  });
  expect(sucesso).toBe(false);
  expect(h.rpc).toHaveBeenCalledWith("reply_review_atomic", {
    p_review_id: "avaliacao-teste",
    p_reply: "Obrigada pela avaliação!",
  });
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    ("code" in erro && erro.code === "42501") ||
      ("status" in erro && erro.status === 403)
      ? MENSAGEM_SESSAO_OU_PERMISSAO
      : "Sua sessão expirou. Entre de novo para enviar a resposta — o texto continua aqui.",
  );
});

it("mantém a mensagem genérica nos demais erros", async () => {
  h.erro = { status: 500, message: "Erro interno" };
  await act(async () => {
    expect(await responder("avaliacao-teste", "Obrigada!")).toBe(false);
  });
  expect(toast.error).toHaveBeenCalledWith("Erro ao enviar resposta.");
});
