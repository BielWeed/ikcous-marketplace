// @vitest-environment jsdom
//
// Frente glm-visual-canais-avisar-0309 (ondas 2 e 3 do rebuild visual do
// painel): as telas "Canais de Atendimento" (AdminWhatsAppConfigView) e
// "Avisar clientes" (AdminPushView) entraram na MESMA CASCA premium do
// rebuild do Frete (PR #414) — AdminPageHeader no topo, zero <h1> manual e
// conteúdo em seções colapsáveis no padrão dos Ajustes. Depois, na frente
// lote-b-telas-admin (12/09), o Atendimento SAIU do colapso: virou
// FORMULÁRIO DIRETO (direção B aprovada pelo dono) — três blocos numerados,
// todos abertos. No Avisar clientes (T2, mesma direção B) a COMPOSIÇÃO saiu
// do colapso junto — virou o cartão fixo "No ar agora" — e o histórico e os
// Ajustes seguem colapsáveis.
//
// A REGRA DE OURO da frente: muda a casa, não o morador. Por isso o contrato
// prende, para cada tela:
//   1. A CASCA — AdminPageHeader usado, nenhum <h1> copiado na mão (Parte 1,
//      contrato de fonte por glob);
//   2. O MORADOR — os campos-chave continuam na árvore (nenhum campo sumiu).
//      No Atendimento, o editor nasce montado com o texto salvo e NADA do
//      que o lojista digitou se perde: sem seção que desmonta, o sinal de
//      alteração não salva (onSetDirty) segue vivo para o App. No Avisar
//      clientes é igual: a composição é cartão fixo, e o sinal de rascunho
//      (onSetDirty) é guarda de navegação — nada na tela desmonta o
//      formulário.
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
async function abrirCanais(aoSujar?: (dirty: boolean) => void) {
  const { AdminWhatsAppConfigView } = await import(
    "@/views/admin/AdminWhatsAppConfigView"
  );
  await act(async () => {
    raiz.render(
      <AdminWhatsAppConfigView active={true} onSetDirty={aoSujar ?? vi.fn()} />,
    );
  });
  await act(async () => {
    await esperar(50);
  });
}

describe("Canais de Atendimento — o formulário direto guarda o morador", () => {
  it("nasce no título padrão, com os três blocos abertos e todos os campos à vista", async () => {
    await abrirCanais();

    // Título padrão (AdminPageHeader), não um h1 avulso.
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Atendimento");

    // Formulário direto: zero controle de colapso nesta tela.
    expect(hospedeiro.querySelectorAll("button[aria-expanded]")).toHaveLength(
      0,
    );

    // Os três blocos à vista de uma vez — nada nasce escondido.
    expect(hospedeiro.querySelector("#settings-whatsapp")).not.toBeNull();
    expect(hospedeiro.querySelector("#settings-business-hours")).not.toBeNull();
    expect(
      hospedeiro.querySelector("#settings-share-message-editor"),
    ).not.toBeNull();

    // O botão Salvar continua na linha do título.
    const salvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Salvar"),
    );
    expect(salvar).toBeTruthy();
  });

  it("o editor nasce montado JÁ com o texto salvo (com os chips de tag)", async () => {
    await abrirCanais();

    // Sem seção para expandir: o editor vive direto na árvore.
    const editor = hospedeiro.querySelector(
      "#settings-share-message-editor",
    ) as HTMLDivElement | null;
    expect(editor).not.toBeNull();
    // O shareText salvo ("Confira [nome] por [preco]: [link]") vira chips
    // dentro do editor — prova de que o conteúdo não nasce vazio.
    expect(editor!.innerHTML).toContain('data-tag="nome"');
    expect(editor!.innerHTML).toContain('data-tag="preco"');
    expect(editor!.innerHTML).toContain('data-tag="link"');

    // Os botões de tag e o atalho de modelos continuam na árvore.
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Nome do Produto"),
      ),
    ).toBeTruthy();
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Modelos prontos"),
      ),
    ).toBeTruthy();
  });

  it("nada do que o lojista digitou se perde: sem colapso, nada desmonta", async () => {
    await abrirCanais();

    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    await digitarEm(campo, "1198765432");
    await act(async () => {
      await esperar(500); // flush do LocalBufferedInput (350 ms)
    });

    // Era o guarda "fechar e reabrir não perde o texto", reancorado: sem
    // seção que desmonta, o editor continua com o texto salvo e o campo,
    // com o que foi digitado (já com a máscara aplicada).
    const editor = hospedeiro.querySelector(
      "#settings-share-message-editor",
    ) as HTMLDivElement;
    expect(editor.innerHTML).toContain('data-tag="nome"');
    expect(
      (hospedeiro.querySelector("#settings-whatsapp") as HTMLInputElement)
        .value,
    ).toBe("(11) 9876-5432");
  });

  it("com alteração não salva, o sinal para o App (onSetDirty) segue de pé — e o aviso de fechar saiu com o colapso", async () => {
    const aoSujar = vi.fn();
    await abrirCanais(aoSujar);

    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    await digitarEm(campo, "1198765432");
    await act(async () => {
      await esperar(500); // flush do LocalBufferedInput (350 ms)
    });

    // O App continua sabendo que há trabalho não salvo — é ele quem avisa
    // antes do texto se perder na navegação.
    expect(aoSujar).toHaveBeenLastCalledWith(true);

    // A frase "Salve antes de fechar" morava no cabeçalho da seção: sem
    // seção não há como fechá-la, e a frase sai junto com o colapso.
    expect(textoDaTela()).not.toMatch(/salve antes de fechar/i);
  });
});

