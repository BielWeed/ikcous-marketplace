// @vitest-environment jsdom
//
// Peça 20, retomada (14/09/2026 à noite — pedido do dono vendo a tela na
// 5177): o grupo "Mercado Pago" aberto despejava guia + prompt + formulário
// de uma vez ("fica poluindo muito a tela"). O desenho novo abre o grupo
// mostrando SÓ o resumo (status + máscaras), com guia e chaves em
// expandidores próprios, ambos FECHADOS por padrão. O que ESTE arquivo
// prova:
//   C1  os dois expandidores nascem FECHADOS e o resumo está à vista —
//       conteúdo de camada nenhuma está no DOM;
//   C2  abrir/fechar funciona de verdade: conteúdo entra e SAI do DOM;
//   C3  abrir uma camada não abre a outra (nada despejado de uma vez);
//   C4  dentro da camada, copiar continua mandando o texto EXATO da
//       constante de conteúdo.
//
// Mesmo padrão da casa: createRoot + act puros, dependências de fora
// mockadas, dublê de edge, chaves FALSAS de mentira.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeText = vi.fn(async () => undefined);
const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

const { invokeFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: { salvo: {} as Record<string, unknown> },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
  if (body?.acao === "ler") return { data: cenario.salvo, error: null };
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
import {
  montarPromptParaAgenteMp,
  urlDeNotificacoesDoWebhook,
} from "@/components/admin/settings/mercado-pago-conteudo";
import { lerSupabaseUrl } from "@/lib/env-valores";

// Peça 28: a tela copia o prompt MONTADO com o endereço desta loja.
const PROMPT_NA_TELA = montarPromptParaAgenteMp({
  urlDeNotificacoes: urlDeNotificacoesDoWebhook(lerSupabaseUrl()),
});

function expansorPorTexto(texto: string): HTMLButtonElement {
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes(texto));
  if (!cabecalho) throw new Error(`Expansor "${texto}" não está na tela.`);
  return cabecalho as HTMLButtonElement;
}

async function clicar(botao: HTMLButtonElement) {
  await act(async () => {
    botao.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("MercadoPagoSection — o grupo abre em camadas, enxuto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(navigator as any, "clipboard");
  });

  async function montar(): Promise<void> {
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  it("C1 — os dois expandidores nascem fechados; só o resumo está à vista", async () => {
    cenario.salvo = {
      configurado: true,
      public_key: PUBLICA_FALSA,
      mascara_token: "••••7777",
      mascara_webhook: null,
      ultimo_teste: null,
      atualizado_em: new Date().toISOString(),
    };
    await montar();

    const guia = expansorPorTexto("Como pegar suas chaves");
    const chaves = expansorPorTexto("Suas chaves");
    expect(guia.getAttribute("aria-expanded")).toBe("false");
    expect(chaves.getAttribute("aria-expanded")).toBe("false");

    // conteúdo de camada nenhuma está no DOM
    expect(document.querySelector("#mp-public-key")).toBeNull();
    expect(document.querySelector("ol")).toBeNull();
    expect(document.body.textContent).not.toContain(
      "Abra o app do Mercado Pago",
    );

    // o resumo sim: status + máscara, sem abrir nada
    expect(document.body.textContent).toContain("Chaves salvas");
    expect(document.body.textContent).toContain("••••7777");
  });

  it("C2 — abrir/fechar de verdade: o conteúdo entra e SAI do DOM", async () => {
    await montar();

    await clicar(expansorPorTexto("Como pegar suas chaves"));
    expect(
      expansorPorTexto("Como pegar suas chaves").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.querySelectorAll("ol li").length).toBe(5);

    await clicar(expansorPorTexto("Como pegar suas chaves"));
    expect(document.querySelector("ol")).toBeNull();

    await clicar(expansorPorTexto("Suas chaves"));
    expect(expansorPorTexto("Suas chaves").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(document.querySelector("#mp-public-key")).not.toBeNull();

    await clicar(expansorPorTexto("Suas chaves"));
    expect(document.querySelector("#mp-public-key")).toBeNull();
  });

  it("C3 — abrir uma camada não despeja a outra", async () => {
    await montar();

    await clicar(expansorPorTexto("Como pegar suas chaves"));
    expect(document.querySelector("#mp-public-key")).toBeNull();

    await clicar(expansorPorTexto("Suas chaves"));
    // as duas ficam abertas só porque quem usa pediu as duas — uma não
    // arrasta a outra
    expect(
      expansorPorTexto("Como pegar suas chaves").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.querySelectorAll("ol li").length).toBe(5);
    expect(document.querySelector("#mp-public-key")).not.toBeNull();
  });

  it("C4 — dentro da camada, copiar manda o texto exato da constante", async () => {
    await montar();
    await clicar(expansorPorTexto("Como pegar suas chaves"));

    const copiar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Copiar prompt"),
    );
    if (!copiar) throw new Error('Botão "Copiar prompt" não está na tela.');
    await clicar(copiar);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PROMPT_NA_TELA);
  });
});
