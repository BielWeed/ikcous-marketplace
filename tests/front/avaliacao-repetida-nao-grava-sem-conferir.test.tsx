// @vitest-environment jsdom
//
// Avaliar um produto (useReviews.addReview):
//  - a conferência "você já avaliou?" que FALHA (rede caiu, erro do banco) não grava mesmo assim: mostra o erro e deixa
//    tentar de novo (antes a tela gravava às cegas e a mesma cliente ficava com duas avaliações);
//  - o banco que RECUSA a repetida (migration 20261641000000: 23505, dois aparelhos ao mesmo tempo) vira "Você já avaliou
//    este produto." e o mesmo resultado da conferência ({ jaAvaliado: true }), nunca uma falha genérica.
import { useReviews } from "@/hooks/useReviews";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  conferencia: vi.fn(),
  gravar: vi.fn(),
  linhas: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => {
  // Qualquer outra leitura (a releitura da vitrine depois de gravar) devolve vazio, sem erro.
  const consulta = (): unknown => {
    const alvo: Record<string, unknown> = {
      limit: () => h.conferencia(),
      insert: (linha: unknown) => {
        h.linhas.push(linha);
        return { select: () => ({ single: () => h.gravar() }) };
      },
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null, count: 0 }).then(ok),
    };
    return new Proxy(alvo, {
      get: (t, nome: string) =>
        nome in t ? Reflect.get(t, nome) : () => consulta(),
    });
  };
  return {
    supabase: {
      from: () => consulta(),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-teste" },
    isAdmin: false,
    loading: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let avaliar: ReturnType<typeof useReviews>["addReview"];
let raiz: Root;
let host: HTMLDivElement;
function Capturador() {
  const enviar = useReviews().addReview;
  useEffect(() => {
    avaliar = enviar;
  }, [enviar]);
  return null;
}
const ENVIO = { productId: "produto-teste", rating: 5, comment: "Gostei" };
const MENSAGEM_DA_CONFERENCIA =
  "Não conseguimos conferir se você já avaliou este produto. Verifique sua internet e tente de novo.";

beforeEach(async () => {
  vi.clearAllMocks();
  h.linhas = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.conferencia.mockResolvedValue({ data: [], error: null });
  h.gravar.mockResolvedValue({ data: { id: "nova" }, error: null });
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

async function enviar() {
  let resultado: unknown;
  await act(async () => {
    resultado = await avaliar(ENVIO);
  });
  return resultado;
}

it("controle: conferência sem avaliação anterior grava uma vez e comemora", async () => {
  expect(await enviar()).toEqual({ id: "nova" });
  expect(h.linhas).toHaveLength(1);
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.error).not.toHaveBeenCalled();
});

it.each([
  [
    "a rede cai na conferência",
    () => Promise.reject(new TypeError("Failed to fetch")),
  ],
  [
    "o banco devolve erro na conferência",
    () =>
      Promise.resolve({ data: null, error: { message: "Failed to fetch" } }),
  ],
  [
    "a conferência devolve erro de servidor",
    () =>
      Promise.resolve({
        data: null,
        error: { code: "57014", message: "canceling statement" },
      }),
  ],
])("%s: NÃO grava, avisa e deixa tentar de novo", async (_caso, falha) => {
  h.conferencia.mockImplementationOnce(falha);
  expect(await enviar()).toBeNull();
  expect(h.linhas).toHaveLength(0);
  expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DA_CONFERENCIA);
  expect(toast.success).not.toHaveBeenCalled();

  // Tentar de novo com a rede de volta: grava.
  expect(await enviar()).toEqual({ id: "nova" });
  expect(h.linhas).toHaveLength(1);
});

it("a conferência que acha avaliação anterior não grava (como antes)", async () => {
  h.conferencia.mockResolvedValueOnce({
    data: [{ id: "antiga" }],
    error: null,
  });
  expect(await enviar()).toEqual({ jaAvaliado: true });
  expect(h.linhas).toHaveLength(0);
  expect(toast.error).toHaveBeenCalledWith("Você já avaliou este produto.");
});

it("o banco recusa a repetida (23505, dois aparelhos ao mesmo tempo): 'Você já avaliou' e o mesmo resultado da conferência", async () => {
  h.gravar.mockResolvedValueOnce({
    data: null,
    error: {
      code: "23505",
      message: "Você já avaliou este produto.",
      details: "avaliacao_repetida",
    },
  });
  expect(await enviar()).toEqual({ jaAvaliado: true });
  expect(h.linhas).toHaveLength(1);
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith("Você já avaliou este produto.");
  expect(toast.success).not.toHaveBeenCalled();
});
