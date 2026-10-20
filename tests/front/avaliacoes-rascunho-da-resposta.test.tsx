// @vitest-environment jsdom
import type { AdminReview } from "@/hooks/useReviews";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("framer-motion", async (importOriginal) => {
  const modulo = await importOriginal<typeof import("framer-motion")>();
  return {
    ...modulo,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});

const h = vi.hoisted(() => ({
  ler: vi.fn(),
  responder: vi.fn(),
  assinar: vi.fn(() => () => {}),
  excluir: vi.fn(),
}));
const avaliacoes: AdminReview[] = ["a", "b"].map((id) => ({
  id,
  productId: "p",
  userId: "u",
  customerName: id,
  productName: "Produto",
  rating: 5,
  comment: "Gostei",
  verified: true,
  status: "publicada",
  helpful: 0,
  createdAt: "2026-10-01T12:00:00Z",
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: avaliacoes,
    loading: false,
    getAllReviews: h.ler,
    addMerchantReply: h.responder,
    subscribeToReviews: h.assinar,
    deleteReview: h.excluir,
    aprovarReview: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => ({ count: 0, error: null }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let raiz: Root;
let host: HTMLDivElement;

beforeEach(() => {
  h.ler.mockReset().mockResolvedValue({ reviews: avaliacoes, total: 2 });
  h.responder.mockReset();
  h.excluir.mockReset().mockResolvedValue(true);
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => {
      dados.set(k, v);
    },
    removeItem: (k: string) => {
      dados.delete(k);
    },
  });
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montar(
  modo: "compact" | "detailed",
  aoMudarSujo: (sujo: boolean) => void = () => {},
) {
  localStorage.setItem("admin_reviews_view_mode", JSON.stringify(modo));
  const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
  await act(async () => {
    raiz.render(
      <AdminReviewsView active onNavigate={vi.fn()} onSetDirty={aoMudarSujo} />,
    );
  });
}
function abridores() {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) =>
      b.title === "Responder" ||
      (b.textContent?.trim() === "Responder" && b.querySelector("svg")),
  );
}
function botaoEnviar() {
  const botao = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) =>
      ["Responder", "Publicar Resposta"].includes(
        el.textContent?.trim() ?? "",
      ) &&
      !el.title &&
      !el.querySelector("svg"),
  );
  if (!botao) throw new Error("Botão de envio ausente");
  return botao;
}
async function clicar(botao: HTMLButtonElement) {
  await act(async () => {
    botao.click();
  });
}
async function digitar(texto: string) {
  const area = host.querySelector("textarea");
  if (!area) throw new Error("Editor ausente");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["compact", "detailed"] as const)(
  "guarda o rascunho de cada avaliação no modo %s",
  async (modo) => {
    await montar(modo);
    await clicar(abridores()[0]);
    await digitar("Resposta de A");
    await clicar(abridores()[0]);
    expect(host.querySelector("textarea")?.value).toBe("Resposta de A");
    await clicar(abridores()[1]);
    await digitar("Resposta de B");
    await clicar(abridores()[0]);
    expect(host.querySelector("textarea")?.value).toBe("Resposta de A");
    await clicar(abridores()[1]);
    expect(host.querySelector("textarea")?.value).toBe("Resposta de B");
  },
);

it.each(["compact", "detailed"] as const)(
  "bloqueia a troca enquanto envia no modo %s",
  async (modo) => {
    let concluir!: (sucesso: boolean) => void;
    h.responder.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          concluir = resolve;
        }),
    );
    await montar(modo);
    await clicar(abridores()[0]);
    await digitar("Resposta de A");
    await clicar(botaoEnviar());
    expect(abridores().every((b) => b.disabled)).toBe(true);
    await clicar(abridores()[1]);
    expect(host.querySelector("textarea")?.value).toBe("Resposta de A");
    await act(async () => {
      concluir(false);
    });
    expect(host.querySelector("textarea")?.value).toBe("Resposta de A");
    expect(abridores().every((b) => !b.disabled)).toBe(true);
  },
);

it("excluir a avaliação descarta o rascunho e tira o aviso de alteração pendente", async () => {
  const sujo = vi.fn();
  await montar("detailed", sujo);
  await clicar(abridores()[0]);
  await digitar("Resposta que não vai ser enviada");
  const cancelar = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Cancelar",
  );
  await clicar(cancelar!);
  expect(sujo).toHaveBeenLastCalledWith(true);
  const excluir = host.querySelector<HTMLButtonElement>(
    'button[title="Excluir Avaliação"]',
  );
  await clicar(excluir!);
  const confirmar = [
    ...host.querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.textContent?.trim() === "Sim, Apagar");
  await clicar(confirmar!);
  expect(h.excluir).toHaveBeenCalledWith("a");
  expect(sujo).toHaveBeenLastCalledWith(false);
});
