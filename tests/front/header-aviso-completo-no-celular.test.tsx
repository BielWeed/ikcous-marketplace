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
    toast.success("Pronto", { description: { nao: "texto" } });
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
    expect(texto!.className).toContain("max-[640px]:line-clamp-none");
    expect(texto!.className).toContain("max-[640px]:max-w-none");
    // alvo legível: 12 px no celular, não 11 px
    expect(texto!.className).toContain("max-[640px]:text-xs");
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
