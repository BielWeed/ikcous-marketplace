// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), tela "Mercado Pago" de Ajustes: o que a
// lojista LÊ quando a edge responde torto. Chaves e valores abaixo são
// FALSOS de propósito (nenhuma chave real, nenhuma chamada de rede).
//   B1  `{ "erro": "" }` vazio NÃO vira um aviso em branco: cai na frase da casa;
//   B2  só o erro de `FunctionsHttpError` (a NOSSA edge) vira texto na tela —
//       um erro de relay do gateway com corpo parecido nunca vaza o texto cru;
//   B3  401, 403 e 500 sem o nosso corpo: frase da casa (não "Failed ..." do SDK);
//       com o corpo `{ erro }` da edge, a frase dela vai como veio;
//   B4  `faltando` com lixo (nulo, número) não vira "completar as chaves": só
//       os textos que a tela conhece aparecem na lista do que falta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_FALSA = "APP_USR-11111111-1111-4111-8111-111111111111";
const TOKEN_FALSO = "TEST-chave-ficticia-0000";
const FRASE_DE_SALVAR = "Não consegui salvar as chaves agora. Tente de novo.";

const { invokeFalso, toastError, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  toastError: vi.fn(),
  cenario: {
    ler: {} as Record<string, unknown>,
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
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { MercadoPagoSection } from "@/components/admin/settings/MercadoPagoSection";

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

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
  if (!achado) throw new Error(`Botão "${rotulo}" não está na tela.`);
  return achado;
}

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    // abrirChavesGatilho > 0: já abre a camada dos campos.
    raiz.render(<MercadoPagoSection abrirChavesGatilho={1} />);
  });
  await assentar();
}

async function salvarComChavesNovas() {
  await act(async () => {
    digitar("mp-public-key", PUBLICA_FALSA);
    digitar("mp-access-token", TOKEN_FALSO);
  });
  await act(async () => {
    botao("Salvar chaves").click();
  });
  await assentar();
}

const erroHttp = (nome: string, status: number, corpo: string) => ({
  name: nome,
  message: "Edge Function returned a non-2xx status code",
  context: new Response(corpo, {
    status,
    headers: { "Content-Type": "application/json" },
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  cenario.ler = { configurado: false, faltando: [], pausado: false };
  cenario.salvar = null;
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
    if (body?.acao === "ler") return { data: cenario.ler, error: null };
    if (body?.acao === "salvar" && cenario.salvar) return cenario.salvar;
    return { data: null, error: null };
  });
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("erro ao salvar: o que vira texto na tela", () => {
  it("B1 corpo { erro: '' } vazio cai na frase da casa, nunca em aviso em branco", async () => {
    cenario.salvar = {
      data: null,
      error: erroHttp("FunctionsHttpError", 500, '{"erro":""}'),
    };
    await montar();
    await salvarComChavesNovas();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(FRASE_DE_SALVAR);
  });

  it("B2 erro de RELAY do gateway com corpo { erro } não vaza o texto cru para a tela", async () => {
    cenario.salvar = {
      data: null,
      error: erroHttp(
        "FunctionsRelayError",
        502,
        '{"erro":"texto cru do gateway que a lojista nunca deve ler"}',
      ),
    };
    await montar();
    await salvarComChavesNovas();
    expect(toastError).toHaveBeenCalledWith(FRASE_DE_SALVAR);
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("gateway");
  });

  it.each([
    [401, "não é um JSON"],
    [403, ""],
    [500, "<html>Internal Server Error</html>"],
  ])(
    "B3 status %i sem o corpo { erro } da nossa edge: frase da casa",
    async (status, corpo) => {
      cenario.salvar = {
        data: null,
        error: erroHttp("FunctionsHttpError", status, corpo),
      };
      await montar();
      await salvarComChavesNovas();
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith(FRASE_DE_SALVAR);
    },
  );

  it.each([401, 403, 500])(
    "B3 status %i COM { erro } da nossa edge: a frase dela vai como veio",
    async (status) => {
      cenario.salvar = {
        data: null,
        error: erroHttp(
          "FunctionsHttpError",
          status,
          '{"erro":"Só o dono da loja troca estas chaves (frase da edge)."}',
        ),
      };
      await montar();
      await salvarComChavesNovas();
      expect(toastError).toHaveBeenCalledWith(
        "Só o dono da loja troca estas chaves (frase da edge).",
      );
    },
  );

  it("B3 a chave digitada nunca aparece no aviso de erro", async () => {
    cenario.salvar = {
      data: null,
      error: erroHttp("FunctionsHttpError", 500, "{}"),
    };
    await montar();
    await salvarComChavesNovas();
    expect(JSON.stringify(toastError.mock.calls)).not.toContain(TOKEN_FALSO);
    expect(document.body.textContent).not.toContain(TOKEN_FALSO);
  });
});

describe("lista do que falta: só texto que a tela conhece", () => {
  it("B4 lixo em `faltando` (nulo, número, texto desconhecido) não vira 'completar as chaves' por engano", async () => {
    cenario.ler = {
      configurado: true,
      public_key: PUBLICA_FALSA,
      mascara_token: "••••0000",
      mascara_webhook: null,
      ultimo_teste: null,
      pix_ligado: false,
      public_key_na_loja: true,
      pausado: false,
      faltando: [null, 7, { x: 1 }, "public_key"],
    };
    await montar();
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("colar a chave pública");
    expect(texto).not.toContain("completar as chaves");
    const bloco = document.querySelector("[data-estado-recebimento]");
    expect(bloco?.getAttribute("data-estado-recebimento")).toBe("faltando");
    expect(bloco?.querySelectorAll("li")).toHaveLength(1);
  });

  it("B4 código de falta desconhecido (texto) vira a frase genérica, sem vazar o código", async () => {
    cenario.ler = {
      configurado: true,
      public_key: PUBLICA_FALSA,
      mascara_token: "••••0000",
      mascara_webhook: null,
      ultimo_teste: null,
      pix_ligado: false,
      public_key_na_loja: true,
      pausado: false,
      faltando: ["codigo_interno_secreto_da_edge"],
    };
    await montar();
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("completar as chaves");
    expect(texto).not.toContain("codigo_interno_secreto_da_edge");
  });
});
