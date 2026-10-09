// @vitest-environment jsdom
//
// G4 do painel simples (spec §6, glossário em src/lib/glossario-do-painel.ts):
// o pagamento pelo app na língua da loja. SÓ TEXTO — nenhuma chamada a
// `credenciais-mercado-pago`, nenhum payload e nenhuma condição muda.
//
// O que ESTE arquivo prova:
//   L1  os 3 diagnósticos do termômetro do PIX (StatusPagamentoPix) dizem o
//       que houve e o que fazer, sem MP_ACCESS_TOKEN, Supabase, flag nem
//       frota; os rótulos de nível ("Funcionando", "Chave ausente",
//       "Desligado") e "Pagamento online (PIX)" ficam — a tela de Ajustes os
//       espelha;
//   L2  o que falta (`faltando` da edge) sai com o nome que o lojista conhece:
//       chave pública, chave secreta, senha dos avisos;
//   L3  os campos levam o nome da loja e o termo do Mercado Pago entre
//       parênteses (ponte com as mensagens da edge, que não mudam); a máscara
//       e os placeholders também;
//   L4  os avisos de "cole a chave" falam a língua da loja e NÃO chamam a edge
//       (o comportamento do salvar segue o mesmo);
//   L5  o passo 5 do guia e o recado de segurança: termo do Mercado Pago só
//       entre parênteses;
//   L6  o prompt pronto continua com os nomes que o agente do Mercado Pago
//       conhece (é texto PARA o agente, não para o lojista).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeFalso, leitura } = vi.hoisted(() => ({
  invokeFalso: vi.fn(),
  leitura: { valor: {} as Record<string, unknown> },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
  if (body?.acao === "ler") return { data: leitura.valor, error: null };
  return { data: null, error: null };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
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
import {
  PASSOS_DO_GUIA,
  PROMPT_PARA_AGENTE_MP,
  RECADO_DE_SEGURANCA,
} from "@/components/admin/settings/mercado-pago-conteudo";
import { padroesProibidosDoPainel } from "@/lib/glossario-do-painel";
import { StatusPagamentoPix } from "@/views/admin/StatusPagamentoPix";

/** Os termos do glossário que aparecem no texto (lista vazia = limpo). */
function jargaoEm(texto: string): string[] {
  return padroesProibidosDoPainel().flatMap((padrao) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- padrão constante do glossário, não entrada de usuário
    const achado = texto.match(new RegExp(padrao.source, `${padrao.flags}g`));
    return achado ?? [];
  });
}

