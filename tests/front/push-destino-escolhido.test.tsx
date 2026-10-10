// @vitest-environment jsdom
//
// Avisar clientes — o destino do aviso é escolhido por LISTA (painel simples,
// H3). O que este arquivo prende:
//
//   a. A lista NÃO tem "Outra Página (Link manual)": o lojista escolhe entre
//      telas com nome, não digita caminho.
//   b. O campo de caminho manual (`#push-custom-path`, o mesmo id de antes)
//      mora só dentro do "Avançado: abrir outra página", recolhido por padrão.
//   c. A URL ENVIADA para cada opção é a de sempre (aviso no app, push e
//      histórico) — o contrato do envio não mudou. Nenhum destino novo.
//   d. Produto: o seletor tem filtro por nome (sem acento) e o produto
//      escolhido depois do filtro vai como `/product-detail?id=<id>`.
//
// Mesmos dublês dos irmãos (`admin-push-envio-honesto`), mais o `Select` do
// Radix trocado por um `<select>` nativo (o jsdom não abre o portal do Radix).
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRODUTOS = [
  { id: "p-corrida", nome: "Tênis Corrida" },
  { id: "p-casual", nome: "Tênis Casual" },
  { id: "p-bota", nome: "Bota de Couro" },
  { id: "p-camiseta", nome: "Camiseta Básica" },
];

