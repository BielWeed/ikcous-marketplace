// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), tela "Mercado Pago" de Ajustes: o que o
// "Salvar chaves" aceita, recusa e ENVIA. Chaves FALSAS de propósito (nunca um
// valor real); a edge é um dublê e nenhuma chamada de rede acontece.
//   F1  colagem com espaço e quebra de linha em volta: os TRÊS campos seguem
//       sem o lixo (a chave pública não é recusada por causa de um espaço, e o
//       segredo não vai com espaço para o servidor);
//   F2  a MESMA chave nos dois campos (pública colada no lugar da secreta) é
//       barrada com a frase própria e nada vai ao servidor;
//   F3  formatos de chave pública recusados (token, prefixo errado, tamanho,
//       minúscula no prefixo) NÃO chamam o servidor; os aceitos (APP_USR e TEST,
//       hex maiúsculo ou minúsculo) chamam;
//   F4  loja que já tem chave salva: re-salvar com o campo secreto VAZIO mantém
//       a chave (nenhum `access_token` no corpo); loja sem chave: secreta
//       obrigatória;
//   F5  campo de segredo só com espaços conta como vazio.
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
  cenario: { ler: {} as Record<string, unknown> },
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

const SEM_CHAVE = { configurado: false, faltando: [], pausado: false };
const COM_CHAVE = {
  configurado: true,
  public_key: PUBLICA,
  mascara_token: "••••0000",
  mascara_webhook: "••••1111",
  ultimo_teste: null,
  pix_ligado: false,
  public_key_na_loja: true,
  pausado: false,
  faltando: [],
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

async function salvar() {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Salvar chaves"),
  );
  if (!botao) throw new Error("Botão Salvar chaves não está na tela.");
  await act(async () => {
    botao.click();
  });
  await assentar();
}

const chamadasDeSalvar = () =>
  invokeFalso.mock.calls
    .map(([, opcoes]) => opcoes?.body as Record<string, unknown>)
    .filter((corpo) => corpo?.acao === "salvar");

beforeEach(() => {
  vi.clearAllMocks();
  cenario.ler = SEM_CHAVE;
  invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
    if (body?.acao === "ler") return { data: cenario.ler, error: null };
    if (body?.acao === "salvar") return { data: COM_CHAVE, error: null };
    return { data: null, error: null };
  });
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("Salvar chaves: colagem com espaços", () => {
  it("F1 espaço e quebra de linha em volta dos três campos não vão para o servidor", async () => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", `  ${PUBLICA}\n`);
      digitar("mp-access-token", `\t${TOKEN_FALSO}  `);
      digitar("mp-webhook-secret", ` ${SENHA_AVISOS_FALSA}\n`);
    });
    await salvar();
    expect(toastError).not.toHaveBeenCalled();
    expect(chamadasDeSalvar()).toEqual([
      {
        acao: "salvar",
        public_key: PUBLICA,
        access_token: TOKEN_FALSO,
        webhook_secret: SENHA_AVISOS_FALSA,
      },
    ]);
  });

  it("F5 segredo só com espaços conta como vazio: não satisfaz 'cole a chave secreta'", async () => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", PUBLICA);
      digitar("mp-access-token", "    ");
    });
    await salvar();
    expect(chamadasDeSalvar()).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith(
      "Cole também a chave secreta — é ela que processa os pagamentos.",
    );
  });

  it("F5b loja que já tem chave: token e senha dos avisos só com espaços NÃO vão no corpo", async () => {
    cenario.ler = COM_CHAVE;
    await montar();
    await act(async () => {
      digitar("mp-access-token", "   ");
      digitar("mp-webhook-secret", "  \n ");
    });
    await salvar();
    expect(chamadasDeSalvar()).toEqual([
      { acao: "salvar", public_key: PUBLICA },
    ]);
  });
});