/** O texto sem o que está entre parênteses (a ponte com o termo técnico). */
function semParenteses(texto: string): string {
  return texto.replace(/\([^()]*\)/g, "");
}

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function abrirExpansor(texto: string) {
  const cabecalho = [
    ...document.body.querySelectorAll("button[aria-expanded]"),
  ].find((b) => b.textContent?.includes(texto));
  if (!cabecalho) throw new Error(`Expansor "${texto}" não está na tela.`);
  await act(async () => {
    (cabecalho as HTMLButtonElement).click();
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

function rotuloDe(id: string): string {
  return (
    document.body.querySelector(`label[for="${id}"] span`)?.textContent ??
    document.body.querySelector(`label[for="${id}"]`)?.textContent ??
    ""
  ).trim();
}

const SALVO = {
  configurado: true,
  public_key: "APP_USR-publica-falsa-de-teste",
  mascara_token: "••••9999",
  mascara_webhook: "••••7777",
  ultimo_teste: null,
  atualizado_em: new Date().toISOString(),
  pix_ligado: false,
  public_key_na_loja: true,
  faltando: [] as string[],
  pausado: false,
};

describe("StatusPagamentoPix — o diagnóstico na língua da loja (L1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function diagnosticoDe(props: { ligado: boolean; chaveOk: boolean }) {
    await act(async () => {
      raiz.render(<StatusPagamentoPix {...props} />);
    });
    await act(async () => {
      hospedeiro.querySelector("button")!.click();
    });
    return hospedeiro.textContent ?? "";
  }

  const CASOS = [
    {
      nome: "ok",
      props: { ligado: true, chaveOk: true },
      rotulo: "Funcionando",
      frases: [
        "Ligado e com a chave pública da loja.",
        "Se algum cliente não conseguir pagar por PIX, confira em Pagamentos › Mercado Pago se não falta nenhuma chave.",
      ],
    },
    {
      nome: "alerta",
      props: { ligado: true, chaveOk: false },
      rotulo: "Chave ausente",
      frases: [
        "falta a chave pública da loja: a tela de pagamento não abre para o cliente",
        "Salve as chaves de novo em Pagamentos › Mercado Pago",
        "fale com o suporte técnico",
      ],
    },
    {
      nome: "off",
      props: { ligado: false, chaveOk: false },
      rotulo: "Desligado",
      frases: [
        "O cliente paga na entrega.",
        "Para receber por PIX no app, cadastre as chaves em Pagamentos › Mercado Pago.",
      ],
    },
  ] as const;

  for (const caso of CASOS) {
    it(`${caso.nome}: diz o que houve e o que fazer, sem jargão técnico`, async () => {
      const texto = await diagnosticoDe(caso.props);

      expect(texto).toContain("Pagamento online (PIX)");
      expect(texto).toContain(caso.rotulo);
      for (const frase of caso.frases) expect(texto).toContain(frase);

      expect(jargaoEm(texto)).toEqual([]);
      expect(texto).not.toMatch(/MP_|Supabase|\bflag\b|\bfrota\b/i);
      // O termômetro só vê ligado + chave pública, não a senha dos avisos (sem
      // ela a cobrança do PIX é recusada): nenhum nível promete que já paga.
      expect(texto).not.toContain("já paga");
    });
  }

  it("nenhum texto do termômetro fica menor que 11px", async () => {
    await diagnosticoDe({ ligado: true, chaveOk: false });
    // Mesma régua de regua-visual-do-painel: nada de text-[6px] … text-[10px].
    for (const tamanho of [6, 7, 8, 9, 10]) {
      expect(hospedeiro.innerHTML).not.toContain(`text-[${tamanho}`);
    }
  });
});

describe("MercadoPagoSection — as chaves com o nome que a loja entende", () => {
  let raiz: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    leitura.valor = { ...SALVO };
  });

  afterEach(async () => {
    if (raiz) {
      const montada = raiz;
      await act(async () => {
        montada.unmount();
      });
      raiz = null;
    }
    document.body.innerHTML = "";
  });

  async function montarComChavesAbertas() {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const montada = raiz;
    await act(async () => {
      montada.render(<MercadoPagoSection />);
    });
    await assentar();
    await abrirExpansor("Suas chaves");
  }

  it("L2 — o que falta sai como chave pública, chave secreta e senha dos avisos", async () => {
    leitura.valor = {
      ...SALVO,
      configurado: false,
      public_key: null,
      mascara_token: null,
      mascara_webhook: null,
      faltando: ["public_key", "access_token", "chave_notificacoes"],
    };
    await montarComChavesAbertas();

    const estado =
      document.body.querySelector("[data-estado-recebimento]")?.textContent ??
      "";
    expect(estado).toContain("Falta para receber pelo app:");
    expect(estado).toContain("colar a chave pública");
    expect(estado).toContain("colar a chave secreta");
    expect(estado).toContain("colar a senha dos avisos");
    expect(jargaoEm(estado)).toEqual([]);
  });

  it("L3 — rótulos com o nome da loja e o termo do Mercado Pago entre parênteses", async () => {
    await montarComChavesAbertas();

    expect(rotuloDe("mp-public-key")).toBe("Chave pública (Public Key)");
    expect(rotuloDe("mp-access-token")).toBe("Chave secreta (Access Token)");
    expect(rotuloDe("mp-webhook-secret")).toBe(
      "Senha dos avisos (Chave de notificações) — obrigatória para receber pelo app",
    );

    // A máscara do resumo também usa o nome da loja.
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("Chave secreta ••••9999");
    expect(texto).toContain("Senha dos avisos ••••7777");
    expect(texto).not.toContain("Access Token ••••");

    // Tudo o que está FORA dos parênteses e fora do prompt pronto está limpo.
    const semPrompt = [...document.body.querySelectorAll("label, p, span")]
      .filter((el) => !el.closest("pre"))
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(jargaoEm(semParenteses(semPrompt))).toEqual([]);
  });

  it("L3 — placeholders sem termo técnico (sem nada salvo)", async () => {
    leitura.valor = {
      ...SALVO,
      configurado: false,
      mascara_token: null,
      mascara_webhook: null,
    };
    await montarComChavesAbertas();

    const token = document.getElementById(
      "mp-access-token",
    ) as HTMLInputElement;
    const senha = document.getElementById(
      "mp-webhook-secret",
    ) as HTMLInputElement;
    expect(token.placeholder).toBe("Cole aqui a chave secreta de produção…");
    expect(senha.placeholder).toBe("Cole aqui a senha dos avisos da sua loja");
    expect(jargaoEm(`${token.placeholder} ${senha.placeholder}`)).toEqual([]);
  });

  it("L3 — ligado sem a chave pública na ficha da loja: o aviso fala a língua da loja", async () => {
    leitura.valor = { ...SALVO, pix_ligado: true, public_key_na_loja: false };
    await montarComChavesAbertas();

    const texto = document.body.textContent ?? "";
    expect(texto).toContain(
      "A ficha da loja ainda não carrega esta chave pública — salve as chaves de novo para o cliente conseguir pagar.",
    );
  });

  it("L4 — os avisos de 'cole a chave' falam a língua da loja e não chamam a edge", async () => {
    leitura.valor = {
      ...SALVO,
      configurado: false,
      public_key: null,
      mascara_token: null,
      mascara_webhook: null,
      faltando: ["public_key", "access_token", "chave_notificacoes"],
    };
    await montarComChavesAbertas();
    invokeFalso.mockClear();

    await act(async () => {
      botaoPorTexto("Salvar chaves").click();
    });
    expect(toastError).toHaveBeenLastCalledWith(
      "Cole a chave pública do Mercado Pago.",
    );

    await act(async () => {
      digitar("mp-public-key", "APP_USR-publica-falsa-de-teste");
    });
    await act(async () => {
      botaoPorTexto("Salvar chaves").click();
    });
    expect(toastError).toHaveBeenLastCalledWith(
      "Cole também a chave secreta — é ela que processa os pagamentos.",
    );

    // Mesma trava de antes: nenhum dos dois avisos chega a chamar a edge.
    expect(invokeFalso).not.toHaveBeenCalled();
  });
});

