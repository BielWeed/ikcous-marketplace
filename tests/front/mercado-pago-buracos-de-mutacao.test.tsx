// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em MercadoPagoSection (os testes antigos
// passavam mesmo com o defeito de uma linha plantado). Duas frases que a tela
// dá à lojista sobre o pagamento pelo app:
//  - depois de "Salvar chaves", "Conexão com a conta OK" SÓ aparece quando o
//    servidor testou a conexão agora E ela conectou (re-salvar sem mudar nada
//    não chama o Mercado Pago, e dizer que o teste passou seria mentira);
//  - "Último teste: <data>" não mostra "Invalid Date" quando a data do banco
//    vem ilegível.
// Chaves FALSAS de propósito; a edge é um dublê e nenhuma rede é acionada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA = "APP_USR-11111111-1111-4111-8111-111111111111";
const SEGREDO = "chave-de-teste";

const { invokeFalso, toastError, toastSuccess, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  cenario: {
    ler: {} as Record<string, unknown>,
    salvar: {} as Record<string, unknown>,
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

const TESTE_OK = {
  quando: "2026-11-20T15:30:00Z",
  conectado: true,
  mensagem: "Conexão com a conta funcionando.",
  ambiente: "producao",
  conta: null,
};
const TESTE_FALHOU = { ...TESTE_OK, conectado: false, mensagem: "Falhou." };

const BASE = {
  configurado: true,
  public_key: PUBLICA,
  mascara_token: "••••0000",
  mascara_webhook: "••••1111",
  ultimo_teste: null as unknown,
  atualizado_em: null,
  pix_ligado: true,
  public_key_na_loja: true,
  pausado: false,
  faltando: [] as string[],
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<MercadoPagoSection abrirChavesGatilho={1} />);
  });
  await assentar();
}

async function salvarChaves() {
  await act(async () => {
    digitar("mp-access-token", SEGREDO);
  });
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Salvar chaves"),
  );
  if (!botao) throw new Error("Botão Salvar chaves não está na tela.");
  await act(async () => {
    botao.click();
  });
  await assentar();
}

beforeEach(() => {
  vi.clearAllMocks();
  cenario.ler = { ...BASE };
  cenario.salvar = { ...BASE };
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
    if (body?.acao === "ler") return { data: cenario.ler, error: null };
    if (body?.acao === "salvar") return { data: cenario.salvar, error: null };
    return { data: null, error: null };
  });
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

const descricaoDoAviso = () =>
  (toastSuccess.mock.calls[0]?.[1] as { description?: string } | undefined)
    ?.description;

describe("aviso depois de salvar as chaves (pagamento pelo app ligado)", () => {
  it("o servidor testou e conectou: diz que a conexão com a conta está OK", async () => {
    cenario.salvar = { ...BASE, testou: true, ultimo_teste: TESTE_OK };
    await montar();
    await salvarChaves();
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(descricaoDoAviso()).toContain("Conexão com a conta OK");
  });

  it("o servidor testou e NÃO conectou: não diz que a conexão está OK", async () => {
    cenario.salvar = { ...BASE, testou: true, ultimo_teste: TESTE_FALHOU };
    await montar();
    await salvarChaves();
    expect(descricaoDoAviso()).toBe("As chaves foram salvas.");
  });

  it("o servidor NÃO testou agora (só regravou) mesmo com teste antigo bom: não afirma conexão OK", async () => {
    cenario.salvar = { ...BASE, testou: false, ultimo_teste: TESTE_OK };
    await montar();
    await salvarChaves();
    expect(descricaoDoAviso()).toBe("As chaves foram salvas.");
  });

  it("resposta sem o campo 'testou' (edge antiga) também não afirma conexão OK", async () => {
    cenario.salvar = { ...BASE, ultimo_teste: TESTE_OK };
    await montar();
    await salvarChaves();
    expect(descricaoDoAviso()).toBe("As chaves foram salvas.");
  });
});

describe("data do último teste de conexão", () => {
  it("data legível aparece como 'Último teste'", async () => {
    cenario.ler = { ...BASE, ultimo_teste: TESTE_OK };
    await montar();
    const hora = hospedeiro.querySelector("time");
    expect(hora?.getAttribute("datetime")).toBe("2026-11-20T15:30:00Z");
    expect(hospedeiro.textContent).toContain("Último teste:");
  });

  it("data ilegível não vira 'Invalid Date' na tela", async () => {
    cenario.ler = {
      ...BASE,
      ultimo_teste: { ...TESTE_OK, quando: "isto-nao-e-data" },
    };
    await montar();
    expect(hospedeiro.querySelector("time")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Invalid Date");
    expect(hospedeiro.textContent).not.toContain("Último teste:");
  });
});
