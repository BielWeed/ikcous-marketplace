// @vitest-environment jsdom
//
// Avisar clientes — dois defeitos medidos na rodada 21 (lote F):
//
//   A. Se a lista de produtos falha ao abrir a tela, "Abrir um produto
//      específico" virava link quebrado sem aviso (o destino pulava sozinho
//      para "Outra página" com "/product-detail" no campo avançado). Agora a
//      falha aparece com "Tentar de novo", a escolha "produto" sem produto não
//      troca o destino, e o envio recusa "/product-detail" sem id.
//   C. Depois de enviar, o número de aparelhos (botão e grupos) continuava o
//      antigo: só o histórico era lido de novo.
//
// Mesmos dublês de `push-destino-escolhido.test.tsx`, com a leitura de
// produtos e as contagens controláveis pelo teste.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRODUTOS = [
  { id: "p-corrida", nome: "Tênis Corrida" },
  { id: "p-casual", nome: "Tênis Casual" },
];

const banco = vi.hoisted(() => ({
  produtos: "ok" as "ok" | "vazio" | "erro" | "excecao",
  aparelhos: 8,
  contagemDoSegmento: 5,
}));
const invokeSendPush = vi.hoisted(() => vi.fn());

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

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    name,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    name?: string;
    children: ReactNode;
  }) => (
    <select
      name={name}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: banco.aparelhos, error: null }),
        };
      }
      if (tabela === "vw_produtos_public") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  range: () => {
                    if (banco.produtos === "excecao")
                      return Promise.reject(new Error("rede caiu"));
                    if (banco.produtos === "erro")
                      return Promise.resolve({
                        data: null,
                        error: { message: "falhou" },
                      });
                    return Promise.resolve({
                      data: banco.produtos === "vazio" ? [] : PRODUTOS,
                      error: null,
                    });
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "log-1" }, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (tabela === "notificacoes") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string) => {
      const r =
        nome === "get_segmented_push_count"
          ? Promise.resolve({ data: banco.contagemDoSegmento, error: null })
          : Promise.resolve({
              data: [
                {
                  user_id: "u1",
                  endpoint: "https://push.example/1",
                  p256dh: "p1",
                  auth: "a1",
                },
              ],
              error: null,
            });
      return Object.assign(r, { order: () => r, range: () => r });
    },
    functions: { invoke: invokeSendPush },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Avisar clientes — produtos que falham e contagens depois do envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    banco.produtos = "ok";
    banco.aparelhos = 8;
    banco.contagemDoSegmento = 5;
    invokeSendPush.mockImplementation(async () => {
      // O envio muda a base: um aparelho a mais e um a menos no grupo.
      banco.aparelhos = 9;
      banco.contagemDoSegmento = 4;
      return {
        data: { enviados: 1, falharam: 0, falhas: [] },
        error: null,
      };
    });
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      Array.from(hospedeiro.querySelectorAll("button"))
        .find((b) => (b.textContent ?? "").includes("Ao tocar na mensagem"))
        ?.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

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

  async function preencherMensagem() {
    const titulo = hospedeiro.querySelector<HTMLInputElement>("#push-title")!;
    const corpo = hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!;
    await act(async () => {
      digitar(titulo, "Oferta");
      digitar(corpo, "Corre que acaba hoje");
    });
    await act(async () => {
      await esperar(260);
    });
  }

  const seletorDoDestino = () =>
    hospedeiro.querySelector<HTMLSelectElement>('select[name="destType"]')!;
  const seletorDoProduto = () =>
    hospedeiro.querySelector<HTMLSelectElement>('select[name="productId"]');

  async function escolher(select: HTMLSelectElement, valor: string) {
    await act(async () => {
      select.value = valor;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const botaoDeEnviar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Enviar agora para"),
    ) as HTMLButtonElement;

  async function enviar() {
    await act(async () => {
      botaoDeEnviar().click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  const botaoTentarDeNovo = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;

  describe("A. lista de produtos", () => {
    it.each([
      ["erro devolvido pelo banco", "erro"],
      ["exceção na leitura", "excecao"],
    ] as const)(
      "%s: a tela diz que não deu para carregar e oferece tentar de novo",
      async (_nome, modo) => {
        banco.produtos = modo;
        const erroNoConsole = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        await abrirTela();

        expect(hospedeiro.textContent).toContain(
          "Não deu para carregar os produtos.",
        );
        expect(botaoTentarDeNovo()).toBeDefined();
        erroNoConsole.mockRestore();
      },
    );

    it("tentar de novo lê a lista outra vez e libera 'Abrir um produto'", async () => {
      banco.produtos = "erro";
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await abrirTela();
      erroNoConsole.mockRestore();

      banco.produtos = "ok";
      await act(async () => {
        botaoTentarDeNovo()!.click();
      });
      await act(async () => {
        await esperar(80);
      });

      expect(hospedeiro.textContent).not.toContain(
        "Não deu para carregar os produtos.",
      );
      expect(botaoTentarDeNovo()).toBeUndefined();

      await escolher(seletorDoDestino(), "product");
      expect(seletorDoDestino().value).toBe("product");
      expect([...seletorDoProduto()!.options].map((o) => o.value)).toEqual([
        "p-corrida",
        "p-casual",
      ]);
    });

    it("sem nenhum produto, escolher 'Abrir um produto' avisa e NÃO troca o destino", async () => {
      banco.produtos = "vazio";
      await abrirTela();
      await preencherMensagem();

      await escolher(seletorDoDestino(), "product");

      expect(toast.warning).toHaveBeenCalledWith(
        "Nenhum produto disponível para escolher.",
      );
      expect(seletorDoDestino().value).toBe("home");
      // O destino não pulou para "Outra página": o campo avançado segue vazio.
      expect(
        hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!.value,
      ).toBe("");

      await enviar();
      const corpo = invokeSendPush.mock.calls[0][1].body as { url: string };
      expect(corpo.url).toBe("/");
    });

    it("recusa enviar um aviso para '/product-detail' sem produto", async () => {
      await abrirTela();
      await preencherMensagem();

      const campo =
        hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;
      await act(async () => {
        digitar(campo, "/product-detail");
      });
      await act(async () => {
        await esperar(260);
      });
      await enviar();

      expect(invokeSendPush).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        "Escolha o produto que o aviso vai abrir",
        expect.anything(),
      );
    });
  });

  describe("C. contagens depois do envio", () => {
    it("para 'todos', o botão e os grupos mostram o número novo", async () => {
      await abrirTela();
      await preencherMensagem();
      expect(botaoDeEnviar().textContent).toContain("8 aparelhos");

      await enviar();

      expect(invokeSendPush).toHaveBeenCalledTimes(1);
      expect(botaoDeEnviar().textContent).toContain("9 aparelhos");
      const grupo = [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Gastaram R$ 150+"),
      )!;
      // O rótulo do grupo traz "150": o número do grupo é o selo que sobra
      // depois do nome.
      expect(grupo.textContent).toContain("Gastaram R$ 150+4aparelhos");
    });

    it("para um grupo, o alcance do grupo escolhido também é medido de novo", async () => {
      await abrirTela();
      await preencherMensagem();
      await act(async () => {
        [...hospedeiro.querySelectorAll("button")]
          .find((b) => (b.textContent ?? "").includes("Novos em 7 dias"))
          ?.click();
      });
      await act(async () => {
        await esperar(80);
      });
      expect(botaoDeEnviar().textContent).toContain("5 aparelhos");

      await enviar();

      expect(botaoDeEnviar().textContent).toContain("4 aparelhos");
    });
  });
});
