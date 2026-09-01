// @vitest-environment jsdom
//
// Achado A3: com `totalReviews = 0`, o cartão "Compras Verificadas" mostrava
// "100%" (e "Taxa de Resposta" mostrava "0%") mesmo sem NENHUMA avaliação
// para medir — um número inventado com a mesma confiança de um número
// medido. A correção troca os dois ternários por uma função só
// (`formatRate`) que devolve "—" quando `totalReviews === 0`, e mantém "0%"
// quando o total é real e a contagem medida é zero (o zero legítimo não pode
// sumir junto).
//
// Padrão estrutural copiado de admin-qa-view-erro-nao-e-fila-limpa.test.tsx:
// render de verdade (createRoot + act, sem @testing-library), leitura por
// `textContent`, mesmos stubs de ResizeObserver/IntersectionObserver/
// matchMedia/localStorage que a AdminKpiCarousel (embla-carousel) e a view
// precisam para montar em jsdom.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Estado trocado por cada teste antes de montar — é o que o `getAllReviews`
// dublê devolve, no mesmo formato que `useReviews` devolve de verdade
// (ver src/hooks/useReviews.ts, linhas 280-285 e 399-404).
const h = vi.hoisted(() => {
  const estado = {
    total: 0,
    averageRating: 0,
    globalVerifiedCount: 0,
    globalRepliedCount: 0,
    globalTotal: 0,
    globalAverageRating: 0,
    globaisDisponiveis: true,
    // Começa carregando, como o hook de verdade. O motivo é do DUBLÊ, não do
    // componente: o `AdminKpiCarousel` só troca o esqueleto pelo conteúdo
    // quando `loading` fica false, e este dublê devolve valores fixos — nada
    // aqui passa por `setState`, então quem move `loading` é o teste.
    //
    // ⚠️ NÃO existe fragilidade equivalente em produção, e a versão anterior
    // deste comentário afirmava que existia. No `useReviews` real,
    // `setAdminReviews(formatted)` recebe um array NOVO a cada fetch, e array
    // novo nunca é `Object.is`-igual ao anterior — o React re-renderiza mesmo
    // que todas as contagens continuem em 0. O esqueleto sempre desgruda.
    loading: true,
  };

  async function getAllReviews() {
    return {
      total: estado.total,
      averageRating: estado.averageRating,
      globalVerifiedCount: estado.globalVerifiedCount,
      globalRepliedCount: estado.globalRepliedCount,
      globalTotal: estado.globalTotal,
      globalAverageRating: estado.globalAverageRating,
      globaisDisponiveis: estado.globaisDisponiveis,
    };
  }

  return { estado, getAllReviews };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: [],
    loading: h.estado.loading,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn(),
    toggleVerified: vi.fn(),
    addMerchantReply: vi.fn(),
    subscribeToReviews: () => () => {},
  }),
}));

// Laudo 0109 (A-4): a view importa o supabase para a contagem da fila de
// moderação — sem este dublê, o cliente REAL estoura no jsdom. Estes testes
// não olham a fila, então count 0 basta.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// jsdom não implementa IntersectionObserver/ResizeObserver — a
// AdminKpiCarousel (embla-carousel-react) cria um ResizeObserver a cada
// montagem, e LazyImage (não usado aqui pois a lista fica vazia) usaria
// IntersectionObserver. Mesmos stubs de admin-qa-view-erro-nao-e-fila-limpa.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminReviewsView — taxa sem dado não vira porcentagem inventada (A3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.total = 0;
    h.estado.averageRating = 0;
    h.estado.globalVerifiedCount = 0;
    h.estado.globalRepliedCount = 0;
    h.estado.globalTotal = 0;
    h.estado.globalAverageRating = 0;
    h.estado.globaisDisponiveis = true;
    h.estado.loading = true;

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");

    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={() => {}} />);
    });
    // Deixa o `getAllReviews` dublê (assíncrono) resolver e o React
    // commitar o estado resultante (totalReviews, globalVerifiedCount, etc.).
    await act(async () => {
      await esperarMicrotarefas();
    });
    // Simula a transição `loading: true -> false` que o hook de verdade faz
    // sozinho (e que força o React a re-renderizar mesmo quando os números
    // resolvidos são iguais aos valores iniciais) e força o commit.
    h.estado.loading = false;
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={() => {}} />);
    });
  }

  function texto(): string {
    return hospedeiro.textContent ?? "";
  }

  /** Largura (em %) da barra de progresso identificada pela classe do
   * cartão — "bg-purple-550" para Compras Verificadas, "bg-sky-500" para
   * Taxa de Resposta. Exige `style.width` setado para não confundir com o
   * fundo do ícone do cartão, que carrega a mesma substring de classe
   * (ex.: "bg-sky-500/10") mas não é a barra. */
  function larguraDaBarra(classeUnica: string): string | undefined {
    const barra = Array.from(
      hospedeiro.querySelectorAll<HTMLDivElement>("div"),
    ).find(
      (div) => div.className.includes(classeUnica) && div.style.width !== "",
    );
    return barra?.style.width;
  }

  it("sem NENHUMA avaliação, mostra '—' — nunca '100%' nem '0%' inventado", async () => {
    h.estado.total = 0;
    h.estado.globalVerifiedCount = 0;
    h.estado.globalRepliedCount = 0;

    await montar();

    const tela = texto();

    // A mentira proibida: taxa indefinida apresentada com a confiança de
    // uma taxa medida.
    expect(tela).not.toContain("100%");
    expect(tela).not.toContain("0%");

    // O "—" tem que aparecer duas vezes: uma para cada cartão de taxa
    // (Compras Verificadas e Taxa de Resposta).
    const tracos = (tela.match(/—/g) ?? []).length;
    expect(tracos).toBe(2);

    // E as duas barras de progresso ficam vazias, não cheias.
    expect(larguraDaBarra("bg-purple-550")).toBe("0%");
    expect(larguraDaBarra("bg-sky-500")).toBe("0%");
  });

  it("CONTROLE — 10 avaliações, 0 verificadas: mostra '0%' de verdade, não '—'", async () => {
    h.estado.total = 10;
    h.estado.globalTotal = 10;
    h.estado.globalVerifiedCount = 0;
    h.estado.globalRepliedCount = 3;

    await montar();

    const tela = texto();

    // Zero medido é zero de verdade: continua aparecendo, sem virar "—".
    expect(tela).toContain("0%");
    expect(larguraDaBarra("bg-purple-550")).toBe("0%");

    // Nenhum "—" vaza para um estado que tem dado real para medir.
    expect(tela).not.toContain("—");
  });

  it("10 avaliações, 5 verificadas: mostra '50%'", async () => {
    h.estado.total = 10;
    h.estado.globalTotal = 10;
    h.estado.globalVerifiedCount = 5;
    h.estado.globalRepliedCount = 5;

    await montar();

    const tela = texto();

    expect(tela).toContain("50%");
    expect(larguraDaBarra("bg-purple-550")).toBe("50%");
    expect(tela).not.toContain("—");
  });
});
