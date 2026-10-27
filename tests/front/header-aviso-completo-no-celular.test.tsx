// @vitest-environment jsdom
//
// Lote 219 (caça 9), item 1: no celular o Sonner some e a cápsula do topo é o
// ÚNICO aviso. Ela repassava só o texto (a `description` e a `duration` do
// aviso eram descartadas), durava sempre 2,6 s e cortava a frase em ~2 linhas
// de 100 px: "Recebemos sua avaliação! Ela aparece…" e a instrução de "não
// conseguimos confirmar se a sua senha foi alterada" se perdiam.
//
// Aqui: (a) o interceptador repassa a descrição e respeita a duração pedida,
// (b) a duração é proporcional ao tamanho do texto, (c) `Infinity` não vira
// "some na hora", (d) no celular a cápsula mostra mensagem + descrição inteiras
// (sem corte) e a região falada leva a descrição. jsdom não vê layout: o que se
// prova é a marcação/classes; a prova visual é de navegador real (relatório).
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `originais` guarda os espiões ANTES de o interceptador trocar os métodos do
// objeto `toast` (que é este mesmo `sonner`).
const sonner = vi.hoisted(() => {
  const originais = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  };
  return { ...originais, originais };
});
vi.mock("sonner", () => ({ toast: sonner }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "LOJA DA PROVA" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

import {
  type HeaderToastData,
  dispensarToastDoHeader,
  duracaoDoAviso,
  initHeaderToastInterceptor,
} from "@/utils/headerToast";

// @ts-expect-error flag interna do React, mesmo padrão de header-center-slot.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM = "Recebemos sua avaliação!";
const DESCRICAO =
  "Ela aparece no produto assim que a loja aprovar o seu comentário.";

describe("duracaoDoAviso — tempo proporcional ao texto", () => {
  it("texto curto mantém o piso de 2600 ms", () => {
    expect(duracaoDoAviso("Salvo")).toBe(2600);
  });

  it("texto longo (mensagem + descrição) fica mais tempo na tela", () => {
    const ms = duracaoDoAviso(MENSAGEM, DESCRICAO);
    expect(ms).toBe((MENSAGEM.length + DESCRICAO.length) * 60);
    expect(ms).toBeGreaterThan(2600);
  });

  it("tem teto de 9000 ms", () => {
    expect(duracaoDoAviso("x".repeat(500))).toBe(9000);
  });
});

describe("interceptador do toast — repassa descrição e duração", () => {
  const recebidos: HeaderToastData[] = [];
  const ouvinte = (e: Event) => {
    recebidos.push((e as CustomEvent<HeaderToastData>).detail);
  };

  beforeEach(() => {
    recebidos.length = 0;
    initHeaderToastInterceptor();
    globalThis.addEventListener("header-toast-event", ouvinte);
  });
  afterEach(() => {
    globalThis.removeEventListener("header-toast-event", ouvinte);
  });

  it("leva a description junto da mensagem e deriva a duração do texto", async () => {
    const { toast } = await import("sonner");
    toast.error(MENSAGEM, { description: DESCRICAO });
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]?.message).toBe(MENSAGEM);
    expect(recebidos[0]?.description).toBe(DESCRICAO);
    expect(recebidos[0]?.duration).toBe(duracaoDoAviso(MENSAGEM, DESCRICAO));
  });

  it("respeita a duração explícita de quem chamou (inclusive Infinity)", async () => {
    const { toast } = await import("sonner");
    toast.warning("Falta escolher o tamanho", { duration: 12000 });
    toast.info("Fica até tocar", { duration: Number.POSITIVE_INFINITY });
    expect(recebidos.map((r) => r.duration)).toEqual([
      12000,
      Number.POSITIVE_INFINITY,
    ]);
  });

  it("descrição que não é texto (elemento React) é ignorada, sem quebrar", async () => {
    const { toast } = await import("sonner");
    toast.success("Pronto", { description: <b>elemento</b> });
    expect(recebidos[0]?.description).toBeUndefined();
    expect(recebidos[0]?.duration).toBe(2600);
  });

  it("ainda chama o toast original (o Sonner segue valendo no computador)", async () => {
    const { toast } = await import("sonner");
    // O interceptador substituiu o método; o original é o mock hoistado.
    toast.success("Salvo", { description: "ok" });
    expect(sonner.originais.success).toHaveBeenCalledWith("Salvo", {
      description: "ok",
    });
  });
});

