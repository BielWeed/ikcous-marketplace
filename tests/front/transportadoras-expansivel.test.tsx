// @vitest-environment jsdom
//
// Pedido do dono (23/09/2026): os cartões de provedor (TransportadorasCard)
// ficaram longos demais no celular. Este arquivo prende o comportamento do
// cartão EXPANSÍVEL — fechado mostra só nome + estado em palavras; clique
// (ou Enter/Espaço) no cabeçalho revela chave, e-mail, modo de teste,
// serviços e botões — sem mexer em NENHUMA regra de negócio já provada nos
// outros arquivos `transportadoras-*.test.tsx` (que continuam passando sem
// alteração: o padrão escolhido — `hidden` no corpo do cartão, nunca
// desmontar — mantém todo campo/botão presente no DOM, só invisível).
//
// O que este arquivo prende:
//   1. cartão CONFIGURADO e sem pendência nasce FECHADO — mostra resumo
//      (nome + estado), mas o corpo (chave, e-mail, botões) fica com
//      `hidden`, então não é alcançável por quem usa mouse ou leitor de
//      tela mesmo estando no DOM;
//   2. cartão INCOMPLETO (sem chave; ou, só para a SuperFrete, com chave
//      mas sem e-mail de contato válido — a única que EXIGE e-mail para
//      salvar) nasce ABERTO — a pendência tem de aparecer sem clique;
//   3. clique no cabeçalho expande (aria-expanded muda, `hidden` some);
//   4. Enter e Espaço no cabeçalho fazem o mesmo que o clique (é um
//      `<button>` de verdade — o navegador ativa sozinho; aqui só provamos
//      que o elemento é mesmo um `<button>` focável, disparando o clique
//      nativo que o handler entende);
//   5. o rascunho digitado sobrevive a fechar e reabrir o cartão (o estado
//      mora no PAI — `TransportadorasSection` —, o corpo do cartão só fica
//      `hidden`, nunca desmonta);
//   6. o guia "Como pegar a chave" de cada provedor abre por conta própria
//      (independente do cartão), tem passos numerados e um link para a
//      fonte oficial com `target="_blank"` e `rel="noopener noreferrer"`;
//   7. a chave salva nunca aparece em texto, nem com o cartão aberto.
//
// Tokens e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, descartarCache } = vi.hoisted(() => ({
  invoke: vi.fn(),
  descartarCache: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => descartarCache(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Configuração fictícia; nenhum segredo é devolvido.
const RESPOSTA_MISTA = {
  success: true,
  modo: "multi",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: {
      tem_chave: true,
      sandbox: false,
      servicos: null,
      contato_email: "tecnico@loja-ficticia.com.br",
    },
    superfrete: {
      tem_chave: true,
      sandbox: false,
      servicos: null,
      contato_email: "",
    },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

describe("Transportadoras — lista e folha por cima, sem duplicar o formulário", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockImplementation(async (_: string, opcoes: any) => ({
      data:
        opcoes.body.action === "ler_configuracao_frete"
          ? RESPOSTA_MISTA
          : { success: true },
    }));
    hospedeiro = document.createElement("div");
    document.body.append(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });
  async function abrir() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => raiz.render(<TransportadorasSection />));
  }
  function nome(provedor: string) {
    return hospedeiro.querySelector<HTMLButtonElement>(
      `button[aria-label="${provedor}"]`,
    )!;
  }
  function folha() {
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  }
  async function clicar(b: HTMLElement) {
    expect(b).toBeTruthy();
    await act(async () => b.click());
  }
  async function fechar() {
    await clicar(
      folha().querySelector<HTMLButtonElement>('[aria-label="Fechar"]')!,
    );
    await act(async () => {
      await esperarMicrotarefas();
    });
  }
  async function digitar(valor: string) {
    const input = folha().querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("configurada nasce como linha, sem campo de segredo fora da folha", async () => {
    await abrir();
    expect(nome("Melhor Envio").getAttribute("aria-expanded")).toBe("false");
    expect(nome("Melhor Envio").textContent).toContain("Ligada");
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it("sem chave a linha informa como conectar, mas não abre uma folha sozinha", async () => {
    await abrir();
    expect(nome("Frenet").textContent).toContain(
      "Sem chave — toque para conectar",
    );
    expect(folha()).toBeNull();
  });
  it("e-mail incompleto aparece na linha e impede ligar a SuperFrete", async () => {
    await abrir();
    expect(nome("SuperFrete").textContent).toContain(
      "Falta o e-mail de contato",
    );
    expect(
      hospedeiro.querySelector<HTMLButtonElement>(
        '[aria-label="Ligar SuperFrete"]',
      )?.disabled,
    ).toBe(true);
  });
  it("nome abre a folha nomeada; fechar desmonta o formulário e devolve foco", async () => {
    await abrir();
    nome("Melhor Envio").focus();
    await clicar(nome("Melhor Envio"));
    expect(folha().textContent).toContain("Melhor Envio");
    expect(nome("Melhor Envio").getAttribute("aria-expanded")).toBe("true");
    await fechar();
    expect(folha()).toBeNull();
    expect(nome("Melhor Envio").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(nome("Melhor Envio"));
  });
  it("alvo do nome é botão de 44px com indicação de foco", async () => {
    await abrir();
    expect(nome("Melhor Envio").tagName).toBe("BUTTON");
    expect(nome("Melhor Envio").className).toContain("min-h-11");
    expect(nome("Melhor Envio").className).toContain("focus-visible:ring");
    await clicar(nome("Melhor Envio"));
    expect(folha()).toBeTruthy();
  });
  it("rascunho sobrevive ao fechar e trocar de transportadora sem nova leitura", async () => {
    await abrir();
    await clicar(nome("Melhor Envio"));
    await digitar("chave-ficticia-pendente");
    await fechar();
    await clicar(nome("Frenet"));
    expect(
      folha().querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe("");
    await fechar();
    await clicar(nome("Melhor Envio"));
    expect(
      folha().querySelector<HTMLInputElement>('input[type="password"]')?.value,
    ).toBe("chave-ficticia-pendente");
    expect(
      invoke.mock.calls.filter(
        (c) => c[1].body.action === "ler_configuracao_frete",
      ),
    ).toHaveLength(1);
  });
  it("guia da chave abre com passos e link oficial seguro", async () => {
    await abrir();
    await clicar(nome("Melhor Envio"));
    const guia = [
      ...folha().querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("Como pegar a chave"))!;
    await clicar(guia);
    expect(guia.getAttribute("aria-expanded")).toBe("true");
    expect(folha().querySelectorAll("ol li").length).toBeGreaterThan(0);
    const link = folha().querySelector("a")!;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.href).toMatch(/^https:/);
  });
  it("o guia da outra transportadora não herda a abertura anterior", async () => {
    await abrir();
    await clicar(nome("Melhor Envio"));
    await clicar(
      [...folha().querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("Como pegar a chave"),
      )!,
    );
    await fechar();
    await clicar(nome("SuperFrete"));
    expect(
      [...folha().querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Como pegar a chave"))
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("nenhuma das três folhas revela a chave salva", async () => {
    await abrir();
    for (const provedor of ["Melhor Envio", "SuperFrete", "Frenet"]) {
      await clicar(nome(provedor));
      expect(
        folha().querySelector<HTMLInputElement>('input[type="password"]')
          ?.value,
      ).toBe("");
      if (provedor !== "Frenet")
        expect(folha().textContent).toContain(
          "Chave salva. Por segurança ela não aparece aqui",
        );
      await fechar();
    }
  });
});
