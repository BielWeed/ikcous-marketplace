// @vitest-environment jsdom
//
// Frente glm-visual-canais-avisar-0309 (ondas 2 e 3 do rebuild visual do
// painel): as telas "Canais de Atendimento" (AdminWhatsAppConfigView) e
// "Avisar clientes" (AdminPushView) entram na MESMA CASCA premium do rebuild
// do Frete (PR #414) — AdminPageHeader no topo, zero <h1> manual e conteúdo
// organizado em seções colapsáveis no padrão dos Ajustes.
//
// A REGRA DE OURO da frente: muda a casa, não o morador. Por isso o contrato
// prende as duas metades:
//   1. A CASCA — AdminPageHeader usado, nenhum <h1> copiado na mão, seções
//      colapsáveis presentes (com estado inicial definido) — é o que este
//      rebuild constrói;
//   2. O MORADOR — os campos-chave de cada tela continuam na árvore depois
//      do rebuild (nenhum campo sumiu), e o editor de mensagem do
//      Atendimento continua nascendo com o texto salvo quando a seção abre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Parte 1: contrato de fonte (o mesmo estilo do teste de título
//    padronizado — ler o fonte prova o import e a ausência de <h1> mesmo
//    onde o jsdom não chega). ──────────────────────────────────────────────
const FONTES = import.meta.glob<string>("/src/views/admin/Admin*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const TELAS = ["AdminWhatsAppConfigView.tsx", "AdminPushView.tsx"] as const;

describe("contrato de fonte das duas telas (Canais e Avisar clientes)", () => {
  it("o glob casou as duas telas de verdade (nada de prova vazia)", () => {
    for (const tela of TELAS) {
      expect(FONTES, `falta o fonte de ${tela}`).toHaveProperty(
        `/src/views/admin/${tela}`,
      );
    }
  });

  for (const tela of TELAS) {
    it(`${tela} importa e usa o AdminPageHeader`, () => {
      const fonte = FONTES[`/src/views/admin/${tela}`];
      expect(fonte).toContain(
        'import { AdminPageHeader } from "@/components/admin/AdminPageHeader";',
      );
      expect(fonte).toContain("<AdminPageHeader");
    });

    it(`${tela} não tem <h1> manual (o título de página nasce só no padrão)`, () => {
      const fonte = FONTES[`/src/views/admin/${tela}`];
      expect(
        fonte,
        "há um <h1> copiado na mão fora do AdminPageHeader",
      ).not.toContain("<h1");
    });
  }
});

// ── Infra comum de renderização (mesma base dos testes de Ajustes) ────────
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function digitarEm(
  campo: HTMLInputElement | HTMLTextAreaElement,
  texto: string,
): Promise<void> {
  const prototipo =
    campo instanceof HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototipo, "value")?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function cabecalhoDeSecao(
  hospedeiro: HTMLElement,
  texto: string,
): HTMLButtonElement | undefined {
  return Array.from(
    hospedeiro.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ).find((b) => (b.textContent ?? "").includes(texto));
}

// ── Mocks compartilhados pelas duas telas (UM por módulo — vi.mock é
//    içado, e um segundo registro para o mesmo caminho venceria o primeiro
//    no arquivo inteiro). ──────────────────────────────────────────────────
const { configDaLoja, updateConfigDaLoja, estadoDoBancoPush } = vi.hoisted(
  () => ({
    configDaLoja: {
      whatsappNumber: "",
      businessHours: "",
      shareText: "Confira [nome] por [preco]: [link]",
      realTimeSalesAlerts: false,
    },
    updateConfigDaLoja: vi.fn(),
    estadoDoBancoPush: {
      subCount: 8,
      historico: [
        {
          id: "log-1",
          title: "Oferta antiga",
          body: "Texto",
          url: "/",
          recipient_count: 0,
          sent_at: new Date("2026-09-01T12:00:00Z").toISOString(),
        },
      ] as any[],
    },
  }),
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configDaLoja,
    isLoaded: true,
    updateConfig: updateConfigDaLoja,
    refresh: vi.fn(),
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({
              count: estadoDoBancoPush.subCount,
              error: null,
            }),
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data:
                  tabela === "push_notifications_log"
                    ? estadoDoBancoPush.historico
                    : [],
                error: null,
              }),
          }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (_nome: string, _args: { p_segment: string }) =>
      Promise.resolve({ data: 0, error: null }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
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

const textoDaTela = () => hospedeiro.textContent ?? "";

// ── Parte 2: Canais de Atendimento (AdminWhatsAppConfigView) ──────────────
async function abrirCanais() {
  const { AdminWhatsAppConfigView } = await import(
    "@/views/admin/AdminWhatsAppConfigView"
  );
  await act(async () => {
    raiz.render(<AdminWhatsAppConfigView active={true} onSetDirty={vi.fn()} />);
  });
  await act(async () => {
    await esperar(50);
  });
}

describe("Canais de Atendimento — a casca nova guarda o morador", () => {
  it("nasce no título padrão, com a seção de contato ABERTA e a de mensagem FECHADA", async () => {
    await abrirCanais();

    // Título padrão (AdminPageHeader), não um h1 avulso.
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Atendimento");

    // A porta de todo dia (contato e expediente) fica à vista, com os campos.
    const contato = cabecalhoDeSecao(hospedeiro, "Canais de Atendimento");
    expect(contato).toBeTruthy();
    expect(contato!.getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.querySelector("#settings-whatsapp")).not.toBeNull();
    expect(hospedeiro.querySelector("#settings-business-hours")).not.toBeNull();

    // A parte pesada (mockup do WhatsApp + editor) nasce oculta.
    const mensagem = cabecalhoDeSecao(
      hospedeiro,
      "Mensagem de Compartilhamento de Produtos",
    );
    expect(mensagem).toBeTruthy();
    expect(mensagem!.getAttribute("aria-expanded")).toBe("false");
    expect(
      hospedeiro.querySelector("#settings-share-message-editor"),
    ).toBeNull();

    // O botão Salvar continua na linha do título.
    const salvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Salvar"),
    );
    expect(salvar).toBeTruthy();
  });

  it("expandir a seção de mensagem monta o editor JÁ com o texto salvo (com os chips de tag)", async () => {
    await abrirCanais();

    const mensagem = cabecalhoDeSecao(
      hospedeiro,
      "Mensagem de Compartilhamento de Produtos",
    )!;
    await act(async () => {
      mensagem.click();
    });
    await act(async () => {
      await esperar(50);
    });

    const editor = hospedeiro.querySelector(
      "#settings-share-message-editor",
    ) as HTMLDivElement | null;
    expect(editor).not.toBeNull();
    // O shareText salvo ("Confira [nome] por [preco]: [link]") vira chips
    // dentro do editor — prova de que o conteúdo não nasce vazio.
    expect(editor!.innerHTML).toContain('data-tag="nome"');
    expect(editor!.innerHTML).toContain('data-tag="preco"');
    expect(editor!.innerHTML).toContain('data-tag="link"');

    // Os botões de tag e o atalho de presets continuam na árvore.
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Nome do Produto"),
      ),
    ).toBeTruthy();
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Escolher Modelo Pronto"),
      ),
    ).toBeTruthy();
  });

  it("fechar e reabrir a seção de mensagem NÃO perde o texto do editor", async () => {
    await abrirCanais();

    const mensagem = cabecalhoDeSecao(
      hospedeiro,
      "Mensagem de Compartilhamento de Produtos",
    )!;
    await act(async () => {
      mensagem.click();
    });
    await act(async () => {
      mensagem.click();
    });
    await act(async () => {
      await esperar(350); // fim da animação de saída
    });
    expect(
      hospedeiro.querySelector("#settings-share-message-editor"),
    ).toBeNull();

    await act(async () => {
      mensagem.click();
    });
    await act(async () => {
      await esperar(50);
    });

    const editor = hospedeiro.querySelector(
      "#settings-share-message-editor",
    ) as HTMLDivElement | null;
    expect(editor).not.toBeNull();
    expect(editor!.innerHTML).toContain('data-tag="nome"');
  });

  it("com alteração não salva, a seção aberta não fecha — 'Salve antes de fechar'", async () => {
    await abrirCanais();

    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    await digitarEm(campo, "1198765432");
    await act(async () => {
      await esperar(500); // flush do LocalBufferedInput (350 ms)
    });

    expect(textoDaTela()).toMatch(/salve antes de fechar/i);

    const contato = cabecalhoDeSecao(hospedeiro, "Canais de Atendimento")!;
    await act(async () => {
      contato.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(contato.getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.querySelector("#settings-whatsapp")).not.toBeNull();
  });
});

