// @vitest-environment jsdom
//
// Desenho SALÃO+PORÃO do lote E (13/09/2026) + painel simples (09/10/2026, E5).
// A tela de Ajustes se organiza em seis grupos (Minha loja / Aparência do app /
// Entrega e frete / Pagamentos / Regras de troca e devolução / Ferramentas).
// O cartão "Como está sua loja" (4 indicadores: Conexão, Pagamento, Frete,
// Atendimento) SAIU: o estado agora é o SUBTÍTULO de cada grupo, calculado
// pela mesma função dos seis passos do Início (`src/lib/loja-pronta.ts`) — e
// o indicador "Conexão" foi para o grupo Ferramentas, junto de "Minha loja
// está no ar?". O PORÃO (consulta rara) fica no pé da tela.
//
// O que este teste fixa:
//   1. O cartão "Como está sua loja" não existe, nem na carga nem depois.
//   2. Minha loja diz "Falta: WhatsApp" (ou "Tudo preenchido"); Pagamentos
//      diz "Na entrega + PIX" / o que estiver ativo; Entrega e frete diz o
//      estado da entrega. Sem config carregada nenhum subtítulo chuta.
//   3. PIX tem 3 níveis (Funcionando / Chave ausente / Desligado) — o
//      crítico de desenho do lote E vetou o "PIX ativo" de 2 rótulos, que
//      diria "ativo" numa loja com a chave ausente (a mentira exata que o
//      laudo 0109 D1 combateu ao criar o termômetro). O nível mora no
//      subtítulo de "Minha loja está no ar?".
//   4. "Conexão" (Online/Offline) mora em Ferramentas.
//   5. Grupos na ordem do desenho; vocabulário novo nos acordeões; velho
//      aposentado.
//   6. Contratos intactos: acordeões nascem FECHADOS (decisão 02/09),
//      onSetDirty somando as pendências, atalhos de vitrine continuam
//      portas role="button" com onNavigate.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
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

// Config zerada por teste, por propriedade (sem índice dinâmico): ausente vale
// "a loja não preencheu" para os subtítulos dos grupos.
function reiniciarConfig() {
  mockConfig.shippingProvider = undefined;
  mockConfig.businessHours = undefined;
  mockConfig.storeName = undefined;
  mockConfig.logoUrl = undefined;
  mockConfig.whatsappNumber = undefined;
  mockConfig.originCep = undefined;
  mockConfig.storeAddress = undefined;
  mockConfig.storeCity = undefined;
  mockConfig.storeState = undefined;
  mockConfig.shippingCoverage = undefined;
  mockConfig.formasPagamentoEntrega = undefined;
}

/** Minha loja preenchida do jeito que a tela grava: marca, endereço e CEP. */
function preencherMarcaEEndereco() {
  mockConfig.storeName = "Loja Teste";
  mockConfig.logoUrl = "https://exemplo.test/logo.png";
  Object.assign(
    mockConfig,
    montarEnderecoDaLoja({
      cep: "38500-000",
      rua: "Rua das Flores",
      numero: "10",
      complemento: "",
      bairro: "Centro",
      cidade: "Monte Carmelo",
      uf: "MG",
    }),
  );
}