describe("Header — cápsula de aviso no celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => dispensarToastDoHeader());
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  // Os testes de TEMPO usam relógio falso (e leem só a região falada, que não
  // depende da animação de saída do framer); os VISUAIS usam o relógio real,
  // porque o AnimatePresence só monta a cápsula depois que o exit termina.
  async function montar() {
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });
  }

  function avisar(detail: Partial<HeaderToastData> & { message: string }) {
    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent("header-toast-event", {
          detail: { id: "a1", type: "success", ...detail },
        }),
      );
    });
  }

  const botaoCom = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );

  async function esperarBotao(texto: string) {
    for (let i = 0; i < 30; i++) {
      const achado = botaoCom(texto);
      if (achado) return achado;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    return undefined;
  }

  it("mostra a descrição dentro da cápsula, sem corte de linhas no celular", async () => {
    await montar();
    avisar({ message: MENSAGEM, description: DESCRICAO, duration: 60_000 });
    const cap = await esperarBotao(MENSAGEM);
    expect(cap).toBeDefined();
    expect(cap!.textContent).toContain(MENSAGEM);
    expect(cap!.textContent).toContain(DESCRICAO);

    const texto = [...cap!.querySelectorAll("span")].find((s) =>
      s.textContent?.includes(MENSAGEM),
    );
    // Largura inteira em TODA a faixa de celular (até 640 px): o cartão longo
    // não herda o `xs:max-w-[155px]` da pílula, que vencia entre 480 e 640 px.
    expect(texto!.className).toContain("max-w-none");
    expect(texto!.className).toContain("line-clamp-none");
    expect(texto!.className).not.toMatch(/(^|\s)(xs|sm):max-w-/);
    expect(texto!.className).not.toContain("max-w-[100px]");
    // acima de 640 px volta à pílula de sempre
    expect(texto!.className).toContain("min-[641px]:max-w-[220px]");
    expect(texto!.className).toContain("min-[641px]:line-clamp-2");
    // alvo legível: 12 px no celular, não 11 px
    expect(texto!.className).toMatch(/(^|\s)text-xs(\s|$)/);
    expect(texto!.className).not.toContain("text-[11px]");
    // o cartão se pendura ABAIXO da barra: a altura do cabeçalho não muda
    expect(cap!.className).toContain("max-[640px]:absolute");
    expect(cap!.className).toContain("max-[640px]:rounded-2xl");
  });

  it("a região falada leva mensagem E descrição", async () => {
    await montar();
    avisar({ message: MENSAGEM, description: DESCRICAO });
    const regiao = [...hospedeiro.querySelectorAll('[role="status"]')].find(
      (r) => r.textContent?.includes(MENSAGEM),
    );
    expect(regiao).toBeDefined();
    expect(regiao!.textContent).toContain(DESCRICAO);
  });

  it("aviso curto e sem descrição continua a pílula compacta de sempre", async () => {
    await montar();
    avisar({ message: "Salvo", duration: 60_000 });
    const cap = await esperarBotao("Salvo");
    expect(cap).toBeDefined();
    expect(cap!.className).not.toContain("max-[640px]:absolute");
    const texto = [...cap!.querySelectorAll("span")].find(
      (s) => s.textContent === "Salvo",
    );
    expect(texto!.className).toContain("line-clamp-2");
  });

  it("a cápsula fica o tempo proporcional ao texto, não 2,6 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await montar();
    const ms = duracaoDoAviso(MENSAGEM, DESCRICAO);
    avisar({ message: MENSAGEM, description: DESCRICAO, duration: ms });
    act(() => vi.advanceTimersByTime(2700));
    expect(hospedeiro.textContent).toContain(DESCRICAO);
    act(() => vi.advanceTimersByTime(ms - 2700));
    expect(hospedeiro.textContent).not.toContain(DESCRICAO);
  });

  it("duration Infinity não some na hora: fica até o toque", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await montar();
    avisar({
      message: MENSAGEM,
      description: DESCRICAO,
      duration: Number.POSITIVE_INFINITY,
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(hospedeiro.textContent).toContain(DESCRICAO);
    act(() => dispensarToastDoHeader());
    expect(hospedeiro.textContent).not.toContain(DESCRICAO);
  });
});

