// @vitest-environment jsdom
//
// Chave de TESTE avisa a lojista (14/10/2026). O teste de conexão do Mercado
// Pago deixava a lojista com "Conectado!" em VERDE mesmo com chave de conta de
// teste — e a cliente real só via "Tentar de novo". Agora, quando a conta é de
// teste (`ultimo_teste.ambiente === "teste"`), o resumo do topo da seção fica
// em ÂMBAR e diz o que isso significa. A edge é DUBLÊ; as chaves são FALSAS.
//
//   T1  conta de teste (vinda do `ler`): resumo âmbar com a mensagem e o aviso;
//   T2  conta de produção: segue VERDE, sem aviso nenhum;
//   T3  resposta sem o campo `ambiente` (edge antiga): verde e sem quebrar;
//   T4  "Testar conexão" devolvendo conta de teste: resumo vira âmbar e o aviso
//       do servidor aparece UMA vez só (nada de frase duplicada na tela);
//   T5  o texto da tela é o MESMO da edge (um guarda contra divergência);
//   T6  `modo_de_teste` true -> texto curto; false OU ausente -> o forte
//       (T6b: o campo também vale vindo da resposta do Testar conexão);
//   T7  o aviso do servidor é anunciado (role="status").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBLICA_FALSA = "APP_USR-publica-falsa-de-teste";

const { invokeFalso, cenario } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  cenario: {
    salvo: {} as Record<string, unknown>,
    respostaTestar: {} as Record<string, unknown>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
  if (body?.acao === "ler") return { data: cenario.salvo, error: null };
  if (body?.acao === "testar")
    return { data: cenario.respostaTestar, error: null };
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
  AVISO_CHAVES_DE_TESTE,
  AVISO_CHAVE_DE_TESTE_EM_MODO_DE_TESTE,
} from "@/components/admin/settings/mercado-pago-conteudo";

const FRASE_DO_AVISO = "Suas clientes não vão conseguir pagar";

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

function botaoPorTexto(texto: string): HTMLButtonElement {
  const botao = [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  return botao;
}

/** A camada "Suas chaves" nasce fechada: abre (nunca alterna) para achar o botão de testar. */
async function abrirExpansor(texto: string) {
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes(texto));
  if (!cabecalho) throw new Error(`Expansor "${texto}" não está na tela.`);
  if (cabecalho.getAttribute("aria-expanded") === "true") return;
  await clique(cabecalho as HTMLButtonElement);
}

async function montarSecao(): Promise<Root> {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<MercadoPagoSection />);
  });
  await assentar();
  return raiz;
}

/** O resumo do topo da seção: o quadro com o resultado do último teste. */
function resumoDoTeste(): HTMLElement {
  const alvo = document.body.querySelector("[data-resumo-do-teste]");
  if (!alvo) throw new Error("O resumo do teste não está na tela.");
  return alvo as HTMLElement;
}

function ocorrencias(texto: string, trecho: string): number {
  return texto.split(trecho).length - 1;
}

const CONTA_DE_TESTE = {
  quando: new Date().toISOString(),
  conectado: true,
  mensagem: 'Conectado! Conta "TESTUSER1234567890" no ambiente de teste.',
  ambiente: "teste",
  conta: "TESTUSER1234567890",
};

const CONTA_DE_PRODUCAO = {
  quando: new Date().toISOString(),
  conectado: true,
  mensagem: 'Conectado! Conta "Loja Real".',
  ambiente: "producao",
  conta: "Loja Real",
};

