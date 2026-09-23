// @vitest-environment jsdom
//
// Desenho SALÃO+PORÃO do lote E (13/09/2026, escolhido pelo Gabriel): a
// tela de Ajustes ganha DUAS camadas. O SALÃO responde "como está?" sem
// clique — o painel de 4 indicadores espelho (Conexão, Pagamento, Frete,
// Atendimento) — e organiza o resto em grupos (Sua loja / Entrega /
// Ferramentas) com títulos na linguagem de gente. O PORÃO (consulta rara)
// fica no pé da tela.
//
// O que este teste fixa:
//   1. O painel mostra os 4 indicadores e cada um diz a verdade do estado.
//      PIX tem 3 níveis (Funcionando / Chave ausente / Desligado) — o
//      crítico de desenho do lote E vetou o "PIX ativo" de 2 rótulos, que
//      diria "ativo" numa loja com a chave ausente (a mentira exata que o
//      laudo 0109 D1 combateu ao criar o termômetro).
//   2. Config parcial/ausente (o campo não veio do banco) não quebra nem
//      inventa: frete cai no MESMO fallback do resto da tela
//      (`|| "flat_fee"`, com ramo para valor fora dos 3 conhecidos),
//      horário vazio após trim = "não informado" ("" não é informado).
//   3. O painel vive DENTRO do ramo isLoaded — durante a carga nenhum
//      indicador pode dizer o estado de uma config que ainda não chegou.
//   4. Grupos na ordem do desenho; vocabulário novo nos acordeões; velho
//      aposentado.
//   5. Contratos intactos: acordeões nascem FECHADOS (decisão 02/09),
//      onSetDirty somando as pendências, atalhos de vitrine continuam
//      portas role="button" com onNavigate.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { View } from "@/types";

const {
  mockConfig,
  mockStore,
  mockFlags,
  mockChave,
  mockOnline,
  estadoDeFrete,
  invokeFrete,
} = vi.hoisted(() => ({
  mockConfig: {} as Record<string, unknown>,
  mockStore: { isLoaded: true, updateConfig: vi.fn(async () => true) },
  mockFlags: { pagamentoOnlineLigado: vi.fn(() => true) },
  mockChave: {
    chavePublicaMercadoPago: vi.fn((): string | null => "APP_USR-prova"),
  },
  mockOnline: { useOnlineStatus: vi.fn(() => false) },
  // RELEASE 1.5.7 v2 (revisão Opus, verificação integrada da hub 22/09):
  // este arquivo era da era de UM provedor (`config.shippingProvider`,
  // StoreContext síncrono). Desde a migração multi-provedor, o indicador
  // de Frete e o subtítulo "Ativo: X" de Ajustes leem
  // `ler_configuracao_frete` pela edge — `estadoDeFrete` é a fonte única
  // que este mock devolve para essa ação. `ligados: []` = equivalente ao
  // antigo `shippingProvider: undefined` (nenhuma transportadora).
  estadoDeFrete: {
    ligados: [] as string[],
    provedores: {} as Record<
      string,
      { tem_chave: boolean; sandbox?: boolean; contato_email?: string | null }
    >,
  },
  invokeFrete: vi.fn(),
}));

function respostaFrete() {
  return {
    success: true,
    modo: estadoDeFrete.ligados.length > 0 ? "multi" : "legado",
    ligados: estadoDeFrete.ligados,
    provedores: {
      melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
      ...Object.fromEntries(
        Object.entries(estadoDeFrete.provedores).map(([p, v]) => [
          p,
          { servicos: null, ...v },
        ]),
      ),
    },
  };
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: mockStore.isLoaded,
    updateConfig: mockStore.updateConfig,
  }),
}));