describe("toast.dismiss fecha a cápsula (aviso fixo não fica preso)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    initHeaderToastInterceptor();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => dispensarToastDoHeader());
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  const falado = () =>
    [...hospedeiro.querySelectorAll('[role="status"]')]
      .map((r) => r.textContent)
      .join("|");

  it("aviso fixo com id some quando o código chama toast.dismiss(id)", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Rascunho não salvo encontrado", {
        id: "rascunho",
        duration: Number.POSITIVE_INFINITY,
      });
    });
    expect(falado()).toContain("Rascunho não salvo encontrado");
    act(() => {
      toast.dismiss("rascunho");
    });
    expect(falado()).not.toContain("Rascunho não salvo encontrado");
    // e o Sonner de verdade também recebeu o dismiss
    expect(sonner.originais.dismiss).toHaveBeenCalledWith("rascunho");
  });

  it("dismiss de OUTRO id não derruba o aviso atual", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Aviso que fica", {
        id: "A",
        duration: Number.POSITIVE_INFINITY,
      });
    });
    act(() => {
      toast.dismiss("B");
    });
    expect(falado()).toContain("Aviso que fica");
  });

  it("toast.dismiss() sem id fecha o aviso atual (como no Sonner, que fecha todos)", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Qualquer aviso", { duration: Number.POSITIVE_INFINITY });
    });
    expect(falado()).toContain("Qualquer aviso");
    act(() => {
      toast.dismiss();
    });
    expect(falado()).not.toContain("Qualquer aviso");
  });

  it("aviso novo substitui o antigo: dismiss do id antigo não derruba o novo", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Velho", { id: "velho", duration: Number.POSITIVE_INFINITY });
      toast.info("Novo", { id: "novo", duration: Number.POSITIVE_INFINITY });
    });
    act(() => {
      toast.dismiss("velho");
    });
    expect(falado()).toContain("Novo");
  });
});

describe("acima de 640 px a cápsula segue com os 2600 ms de sempre", () => {
  const recebidos: HeaderToastData[] = [];
  const ouvinte = (e: Event) => {
    recebidos.push((e as CustomEvent<HeaderToastData>).detail);
  };

  beforeEach(() => {
    recebidos.length = 0;
    initHeaderToastInterceptor();
    globalThis.addEventListener("header-toast-event", ouvinte);
  });
  afterEach(() => {
    globalThis.removeEventListener("header-toast-event", ouvinte);
    vi.unstubAllGlobals();
  });

  it("no computador, duration explícito, Infinity e texto longo não alongam a cápsula", async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
    }));
    const { toast } = await import("sonner");
    toast.warning("x".repeat(200), { duration: 12000 });
    toast.info("fixo", { duration: Number.POSITIVE_INFINITY });
    toast.success(MENSAGEM, { description: DESCRICAO });
    expect(recebidos.map((r) => r.duration)).toEqual([2600, 2600, 2600]);
  });

  it("no celular (<=640 px) vale o tempo novo", async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta === "(max-width: 640px)",
      media: consulta,
    }));
    const { toast } = await import("sonner");
    toast.success(MENSAGEM, { description: DESCRICAO });
    expect(recebidos[0]?.duration).toBe(duracaoDoAviso(MENSAGEM, DESCRICAO));
  });
});