const inserts = vi.hoisted(() => ({
  pushLog: [] as Record<string, unknown>[],
  notificacoes: [] as Record<string, unknown>[],
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
        return { select: () => Promise.resolve({ count: 8, error: null }) };
      }
      if (tabela === "vw_produtos_public") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: PRODUTOS, error: null }),
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
          insert: (linha: Record<string, unknown>) => {
            inserts.pushLog.push(linha);
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
          insert: (linha: Record<string, unknown>) => {
            inserts.notificacoes.push(linha);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string) => {
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: 1, error: null });
      }
      return Promise.resolve({
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

const TITULO_DO_AVANCADO = "Avançado: abrir outra página";

describe("Avisar clientes — destino escolhido por lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    inserts.pushLog = [];
    inserts.notificacoes = [];
    invokeSendPush.mockResolvedValue({
      data: { enviados: 1, falharam: 0, falhas: [] },
      error: null,
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
    // LocalBufferedInput só devolve o valor depois do debounce (200 ms).
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

  async function enviar() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Enviar agora para"),
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(80);
    });
  }

  function urlEnviada(): string {
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
    const corpo = invokeSendPush.mock.calls[0][1].body as { url: string };
    // A mesma URL vai para o push, o histórico e o aviso dentro do app.
    expect(inserts.pushLog[0]?.url).toBe(corpo.url);
    return corpo.url;
  }

  function secaoAvancado() {
    return hospedeiro.querySelector<HTMLElement>(
      `section[aria-label="${TITULO_DO_AVANCADO}"]`,
    );
  }

  it("a lista de destinos não tem 'Outra Página' — são as 7 telas com nome", async () => {
    await abrirTela();

    const valores = [...seletorDoDestino().options].map((o) => o.value);
    expect(valores).toEqual([
      "home",
      "search",
      "cart",
      "favorites",
      "orders",
      "profile",
      "product",
    ]);
    expect(valores).not.toContain("custom");
    expect(hospedeiro.textContent).not.toContain("Outra Página");
    expect(hospedeiro.textContent).not.toContain("Link manual");
  });

  it("o campo de caminho manual só existe dentro do Avançado, recolhido por padrão", async () => {
    await abrirTela();

    const campos = hospedeiro.querySelectorAll("#push-custom-path");
    expect(campos).toHaveLength(1);
    const secao = secaoAvancado();
    expect(secao).not.toBeNull();
    expect(secao!.contains(campos[0])).toBe(true);

    const cabecalho = secao!.querySelector("button")!;
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
    expect(campos[0].closest("[hidden]")).not.toBeNull();

    await act(async () => {
      cabecalho.click();
    });
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");
    expect(campos[0].closest("[hidden]")).toBeNull();
  });

  it("o campo de caminho manual não sugere '/exemplo-pagina'", async () => {
    await abrirTela();

    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;
    expect(campo.placeholder).not.toContain("exemplo-pagina");
    expect(campo.placeholder).not.toBe("");
  });

  it.each([
    ["home", "/"],
    ["search", "/search"],
    ["cart", "/cart"],
    ["favorites", "/favorites"],
    ["orders", "/orders"],
    ["profile", "/profile"],
  ])("escolher %s envia a mesma URL de sempre: %s", async (tipo, url) => {
    await abrirTela();
    await preencherMensagem();

    // Parte de outro destino, para provar que a escolha da lista é que manda.
    await escolher(seletorDoDestino(), "cart");
    await escolher(seletorDoDestino(), tipo);
    await enviar();

    expect(urlEnviada()).toBe(url);
  });

  it("produto filtrado por 'tênis' mostra só os tênis e envia /product-detail?id=…", async () => {
    await abrirTela();
    await preencherMensagem();
    await escolher(seletorDoDestino(), "product");

    const filtro = hospedeiro.querySelector<HTMLInputElement>(
      "#push-product-filter",
    );
    expect(filtro).not.toBeNull();
    // Antes de filtrar, todos os produtos estão na lista.
    expect(
      [...seletorDoProduto()!.options].map((o) => o.textContent),
    ).toHaveLength(PRODUTOS.length);

    await act(async () => {
      digitar(filtro!, "tênis");
    });

    expect([...seletorDoProduto()!.options].map((o) => o.textContent)).toEqual([
      "Tênis Corrida",
      "Tênis Casual",
    ]);

    await escolher(seletorDoProduto()!, "p-casual");
    await enviar();

    expect(urlEnviada()).toBe("/product-detail?id=p-casual");
  });

  it("o filtro de produto ignora acento e caixa: 'TENIS' acha 'Tênis'", async () => {
    await abrirTela();
    await escolher(seletorDoDestino(), "product");

    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#push-product-filter")!,
        "TENIS",
      );
    });

    expect([...seletorDoProduto()!.options].map((o) => o.textContent)).toEqual([
      "Tênis Corrida",
      "Tênis Casual",
    ]);
  });

  it("filtro sem resultado deixa a lista vazia e o produto antes escolhido segue valendo", async () => {
    await abrirTela();
    await preencherMensagem();
    await escolher(seletorDoDestino(), "product");
    await escolher(seletorDoProduto()!, "p-bota");

    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#push-product-filter")!,
        "zzz",
      );
    });

    // O escolhido não some da lista só porque o filtro não o casa: senão a
    // tela mostraria um seletor vazio enquanto o aviso sairia com o produto.
    expect([...seletorDoProduto()!.options].map((o) => o.value)).toEqual([
      "p-bota",
    ]);
    await enviar();
    expect(urlEnviada()).toBe("/product-detail?id=p-bota");
  });

  it("o caminho digitado no Avançado é o que o aviso envia, sem tratar", async () => {
    await abrirTela();
    await preencherMensagem();

    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;
    await act(async () => {
      digitar(campo, "/promocao-do-mes");
    });
    await act(async () => {
      await esperar(260);
    });
    await enviar();

    expect(urlEnviada()).toBe("/promocao-do-mes");
  });

  it("escolher uma tela da lista depois de digitar o caminho manual troca a URL", async () => {
    await abrirTela();
    await preencherMensagem();

    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;
    await act(async () => {
      digitar(campo, "/promocao-do-mes");
    });
    await act(async () => {
      await esperar(260);
    });
    await escolher(seletorDoDestino(), "orders");
    await enviar();

    expect(urlEnviada()).toBe("/orders");
  });

  // O LocalBufferedInput devolve o valor ao PERDER O FOCO mesmo sem mudança.
  // O campo do Avançado existe sempre (só fica recolhido): focar e sair sem
  // digitar nada não pode virar "escolhi outra página".
  async function focarESair(campo: HTMLInputElement) {
    await act(async () => {
      campo.focus();
    });
    await act(async () => {
      campo.blur();
    });
    await act(async () => {
      await esperar(260);
    });
  }

  const campoManual = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-custom-path")!;

  it("focar e sair do campo do Avançado, sem digitar, não muda o destino: Carrinho segue Carrinho", async () => {
    await abrirTela();
    await preencherMensagem();
    await escolher(seletorDoDestino(), "cart");

    await focarESair(campoManual());
    await enviar();

    expect(urlEnviada()).toBe("/cart");
  });

  it("focar e sair do campo do Avançado não muda o destino: produto segue produto", async () => {
    await abrirTela();
    await preencherMensagem();
    await escolher(seletorDoDestino(), "product");
    await escolher(seletorDoProduto()!, "p-casual");

    await focarESair(campoManual());
    await enviar();

    expect(urlEnviada()).toBe("/product-detail?id=p-casual");
  });

  it("modelo pronto depois de digitar um caminho manual: o campo esvazia e o aviso leva a URL do modelo, mesmo após focar e sair", async () => {
    await abrirTela();
    await preencherMensagem();

    await act(async () => {
      digitar(campoManual(), "/promo");
    });
    await act(async () => {
      await esperar(260);
    });

    const modelo = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Lembrete de Carrinho"),
    ) as HTMLButtonElement;
    await act(async () => {
      modelo.click();
    });

    expect(seletorDoDestino().value).toBe("cart");
    expect(campoManual().value).toBe("");

    await focarESair(campoManual());
    await enviar();

    expect(urlEnviada()).toBe("/cart");
  });

  it("depois do envio o caminho manual some: o aviso seguinte volta limpo", async () => {
    await abrirTela();
    await preencherMensagem();

    await act(async () => {
      digitar(campoManual(), "/promo");
    });
    await act(async () => {
      await esperar(260);
    });
    await enviar();
    expect(urlEnviada()).toBe("/promo");

    expect(campoManual().value).toBe("");
    expect(seletorDoDestino().value).toBe("home");
  });
});