describe("mercado-pago-conteudo — guia e recado na língua da loja", () => {
  it("L5 — o passo 5 usa os nomes da loja; o termo do Mercado Pago só entre parênteses", () => {
    const passo5 = PASSOS_DO_GUIA[4];
    expect(passo5.titulo).toBe("Volte aqui: cole as três chaves e salve");
    expect(passo5.descricao).toContain("chave pública (Public Key)");
    expect(passo5.descricao).toContain("chave secreta (Access Token)");
    expect(passo5.descricao).toContain(
      '"Senha dos avisos (Chave de notificações)"',
    );
    expect(jargaoEm(semParenteses(passo5.descricao))).toEqual([]);
  });

  it("L5 — o recado de segurança não fala em Access Token", () => {
    expect(RECADO_DE_SEGURANCA).toContain("chave secreta");
    expect(jargaoEm(RECADO_DE_SEGURANCA)).toEqual([]);
  });

  it("L6 — o prompt para o agente do Mercado Pago mantém os nomes de lá", () => {
    expect(PROMPT_PARA_AGENTE_MP).toContain("PUBLIC KEY");
    expect(PROMPT_PARA_AGENTE_MP).toContain("ACCESS TOKEN");
    expect(PROMPT_PARA_AGENTE_MP).toContain("Assinatura secreta");
    // e aponta o campo da loja pelo nome novo
    expect(PROMPT_PARA_AGENTE_MP).toContain(
      'no campo "Senha dos avisos (Chave de notificações)"',
    );
  });
});
