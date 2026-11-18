// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ apagar: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({ eq: () => ({ select: h.apagar }) }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-teste" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  cachedQuestionsData: null,
  setCachedReviewsData: vi.fn(),
  setCachedQuestionsData: vi.fn(),
  lerGeracaoDosCachesDeAdmin: () => 0,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let excluir: (id: string) => Promise<boolean | null>;
function Capturador({ perguntas }: { perguntas: boolean }) {
  const reviews = useReviews();
  const questions = useQuestions();
  const apagar = perguntas ? questions.deleteQuestion : reviews.deleteReview;
  useEffect(() => {
    excluir = apagar;
  }, [apagar]);
  return null;
}

describe.each([false, true])("exclusão em voo — perguntas=%s", (perguntas) => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    h.apagar.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    raiz = createRoot(host);
    await act(async () => raiz.render(<Capturador perguntas={perguntas} />));
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("reabrir a confirmação não repete a exclusão do mesmo id; outro id segue livre", async () => {
    let terminar!: (value: { data: { id: string }[]; error: null }) => void;
    h.apagar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          terminar = resolve;
        }),
    );
    h.apagar.mockResolvedValue({ data: [{ id: "outro" }], error: null });
    let primeira!: Promise<boolean | null>;
    let repetida!: Promise<boolean | null>;
    await act(async () => {
      primeira = excluir("item");
      repetida = excluir("item");
      await excluir("outro");
    });
    expect(h.apagar).toHaveBeenCalledTimes(2);
    await act(async () => {
      terminar({ data: [{ id: "item" }], error: null });
      await Promise.all([primeira, repetida]);
    });
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => {
      await excluir("item");
    });
    expect(h.apagar).toHaveBeenCalledTimes(3);
  });

  it("item já ausente não vira erro vermelho", async () => {
    h.apagar.mockResolvedValue({ data: [], error: null });
    await act(async () => {
      expect(await excluir("item")).toBeNull();
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("erro real libera a trava para tentar novamente", async () => {
    h.apagar.mockResolvedValueOnce({ data: null, error: { message: "rede" } });
    h.apagar.mockResolvedValueOnce({ data: [{ id: "item" }], error: null });
    await act(async () => {
      expect(await excluir("item")).toBe(false);
    });
    await act(async () => {
      expect(await excluir("item")).toBe(true);
    });
    expect(h.apagar).toHaveBeenCalledTimes(2);
  });
});
