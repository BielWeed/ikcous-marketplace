// @vitest-environment jsdom
//
// Só o DONO da loja troca as chaves do Mercado Pago e o e-mail da loja
// (24/11/2026). Quem barra de verdade é o servidor (403 ao administrador
// nomeado); esta tela é conforto: para quem não é o dono os campos e botões de
// TROCAR ficam travados, com uma frase simples. O que prova:
//   F1  nomeado (há dono e não sou eu): campos e botão de salvar travados + a
//       frase; "Testar conexão" / "Enviar e-mail de teste" seguem como eram
//   F2  dono: tudo destravado, sem frase
//   F3  loja SEM dono cadastrado (tabela vazia): tudo destravado, sem frase
//   F4  ainda lendo o dono: travado, SEM frase (nem destrava por engano, nem
//       acusa o dono)
//   F5  a leitura do dono FALHOU: travado, com a frase NEUTRA (nunca "só o
//       dono") — "não consegui ler" não vira "sem dono"
//   F6  travado, apertar Salvar (mesmo à força) não chama o servidor
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StatusDoEmail } from "@/components/admin/settings/email-da-loja-conteudo";
import type { EstadoDoDono } from "@/hooks/useDonoDaLoja";
import type { UseEmailDaLoja } from "@/hooks/useEmailDaLoja";

const { donoFalso, hookEmailFalso, invokeFalso } = vi.hoisted(() => ({
  donoFalso: { atual: {} as EstadoDoDono },
  hookEmailFalso: { atual: {} as UseEmailDaLoja },
  invokeFalso: vi.fn(),
}));

vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => donoFalso.atual,
}));
vi.mock("@/hooks/useEmailDaLoja", () => ({
  useEmailDaLoja: () => hookEmailFalso.atual,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
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

import { EmailDaLojaSection } from "@/components/admin/settings/EmailDaLojaSection";
import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";

const SO_O_DONO_CHAVES = "Só o dono da loja troca estas chaves.";
const SO_O_DONO_EMAIL = "Só o dono da loja troca o e-mail da loja.";

const EU = "uid-eu";
const ESTADOS: Record<string, EstadoDoDono> = {
  nomeado: {
    souODono: false,
    carregando: false,
    donoId: "uid-do-dono",
    leituraFalhou: false,
  },
  dono: {
    souODono: true,
    carregando: false,
    donoId: EU,
    leituraFalhou: false,
  },
  semDono: {
    souODono: false,
    carregando: false,
    donoId: null,
    leituraFalhou: false,
  },
  carregando: {
    souODono: false,
    carregando: true,
    donoId: null,
    leituraFalhou: false,
  },
  falhou: {
    souODono: false,
    carregando: false,
    donoId: null,
    leituraFalhou: true,
  },
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function montar(ui: React.ReactElement) {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(ui);
  });
  await assentar();
}

beforeEach(() => {
  invokeFalso.mockReset();
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

const texto = () => hospedeiro.textContent ?? "";
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
function botao(rotulo: string): HTMLButtonElement {
  const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
  if (!achado) throw new Error(`Botão "${rotulo}" não está na tela.`);
  return achado;
}
async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await assentar();
}

// ── Mercado Pago ────────────────────────────────────────────────────────────

const MP_CONFIGURADO = {
  configurado: true,
  public_key: "APP_USR-11111111-1111-4111-8111-111111111111",
  mascara_token: "••••9999",
  mascara_webhook: "••••7777",
  ultimo_teste: {
    quando: "2026-11-24T10:00:00.000Z",
    conectado: true,
    mensagem: "Conectado",
    ambiente: "producao",
    conta: "Loja",
  },
  atualizado_em: "2026-11-24T10:00:00.000Z",
  pix_ligado: true,
  public_key_na_loja: true,
  faltando: [],
  pausado: false,
};

async function montarMp() {
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => ({
    data: body?.acao === "ler" ? MP_CONFIGURADO : null,
    error: null,
  }));
  await montar(<MercadoPagoSection abrirChavesGatilho={1} />);
}

const CAMPOS_MP = ["mp-public-key", "mp-access-token", "mp-webhook-secret"];

describe("Mercado Pago: só o dono troca as chaves", () => {
  it("F1 nomeado: os três campos e o Salvar travados, com a frase; Testar conexão segue", async () => {
    donoFalso.atual = ESTADOS.nomeado;
    await montarMp();
    for (const id of CAMPOS_MP) expect(campo(id).disabled).toBe(true);
    expect(botao("Salvar chaves").disabled).toBe(true);
    expect(texto()).toContain(SO_O_DONO_CHAVES);
    expect(botao("Testar conexão").disabled).toBe(false);
  });

  it("F2 dono e F3 loja sem dono: tudo destravado e sem frase", async () => {
    for (const estado of [ESTADOS.dono, ESTADOS.semDono]) {
      donoFalso.atual = estado;
      await montarMp();
      for (const id of CAMPOS_MP) expect(campo(id).disabled).toBe(false);
      expect(botao("Salvar chaves").disabled).toBe(false);
      expect(texto()).not.toContain("Só o dono");
      expect(texto()).not.toContain("Não consegui confirmar");
      act(() => raiz.unmount());
      hospedeiro.remove();
    }
  });

  it("F4 ainda lendo o dono: travado e SEM frase; F5 leitura falhou: travado com frase neutra", async () => {
    donoFalso.atual = ESTADOS.carregando;
    await montarMp();
    for (const id of CAMPOS_MP) expect(campo(id).disabled).toBe(true);
    expect(botao("Salvar chaves").disabled).toBe(true);
    expect(texto()).not.toContain("Só o dono");
    expect(texto()).not.toContain("Não consegui confirmar");
    act(() => raiz.unmount());
    hospedeiro.remove();

    donoFalso.atual = ESTADOS.falhou;
    await montarMp();
    for (const id of CAMPOS_MP) expect(campo(id).disabled).toBe(true);
    expect(botao("Salvar chaves").disabled).toBe(true);
    expect(texto()).toContain("Não consegui confirmar agora quem é o dono");
    expect(texto()).not.toContain("Só o dono");
  });

  it("F6 travado: nem à força o Salvar chama o servidor", async () => {
    donoFalso.atual = ESTADOS.nomeado;
    await montarMp();
    invokeFalso.mockClear();
    await clicar(botao("Salvar chaves"));
    expect(
      invokeFalso.mock.calls.filter(([, { body }]) => body?.acao === "salvar"),
    ).toHaveLength(0);
  });
});

// ── E-mail da loja ──────────────────────────────────────────────────────────

const STATUS_VAZIO: StatusDoEmail = {
  usuario: null,
  senhaGuardada: false,
  ultimoTeste: null,
  origem: "nenhuma",
  cofrePronto: true,
  registroIlegivel: false,
  falha: null,
};
const STATUS_SALVO: StatusDoEmail = {
  ...STATUS_VAZIO,
  usuario: "loja@gmail.com",
  senhaGuardada: true,
  origem: "painel",
};
const emailFns = {
  salvar: vi.fn(),
  testar: vi.fn(),
  remover: vi.fn(),
  recarregar: vi.fn(),
};

function definirHookDoEmail(status: StatusDoEmail) {
  hookEmailFalso.atual = {
    carga: "pronto",
    mensagemDeCarga: null,
    status,
    ocupado: null,
    recarregar: emailFns.recarregar,
    salvar: emailFns.salvar,
    testar: emailFns.testar,
    remover: emailFns.remover,
  };
}

describe("E-mail da loja: só o dono troca o e-mail", () => {
  beforeEach(() => {
    for (const f of Object.values(emailFns)) f.mockReset();
  });

  it("F1 nomeado, e-mail já salvo: Trocar e Remover travados, com a frase; Enviar e-mail de teste segue", async () => {
    donoFalso.atual = ESTADOS.nomeado;
    definirHookDoEmail(STATUS_SALVO);
    await montar(<EmailDaLojaSection />);
    expect(texto()).toContain(SO_O_DONO_EMAIL);
    expect(botao("Trocar").disabled).toBe(true);
    expect(botao("Remover o Gmail").disabled).toBe(true);
    expect(botao("Enviar e-mail de teste").disabled).toBe(false);
  });

  it("F1 nomeado, e-mail ainda não cadastrado: os campos do passo 4 e o Salvar travados", async () => {
    donoFalso.atual = ESTADOS.nomeado;
    definirHookDoEmail(STATUS_VAZIO);
    await montar(<EmailDaLojaSection />);
    for (let i = 0; i < 3; i++) await clicar(botao("Já fiz, próximo passo"));
    expect(campo("email-loja-usuario").disabled).toBe(true);
    expect(campo("email-loja-senha").disabled).toBe(true);
    expect(botao("Salvar").disabled).toBe(true);
    expect(texto()).toContain(SO_O_DONO_EMAIL);
  });

  it("F2 dono e F3 loja sem dono: tudo destravado e sem frase", async () => {
    for (const estado of [ESTADOS.dono, ESTADOS.semDono]) {
      donoFalso.atual = estado;
      definirHookDoEmail(STATUS_SALVO);
      await montar(<EmailDaLojaSection />);
      expect(botao("Trocar").disabled).toBe(false);
      expect(botao("Remover o Gmail").disabled).toBe(false);
      expect(texto()).not.toContain("Só o dono");
      expect(texto()).not.toContain("Não consegui confirmar");
      act(() => raiz.unmount());
      hospedeiro.remove();
    }
    donoFalso.atual = ESTADOS.dono;
    definirHookDoEmail(STATUS_VAZIO);
    await montar(<EmailDaLojaSection />);
    for (let i = 0; i < 3; i++) await clicar(botao("Já fiz, próximo passo"));
    expect(campo("email-loja-usuario").disabled).toBe(false);
    expect(campo("email-loja-senha").disabled).toBe(false);
    expect(botao("Salvar").disabled).toBe(false);
  });

  it("F4 ainda lendo: travado sem frase; F5 leitura falhou: travado com a frase neutra", async () => {
    donoFalso.atual = ESTADOS.carregando;
    definirHookDoEmail(STATUS_SALVO);
    await montar(<EmailDaLojaSection />);
    expect(botao("Trocar").disabled).toBe(true);
    expect(botao("Remover o Gmail").disabled).toBe(true);
    expect(texto()).not.toContain("Só o dono");
    expect(texto()).not.toContain("Não consegui confirmar");
    act(() => raiz.unmount());
    hospedeiro.remove();

    donoFalso.atual = ESTADOS.falhou;
    definirHookDoEmail(STATUS_SALVO);
    await montar(<EmailDaLojaSection />);
    expect(botao("Trocar").disabled).toBe(true);
    expect(botao("Remover o Gmail").disabled).toBe(true);
    expect(texto()).toContain("Não consegui confirmar agora quem é o dono");
    expect(texto()).not.toContain("Só o dono");
  });

  it("F6 travado: nem à força Salvar ou Remover chamam o servidor", async () => {
    donoFalso.atual = ESTADOS.nomeado;
    definirHookDoEmail(STATUS_SALVO);
    await montar(<EmailDaLojaSection />);
    await clicar(botao("Remover o Gmail"));
    expect(texto()).not.toContain("Sim, remover");
    expect(emailFns.remover).not.toHaveBeenCalled();
    expect(emailFns.salvar).not.toHaveBeenCalled();
  });
});
