// @vitest-environment jsdom
//
// PAUSAR o pagamento pelo app avisa, ANTES, que a transportadora para de
// vender (14/10/2026).
//
// O lojista que pausa o PIX "só um pouquinho" não tem como saber que, junto
// com ele, todo cliente de outra cidade deixa de conseguir comprar: o
// checkout recusa o envio por transportadora sem pagamento pelo app. O
// aviso NÃO bloqueia — pausar é o lado seguro e continua possível —, só diz o
// que vai acontecer e deixa confirmar.
//
// O que esta suíte prende (a edge é DUBLÊ, as chaves são FALSAS):
//   P1  com transportadora vendendo: o clique em Pausar NÃO chama a edge — abre
//       o aviso com a consequência e os botões "Pausar mesmo assim" / "Voltar";
//   P2  "Pausar mesmo assim" pausa de verdade (chama `desligar_pix`);
//   P3  "Voltar" fecha o aviso e NADA é pausado;
//   P4  SEM transportadora vendendo (o padrão): Pausar pausa direto, como
//       sempre — nenhum ruído para quem só entrega na cidade;
//   P5  o aviso não sobrevive ao estado: depois de pausar e retomar, o clique
//       em Pausar volta a perguntar (não fica "meio confirmado").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = { nome: string; corpo: Record<string, unknown> };
const chamadas: Chamada[] = [];

const { invokeFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: {
    salvo: {} as Record<string, unknown>,
    respostaPausar: {} as Record<string, unknown>,
    respostaRetomar: {} as Record<string, unknown>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (nome: string, { body }: any) => {
  chamadas.push({ nome, corpo: body });
  if (body?.acao === "ler") return { data: cenario.salvo, error: null };
  if (body?.acao === "desligar_pix") {
    return { data: cenario.respostaPausar, error: null };
  }
  if (body?.acao === "ligar_pix") {
    return { data: cenario.respostaRetomar, error: null };
  }
  return { data: null, error: null };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";

const RECEBENDO = {
  configurado: true,
  public_key: "APP_USR-publica-falsa-de-teste",
  mascara_token: "••••9999",
  mascara_webhook: "••••7777",
  ultimo_teste: {
    quando: new Date().toISOString(),
    conectado: true,
    mensagem: "Conectado!",
    ambiente: "producao",
    conta: "Loja Teste",
  },
  atualizado_em: new Date().toISOString(),
  pix_ligado: true,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function clique(elemento: HTMLElement) {
  await act(async () => {
    elemento.click();
  });
  await assentar();
}

/** Texto EXATO: "Pausar" também está dentro de "Pausar mesmo assim". */
function botaoExato(texto: string): HTMLButtonElement {
  const botao = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  return botao;
}

function temBotaoExato(texto: string): boolean {
  return [...document.body.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === texto,
  );
}

const aviso = () =>
  document.body.querySelector<HTMLElement>(
    "[data-aviso-pausar-sem-transportadora]",
  );
const pausouNaEdge = () =>
  chamadas.some((c) => c.corpo.acao === "desligar_pix");

describe("MercadoPagoSection — Pausar avisa que a transportadora para de vender", () => {
  let raiz: Root;

  async function montar(transportadoraVende?: boolean) {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <MercadoPagoSection transportadoraVende={transportadoraVende} />,
      );
    });
    await assentar();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chamadas.length = 0;
    cenario.salvo = { ...RECEBENDO };
    cenario.respostaPausar = {
      pix_ligado: false,
      pausado: true,
      faltando: [],
      public_key_na_loja: true,
    };
    cenario.respostaRetomar = {
      pix_ligado: true,
      pausado: false,
      faltando: [],
      public_key_na_loja: true,
    };
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    document.body.innerHTML = "";
  });

  it("P1 — com transportadora vendendo, Pausar NÃO pausa: abre o aviso com a consequência", async () => {
    await montar(true);

    await clique(botaoExato("Pausar"));

    expect(pausouNaEdge()).toBe(false);
    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toMatch(/transportadora/i);
    expect(aviso()?.textContent).toMatch(/outras cidades/i);
    expect(aviso()?.textContent).toMatch(/retomar/i);
    expect(temBotaoExato("Pausar mesmo assim")).toBe(true);
    expect(temBotaoExato("Voltar")).toBe(true);
  });

  it("P2 — 'Pausar mesmo assim' pausa de verdade e o aviso some", async () => {
    await montar(true);
    await clique(botaoExato("Pausar"));

    await clique(botaoExato("Pausar mesmo assim"));

    expect(pausouNaEdge()).toBe(true);
    expect(aviso()).toBeNull();
    expect(document.body.textContent).toContain("Pausado por você");
  });

  it("P3 — 'Voltar' fecha o aviso e NADA é pausado", async () => {
    await montar(true);
    await clique(botaoExato("Pausar"));

    await clique(botaoExato("Voltar"));

    expect(pausouNaEdge()).toBe(false);
    expect(aviso()).toBeNull();
    expect(temBotaoExato("Pausar")).toBe(true);
  });

  it("P4 — SEM transportadora vendendo (o padrão), Pausar pausa direto: nenhum ruído", async () => {
    await montar(false);
    await clique(botaoExato("Pausar"));

    expect(aviso()).toBeNull();
    expect(pausouNaEdge()).toBe(true);
  });

  it("P4b — prop ausente (quem não sabe) também pausa direto", async () => {
    await montar(undefined);
    await clique(botaoExato("Pausar"));

    expect(aviso()).toBeNull();
    expect(pausouNaEdge()).toBe(true);
  });

  it("P5 — depois de pausar e retomar, Pausar volta a perguntar", async () => {
    await montar(true);
    await clique(botaoExato("Pausar"));
    await clique(botaoExato("Pausar mesmo assim"));
    await clique(botaoExato("Retomar"));
    chamadas.length = 0;

    await clique(botaoExato("Pausar"));

    expect(pausouNaEdge()).toBe(false);
    expect(aviso()).not.toBeNull();
  });
});
