// @vitest-environment jsdom
//
// Tarefa mp-9 (16/09/2026) — a MESMA tela de Ajustes mostrava DOIS estados
// do PIX depois de mexer no interruptor "Receber PIX no app".
//
// O que acontecia: `pagamentoOnlineLigado()` é o retrato SÍNCRONO da ficha
// injetada no BOOT da página; o interruptor da seção Mercado Pago escreve
// `store_config.pagamento_online` pela edge. Sem eco entre os dois, o tile
// "Pagamento" do painel "Como está sua loja", o subtítulo "PIX: …" e o
// termômetro de "Minha loja está no ar?" continuavam com o valor ANTIGO até
// um recarregamento completo — enquanto a própria seção já dizia ao lojista
// "Pronto. A vitrine passa a refletir em até 1 minuto".
//
// O que este arquivo prova, sem nenhum remount:
//   P0  (mp-10) o `ler` que a seção dispara sozinha ao ABRIR também ecoa
//       para o painel — sem clicar em nada. Sem isso, um boot desatualizado
//       (a ficha mudou por fora entre o boot da página e abrir esta seção)
//       deixava o painel MENTINDO até o lojista mexer no interruptor.
//   P1  ligar o interruptor acende o painel inteiro na mesma sessão;
//   P2  desligar apaga o painel inteiro na mesma sessão;
//   P3  salvar uma credencial NOVA (a edge devolve `pix_desligado`) também
//       apaga o painel — o servidor desligou o PIX, a tela não pode seguir
//       dizendo "Funcionando".
//
// Padrão dos vizinhos (admin-ajustes-salao-e-porao.test.tsx): createRoot +
// act do React puro, dependências de fora mockadas, a edge
// credenciais-mercado-pago é DUBLÊ e as chaves são FALSAS de mentira.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

type Chamada = { nome: string; corpo: Record<string, unknown> };
const chamadas: Chamada[] = [];

const { invokeFalso, cenario, mockFlags, mockChave } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: {
    salvo: {} as Record<string, unknown>,
    respostaLigar: {} as Record<string, unknown>,
    respostaDesligar: {} as Record<string, unknown>,
    respostaSalvar: {} as Record<string, unknown>,
  },
  mockFlags: { pagamentoOnlineLigado: vi.fn(() => false) },
  mockChave: {
    chavePublicaMercadoPago: vi.fn((): string | null => PUBLICA_FALSA),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(
  async (nome: string, opcoes: { body?: Record<string, unknown> }) => {
    const corpo = opcoes?.body ?? {};
    chamadas.push({ nome, corpo });
    if (corpo.acao === "ler") return { data: cenario.salvo, error: null };
    if (corpo.acao === "ligar_pix")
      return { data: cenario.respostaLigar, error: null };
    if (corpo.acao === "desligar_pix")
      return { data: cenario.respostaDesligar, error: null };
    if (corpo.acao === "salvar")
      return { data: cenario.respostaSalvar, error: null };
    return { data: null, error: null };
  },
);

// As DUAS portas do estado do PIX no hub (mesmo mock do vizinho
// admin-ajustes-salao-e-porao): a flag do boot e a chave pública da ficha.
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

const CONFIGURADO = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: null,
  ultimo_teste: CONECTADO as unknown,
  atualizado_em: new Date().toISOString(),
  pix_ligado: false,
  public_key_na_loja: true,
};