describe("Ajustes — o estado mora no subtítulo de cada grupo, sem cartão", () => {
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
    reiniciarConfig();
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

  /** O `<section>` do grupo, achado pelo título (o `<h2>` filho direto). */
  function secaoDoGrupo(titulo: string): Element {
    const secao = [...hospedeiro.querySelectorAll("section")].find(
      (s) => s.querySelector(":scope > h2")?.textContent === titulo,
    );
    expect(secao, `grupo "${titulo}" ausente`).toBeDefined();
    return secao as Element;
  }

  /** A linha de estado sob o título do grupo (o `<p>` filho direto). */
  function subtituloDoGrupo(titulo: string): string | null {
    return (
      secaoDoGrupo(titulo).querySelector(":scope > p")?.textContent ?? null
    );
  }

  function cabecalhoDaSecao(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
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

  it("o cartão 'Como está sua loja' não existe mais — nem o título, nem os rótulos dos 4 indicadores", async () => {
    estadoDeFrete.ligados = ["melhor_envio"];
    estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
    mockConfig.businessHours = "Seg-Sáb: 9h às 18h";
    await renderizar();

    const titulos = [...hospedeiro.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(titulos).not.toContain("Como está sua loja");
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Como está sua loja");
    // "Atendimento" e "Frete" (os rótulos soltos do cartão) não aparecem como
    // tile; o horário salvo não é mais espelhado em Ajustes (mora em Minha loja).
    expect(texto).not.toContain("Atendimento");
    expect(texto).not.toContain("Seg-Sáb: 9h às 18h");
  });

  describe("Minha loja: 'Falta: …' ou 'Tudo preenchido' (mesma função dos seis passos)", () => {
    it("só falta o WhatsApp → 'Falta: WhatsApp'", async () => {
      preencherMarcaEEndereco();
      await renderizar();
      expect(subtituloDoGrupo("Minha loja")).toBe("Falta: WhatsApp");
    });

    it("loja vazia lista tudo o que falta, na ordem dos passos", async () => {
      await renderizar();
      expect(subtituloDoGrupo("Minha loja")).toBe(
        "Falta: Nome e logo, Endereço, WhatsApp",
      );
    });

    it("com marca, endereço e WhatsApp → 'Tudo preenchido'", async () => {
      preencherMarcaEEndereco();
      mockConfig.whatsappNumber = "(34) 99999-9999";
      await renderizar();
      expect(subtituloDoGrupo("Minha loja")).toBe("Tudo preenchido");
    });
  });

  describe("Pagamentos: o que está ativo", () => {
    it("na entrega (as três formas) + PIX pelo app funcionando → 'Na entrega + PIX'", async () => {
      await renderizar();
      expect(subtituloDoGrupo("Pagamentos")).toBe("Na entrega + PIX");
    });

    it("PIX desligado → só 'Na entrega'", async () => {
      mockFlags.pagamentoOnlineLigado.mockReturnValue(false);
      await renderizar();
      expect(subtituloDoGrupo("Pagamentos")).toBe("Na entrega");
    });

    it("sem nada na entrega mas com PIX pelo app → 'PIX'", async () => {
      mockConfig.formasPagamentoEntrega = [];
      await renderizar();
      expect(subtituloDoGrupo("Pagamentos")).toBe("PIX");
    });

    it("sem nada na entrega e sem PIX → 'Falta: Como você recebe'", async () => {
      mockConfig.formasPagamentoEntrega = [];
      mockFlags.pagamentoOnlineLigado.mockReturnValue(false);
      await renderizar();
      expect(subtituloDoGrupo("Pagamentos")).toBe("Falta: Como você recebe");
    });

    it("PIX ligado sem chave e nada na entrega → 'Falta: Como você recebe' (PIX quebrado não é jeito de receber)", async () => {
      mockChave.chavePublicaMercadoPago.mockReturnValue(null);
      mockConfig.formasPagamentoEntrega = [];
      await renderizar();
      expect(subtituloDoGrupo("Pagamentos")).toBe("Falta: Como você recebe");
    });

    it("PIX ligado com a chave ausente NÃO conta como PIX: o subtítulo avisa", async () => {
      mockChave.chavePublicaMercadoPago.mockReturnValue(null);
      await renderizar();
      expect(subtituloDoGrupo("Pagamentos")).toBe("Na entrega · PIX sem chave");
    });
  });

  describe("Entrega e frete: o estado da entrega", () => {
    it("sem CEP da loja e sem transportadora → diz as duas faltas", async () => {
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBe(
        "Falta: CEP da loja, transportadora",
      );
    });

    it("sem CEP mas com transportadora ligada → só 'Falta: CEP da loja'", async () => {
      estadoDeFrete.ligados = ["melhor_envio"];
      estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBe("Falta: CEP da loja");
    });

    it("com CEP e transportadora ligada → diz a entrega local e a transportadora", async () => {
      preencherMarcaEEndereco();
      estadoDeFrete.ligados = ["melhor_envio"];
      estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBe(
        "R$ 10 por entrega · Melhor Envio ligado",
      );
    });

    it("com CEP, entrega nacional e nenhuma transportadora → 'Falta: transportadora'", async () => {
      preencherMarcaEEndereco();
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBe("Falta: transportadora");
    });

    it("loja que só entrega na cidade, com CEP, não precisa de transportadora", async () => {
      preencherMarcaEEndereco();
      mockConfig.shippingCoverage = "local";
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBe(
        "R$ 10 por entrega · Só na sua cidade",
      );
    });

    it("leitura das transportadoras falhou (data nula + erro), com CEP e cobertura nacional → SEM subtítulo, não chuta", async () => {
      preencherMarcaEEndereco();
      invokeFrete.mockImplementation((_nome: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({
            data: null,
            error: { message: "falha de rede de mentira" },
          });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      });
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBeNull();
    });

    it("SuperFrete ligada sem e-mail válido não conta como transportadora ligada", async () => {
      preencherMarcaEEndereco();
      estadoDeFrete.ligados = ["superfrete"];
      estadoDeFrete.provedores = {
        superfrete: { tem_chave: true, contato_email: null },
      };
      await renderizar();
      expect(subtituloDoGrupo("Entrega e frete")).toBe("Falta: transportadora");
    });
  });

  it("grupos sem passo próprio (Aparência, Regras de troca, Ferramentas) não inventam subtítulo", async () => {
    await renderizar();
    expect(subtituloDoGrupo("Aparência do app")).toBeNull();
    expect(subtituloDoGrupo("Regras de troca e devolução")).toBeNull();
    expect(subtituloDoGrupo("Ferramentas")).toBeNull();
  });

  it("'Conexão' mora em Ferramentas, junto de 'Minha loja está no ar?': Online", async () => {
    await renderizar();
    const ferramentas = secaoDoGrupo("Ferramentas");
    expect(ferramentas.textContent).toContain("Conexão");
    expect(ferramentas.textContent).toContain("Online");
    expect(ferramentas.textContent).toContain("Minha loja está no ar?");
    // E só lá: nenhum outro grupo carrega o indicador.
    for (const outro of [
      "Minha loja",
      "Aparência do app",
      "Entrega e frete",
      "Pagamentos",
      "Regras de troca e devolução",
    ]) {
      expect(secaoDoGrupo(outro).textContent).not.toContain("Conexão");
    }
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
      // O nível do PIX mora no cabeçalho de "Minha loja está no ar?" (porão).
      expect(cabecalhoDaSecao("Minha loja está no ar?")?.textContent).toContain(
        `PIX: ${rotulo}`,
      );
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

  it("durante a carga (isLoaded=false) nenhum grupo existe — subtítulo nenhum chuta estado", async () => {
    estadoDeFrete.ligados = ["melhor_envio"];
    estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
    mockStore.isLoaded = false;
    await renderizar();
    expect(hospedeiro.querySelectorAll("section").length).toBe(0);
    expect(hospedeiro.textContent).not.toContain("Falta:");
    expect(hospedeiro.textContent).not.toContain("Melhor Envio");
  });

  it("offline: Conexão diz Offline, em Ferramentas", async () => {
    mockOnline.useOnlineStatus.mockReturnValue(true);
    await renderizar();
    const ferramentas = secaoDoGrupo("Ferramentas").textContent ?? "";
    expect(ferramentas).toContain("Conexão");
    expect(ferramentas).toContain("Offline");
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

  it("os grupos aparecem na ordem do desenho: os seis grupos de Ajustes, sem o cartão de indicadores", async () => {
    await renderizar();
    const titulos = [...hospedeiro.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(titulos).toEqual([
      "Minha loja",
      "Aparência do app",
      "Entrega e frete",
      // Peça 20 (pedido do dono, 14/09): o Mercado Pago vira grupo próprio,
      // ao lado de Entrega e frete e antes do PORÃO (Ferramentas).
      "Pagamentos",
      // Devoluções (plano 2026-09-26): a política de trocas da loja mora
      // num grupo próprio ("Pós-venda" até 09/10/2026), antes do PORÃO.
      "Regras de troca e devolução",
      "Ferramentas",
    ]);
  });

  it("os acordeões usam o vocabulário novo — e o velho saiu", async () => {
    await renderizar();
    const texto = hospedeiro.textContent ?? "";
    // "Nome, logo e cores" e "Atendimento" (acordeões) SAÍRAM em 22/09/2026:
    // eram duplicados de AdminAboutStoreView, que monta a edição de verdade.
    // Desde 09/10/2026 nem o rótulo do indicador "Atendimento" resta aqui.
    for (const novo of [
      "Entrega e frete",
      "Transportadoras",
      "Formas de pagamento",
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
    // de AdminAboutStoreView): sobram Transportadoras, Formas de pagamento
    // (25/09/2026, migration 20261174000000), Mercado Pago, Minha loja está
    // no ar? e Consultas de frete — e, desde o plano 2026-09-26, Trocas e
    // devoluções (grupo Regras de troca e devolução). O acordeão de
    // Entrega e frete virou "Transportadoras" em 09/10/2026.
    expect(cabecalhos.length).toBe(6);
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

  it("linha de estado no cabeçalho: Transportadoras diz 'Ativo: <provedor>' sem abrir", async () => {
    estadoDeFrete.ligados = ["melhor_envio"];
    estadoDeFrete.provedores = { melhor_envio: { tem_chave: true } };
    await renderizar();
    const cabecalho = cabecalhoDaSecao("Transportadoras")!;
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

  it("as portas continuam role=button com onNavigate (20/09: +Sobre a Loja; 09/10: Minha loja e +Entrega e frete)", async () => {
    const onNavigate = vi.fn();
    await renderizar(undefined, onNavigate);

    const portas = [...hospedeiro.querySelectorAll('[role="button"]')];
    expect(portas.length).toBe(4);
    await act(async () => {
      for (const porta of portas) {
        porta.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    const destinos = onNavigate.mock.calls.map((chamada) => chamada[0]);
    expect(destinos).toContain("admin-banners");
    expect(destinos).toContain("admin-carousels");
    expect(destinos).toContain("admin-about-store");
    expect(destinos).toContain("admin-shipping");
  });
});