// As DUAS portas do estado do PIX (o hub importa `pagamentoOnlineLigado`
// de @/lib/flags e `chavePublicaMercadoPago` de @/config/configuracaoDaLoja).
// Spread do módulo real: import nomeado de vizinho não pode sumir do mock.
vi.mock("@/lib/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));
vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  chavePublicaMercadoPago: mockChave.chavePublicaMercadoPago,
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: mockOnline.useOnlineStatus,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeFrete(...args) },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/admin/settings/IdentitySettingsSection", async () => {
  const { useState, useEffect } = await import("react");
  return {
    IdentitySettingsSection: ({
      onDirtyChange,
    }: { onDirtyChange: (value: boolean) => void }) => {
      const [value, setValue] = useState("Loja Teste");
      useEffect(
        () => onDirtyChange(value !== "Loja Teste"),
        [value, onDirtyChange],
      );
      return (
        <input
          id="store-name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

async function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Painel 'Como está sua loja' — salão sem clique", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
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
    // Estado limpo por teste: config parcial por padrão (como no guard
    // porta-de-avisar-clientes, que monta o hub com storeCity/storeState só).
    // Reset por propriedade (sem índice dinâmico): undefined vale ausente
    // para o hub (`|| "flat_fee"`, `?? ""`).
    mockConfig.shippingProvider = undefined;
    mockConfig.businessHours = undefined;
    mockConfig.storeName = undefined;
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue("APP_USR-prova");
    mockOnline.useOnlineStatus.mockReturnValue(false);
    mockStore.isLoaded = true;
    mockStore.updateConfig.mockReset();
    mockStore.updateConfig.mockResolvedValue(true);
    // Equivalente novo de "shippingProvider: undefined": nenhum provedor
    // ligado na edge.
    estadoDeFrete.ligados = [];
    estadoDeFrete.provedores = {};
    invokeFrete.mockReset();
    invokeFrete.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaFrete(), error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
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
  });

  async function renderizar(
    onSetDirty?: (dirty: boolean) => void,
    onNavigate?: (view: View) => void,
  ) {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(
        <AdminSettingsView
          onNavigate={onNavigate ?? vi.fn()}
          active={true}
          onSetDirty={onSetDirty}
        />,
      );
    });
    // RELEASE 1.5.7 v2 (revisão Opus): o indicador de Frete não é mais
    // síncrono do StoreContext — vem de `buscarConfiguracaoDeFrete()`
    // (a edge), que resolve depois de pelo menos um `await` extra. Drena
    // a fila de microtarefas antes de conferir o texto do painel.
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("mostra os 4 indicadores nessa ordem: Conexão, Pagamento, Frete, Atendimento", async () => {
    estadoDeFrete.ligados = ["melhor_envio"];
    estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
    mockConfig.businessHours = "Seg-Sáb: 9h às 18h";
    await renderizar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Como está sua loja");
    const posicoes = ["Conexão", "Pagamento", "Frete", "Atendimento"].map(
      (rotulo) => texto.indexOf(rotulo),
    );
    for (const posicao of posicoes) expect(posicao).toBeGreaterThan(-1);
    expect(posicoes[0]).toBeLessThan(posicoes[1]);
    expect(posicoes[1]).toBeLessThan(posicoes[2]);
    expect(posicoes[2]).toBeLessThan(posicoes[3]);

    // Valores espelho: online, PIX funcionando, frete nomeado, horário salvo.
    expect(texto).toContain("Online");
    expect(texto).toContain("Funcionando");
    expect(texto).toContain("Melhor Envio");
    expect(texto).toContain("Seg-Sáb: 9h às 18h");
  });

  it.each([
    {
      ligado: true,
      chave: "APP_USR-prova" as string | null,
      rotulo: "Funcionando",
    },
    { ligado: true, chave: null, rotulo: "Chave ausente" },
    { ligado: false, chave: null, rotulo: "Desligado" },
  ])(
    "PIX replica o termômetro: ligado=$ligado, chave=$chave → $rotulo",
    async ({ ligado, chave, rotulo }) => {
      mockFlags.pagamentoOnlineLigado.mockReturnValue(ligado);
      mockChave.chavePublicaMercadoPago.mockReturnValue(chave);
      await renderizar();
      expect(hospedeiro.textContent).toContain(rotulo);
    },
  );

  it("nunca diz 'PIX ativo': com a chave ausente o pagamento está QUEBRADO, não ativo", async () => {
    // O rascunho do desenho tinha 2 rótulos ("PIX ativo" / "não configurado").
    // O estado do meio (ligado, chave ausente) derruba esse mapa: o lojista
    // veria "ativo" com o checkout quebrado para o cliente.
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue(null);
    await renderizar();
    expect(hospedeiro.textContent).toContain("Chave ausente");
    expect(hospedeiro.textContent).not.toContain("PIX ativo");
  });

  it("nenhum provedor ligado na edge diz 'Sem cotação automática' (mesmo fallback do resto da tela)", async () => {
    // A prova viva do guard porta-de-avisar-clientes: config parcial chega
    // — ANTES a fonte era `config.shippingProvider` ausente; agora é a
    // edge devolvendo `ligados: []` (o padrão do `beforeEach`).
    await renderizar();
    expect(hospedeiro.textContent).toContain("Sem cotação automática");
  });

  it("provedor ligado fora dos 3 conhecidos também cai no ramo seguro", async () => {
    // Equivalente novo de "shippingProvider fora dos 3 conhecidos": a
    // edge manda um id desconhecido em `ligados` — `buscarConfiguracaoDeFrete`
    // filtra para a união fechada de ProvedorFrete, e o desconhecido some
    // (mesmo efeito prático do fallback antigo).
    estadoDeFrete.ligados = ["correio_galatico"];
    await renderizar();
    expect(hospedeiro.textContent).toContain("Sem cotação automática");
  });

  it("SuperFrete (1.5.4) é provedor conhecido: o indicador diz o nome, não o ramo seguro", async () => {
    estadoDeFrete.ligados = ["superfrete"];
    // E-mail de contato válido: sem ele a SuperFrete vira "incompleta"
    // (achado 2) — este teste quer só provar "nome conhecido", a garantia
    // de incompleta tem teste dedicado logo abaixo.
    estadoDeFrete.provedores = {
      superfrete: {
        tem_chave: true,
        contato_email: "tecnico@loja-ficticia.com.br",
      },
    };
    await renderizar();
    expect(hospedeiro.textContent).toContain("SuperFrete");
    expect(hospedeiro.textContent).not.toContain("Sem cotação automática");
    expect(hospedeiro.textContent).not.toContain("incompleta");
  });

  // ── Achado 2 (revisão Opus, ANOTADO do revisor): uma SuperFrete ligada
  // mas INCOMPLETA (sem e-mail de contato válido) não pode aparecer como
  // se estivesse cotando de verdade neste painel — a mesma verdade que a
  // tela de Frete já conta (FreteNacionalBloco.tsx). ─────────────────────
  it("SuperFrete ligada mas SEM e-mail de contato válido: o indicador diz 'incompleta', não só o nome", async () => {
    estadoDeFrete.ligados = ["superfrete"];
    estadoDeFrete.provedores = {
      superfrete: { tem_chave: true, contato_email: null },
    };
    await renderizar();
    expect(hospedeiro.textContent).toContain("SuperFrete incompleta");
  });

  it.each([null, "   "])(
    "horário %p = 'não informado' (vazio após trim não é informado)",
    async (horario) => {
      mockConfig.businessHours = horario;
      await renderizar();
      expect(hospedeiro.textContent).toContain("não informado");
    },
  );

  it("durante a carga (isLoaded=false) o painel NÃO existe — indicador nenhum chuta estado", async () => {
    estadoDeFrete.ligados = ["melhor_envio"];
    estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
    mockStore.isLoaded = false;
    await renderizar();
    expect(hospedeiro.textContent).not.toContain("Como está sua loja");
    expect(hospedeiro.textContent).not.toContain("Melhor Envio");
  });

  it("offline: Conexão diz Offline", async () => {
    mockOnline.useOnlineStatus.mockReturnValue(true);
    await renderizar();
    expect(hospedeiro.textContent).toContain("Offline");
    expect(hospedeiro.textContent).not.toContain("Online");
  });
});

