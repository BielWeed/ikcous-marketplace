// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), tela "Mercado Pago" de Ajustes: o SEGREDO
// que a lojista digita (chave secreta e senha dos avisos) não pode sobrar em
// lugar nenhum depois de salvo, nem vazar em aviso, texto da tela ou console.
// Chaves e senhas FALSAS de propósito; a edge é um dublê.
//   V1  os dois campos de segredo são `password` (campo mascarado), antes e
//       depois de digitar, e não deixam o navegador sugerir/guardar;
//   V2  salvou com sucesso: os DOIS campos de segredo voltam VAZIOS (a chave
//       pública fica, ela não é segredo) e só a máscara "••••1234" aparece;
//   V3  nem na tela, nem nos avisos (sucesso ou erro), nem no console aparece o
//       valor digitado — salvando, falhando ou testando a conexão;
//   V4  salvar que FALHA não apaga o que ela digitou (para não colar tudo de
//       novo), mas o valor continua só dentro do campo mascarado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA = "APP_USR-11111111-1111-4111-8111-111111111111";
const TOKEN_FALSO = "TEST-chave-ficticia-0000";
const SENHA_AVISOS_FALSA = "senha-dos-avisos-ficticia-0000";

const { invokeFalso, toastError, toastSuccess, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  cenario: {
    salvar: null as null | { data: unknown; error: unknown },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => ({
    souODono: true,
    carregando: false,
    donoId: "uid-do-dono-ficticio",
    leituraFalhou: false,
  }),
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

const SALVO = {
  configurado: true,
  public_key: PUBLICA,
  mascara_token: "••••0000",
  mascara_webhook: "••••1111",
  ultimo_teste: null,
  pix_ligado: false,
  public_key_na_loja: true,
  pausado: false,
  faltando: ["teste"],
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
const espioes = ["log", "info", "warn", "error", "debug"].map((nivel) =>
  vi.spyOn(console, nivel as "log").mockImplementation(() => {}),
);

const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;

function digitar(id: string, valor: string) {
  const el = campo(id);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clicar(rotulo: string) {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
  if (!botao) throw new Error(`Botão "${rotulo}" não está na tela.`);
  await act(async () => {
    botao.click();
  });
  await assentar();
}

async function montarEDigitar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<MercadoPagoSection abrirChavesGatilho={1} />);
  });
  await assentar();
  await act(async () => {
    digitar("mp-public-key", PUBLICA);
    digitar("mp-access-token", TOKEN_FALSO);
    digitar("mp-webhook-secret", SENHA_AVISOS_FALSA);
  });
}

/** Tudo que o usuário (ou um log) poderia ver, menos o valor dos campos. */
function tudoQueVazaria() {
  return [
    document.body.textContent ?? "",
    JSON.stringify(toastSuccess.mock.calls),
    JSON.stringify(toastError.mock.calls),
    ...espioes.map((e) => JSON.stringify(e.mock.calls)),
  ].join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  cenario.salvar = { data: SALVO, error: null };
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
    if (body?.acao === "ler") {
      return { data: { configurado: false, faltando: [] }, error: null };
    }
    if (body?.acao === "salvar") return cenario.salvar;
    if (body?.acao === "testar") {
      return {
        data: { conectado: true, mensagem: "Conexão com a conta OK." },
        error: null,
      };
    }
    return { data: null, error: null };
  });
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("campos de segredo: mascarados", () => {
  it("V1 chave secreta e senha dos avisos são type=password e não deixam o navegador guardar", async () => {
    await montarEDigitar();
    for (const id of ["mp-access-token", "mp-webhook-secret"]) {
      expect(campo(id).type).toBe("password");
      expect(campo(id).getAttribute("autocomplete")).toBe("new-password");
    }
    // Digitado, o valor continua só dentro do campo mascarado.
    expect(campo("mp-access-token").value).toBe(TOKEN_FALSO);
    expect(tudoQueVazaria()).not.toContain(TOKEN_FALSO);
    expect(tudoQueVazaria()).not.toContain(SENHA_AVISOS_FALSA);
  });
});

describe("depois de salvar com sucesso", () => {
  it("V2 os dois campos de segredo voltam vazios; só a máscara aparece; a pública fica", async () => {
    await montarEDigitar();
    await clicar("Salvar chaves");

    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(campo("mp-access-token").value).toBe("");
    expect(campo("mp-webhook-secret").value).toBe("");
    expect(campo("mp-public-key").value).toBe(PUBLICA);
    expect(document.body.textContent).toContain("••••0000");
    expect(document.body.textContent).toContain("••••1111");
  });

  it("V3 nem tela, nem aviso, nem console têm o valor digitado (salvar e depois testar a conexão)", async () => {
    await montarEDigitar();
    await clicar("Salvar chaves");
    await clicar("Testar conexão");
    const vazaria = tudoQueVazaria();
    expect(vazaria).not.toContain(TOKEN_FALSO);
    expect(vazaria).not.toContain(SENHA_AVISOS_FALSA);
  });
});

describe("salvar que falha", () => {
  it("V4 o que ela digitou continua no campo mascarado e não vaza para tela, aviso ou console", async () => {
    cenario.salvar = {
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: new Response("{}", { status: 500 }),
      },
    };
    await montarEDigitar();
    await clicar("Salvar chaves");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(campo("mp-access-token").value).toBe(TOKEN_FALSO);
    expect(campo("mp-webhook-secret").value).toBe(SENHA_AVISOS_FALSA);
    expect(campo("mp-access-token").type).toBe("password");
    expect(campo("mp-webhook-secret").type).toBe("password");
    const vazaria = tudoQueVazaria();
    expect(vazaria).not.toContain(TOKEN_FALSO);
    expect(vazaria).not.toContain(SENHA_AVISOS_FALSA);
  });
});