describe("Salvar chaves: a mesma chave nos dois campos", () => {
  it("F2 chave pública colada também no campo secreto: frase própria e nada vai ao servidor", async () => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", PUBLICA);
      digitar("mp-access-token", PUBLICA);
    });
    await salvar();
    expect(chamadasDeSalvar()).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith(
      "A chave pública não pode ser o token secreto. Confira os campos.",
    );
  });

  it("F2b igualdade vale depois de tirar os espaços", async () => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", PUBLICA);
      digitar("mp-access-token", ` ${PUBLICA} `);
    });
    await salvar();
    expect(chamadasDeSalvar()).toHaveLength(0);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

describe("Salvar chaves: formato da chave pública", () => {
  it.each([
    [
      "token secreto no lugar da pública",
      "APP_USR-token-ficticio-que-nao-e-publica",
    ],
    [
      "chave de teste fictícia sem o formato",
      "TEST-chave-publica-ficticia-0001",
    ],
    ["prefixo desconhecido", "XYZ-11111111-1111-4111-8111-111111111111"],
    ["prefixo em minúsculas", "app_usr-11111111-1111-4111-8111-111111111111"],
    ["sem prefixo", "11111111-1111-4111-8111-111111111111"],
    ["último bloco curto", "APP_USR-11111111-1111-4111-8111-11111111111"],
    ["último bloco longo", "APP_USR-11111111-1111-4111-8111-1111111111111"],
    [
      "letra fora do hexadecimal",
      "APP_USR-1111111g-1111-4111-8111-111111111111",
    ],
    ["texto depois da chave", `${PUBLICA} extra`],
  ])("F3 recusa: %s", async (_nome, publica) => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", publica);
      digitar("mp-access-token", TOKEN_FALSO);
    });
    await salvar();
    expect(chamadasDeSalvar()).toHaveLength(0);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toContain(
      "Copie a chave pública (Public Key)",
    );
    // A chave secreta digitada não aparece no aviso.
    expect(JSON.stringify(toastError.mock.calls)).not.toContain(TOKEN_FALSO);
  });

  it.each([
    ["APP_USR minúsculo", PUBLICA],
    ["APP_USR hex maiúsculo", "APP_USR-AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
    ["TEST (sandbox)", "TEST-11111111-1111-4111-8111-111111111111"],
  ])("F3 aceita: %s", async (_nome, publica) => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", publica);
      digitar("mp-access-token", TOKEN_FALSO);
    });
    await salvar();
    expect(toastError).not.toHaveBeenCalled();
    expect(chamadasDeSalvar()).toHaveLength(1);
    expect(chamadasDeSalvar()[0]?.public_key).toBe(publica);
  });
});

describe("Salvar chaves: segredo vazio mantém a chave salva", () => {
  it("F4 loja SEM chave exige a secreta e não chama o servidor sem ela", async () => {
    await montar();
    await act(async () => {
      digitar("mp-public-key", PUBLICA);
    });
    await salvar();
    expect(chamadasDeSalvar()).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith(
      "Cole também a chave secreta — é ela que processa os pagamentos.",
    );
  });

  it("F4b loja COM chave: salvar de novo com tudo vazio manda só a pública (a secreta salva fica)", async () => {
    cenario.ler = COM_CHAVE;
    await montar();
    await salvar();
    expect(toastError).not.toHaveBeenCalled();
    expect(chamadasDeSalvar()).toEqual([
      { acao: "salvar", public_key: PUBLICA },
    ]);
  });

  it("F4c loja COM chave: trocar só a pública manda a nova pública e nenhum segredo", async () => {
    cenario.ler = COM_CHAVE;
    await montar();
    await act(async () => {
      digitar("mp-public-key", "TEST-22222222-2222-4222-8222-222222222222");
    });
    await salvar();
    expect(chamadasDeSalvar()).toEqual([
      {
        acao: "salvar",
        public_key: "TEST-22222222-2222-4222-8222-222222222222",
      },
    ]);
  });
});
