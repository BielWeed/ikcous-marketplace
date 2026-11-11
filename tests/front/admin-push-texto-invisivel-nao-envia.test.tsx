// @vitest-environment jsdom
//
// Avisar clientes: titulo ou mensagem feitos so de caractere INVISIVEL (espaco
// de largura zero, hifen suave, marca de direcao...) passavam no `trim()` do
// JavaScript e o aviso saia em branco para todos os clientes. Envio nao se
// desfaz, entao a trava tem de recusar ANTES de qualquer gravacao ou chamada.
//
// Prova nos DOIS pontos: o toast "Preencha titulo e mensagem" (handleSend) e a
// pendencia de rascunho (onSetDirty) — texto invisivel nao e rascunho a perder.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarEnvioSePerguntar } from "./confirma-envio-para-todos";

const { invokeSendPush, gravacoes, toastError } = vi.hoisted(() => ({
  invokeSendPush: vi.fn(),
  gravacoes: [] as string[],
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () => Promise.resolve({ count: 3, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => {
            gravacoes.push("push_notifications_log");
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: "log-1" }, error: null }),
              }),
            };
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (tabela === "notificacoes") {
        return {
          insert: () => {
            gravacoes.push("notificacoes");
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
    rpc: (nome: string) => {
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: 3, error: null });
      }
      const consulta = {
        order: () => consulta,
        range: () =>
          Promise.resolve({
            data: [1, 2, 3].map((i) => ({
              user_id: `u${i}`,
              endpoint: `https://fcm.fixture.invalid/e${i}`,
              p256dh: "p",
              auth: "a",
            })),
            error: null,
          }),
      };
      return consulta;
    },
    functions: { invoke: invokeSendPush },
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

// Cada um, escrito por codigo (o arquivo nao carrega o caractere invisivel; as
// marcas de direcao vao por `fromCodePoint` para nao acender o alarme de bidi).
const INVISIVEIS: [string, string][] = [
  ["U+200B espaco de largura zero", String.fromCodePoint(0x200b)],
  ["U+200C nao-juntador", String.fromCodePoint(0x200c)],
  ["U+200D juntador", String.fromCodePoint(0x200d)],
  ["U+2060 junta-palavras", String.fromCodePoint(0x2060)],
  ["U+00AD hifen suave", String.fromCodePoint(0x00ad)],
  ["U+200E marca esquerda-direita", String.fromCodePoint(0x200e)],
  ["U+200F marca direita-esquerda", String.fromCodePoint(0x200f)],
];
const TODOS_JUNTOS = INVISIVEIS.map(([, c]) => c).join("");
const MARCA_DA_ABERTURA = "ABRE";

describe("Avisar clientes: texto so com caractere invisivel nao envia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSetDirty: ReturnType<typeof vi.fn<(dirty: boolean) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    gravacoes.length = 0;
    onSetDirty = vi.fn<(dirty: boolean) => void>();
    invokeSendPush.mockResolvedValue({
      data: { enviados: 3, falharam: 0, falhas: [] },
      error: null,
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => void armazem.set(c, v),
      removeItem: (c: string) => void armazem.delete(c),
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} onSetDirty={onSetDirty} />,
      );
    });
    await act(async () => {
      await esperar(80);
    });
  }

  function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function escrever(titulo: string, corpo: string) {
    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#push-title")!,
        titulo,
      );
      digitar(
        hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!,
        corpo,
      );
    });
    await act(async () => {
      await esperar(260);
    });
  }

  const botao = (trecho: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(trecho),
    ) as HTMLButtonElement | undefined;

  async function enviar() {
    await act(async () => {
      botao("Enviar agora para")!.click();
    });
    await confirmarEnvioSePerguntar();
    await act(async () => {
      await esperar(80);
    });
  }

  function nadaFoiParaOsClientes() {
    expect(toastError).toHaveBeenCalledWith("Preencha título e mensagem");
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(gravacoes).toEqual([]);
  }

  const ultimaPendencia = () => onSetDirty.mock.calls.at(-1)?.[0];

  it.each(INVISIVEIS)(
    "titulo e mensagem so com %s: nao envia, nao grava, nao conta como rascunho",
    async (_nome, caractere) => {
      await abrirTela();
      await escrever(caractere.repeat(3), caractere.repeat(5));
      expect(ultimaPendencia()).toBe(false);
      await enviar();
      nadaFoiParaOsClientes();
    },
  );

  it("todos os invisiveis misturados com espacos: nao envia", async () => {
    await abrirTela();
    await escrever(` ${TODOS_JUNTOS} `, `${TODOS_JUNTOS}\n ${TODOS_JUNTOS}`);
    expect(ultimaPendencia()).toBe(false);
    await enviar();
    nadaFoiParaOsClientes();
  });

  it("titulo valido + mensagem so invisivel: nao envia, mas e rascunho (tem titulo a perder)", async () => {
    await abrirTela();
    await escrever("Novidade", TODOS_JUNTOS);
    expect(ultimaPendencia()).toBe(true);
    await enviar();
    nadaFoiParaOsClientes();
  });

  it("titulo so invisivel + mensagem valida: nao envia, mas e rascunho (tem mensagem a perder)", async () => {
    await abrirTela();
    await escrever(TODOS_JUNTOS, "Chegou colecao nova");
    expect(ultimaPendencia()).toBe(true);
    await enviar();
    nadaFoiParaOsClientes();
  });

  it("controle: texto normal com acento e emoji envia e grava", async () => {
    await abrirTela();
    await escrever("Promoção ✨", "Chegou coleção nova 🎉");
    expect(ultimaPendencia()).toBe(true);
    await enviar();

    expect(toastError).not.toHaveBeenCalledWith("Preencha título e mensagem");
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    expect(gravacoes).toContain("push_notifications_log");
  });

  it("controle: titulo SO de emoji (sem letra nem numero) continua valido", async () => {
    await abrirTela();
    await escrever("🎉", "Chegou coleção nova");
    await enviar();

    expect(toastError).not.toHaveBeenCalledWith("Preencha título e mensagem");
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("controle: emoji colado por juntador (familia) nao e confundido com invisivel", async () => {
    await abrirTela();
    await escrever("\u{1F468}‍\u{1F469}‍\u{1F467}", MARCA_DA_ABERTURA);
    await enviar();

    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });
});