const BASE = {
  configurado: true,
  public_key: PUBLICA_FALSA,
  mascara_token: "••••9999",
  mascara_webhook: "••••7777",
  ultimo_teste: CONTA_DE_PRODUCAO as unknown,
  atualizado_em: new Date().toISOString(),
  pix_ligado: true,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

describe("MercadoPagoSection — chave de TESTE avisa a lojista", () => {
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    cenario.salvo = { ...BASE };
    cenario.respostaTestar = {};
  });

  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    document.body.innerHTML = "";
  });

  it("T1 — conta de teste: o resumo fica âmbar (não verde) e diz que as clientes não conseguem pagar", async () => {
    cenario.salvo = { ...BASE, ultimo_teste: CONTA_DE_TESTE };
    raiz = await montarSecao();

    const resumo = resumoDoTeste();
    expect(resumo.className).toContain("amber");
    expect(resumo.className).not.toContain("emerald");
    expect(resumo.textContent).toContain("TESTUSER1234567890");
    expect(resumo.textContent).toContain(FRASE_DO_AVISO);
    expect(resumo.textContent).toContain("Troque pelas chaves de PRODUÇÃO");
    expect(resumo.textContent).toBe(
      `${CONTA_DE_TESTE.mensagem}${AVISO_CHAVES_DE_TESTE}`,
    );
  });

  it("T2 — conta de produção segue VERDE e sem nenhum aviso de teste", async () => {
    cenario.salvo = { ...BASE, ultimo_teste: CONTA_DE_PRODUCAO };
    raiz = await montarSecao();

    const resumo = resumoDoTeste();
    expect(resumo.className).toContain("emerald");
    expect(resumo.className).not.toContain("amber");
    expect(resumo.textContent).toBe(CONTA_DE_PRODUCAO.mensagem);
    expect(document.body.textContent).not.toContain(FRASE_DO_AVISO);
  });

  it("T3 — resposta sem o campo `ambiente` (edge antiga) segue verde e a tela não quebra", async () => {
    const { ambiente: _ambiente, ...semAmbiente } = CONTA_DE_PRODUCAO;
    cenario.salvo = { ...BASE, ultimo_teste: semAmbiente };
    raiz = await montarSecao();

    const resumo = resumoDoTeste();
    expect(resumo.className).toContain("emerald");
    expect(resumo.className).not.toContain("amber");
    expect(document.body.textContent).not.toContain(FRASE_DO_AVISO);
  });

  it("T4 — Testar conexão com conta de teste: resumo vira âmbar e o aviso do servidor aparece UMA vez só", async () => {
    raiz = await montarSecao();
    expect(resumoDoTeste().className).toContain("emerald");

    cenario.respostaTestar = {
      conectado: true,
      mensagem: CONTA_DE_TESTE.mensagem,
      ambiente: "teste",
      conta: CONTA_DE_TESTE.conta,
      pix_ligado: true,
      public_key_na_loja: true,
      faltando: [],
      pausado: false,
      aviso: AVISO_CHAVES_DE_TESTE,
    };
    await abrirExpansor("Suas chaves");
    await clique(botaoPorTexto("Testar conexão"));

    expect(resumoDoTeste().className).toContain("amber");
    expect(resumoDoTeste().className).not.toContain("emerald");
    expect(ocorrencias(document.body.textContent ?? "", FRASE_DO_AVISO)).toBe(
      1,
    );
  });

  it("T5 — o texto da tela é o MESMO que a edge manda (se um mudar, o outro tem que mudar junto)", () => {
    // Caminho fixo do próprio repositório, nenhuma entrada de usuário.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const edge = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "supabase",
        "functions",
        "credenciais-mercado-pago",
        "index.ts",
      ),
      "utf8",
    );
    expect(edge).toContain(AVISO_CHAVES_DE_TESTE);
    // O aviso curto na edge termina sem ponto (o ponto entra ao juntar avisos).
    expect(edge).toContain(AVISO_CHAVE_DE_TESTE_EM_MODO_DE_TESTE.slice(0, -1));
  });

  it("T6 — com `modo_de_teste: true` o resumo usa o texto CURTO; com `false` OU sem o campo, o forte (nunca cai no curto por padrão)", async () => {
    const casos: Array<[string, Record<string, unknown>, boolean]> = [
      ["true", { modo_de_teste: true }, true],
      ["false", { modo_de_teste: false }, false],
      ["ausente", {}, false],
    ];
    for (const [rotulo, campo, curto] of casos) {
      cenario.salvo = { ...BASE, ultimo_teste: CONTA_DE_TESTE, ...campo };
      raiz = await montarSecao();

      const texto = resumoDoTeste().textContent ?? "";
      expect(texto, rotulo).toContain(CONTA_DE_TESTE.mensagem);
      if (curto) {
        expect(texto, rotulo).toContain(AVISO_CHAVE_DE_TESTE_EM_MODO_DE_TESTE);
        expect(texto, rotulo).not.toContain(FRASE_DO_AVISO);
      } else {
        expect(texto, rotulo).toContain(AVISO_CHAVES_DE_TESTE);
        expect(texto, rotulo).not.toContain(
          AVISO_CHAVE_DE_TESTE_EM_MODO_DE_TESTE,
        );
      }
      await act(async () => {
        raiz.unmount();
      });
      document.body.innerHTML = "";
    }
  });

  it("T6b — `modo_de_teste` que chega na resposta do Testar conexão também vale (e sem aviso do servidor o resumo mostra o curto)", async () => {
    cenario.salvo = { ...BASE, modo_de_teste: false };
    raiz = await montarSecao();
    cenario.respostaTestar = {
      conectado: true,
      mensagem: CONTA_DE_TESTE.mensagem,
      ambiente: "teste",
      conta: CONTA_DE_TESTE.conta,
      pix_ligado: true,
      public_key_na_loja: true,
      faltando: [],
      pausado: false,
      modo_de_teste: true,
    };
    await abrirExpansor("Suas chaves");
    await clique(botaoPorTexto("Testar conexão"));

    const texto = resumoDoTeste().textContent ?? "";
    expect(texto).toContain(AVISO_CHAVE_DE_TESTE_EM_MODO_DE_TESTE);
    expect(texto).not.toContain(FRASE_DO_AVISO);
  });

  it("T7 — o aviso que o servidor manda é anunciado a quem usa leitor de tela (role=status)", async () => {
    raiz = await montarSecao();
    cenario.respostaTestar = {
      conectado: true,
      mensagem: CONTA_DE_TESTE.mensagem,
      ambiente: "teste",
      conta: CONTA_DE_TESTE.conta,
      pix_ligado: true,
      public_key_na_loja: true,
      faltando: [],
      pausado: false,
      aviso: AVISO_CHAVES_DE_TESTE,
    };
    await abrirExpansor("Suas chaves");
    await clique(botaoPorTexto("Testar conexão"));

    const avisos = [
      ...document.body.querySelectorAll('[role="status"]'),
    ].filter((el) => el.textContent?.includes(FRASE_DO_AVISO));
    expect(avisos).toHaveLength(1);
  });
});