describe("Ajustes — o painel do PIX acompanha o interruptor sem recarregar", () => {
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
    chamadas.length = 0;
    cenario.salvo = { ...CONFIGURADO };
    cenario.respostaLigar = { pix_ligado: true };
    cenario.respostaDesligar = { pix_ligado: false };
    cenario.respostaSalvar = { ...CONFIGURADO };
    mockFlags.pagamentoOnlineLigado.mockReturnValue(false);
    mockChave.chavePublicaMercadoPago.mockReturnValue(PUBLICA_FALSA);
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

  async function clicar(elemento: HTMLElement) {
    await act(async () => {
      elemento.click();
    });
    await assentar();
  }

  function interruptorDoPix(): HTMLButtonElement {
    const alvo = hospedeiro.querySelector(
      '[role="switch"][aria-label="Receber PIX no app"]',
    );
    if (!alvo)
      throw new Error('O interruptor "Receber PIX no app" não está na tela.');
    return alvo as HTMLButtonElement;
  }

  /** Abre Pagamentos > Mercado Pago > Suas chaves, onde mora o interruptor. */
  async function abrirOInterruptor() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await assentar();
    await clicar(botaoPorTexto("Mercado Pago"));
    // A seção é lazy: espera o import dinâmico assentar antes de procurar
    // o expansor interno.
    await assentar();
    await clicar(botaoPorTexto("Suas chaves"));
  }

  /** O termômetro mora dentro do porão "Minha loja está no ar?", que nasce
   * fechado (decisão do dono, 02/09) e só monta ao abrir. */
  async function abrirOTermometro() {
    await clicar(botaoPorTexto("Minha loja está no ar?"));
  }

  it("P0 — abrir a seção com o boot desatualizado corrige o painel pelo que o `ler` devolveu, sem clicar em nada", async () => {
    // O retrato do BOOT (a ficha injetada na página) diz "ligado", mas o
    // servidor — o que `ler` traz ao abrir a seção — já está desligado:
    // cenário real de alguém ter mudado a ficha por outro caminho (SQL,
    // outra aba) depois do boot desta página. Sem o eco do `ler`, o painel
    // ficava preso no retrato velho até um F5 completo, exatamente o
    // problema que este arquivo inteiro existe para fechar.
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    cenario.salvo = { ...CONFIGURADO, pix_ligado: false };
    await abrirOInterruptor();

    expect(hospedeiro.textContent).toContain("PIX: Desligado");
    expect(hospedeiro.textContent).not.toContain("PIX: Funcionando");
  });

  it("P0b — abrir a seção com o PIX ligado mas a Public Key ausente da ficha NÃO acende o painel (achado BLOQUEIA da revisão)", async () => {
    // O MESMO estado que o X6 deste repo já modela (MercadoPagoSection):
    // `store_config.pagamento_online = true` com `mp_public_key` ausente —
    // o checkout de PIX nem carrega. Retrato do BOOT já correto ("Chave
    // ausente", porque `chavePublicaMercadoPago()` é nula); o bug era o eco
    // do `ler` mandando só `pix_ligado: true` e o painel inferindo "ligado
    // -> chave OK" (inferência válida para `ligar_pix`/`salvar`, que a edge
    // só acende com a chave publicada JUNTO, mas NÃO para `ler`, que devolve
    // o retrato cru da ficha).
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    mockChave.chavePublicaMercadoPago.mockReturnValue(null);
    cenario.salvo = {
      ...CONFIGURADO,
      pix_ligado: true,
      public_key_na_loja: false,
    };
    await abrirOInterruptor();

    expect(hospedeiro.textContent).toContain("PIX: Chave ausente");
    expect(hospedeiro.textContent).not.toContain("PIX: Funcionando");
  });

  it("P1 — ligar o interruptor acende o painel inteiro na mesma sessão", async () => {
    await abrirOInterruptor();

    // Retrato do boot: a ficha injetada diz desligado.
    expect(hospedeiro.textContent).toContain("PIX: Desligado");

    await clicar(interruptorDoPix());

    expect(chamadas.some((c) => c.corpo.acao === "ligar_pix")).toBe(true);
    expect(hospedeiro.textContent).toContain("PIX: Funcionando");
    expect(hospedeiro.textContent).not.toContain("PIX: Desligado");

    await abrirOTermometro();
    const termometro = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pagamento online (PIX)"),
    );
    expect(termometro?.textContent).toContain("Funcionando");
  });

  it("P2 — desligar o interruptor apaga o painel inteiro na mesma sessão", async () => {
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    cenario.salvo = { ...CONFIGURADO, pix_ligado: true };
    await abrirOInterruptor();

    expect(hospedeiro.textContent).toContain("PIX: Funcionando");

    await clicar(interruptorDoPix());

    expect(chamadas.some((c) => c.corpo.acao === "desligar_pix")).toBe(true);
    expect(hospedeiro.textContent).toContain("PIX: Desligado");
    expect(hospedeiro.textContent).not.toContain("PIX: Funcionando");

    await abrirOTermometro();
    const termometro = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pagamento online (PIX)"),
    );
    expect(termometro?.textContent).toContain("Desligado");
  });

  it("P3 — salvar credencial nova (pix_desligado da edge) também apaga o painel", async () => {
    mockFlags.pagamentoOnlineLigado.mockReturnValue(true);
    cenario.salvo = { ...CONFIGURADO, pix_ligado: true };
    cenario.respostaSalvar = {
      ...CONFIGURADO,
      pix_ligado: false,
      ultimo_teste: null,
      pix_desligado: true,
      aviso:
        "Desliguei o PIX no app: teste a conexão com a credencial nova e ligue de novo.",
    };
    await abrirOInterruptor();

    expect(hospedeiro.textContent).toContain("PIX: Funcionando");

    await clicar(botaoPorTexto("Salvar chaves"));

    expect(chamadas.some((c) => c.corpo.acao === "salvar")).toBe(true);
    expect(hospedeiro.textContent).toContain("PIX: Desligado");
    expect(hospedeiro.textContent).toContain("Desliguei o PIX no app");
  });
});
