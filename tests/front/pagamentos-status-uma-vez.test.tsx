// @vitest-environment jsdom
//
// Painel simples, H6 (onda 4, frente A; P2 aprovada): o estado do PIX pelo
// app aparece UMA vez em Ajustes. Antes eram quatro lugares contando o mesmo
// dinheiro: o subtítulo "PIX: …" e o termômetro dentro de "Minha loja está no
// ar?", o "+ app" e a linha "Ligado/Desligado" de "Formas de pagamento" e o
// "Pix liberado no app" do bloco do Mercado Pago. Agora:
//   S1  o termômetro mora no TOPO do grupo Pagamentos e é o único status —
//       nem com todas as seções abertas o rótulo aparece duas vezes;
//   S2  "Formas de pagamento" perde o "+ app"; a linha do pagamento pelo app
//       vira só um atalho para o Mercado Pago, sem estado;
//   S3  "Minha loja está no ar?" mostra só a conexão e um atalho para
//       Pagamentos, que abre a seção do Mercado Pago;
//   S4  o bloco do Mercado Pago fica com Pausar/Retomar e a lista do que
//       falta, sem repetir "Pix liberado";
//   S5  "Como pegar suas chaves" e "Suas chaves" moram em "Avançado: chaves
//       do Mercado Pago" — montado (escondido) e aberto sozinho quando falta
//       alguma coisa;
//   S6  nenhuma chamada a `credenciais-mercado-pago` muda: o `ler` do mount
//       segue sendo `{ acao: "ler" }`, e Pausar segue sendo `desligar_pix`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

