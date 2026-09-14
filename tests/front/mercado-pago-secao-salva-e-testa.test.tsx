// @vitest-environment jsdom
//
// Peça 20 — a seção "Mercado Pago" da tela de Ajustes, na tela de verdade.
// O que ESTE arquivo prova é o contrato de segurança pedido pelo dono:
//   S1  a tela mostra SÓ a MÁSCARA do Access Token salvo ("••••1234") — o
//       segredo inteiro não aparece em nenhuma parte do corpo da página;
//   S2  salvar manda as chaves para a edge (ação "salvar") e LIMPA os campos
//       de segredo, voltando a ler o estado salvo;
//   S3  "Testar conexão" chama a edge (ação "testar") e mostra o recado
//       amigável de sucesso vindo do servidor;
//   S4  recusa do Mercado Pago vira recado vermelho amigável — e o token
//       falso não vaza para a tela;
//   S5  com chave digitada e não salva, o teste fica BLOQUEADO ("Salve para
//       testar") — o teste fala do que está salvo, não do que está na tela.
//
// Mesmo padrão de admin-product-form-um-grupo-de-variacao.test.tsx: sem
// @testing-library/react (não instalado), createRoot + act do React puro, e
// as dependências de fora mockadas. NENHUMA chamada real: a edge
// credenciais-mercado-pago é DUBLÊ aqui, e as chaves dos testes são FALSAS
// de mentira (legíveis de propósito — nunca uma chave real de ninguém).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_FALSO = "APP_USR-token-falso-de-teste-9999";
const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

type Chamada = { nome: string; corpo: Record<string, unknown> };
const chamadas: Chamada[] = [];

// O dublê da edge: roteia por acao e lembra o que recebeu. `vi.hoisted`
// porque a fábrica do vi.mock sobe para o topo do arquivo. Estados mudam
// por teste via `cenario`.
const { invokeFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: {
    salvo: {} as Record<string, unknown>,
    respostaTeste: {} as Record<string, unknown>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (nome: string, { body }: any) => {
  chamadas.push({ nome, corpo: body });
  if (body?.acao === "ler") {
    return { data: cenario.salvo, error: null };
  }
  if (body?.acao === "salvar") {
    cenario.salvo = {
      configurado: true,
      public_key: body.public_key ?? null,
      mascara_token: "••••9999",
      mascara_webhook: null,
      ultimo_teste: null,
      atualizado_em: new Date().toISOString(),
    };
    return { data: cenario.salvo, error: null };
  }
  if (body?.acao === "testar") {
    return { data: cenario.respostaTeste, error: null };
  }
  return { data: null, error: null };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: toastSuccess,
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Input "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string): HTMLButtonElement {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  return botao;
}

async function clique(botao: HTMLButtonElement) {
  await act(async () => {
    botao.click();
  });
  // deixa os efeitos assíncronos (invoke, setEstado) assentarem
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function montarSecao(): Promise<Root> {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<MercadoPagoSection />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return raiz;
}

const CONFIGURADO = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: null,
  ultimo_teste: null,
  atualizado_em: new Date().toISOString(),
};

describe("MercadoPagoSection — salva e testa as chaves do lojista", () => {
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadas.length = 0;
    cenario.salvo = {};
    cenario.respostaTeste = {};
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
  });

  it("S1 — mostra só a máscara do token salvo, nunca o segredo inteiro", async () => {
    cenario.salvo = {
      ...CONFIGURADO,
      mascara_token: "••••4321",
    };
    raiz = await montarSecao();

    expect(document.body.textContent).toContain("••••4321");
    expect(document.body.textContent).not.toContain(TOKEN_FALSO);
    // o placeholder convida a MANTER a chave, não a exibi-la
    const campo = document.getElementById("mp-access-token") as HTMLInputElement;
    expect(campo.placeholder).toContain("Deixe vazio para manter");
  });

  it("S2 — salvar manda as chaves para a edge e limpa os segredos da tela", async () => {
    cenario.salvo = { ...CONFIGURADO, configurado: false, public_key: null, mascara_token: null };
    raiz = await montarSecao();

    digitar("mp-public-key", PUBLICA_FALSA);
    digitar("mp-access-token", TOKEN_FALSO);
    await clique(botaoPorTexto("Salvar chaves"));

    const salvar = chamadas.find((c) => c.corpo.acao === "salvar");
    expect(salvar).toBeTruthy();
    expect(salvar!.corpo.public_key).toBe(PUBLICA_FALSA);
    expect(salvar!.corpo.access_token).toBe(TOKEN_FALSO);

    expect(toastSuccess).toHaveBeenCalled();
    // o campo de segredo nasce vazio de novo; a máscara atualizada volta
    expect((document.getElementById("mp-access-token") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).toContain("••••9999");
    expect(document.body.textContent).not.toContain(TOKEN_FALSO);
  });

  it("S3 — testar conexão fala com a edge e mostra o recado de sucesso", async () => {
    cenario.salvo = { ...CONFIGURADO };
    cenario.respostaTeste = {
      conectado: true,
      mensagem: 'Conectado! Conta "Loja Teste" no ambiente de produção.',
      ambiente: "producao",
      conta: "Loja Teste",
    };
    raiz = await montarSecao();

    await clique(botaoPorTexto("Testar conexão"));

    const testar = chamadas.find((c) => c.corpo.acao === "testar");
    expect(testar).toBeTruthy();
    expect(document.body.textContent).toContain("Conectado! Conta");
    expect(document.body.textContent).not.toContain(TOKEN_FALSO);
  });

  it("S4 — recusa do MP vira recado vermelho amigável, sem vazar a chave", async () => {
    cenario.salvo = { ...CONFIGURADO };
    cenario.respostaTeste = {
      conectado: false,
      mensagem:
        "O Mercado Pago recusou a chave: o Access Token está errado, expirou ou veio incompleto. Cole a chave de novo e salve.",
    };
    raiz = await montarSecao();

    await clique(botaoPorTexto("Testar conexão"));

    expect(document.body.textContent).toContain("recusou a chave");
    expect(document.body.textContent).not.toContain(TOKEN_FALSO);
  });

  it("S5 — com chave digitada e não salva, o teste fica bloqueado", async () => {
    cenario.salvo = { ...CONFIGURADO };
    raiz = await montarSecao();

    const testarAntes = botaoPorTexto("Testar conexão");
    expect(testarAntes.disabled).toBe(false);

    digitar("mp-access-token", TOKEN_FALSO);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(document.body.textContent).toContain("Salve para testar");
    expect(botaoPorTexto("Testar conexão").disabled).toBe(true);
    // e nenhum teste saiu daqui
    expect(chamadas.some((c) => c.corpo.acao === "testar")).toBe(false);
  });
});
