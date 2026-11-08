// @vitest-environment jsdom
//
// Painel de avaliações com dois aparelhos abertos:
// - a resposta de um não pode apagar em silêncio a que o outro acabou de gravar;
// - abrir "Editar resposta" sem mudar nada não deixa a tela "com alterações" só
//   porque a avaliação saiu da página (filtro, busca, outra página);
// - avaliação excluída em outro aparelho leva o rascunho junto.
import type { AdminReview } from "@/hooks/useReviews";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { type Mock, afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("framer-motion", async (importOriginal) => {
  const modulo = await importOriginal<typeof import("framer-motion")>();
  return {
    ...modulo,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});

const h = vi.hoisted(() => ({
  avaliacoes: [] as unknown[],
  responder: vi.fn(),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.avaliacoes,
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({ reviews: [], total: 1 }),
    addMerchantReply: h.responder,
    subscribeToReviews: () => () => {},
    deleteReview: vi.fn(),
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
let sujo: Mock<(sujo: boolean) => void>;

function avaliacao(merchantReply?: string): AdminReview {
  return {
    id: "a",
    productId: "p",
    userId: "u",
    customerName: "Ana",
    productName: "Produto",
    rating: 5,
    comment: "Gostei",
    verified: true,
    status: "publicada",
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    merchantReply,
  };
}

beforeEach(() => {
  h.responder.mockReset().mockResolvedValue(true);
  sujo = vi.fn<(sujo: boolean) => void>();
  vi.mocked(toast.error).mockClear();
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

async function desenhar() {
  const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
  await act(async () => {
    // `onNavigate` novo a cada chamada: o componente é memoizado e precisa
    // repintar quando a lista (que vem do hook) muda.
    raiz.render(
      <AdminReviewsView active onNavigate={vi.fn()} onSetDirty={sujo} />,
    );
  });
}
function atualizarLista(lista: unknown[]) {
  h.avaliacoes = lista;
  return desenhar();
}
function botao(rotulo: RegExp) {
  const achado = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => rotulo.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
  );
  if (!achado) throw new Error(`Botão ausente: ${rotulo}`);
  return achado;
}
async function clicar(el: HTMLButtonElement) {
  await act(async () => {
    el.click();
  });
}
async function digitar(texto: string) {
  const area = host.querySelector("textarea");
  if (!area) throw new Error("Editor ausente");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function campo() {
  return host.querySelector("textarea")?.value;
}

it("Editar resposta sem mexer: o texto novo do outro aparelho entra no campo", async () => {
  h.avaliacoes = [avaliacao("Resposta velha")];
  await desenhar();
  await clicar(botao(/^Editar resposta a Ana/));
  expect(campo()).toBe("Resposta velha");
  await atualizarLista([avaliacao("Resposta nova do computador")]);
  expect(campo()).toBe("Resposta nova do computador");
  expect(sujo).not.toHaveBeenLastCalledWith(true);
});

it("texto já digitado: publicar por cima da resposta nova do outro aparelho pede confirmação", async () => {
  h.avaliacoes = [avaliacao()];
  await desenhar();
  await clicar(botao(/^Responder a Ana/));
  await digitar("Meu texto do celular");
  await atualizarLista([avaliacao("Resposta do computador")]);
  expect(campo()).toBe("Meu texto do celular");

  await clicar(botao(/^Publicar resposta/));
  expect(h.responder).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining("mudou em outro aparelho"),
    expect.anything(),
  );
  expect(campo()).toBe("Meu texto do celular");

  // Já avisada, o segundo toque publica de propósito.
  await clicar(botao(/^Publicar resposta/));
  expect(h.responder).toHaveBeenCalledWith("a", "Meu texto do celular");
});

it("sem mudança no outro aparelho, publicar segue direto", async () => {
  h.avaliacoes = [avaliacao("Resposta velha")];
  await desenhar();
  await clicar(botao(/^Editar resposta a Ana/));
  await digitar("Resposta corrigida");
  await clicar(botao(/^Publicar resposta/));
  expect(h.responder).toHaveBeenCalledWith("a", "Resposta corrigida");
  expect(toast.error).not.toHaveBeenCalled();
});

it("a avaliação sai da página com o campo de edição aberto e intacto: a tela não fica suja", async () => {
  h.avaliacoes = [avaliacao("Resposta velha")];
  await desenhar();
  await clicar(botao(/^Editar resposta a Ana/));
  await atualizarLista([]);
  expect(sujo).not.toHaveBeenCalledWith(true);
  expect(sujo).toHaveBeenLastCalledWith(false);
});

it("avaliação excluída em outro aparelho leva o rascunho e fecha o campo", async () => {
  h.avaliacoes = [avaliacao()];
  await desenhar();
  await clicar(botao(/^Responder a Ana/));
  await digitar("Texto que não vai mais ser enviado");
  expect(sujo).toHaveBeenLastCalledWith(true);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("admin:avaliacao-excluida", { detail: { id: "a" } }),
    );
  });
  await atualizarLista([]);
  expect(host.querySelector("textarea")).toBeNull();
  expect(sujo).toHaveBeenLastCalledWith(false);
});
