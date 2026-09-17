// @vitest-environment jsdom
//
// Peça 20 — o guia passo a passo da seção "Mercado Pago". O dono pediu um
// guia com passos numerados e um PROMPT PRONTO que a lojista copia para
// colar no agente de IA do app do Mercado Pago. O que ESTE arquivo prova:
//   G1  o guia mostra os 5 passos numerados;
//   G2  o prompt pronto aparece na tela (a lojista lê o que vai copiar);
//   G3  o botão copia o texto EXATO da constante de conteúdo (fonte única)
//       e mostra o feedback "Copiado!".
//
// Mesmo padrão da casa: createRoot + act puros, dependências de fora
// mockadas. O conteúdo (passos + prompt) é importado da FONTE — o teste
// compara com a constante, não com uma cópia do texto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeText = vi.fn(async () => undefined);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));

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

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";
import {
  PASSOS_DO_GUIA,
  PROMPT_PARA_AGENTE_MP,
  montarPromptParaAgenteMp,
  urlDeNotificacoesDoWebhook,
} from "@/components/admin/settings/mercado-pago-conteudo";
import { lerSupabaseUrl } from "@/lib/env-valores";

// Peça 28: a tela monta o prompt com o endereço de notificações desta loja
// (o mesmo caminho que ela usa) — o teste compara com a MESMA montagem.
const PROMPT_NA_TELA = montarPromptParaAgenteMp({
  urlDeNotificacoes: urlDeNotificacoesDoWebhook(lerSupabaseUrl()),
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Retomada 14/09: o guia virou expandidor que nasce FECHADO (pedido do
// dono — o grupo aberto poluía a tela). As provas passam com a camada
// "Como pegar suas chaves" aberta.
async function abrirGuia() {
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes("Como pegar suas chaves"));
  if (!cabecalho) throw new Error('Expansor "Como pegar suas chaves" ausente.');
  await act(async () => {
    (cabecalho as HTMLButtonElement).click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function botaoPorTexto(texto: string): HTMLButtonElement {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  return botao;
}

describe("MercadoPagoSection — o guia com o prompt pronto", () => {
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
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(navigator as any, "clipboard");
  });

  it("G1 e G2 — guia com os 5 passos numerados e o prompt à vista", async () => {
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await abrirGuia();

    const itens = document.body.querySelectorAll("ol li");
    expect(itens.length).toBe(PASSOS_DO_GUIA.length);
    expect(itens.length).toBe(5);
    // o primeiro passo é abrir o app do MP; o último é voltar, colar, salvar e testar
    expect(document.body.textContent).toContain("Abra o app do Mercado Pago");
    expect(document.body.textContent).toContain("salve e teste");
    // o prompt pronto é visível para quem vai copiar
    expect(document.body.textContent).toContain(
      PROMPT_NA_TELA.slice(0, 40),
    );
  });

  it("G3 — copiar manda o texto exato da constante e mostra 'Copiado!'", async () => {
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await abrirGuia();

    const copiar = botaoPorTexto("Copiar prompt");
    await act(async () => {
      copiar.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PROMPT_NA_TELA);
    expect(botaoPorTexto("Copiado!")).toBeTruthy();
  });

  // Peça 27 (15/09): o campo "Chave de notificações (opcional)" da tela não
  // era ensinado em lugar nenhum. O prompt agora pede ao agente o passo a
  // passo leigo de onde copiar essa chave, e o guia diz que ela é OPCIONAL —
  // o Pix funciona sem ela (o teste real do dono foi feito sem ela).
  it("G4 e G5 — chave de notificações opcional: o prompt ensina onde copiar e o guia diz que pode ficar para depois", async () => {
    // G4 — o PROMPT copiável menciona a chave de notificações como opcional
    // e pede ao agente o caminho exato (área de Webhooks) para copiá-la.
    const promptMinusculo = PROMPT_PARA_AGENTE_MP.toLowerCase();
    expect(promptMinusculo).toContain("chave de notificações");
    expect(promptMinusculo).toContain("opcional");
    expect(promptMinusculo).toContain("webhook");
    expect(promptMinusculo).toContain("pix já funciona sem ela");

    // G5 — o guia NA TELA diz o mesmo: pode deixar vazio e colar depois.
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<MercadoPagoSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await abrirGuia();
    const tela = document.body.textContent ?? "";
    expect(tela).toContain("Chave de notificações (opcional)");
    expect(tela).toContain("pode deixar vazio e colar depois");
    expect(tela).toContain("já funciona sem ela");
  });

  // Peça 28 (17/09): o dono pediu um prompt que diga ao agente do MP com
  // QUEM ele fala (lojista leigo), o que precisa sair da conversa, como
  // guiar e tirar dúvidas, e que ensine a chave de notificações no final,
  // como opcional — com o endereço REAL de notificações desta loja.
  it("G6 — o prompt é um roteiro para o agente: quem fala, o que sair, como guiar, a chave opcional no fim, segurança", () => {
    const url = "https://exemplo.supabase.co/functions/v1/webhook-mercadopago";
    const comUrl = montarPromptParaAgenteMp({ urlDeNotificacoes: url });
    const semUrl = montarPromptParaAgenteMp({ urlDeNotificacoes: null });
    for (const prompt of [comUrl, semUrl]) {
      const p = prompt.toLowerCase();
      // quem fala e o que o app usa
      expect(p).toContain("não sou programador");
      expect(p).toContain("checkout api");
      // o que precisa sair: as duas de produção, e a terceira opcional no fim
      expect(p).toContain("public key de produção");
      expect(p).toContain("access token de produção");
      expect(p).toContain("credenciais de teste não me servem agora");
      expect(p).toContain("ativar credenciais de produção");
      expect(p).toContain("assinatura secreta");
      // como guiar: um passo por vez, linguagem simples, dúvidas no meio
      expect(p).toContain("um passo por vez");
      expect(p).toContain("palavra técnica");
      expect(p).toContain("pergunta no meio");
      // a chave de notificações fica para o FINAL e é opcional
      const iChaves = p.indexOf("access token de produção");
      const iNoFinal = p.indexOf("no final: a chave de notificações");
      expect(iNoFinal).toBeGreaterThan(iChaves);
      expect(p).toContain("pix já funciona sem ela");
      // segurança
      expect(p).toContain("secretas");
      expect(p).toContain("nem colar aqui nesta conversa");
      // nunca vaza um valor indefinido para o texto
      expect(prompt).not.toMatch(/undefined|null|\{\{/);
    }
    // com endereço conhecido, o prompt manda colar EXATAMENTE ele
    expect(comUrl).toContain(`colar exatamente este endereço no campo da URL de produção: ${url}`);
    // sem endereço, pede ao lojista em vez de inventar
    expect(semUrl).toContain("eu te passo quando você pedir");
    expect(semUrl).not.toContain("https://");
    // a referência estática é a versão sem endereço
    expect(PROMPT_PARA_AGENTE_MP).toBe(semUrl);
  });

  it("G7 — o endereço de notificações nasce da URL do Supabase, e só dela", () => {
    expect(urlDeNotificacoesDoWebhook("https://cafkrminfnokvgjqtkle.supabase.co")).toBe(
      "https://cafkrminfnokvgjqtkle.supabase.co/functions/v1/webhook-mercadopago",
    );
    expect(urlDeNotificacoesDoWebhook("https://x.supabase.co/")).toBe(
      "https://x.supabase.co/functions/v1/webhook-mercadopago",
    );
    expect(urlDeNotificacoesDoWebhook("http://127.0.0.1:54321")).toBe(
      "http://127.0.0.1:54321/functions/v1/webhook-mercadopago",
    );
    for (const ruim of ["", "   ", null, undefined, "supabase.co", "https://", "https://x.supabase.co/rest/v1"]) {
      expect(urlDeNotificacoesDoWebhook(ruim)).toBeNull();
    }
  });
});