// ── Parte 3: Avisar clientes (AdminPushView) ───────────────────────────────
async function abrirAvisar(aoSujar?: (dirty: boolean) => void) {
  const { AdminPushView } = await import("@/views/admin/AdminPushView");
  await act(async () => {
    raiz.render(
      <AdminPushView onNavigate={vi.fn()} onSetDirty={aoSujar ?? vi.fn()} />,
    );
  });
  await act(async () => {
    await esperar(50);
  });
}

// Rótulos reancorados (12/09): a direção B da tela de Notificações (frente
// T2) renomeou as seções — "No ar agora" (composição), "O que já foi ao ar"
// (histórico) e uma terceira, "Ajustes", que nasce FECHADA e abriga o
// interruptor de prova social. E o colapso da composição saiu (revisão do
// lote B): ela é cartão FIXO — "painel único aceso, nada escondido" —; só
// histórico e Ajustes recolhem e reabrem. Rascunho pendente sinaliza ao
// App (onSetDirty), nunca trava colapso.
describe("Avisar clientes — a casca nova guarda o morador", () => {
  it("nasce no título padrão, com composição e histórico visíveis na árvore", async () => {
    await abrirAvisar();

    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Enviar Notificações",
    );

    // A composição é cartão FIXO: zero controle de colapso para ela — o
    // conteúdo (os campos, logo abaixo) está na árvore sem interação
    // nenhuma. O histórico segue colapsável e nasce aberto.
    expect(cabecalhoDeSecao(hospedeiro, "No ar agora")).toBeUndefined();
    const historico = cabecalhoDeSecao(hospedeiro, "O que já foi ao ar");
    expect(historico).toBeTruthy();
    expect(historico!.getAttribute("aria-expanded")).toBe("true");

    // Campos-chave do envio — nenhum sumiu no redesenho.
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
        (b.textContent ?? "").includes("Enviar agora para"),
      ),
    ).toBeTruthy();

    // Cartão de métrica e ajuda da tela.
    expect(hospedeiro.querySelector("h2.text-3xl")).not.toBeNull();
    expect(
      hospedeiro.querySelector('button[title="Ajuda e explicação desta tela"]'),
    ).not.toBeNull();

    // O interruptor de prova social mora na seção "Ajustes", que nasce
    // FECHADA — expandir para prová-lo na árvore.
    const ajustes = cabecalhoDeSecao(hospedeiro, "Ajustes");
    expect(ajustes).toBeTruthy();
    expect(ajustes!.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      ajustes!.click();
    });
    await act(async () => {
      await esperar(50);
    });
    expect(
      hospedeiro.querySelector("#realtime-sales-alerts-switch"),
    ).not.toBeNull();
  });

  it("o histórico recolhe e reabre (o conteúdo sai e volta da árvore) — e a composição é fixa", async () => {
    await abrirAvisar();

    const historico = cabecalhoDeSecao(hospedeiro, "O que já foi ao ar")!;
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

    // A composição NÃO é recolhível — cartão fixo: sem controle de colapso,
    // o campo nunca sai da árvore (o recolher/reabrir vale só para o
    // histórico e os Ajustes).
    expect(cabecalhoDeSecao(hospedeiro, "No ar agora")).toBeUndefined();
    expect(hospedeiro.querySelector("#push-title")).not.toBeNull();
  });

  it("com rascunho pendente, a composição continua na árvore — e o sinal para o App segue de pé", async () => {
    const aoSujar = vi.fn();
    await abrirAvisar(aoSujar);

    const campo = hospedeiro.querySelector("#push-title") as HTMLInputElement;
    await digitarEm(campo, "Oferta da semana");
    await act(async () => {
      await esperar(400); // flush do LocalBufferedInput (200 ms)
    });

    // A guarda real é de navegação: o App fica sabendo que há rascunho.
    expect(aoSujar).toHaveBeenLastCalledWith(true);

    // A frase "Salve antes de fechar" morava no cabeçalho da seção: sem
    // seção não há o que fechar, e a frase sai junto (mesmo raciocínio do
    // Atendimento, na Parte 2).
    expect(textoDaTela()).not.toMatch(/salve antes de fechar/i);

    // E a composição segue inteira na árvore, com o rascunho no campo.
    expect(cabecalhoDeSecao(hospedeiro, "No ar agora")).toBeUndefined();
    expect(hospedeiro.querySelector("#push-title")).not.toBeNull();
    expect(
      (hospedeiro.querySelector("#push-title") as HTMLInputElement).value,
    ).toBe("Oferta da semana");
  });
});