describe("SALÃO+PORÃO — grupos e vocabulário", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
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
    mockConfig.shippingProvider = undefined;
    mockConfig.businessHours = undefined;
    mockConfig.storeName = undefined;
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue("APP_USR-prova");
    mockOnline.useOnlineStatus.mockReturnValue(false);
    mockStore.isLoaded = true;
    mockStore.updateConfig.mockReset();
    mockStore.updateConfig.mockResolvedValue(true);
    // Equivalente novo de "shippingProvider: undefined": nenhum provedor
    // ligado na edge.
    estadoDeFrete.ligados = [];
    estadoDeFrete.provedores = {};
    invokeFrete.mockReset();
    invokeFrete.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: respostaFrete(), error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
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
  });

  function cabecalhoDaSecao(texto: string) {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;
  }

  async function renderizar(
    onSetDirty?: (dirty: boolean) => void,
    onNavigate?: (view: View) => void,
  ) {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(
        <AdminSettingsView
          onNavigate={onNavigate ?? vi.fn()}
          active={true}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("os grupos aparecem na ordem do desenho: Como está sua loja, Sua loja, Entrega, Ferramentas", async () => {
    await renderizar();
    const titulos = [...hospedeiro.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(titulos).toEqual([
      "Como está sua loja",
      "Sua loja",
      "Entrega",
      // Peça 20 (pedido do dono, 14/09): o Mercado Pago vira grupo próprio,
      // ao lado de Entrega e antes do PORÃO (Ferramentas).
      "Pagamentos",
      "Ferramentas",
    ]);
  });

  it("os acordeões usam o vocabulário novo — e o velho saiu", async () => {
    await renderizar();
    const texto = hospedeiro.textContent ?? "";
    // "Nome, logo e cores" e "Atendimento" (o acordeão, não o rótulo do
    // indicador-espelho) SAÍRAM em 22/09/2026: eram duplicados de
    // AdminAboutStoreView, que monta a edição de verdade. "Atendimento"
    // continua aparecendo — é o rótulo do indicador em "Como está sua
    // loja" — mas não é mais cabeçalho de acordeão (provado no teste de
    // contagem abaixo).
    for (const novo of [
      "Entrega e frete",
      "Mercado Pago",
      "Minha loja está no ar?",
      "Consultas de frete",
    ]) {
      expect(texto).toContain(novo);
    }
    for (const velho of [
      "Identidade da loja",
      "Nome, logo e cores",
      "Status de funcionamento do sistema",
      "Transportadoras e cotação de frete",
      "Histórico de cotações de frete",
      "Design & Vitrine",
    ]) {
      expect(texto).not.toContain(velho);
    }
  });

  it("os acordeões nascem FECHADOS (decisão do dono, 02/09 — peça deliberada)", async () => {
    await renderizar();
    const cabecalhos = [
      ...hospedeiro.querySelectorAll("button[aria-expanded]"),
    ];
    // "Nome, logo e cores" e "Atendimento" SAÍRAM em 22/09/2026 (duplicados
    // de AdminAboutStoreView): sobram Entrega e frete, Mercado Pago, Minha
    // loja está no ar? e Consultas de frete.
    expect(cabecalhos.length).toBe(4);
    for (const cabecalho of cabecalhos) {
      expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
    }
    // Os campos de identidade/horário nem existem mais nesta tela (não é
    // "fechado", é ausente).
    expect(hospedeiro.querySelector("#store-business-hours")).toBeNull();
    expect(hospedeiro.querySelector("#store-name")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Pagamento online (PIX)");
    expect(hospedeiro.querySelector("table")).toBeNull();
  });

  it("linha de estado no cabeçalho: Entrega e frete diz 'Ativo: <provedor>' sem abrir", async () => {
    estadoDeFrete.ligados = ["melhor_envio"];
    estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
    await renderizar();
    const cabecalho = cabecalhoDaSecao("Entrega e frete")!;
    expect(cabecalho).toBeTruthy();
    expect(cabecalho.textContent).toContain("Ativo: Melhor Envio");
  });

  // As pendências de horário e identidade SAÍRAM da soma de onSetDirty
  // desta tela em 22/09/2026, junto com os acordeões: os dois editores
  // moram só em AdminAboutStoreView agora, e a pendência deles é somada
  // por ELA (provado em admin-sobre-a-loja-salva-sem-apagar.test.tsx e em
  // admin-settings-identidade-da-loja.test.tsx). onSetDirty desta tela
  // continua somando transportadoras + pagamentos (inalterado, sem teste
  // dedicado aqui: cobertos pelos vizinhos de cada seção).

  it("atalhos de vitrine continuam portas role=button com onNavigate (20/09: +Sobre a Loja)", async () => {
    const onNavigate = vi.fn();
    await renderizar(undefined, onNavigate);

    const portas = [...hospedeiro.querySelectorAll('[role="button"]')];
    expect(portas.length).toBe(3);
    await act(async () => {
      for (const porta of portas) {
        porta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    const destinos = onNavigate.mock.calls.map((chamada) => chamada[0]);
    expect(destinos).toContain("admin-banners");
    expect(destinos).toContain("admin-carousels");
    expect(destinos).toContain("admin-about-store");
  });
});
