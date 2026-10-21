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
  AVISO_BASE_CHAVES_DE_TESTE,
  AVISO_CHAVES_DE_TESTE,
  AVISO_CHAVE_DE_TESTE_EM_MODO_DE_TESTE,
  AVISO_MODO_DE_TESTE_EM_PRODUCAO as AVISO_MODO_DE_TESTE_DO_FRONT,
} from "@/components/admin/settings/mercado-pago-conteudo";

const FRASE_DO_AVISO = "Essas chaves são de TESTE";
const PIX_FICA_DESLIGADO = "O PIX fica desligado até lá";
const AVISO_MODO_DE_TESTE_EM_PRODUCAO =
  "Seu app está em modo de teste: as compras reais estão indo ao Mercado Pago com um e-mail de teste no lugar do e-mail do cliente, o que pode fazer o cartão ser recusado. Peça para desligar o modo de teste (segredo MP_SANDBOX_PAYER_EMAIL) no servidor.";
/** O que a edge devolve hoje com chave de teste e sem modo declarado: PIX desligado + a falta. */
const BLOQUEADA_POR_CHAVE_DE_TESTE = {
  pix_ligado: false,
  faltando: ["chave_de_teste"],
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

  it("T1 — conta de teste (PIX desligado pela falta): o resumo fica âmbar (não verde) e diz que é preciso trocar as chaves e que o PIX fica desligado", async () => {
    cenario.salvo = {
      ...BASE,
      ...BLOQUEADA_POR_CHAVE_DE_TESTE,
      ultimo_teste: CONTA_DE_TESTE,
    };
    raiz = await montarSecao();

    const resumo = resumoDoTeste();
    expect(resumo.className).toContain("orange");
    expect(resumo.className).not.toContain("emerald");
    expect(resumo.textContent).toContain("TESTUSER1234567890");
    expect(resumo.textContent).toContain(FRASE_DO_AVISO);
    expect(resumo.textContent).toContain("troque pelas chaves de PRODUÇÃO");
    expect(resumo.textContent).toContain(PIX_FICA_DESLIGADO);
    expect(resumo.textContent).toBe(
      `${CONTA_DE_TESTE.mensagem}Último teste: ${new Date(CONTA_DE_TESTE.quando).toLocaleString("pt-BR")}${AVISO_CHAVES_DE_TESTE}`,
    );
  });

  it("T2 — conta de produção segue VERDE e sem nenhum aviso de teste", async () => {
    cenario.salvo = { ...BASE, ultimo_teste: CONTA_DE_PRODUCAO };
    raiz = await montarSecao();

    const resumo = resumoDoTeste();
    expect(resumo.className).toContain("emerald");
    expect(resumo.className).not.toContain("orange");
    expect(resumo.textContent).toBe(
      `${CONTA_DE_PRODUCAO.mensagem}Último teste: ${new Date(CONTA_DE_PRODUCAO.quando).toLocaleString("pt-BR")}`,
    );
    expect(resumo.querySelector("time")?.dateTime).toBe(
      CONTA_DE_PRODUCAO.quando,
    );
    expect(document.body.textContent).not.toContain(FRASE_DO_AVISO);
  });

  it("T3 — resposta sem o campo `ambiente` (edge antiga) segue verde e a tela não quebra", async () => {
    const { ambiente: _ambiente, ...semAmbiente } = CONTA_DE_PRODUCAO;
    cenario.salvo = { ...BASE, ultimo_teste: semAmbiente };
    raiz = await montarSecao();

    const resumo = resumoDoTeste();
    expect(resumo.className).toContain("emerald");
    expect(resumo.className).not.toContain("orange");
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
      ...BLOQUEADA_POR_CHAVE_DE_TESTE,
      public_key_na_loja: true,
      pausado: false,
      aviso: AVISO_CHAVES_DE_TESTE,
    };
    await abrirExpansor("Suas chaves");
    await clique(botaoPorTexto("Testar conexão"));

    expect(resumoDoTeste().className).toContain("orange");
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
    expect(edge).toContain(AVISO_BASE_CHAVES_DE_TESTE);
    expect(AVISO_MODO_DE_TESTE_DO_FRONT).toBe(AVISO_MODO_DE_TESTE_EM_PRODUCAO);
    expect(edge).toContain(AVISO_MODO_DE_TESTE_DO_FRONT);
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
      cenario.salvo = {
        ...BASE,
        ...BLOQUEADA_POR_CHAVE_DE_TESTE,
        ultimo_teste: CONTA_DE_TESTE,
        ...campo,
      };
      raiz = await montarSecao();

      const texto = resumoDoTeste().textContent ?? "";
      expect(texto, rotulo).toContain(CONTA_DE_TESTE.mensagem);
      expect(texto, rotulo).not.toContain(AVISO_MODO_DE_TESTE_EM_PRODUCAO);
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
    // (Em modo de teste declarado o PIX liga como sempre: sem falta nenhuma.)
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
      ...BLOQUEADA_POR_CHAVE_DE_TESTE,
      public_key_na_loja: true,
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

  it("T8 — loja que ainda aparece LIGADA com conta de teste (só desliga quando alguém testa/salva): o resumo avisa SEM dizer que o PIX 'fica desligado'", async () => {
    cenario.salvo = { ...BASE, pix_ligado: true, ultimo_teste: CONTA_DE_TESTE };
    raiz = await montarSecao();

    const texto = resumoDoTeste().textContent ?? "";
    expect(texto).toContain(AVISO_BASE_CHAVES_DE_TESTE);
    expect(texto).not.toContain(PIX_FICA_DESLIGADO);
  });

  it("T10 — produção em modo de teste: aviso no resumo, mesmo sem abrir as chaves", async () => {
    cenario.salvo = { ...BASE, modo_de_teste: true };
    raiz = await montarSecao();

    expect(resumoDoTeste().textContent).toContain(
      AVISO_MODO_DE_TESTE_EM_PRODUCAO,
    );
    expect(resumoDoTeste().querySelector('[role="status"]')?.textContent).toBe(
      AVISO_MODO_DE_TESTE_EM_PRODUCAO,
    );
    expect(resumoDoTeste().className).toContain("orange");
    expect(resumoDoTeste().className).not.toContain("emerald");
    expect(resumoDoTeste().textContent).not.toContain(FRASE_DO_AVISO);
  });

  it.each([false, undefined])(
    "T11 — produção sem modo declarado (%s) não alarma",
    async (modo_de_teste) => {
      cenario.salvo = { ...BASE, modo_de_teste };
      raiz = await montarSecao();

      expect(resumoDoTeste().textContent).not.toContain(
        AVISO_MODO_DE_TESTE_EM_PRODUCAO,
      );
      expect(resumoDoTeste().className).toContain("emerald");
    },
  );

  it("T12 — ambiente desconhecido não é tratado como produção, mesmo em modo de teste", async () => {
    cenario.salvo = {
      ...BASE,
      modo_de_teste: true,
      ultimo_teste: { ...CONTA_DE_PRODUCAO, ambiente: null },
    };
    raiz = await montarSecao();

    expect(resumoDoTeste().textContent).not.toContain(
      AVISO_MODO_DE_TESTE_EM_PRODUCAO,
    );
    expect(resumoDoTeste().className).toContain("emerald");
  });

  it.each(["", "Outro aviso do servidor."])(
    "T13 — Testar conexão mostra o aviso uma vez no topo e preserva o complemento (%s)",
    async (complemento) => {
      raiz = await montarSecao();
      cenario.respostaTestar = {
        ...CONTA_DE_PRODUCAO,
        modo_de_teste: true,
        pix_ligado: true,
        public_key_na_loja: true,
        faltando: [],
        pausado: false,
        aviso: `${AVISO_MODO_DE_TESTE_EM_PRODUCAO} ${complemento}`.trim(),
      };
      await abrirExpansor("Suas chaves");
      await clique(botaoPorTexto("Testar conexão"));

      expect(resumoDoTeste().textContent).toContain(
        AVISO_MODO_DE_TESTE_EM_PRODUCAO,
      );
      expect(
        ocorrencias(
          document.body.textContent ?? "",
          AVISO_MODO_DE_TESTE_EM_PRODUCAO,
        ),
      ).toBe(1);
      if (complemento) expect(document.body.textContent).toContain(complemento);
    },
  );

  it("T9 — a falta nova aparece em linguagem de leigo na lista 'o que falta'; código que a tela não conhece cai em 'completar as chaves' sem quebrar", async () => {
    cenario.salvo = {
      ...BASE,
      ...BLOQUEADA_POR_CHAVE_DE_TESTE,
      ultimo_teste: CONTA_DE_TESTE,
    };
    raiz = await montarSecao();
    expect(document.body.textContent).toContain(
      "trocar as chaves de TESTE pelas de PRODUÇÃO",
    );
    expect(document.body.textContent).not.toContain("chave_de_teste");
    await act(async () => {
      raiz.unmount();
    });
    document.body.innerHTML = "";

    cenario.salvo = {
      ...BASE,
      pix_ligado: false,
      faltando: ["falta_que_a_tela_nao_conhece"],
    };
    raiz = await montarSecao();
    expect(document.body.textContent).toContain("completar as chaves");
    expect(document.body.textContent).not.toContain(
      "falta_que_a_tela_nao_conhece",
    );
  });
});