const { invokeFalso, cenario, mockFlags, mockChave, chamadas } = vi.hoisted(
  () => ({
    invokeFalso: vi.fn(),
    cenario: {
      salvo: {} as Record<string, unknown>,
      respostaPausar: {} as Record<string, unknown>,
    },
    mockFlags: { pagamentoOnlineLigado: vi.fn(() => true) },
    mockChave: {
      chavePublicaMercadoPago: vi.fn((): string | null => PUBLICA_FALSA),
    },
    chamadas: [] as { nome: string; corpo: Record<string, unknown> }[],
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));
vi.mock("@/lib/flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));
vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  chavePublicaMercadoPago: mockChave.chavePublicaMercadoPago,
  pagamentoOnlineLigado: mockFlags.pagamentoOnlineLigado,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CONECTADO = {
  quando: new Date().toISOString(),
  conectado: true,
  mensagem: 'Conectado! Conta "Loja Teste" no ambiente de produção.',
  ambiente: "producao",
  conta: "Loja Teste",
};

/** Loja recebendo pelo app: três chaves salvas, teste passou. */
const RECEBENDO = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: "••••7777",
  ultimo_teste: CONECTADO as unknown,
  atualizado_em: new Date().toISOString(),
  pix_ligado: true,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

/** O rótulo do termômetro (3 níveis): o "status do PIX". */
const ROTULO_DO_PIX = /Funcionando|Chave ausente|Desligado/g;

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
  Element.prototype.scrollIntoView = vi.fn();
  chamadas.length = 0;
  cenario.salvo = { ...RECEBENDO };
  cenario.respostaPausar = {
    pix_ligado: false,
    pausado: true,
    faltando: [],
    public_key_na_loja: true,
  };
  mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
  mockChave.chavePublicaMercadoPago.mockReturnValue(PUBLICA_FALSA);
  invokeFalso.mockImplementation(
    async (nome: string, opcoes: { body?: Record<string, unknown> }) => {
      const corpo = opcoes?.body ?? {};
      chamadas.push({ nome, corpo });
      if (corpo.acao === "ler") return { data: cenario.salvo, error: null };
      if (corpo.acao === "desligar_pix")
        return { data: cenario.respostaPausar, error: null };
      return { data: null, error: null };
    },
  );
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

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function botaoPorTexto(trecho: string): HTMLButtonElement {
  const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(trecho),
  );
  if (!botao) throw new Error(`Botão "${trecho}" não está na tela.`);
  return botao as HTMLButtonElement;
}

function cabecalhoDaSecao(titulo: string): HTMLButtonElement {
  const botao = [...hospedeiro.querySelectorAll("button[aria-expanded]")].find(
    (b) => b.textContent?.includes(titulo),
  );
  if (!botao) throw new Error(`Seção "${titulo}" não está na tela.`);
  return botao as HTMLButtonElement;
}

async function clicar(elemento: HTMLElement) {
  await act(async () => {
    elemento.click();
  });
  await assentar();
}

function grupo(titulo: string): HTMLElement {
  const secao = [...hospedeiro.querySelectorAll("section")].find(
    (s) => s.querySelector(":scope > h2")?.textContent === titulo,
  );
  if (!secao) throw new Error(`Grupo "${titulo}" não está na tela.`);
  return secao as HTMLElement;
}

async function renderizarAjustes() {
  const { AdminSettingsView } = await import("@/views/admin/AdminSettingsView");
  await act(async () => {
    raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
  });
  await assentar();
}

/** Abre as três seções que já contaram o estado do PIX. */
async function abrirTudo() {
  await clicar(cabecalhoDaSecao("Formas de pagamento"));
  await clicar(cabecalhoDaSecao("Mercado Pago"));
  // Mercado Pago é lazy: espera o import assentar.
  for (
    let i = 0;
    i < 50 && !hospedeiro.querySelector("[data-estado-recebimento]");
    i++
  ) {
    await assentar();
  }
  await clicar(cabecalhoDaSecao("Minha loja está no ar?"));
}

describe("Ajustes — o status do PIX aparece uma vez", () => {
  it("S1 — o termômetro mora no topo de Pagamentos, antes de qualquer seção", async () => {
    await renderizarAjustes();

    const pagamentos = grupo("Pagamentos");
    const termometro = [...pagamentos.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pagamento online (PIX)"),
    );
    expect(termometro, "termômetro fora de Pagamentos").toBeDefined();
    expect(termometro!.textContent).toContain("Funcionando");
    // Topo: vem antes do primeiro acordeão do grupo (Formas de pagamento).
    const formas = cabecalhoDaSecao("Formas de pagamento");
    expect(
      termometro!.compareDocumentPosition(formas) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // E só ele: o rótulo do PIX não aparece em mais lugar nenhum.
    expect(hospedeiro.textContent?.match(ROTULO_DO_PIX)).toHaveLength(1);
  });

  it("S1/S2/S3/S4 — com todas as seções abertas, o status continua aparecendo uma vez só", async () => {
    await renderizarAjustes();
    await abrirTudo();

    const texto = hospedeiro.textContent ?? "";
    expect(texto.match(ROTULO_DO_PIX)).toHaveLength(1);
    expect(texto.match(/Pagamento online \(PIX\)/g)).toHaveLength(1);
    expect(texto).not.toContain("PIX: ");
    expect(texto).not.toContain("Pix liberado");
    // S2: o subtítulo de Formas de pagamento não fala do app.
    expect(cabecalhoDaSecao("Formas de pagamento").textContent).not.toContain(
      "app",
    );
  });

  it("S2 — a linha do pagamento pelo app em Formas de pagamento é só um atalho, sem estado", async () => {
    await renderizarAjustes();
    await clicar(cabecalhoDaSecao("Formas de pagamento"));

    const atalho = botaoPorTexto("Configurar credenciais");
    const linha = atalho.parentElement as HTMLElement;
    expect(linha.textContent).toContain("Pagar pelo app (PIX)");
    expect(linha.textContent).not.toMatch(/Ligado|Desligado/);

    await clicar(atalho);
    expect(cabecalhoDaSecao("Mercado Pago").getAttribute("aria-expanded")).toBe(
      "true",
    );
    // Cai direto nos campos das chaves (lazy: espera o import assentar).
    for (
      let i = 0;
      i < 50 && !hospedeiro.querySelector("#mp-public-key");
      i++
    ) {
      await assentar();
    }
    const campo = hospedeiro.querySelector("#mp-public-key");
    expect(campo, "campos das chaves não abriram").not.toBeNull();
    expect(campo!.closest("[hidden]")).toBeNull();
  });

  it("S3 — 'Minha loja está no ar?' mostra a conexão e um atalho para Pagamentos, que abre o Mercado Pago", async () => {
    await renderizarAjustes();

    const noAr = cabecalhoDaSecao("Minha loja está no ar?");
    expect(noAr.textContent).not.toMatch(/PIX/);
    await clicar(noAr);

    const ferramentas = grupo("Ferramentas");
    expect(ferramentas.textContent).toContain("Diagnóstico de Conexão");
    expect(ferramentas.textContent).not.toContain("Pagamento online (PIX)");

    const atalho = [...ferramentas.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver o PIX em Pagamentos"),
    );
    expect(atalho, "atalho para Pagamentos ausente").toBeDefined();
    await clicar(atalho!);
    expect(cabecalhoDaSecao("Mercado Pago").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("S4/S6 — Pausar continua no bloco do Mercado Pago, chama a mesma ação e o termômetro acompanha", async () => {
    await renderizarAjustes();
    await abrirTudo();

    const bloco = hospedeiro.querySelector(
      "[data-estado-recebimento]",
    ) as HTMLElement;
    expect(bloco.getAttribute("data-estado-recebimento")).toBe("recebendo");
    expect(bloco.textContent).not.toContain("Pix liberado");
    expect(
      chamadas.find(
        (c) => c.nome === "credenciais-mercado-pago" && c.corpo.acao === "ler",
      )?.corpo,
    ).toEqual({ acao: "ler" });

    await clicar(botaoPorTexto("Pausar"));

    const pausar = chamadas.find((c) => c.corpo.acao === "desligar_pix");
    expect(pausar?.nome).toBe("credenciais-mercado-pago");
    expect(pausar?.corpo).toEqual({ acao: "desligar_pix" });
    const termometro = [...grupo("Pagamentos").querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Pagamento online (PIX)"),
    );
    expect(termometro?.textContent).toContain("Desligado");
    expect(hospedeiro.textContent?.match(ROTULO_DO_PIX)).toHaveLength(1);
  });
});

describe("MercadoPagoSection — as chaves em 'Avançado: chaves do Mercado Pago'", () => {
  async function montarSecao() {
    const { MercadoPagoSection } = await import(
      "@/components/admin/settings/MercadoPagoSection"
    );
    await act(async () => {
      raiz.render(<MercadoPagoSection />);
    });
    await assentar();
  }

  function camadaAberta(titulo: string): boolean {
    const botao = [
      ...hospedeiro.querySelectorAll("button[aria-expanded]"),
    ].find((b) => b.textContent?.includes(titulo));
    if (!botao) throw new Error(`Camada "${titulo}" ausente.`);
    return botao.getAttribute("aria-expanded") === "true";
  }

  function avancado(): HTMLElement {
    const secao = hospedeiro.querySelector(
      'section[aria-label="Avançado: chaves do Mercado Pago"]',
    );
    if (!secao) throw new Error("Seção Avançado ausente.");
    return secao as HTMLElement;
  }

  it("S5 — sem pendência: Avançado nasce fechado, mas montado, com o guia e as chaves dentro", async () => {
    cenario.salvo = { ...RECEBENDO };
    await montarSecao();

    const secao = avancado();
    const cabecalho = secao.querySelector(
      ":scope > button[aria-expanded]",
    ) as HTMLButtonElement;
    expect(cabecalho.getAttribute("aria-expanded")).toBe("false");
    const nomes = [...secao.querySelectorAll("button[aria-expanded]")].map(
      (b) => b.textContent ?? "",
    );
    expect(nomes.some((n) => n.includes("Como pegar suas chaves"))).toBe(true);
    expect(nomes.some((n) => n.includes("Suas chaves"))).toBe(true);
    // O estado do recebimento (Pausar) fica FORA do Avançado, à vista.
    const bloco = hospedeiro.querySelector("[data-estado-recebimento]");
    expect(bloco).not.toBeNull();
    expect(secao.contains(bloco)).toBe(false);
    expect(botaoPorTexto("Pausar")).toBeDefined();
  });

  it("S5 — com pendência (falta a senha dos avisos), Avançado abre sozinho e a lista do que falta fica à vista", async () => {
    cenario.salvo = {
      ...RECEBENDO,
      pix_ligado: false,
      mascara_webhook: null,
      faltando: ["chave_notificacoes"],
    };
    await montarSecao();

    const cabecalho = avancado().querySelector(
      ":scope > button[aria-expanded]",
    ) as HTMLButtonElement;
    expect(cabecalho.getAttribute("aria-expanded")).toBe("true");
    const bloco = hospedeiro.querySelector(
      "[data-estado-recebimento]",
    ) as HTMLElement;
    expect(bloco.textContent).toContain("Falta para receber pelo app:");
    expect(bloco.textContent).toContain("colar a senha dos avisos");
    // "Suas chaves" abre junto: o conserto (campos e Testar conexão) fica à
    // mão, sem um clique a mais.
    expect(camadaAberta("Suas chaves")).toBe(true);
    expect(hospedeiro.querySelector("#mp-webhook-secret")).not.toBeNull();
    const testar = [...avancado().querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Testar conexão"),
    );
    expect(testar, "Testar conexão fora do alcance").toBeDefined();
    expect(testar!.closest("[hidden]")).toBeNull();
  });

  it("S5 — tudo preenchido e desligado: Avançado e 'Suas chaves' abrem com o Testar conexão à mão", async () => {
    cenario.salvo = { ...RECEBENDO, pix_ligado: false };
    await montarSecao();

    expect(
      hospedeiro
        .querySelector(
          'section[aria-label="Avançado: chaves do Mercado Pago"] > button[aria-expanded]',
        )
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(camadaAberta("Suas chaves")).toBe(true);
    const testar = [...avancado().querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Testar conexão"),
    );
    expect(testar?.closest("[hidden]")).toBeNull();
  });

  it("S5 — o atalho 'Configurar credenciais' (gatilho) abre direto os campos, mesmo sem pendência", async () => {
    cenario.salvo = { ...RECEBENDO };
    const { MercadoPagoSection } = await import(
      "@/components/admin/settings/MercadoPagoSection"
    );
    await act(async () => {
      raiz.render(<MercadoPagoSection abrirChavesGatilho={1} />);
    });
    await assentar();

    expect(
      avancado()
        .querySelector(":scope > button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(camadaAberta("Suas chaves")).toBe(true);
    const campo = hospedeiro.querySelector("#mp-public-key");
    expect(campo).not.toBeNull();
    expect(campo!.closest("[hidden]")).toBeNull();
  });
});
