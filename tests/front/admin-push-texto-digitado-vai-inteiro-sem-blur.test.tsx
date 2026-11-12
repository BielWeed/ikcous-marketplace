// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarEnvioSePerguntar } from "./confirma-envio-para-todos";

// Avisar clientes: o envio é irreversível e vai para a base inteira. No iPhone
// (e num toque rápido) tocar em "Enviar agora" NÃO tira o foco do campo, então
// o `blur` que descarregava o buffer de 200 ms não acontece: o aviso saía sem
// os últimos caracteres e o formulário seguia preenchido, convidando a
// reenviar. Aqui o texto é digitado e o botão tocado NO MESMO instante, sem
// `blur` e sem esperar o atraso.

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
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { enviarPush, registrarAviso, registrarLog, contarAlcance, buscarAlvos } =
  vi.hoisted(() => ({
    enviarPush: vi.fn(),
    registrarAviso: vi.fn(),
    registrarLog: vi.fn(),
    contarAlcance: vi.fn(),
    buscarAlvos: vi.fn(),
  }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { select: () => Promise.resolve({ count: 1, error: null }) };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { full_name: "Cliente de teste" },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (tabela === "notificacoes") return { insert: registrarAviso };
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: (linha: unknown) => {
            registrarLog(linha);
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
      // Lista de produtos: `.eq().order().order().range()`.
      const leitura: any = Object.assign(
        Promise.resolve({ data: [], error: null }),
        { range: () => Promise.resolve({ data: [], error: null }) },
      );
      leitura.order = () => leitura;
      return { select: () => ({ eq: () => leitura }) };
    },
    rpc: (nome: string) => {
      const r =
        nome === "get_segmented_push_count" ? contarAlcance() : buscarAlvos();
      return Object.assign(r, { order: () => r, range: () => r });
    },
    functions: { invoke: enviarPush },
  },
}));

describe("Avisar clientes — o que está na tela é o que sai, sem depender de blur", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    contarAlcance.mockResolvedValue({ data: 1, error: null });
    buscarAlvos.mockResolvedValue({
      data: [
        {
          user_id: "cliente-1",
          endpoint: "https://push.example/1",
          p256dh: "p1",
          auth: "a1",
        },
      ],
      error: null,
    });
    registrarAviso.mockResolvedValue({ error: null });
    enviarPush.mockResolvedValue({
      data: { enviados: 1, falharam: 0 },
      error: null,
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", Observador);
    vi.stubGlobal("IntersectionObserver", Observador);
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function digitar(
    elemento: HTMLInputElement | HTMLTextAreaElement,
    valor: string,
  ) {
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(
      elemento,
      valor,
    );
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const campoTitulo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-title")!;
  const campoMensagem = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!;
  const campoCaminho = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;

  function botaoEnviar() {
    const encontrado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Enviar agora para"),
    );
    expect(encontrado).toBeDefined();
    return encontrado!;
  }

  // Cliente específico: não abre a pergunta de confirmação, o envio é direto.
  async function abrirComModeloPronto() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId="cliente-1" />,
      );
    });
    const modelo = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Lembrete de Carrinho"),
    );
    await act(async () => modelo!.click());
    expect(botaoEnviar().disabled).toBe(false);
  }

  it("título e mensagem digitados e Enviar tocado no mesmo instante saem COMPLETOS", async () => {
    await abrirComModeloPronto();

    // Sem `blur`, sem esperar 200 ms: digita e toca no mesmo lote.
    await act(async () => {
      digitar(campoTitulo(), "Oferta relâmpago só hoje");
      digitar(campoMensagem(), "Corre que acaba hoje à noite!");
      botaoEnviar().click();
    });
    await confirmarEnvioSePerguntar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(registrarAviso).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledWith(
      expect.objectContaining({
        titulo: "Oferta relâmpago só hoje",
        mensagem: "Corre que acaba hoje à noite!",
      }),
    );
    expect(registrarLog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Oferta relâmpago só hoje",
        body: "Corre que acaba hoje à noite!",
      }),
    );
    expect(enviarPush).toHaveBeenCalledWith("send-push", {
      body: expect.objectContaining({
        title: "Oferta relâmpago só hoje",
        body: "Corre que acaba hoje à noite!",
      }),
    });
  });

  it("o endereço da página (Avançado) digitado e Enviar no mesmo instante também sai completo", async () => {
    await abrirComModeloPronto();
    // O destino e o Avançado vêm recolhidos: o campo só existe depois de abrir.
    const botaoCom = (texto: string) =>
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(texto),
      )!;
    await act(async () => botaoCom("Ao tocar na mensagem").click());
    await act(async () => botaoCom("Avançado: abrir outra página").click());

    await act(async () => {
      digitar(campoCaminho(), "/notifications");
      botaoEnviar().click();
    });
    await confirmarEnvioSePerguntar();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(registrarAviso).toHaveBeenCalledTimes(1);
    expect(registrarAviso).toHaveBeenCalledWith(
      expect.objectContaining({
        dados: expect.objectContaining({ action_url: "/notifications" }),
      }),
    );
    expect(enviarPush).toHaveBeenCalledWith("send-push", {
      body: expect.objectContaining({ url: "/notifications" }),
    });
  });

  it("controle: os limites de 60 e 140 caracteres e os contadores seguem valendo", async () => {
    await abrirComModeloPronto();

    expect(campoTitulo().getAttribute("maxlength")).toBe("60");
    expect(campoMensagem().getAttribute("maxlength")).toBe("140");

    await act(async () => {
      digitar(campoTitulo(), "Cinco");
      digitar(campoMensagem(), "Sete!!!");
    });
    // O contador acompanha o que está digitado, sem esperar atraso nenhum.
    // (colado ao rótulo: "45/60" também contém "5/60".)
    expect(hospedeiro.textContent).toContain("Título5/60");
    expect(hospedeiro.textContent).toContain("Mensagem7/140");
  });
});