// ── Parte 3: Avisar clientes (AdminPushView) ───────────────────────────────
async function abrirAvisar() {
  const { AdminPushView } = await import("@/views/admin/AdminPushView");
  await act(async () => {
    raiz.render(<AdminPushView onNavigate={vi.fn()} />);
  });
  await act(async () => {
    await esperar(50);
  });
}

describe("Avisar clientes — a casca nova guarda o morador", () => {
  it("nasce no título padrão, com escrita e histórico visíveis na árvore", async () => {
    await abrirAvisar();

    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Enviar Notificações",
    );

    // Seções colapsáveis presentes e abertas (a porta de trabalho inteira).
    const escrita = cabecalhoDeSecao(hospedeiro, "Escrever Nova Notificação");
    const historico = cabecalhoDeSecao(
      hospedeiro,
      "Histórico de Mensagens Enviadas",
    );
    expect(escrita).toBeTruthy();
    expect(historico).toBeTruthy();
    expect(escrita!.getAttribute("aria-expanded")).toBe("true");
    expect(historico!.getAttribute("aria-expanded")).toBe("true");

    // Campos-chave do envio — nenhum sumiu no rebuild.
    expect(hospedeiro.querySelector("#push-title")).not.toBeNull();
    expect(hospedeiro.querySelector("#push-body")).not.toBeNull();
    expect(hospedeiro.querySelector("#push-destination")).not.toBeNull();
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Todos os Clientes"),
      ),
    ).toBeTruthy();
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Enviar Notificação Agora"),
      ),
    ).toBeTruthy();

    // Cartão de métrica, interruptor de prova social e ajuda da tela.
    expect(hospedeiro.querySelector("h2.text-3xl")).not.toBeNull();
    expect(
      hospedeiro.querySelector("#realtime-sales-alerts-switch"),
    ).not.toBeNull();
    expect(
      hospedeiro.querySelector('button[title="Ajuda e explicação desta tela"]'),
    ).not.toBeNull();
  });

  it("as seções recolhem e reabrem (o histórico sai e volta da árvore)", async () => {
    await abrirAvisar();

    const historico = cabecalhoDeSecao(
      hospedeiro,
      "Histórico de Mensagens Enviadas",
    )!;
    expect(textoDaTela()).toContain("Não confirmada");

    await act(async () => {
      historico.click();
    });
    await act(async () => {
      await esperar(350); // fim da animação de saída
    });
    expect(historico.getAttribute("aria-expanded")).toBe("false");
    expect(textoDaTela()).not.toContain("Não confirmada");

    await act(async () => {
      historico.click();
    });
    await act(async () => {
      await esperar(50);
    });
    expect(historico.getAttribute("aria-expanded")).toBe("true");
    expect(textoDaTela()).toContain("Não confirmada");
  });

  it("com rascunho não enviado, a seção de escrita não fecha — 'Salve antes de fechar'", async () => {
    await abrirAvisar();

    const campo = hospedeiro.querySelector("#push-title") as HTMLInputElement;
    await digitarEm(campo, "Oferta da semana");
    await act(async () => {
      await esperar(400); // flush do LocalBufferedInput (200 ms)
    });

    expect(textoDaTela()).toMatch(/salve antes de fechar/i);

    const escrita = cabecalhoDeSecao(hospedeiro, "Escrever Nova Notificação")!;
    await act(async () => {
      escrita.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(escrita.getAttribute("aria-expanded")).toBe("true");
    expect(hospedeiro.querySelector("#push-title")).not.toBeNull();
  });
});
