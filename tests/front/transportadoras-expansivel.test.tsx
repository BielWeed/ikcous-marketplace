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

// Melhor Envio: chave + e-mail válidos, sem pendência -> nasce FECHADO.
// SuperFrete: TEM chave mas SEM e-mail (a única que exige e-mail para
// salvar) -> incompleta, nasce ABERTO.
// Frenet: SEM chave -> nasce ABERTO.
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

describe("TransportadorasSection — cartão de provedor expansível (23/09/2026)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_MISTA, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  // Cabeçalhos dos TRÊS cartões de provedor, na ordem ME, SF, Frenet — o
  // guia "Como pegar a chave" também usa `aria-expanded`, por isso o
  // filtro pelo texto do próprio cartão.
  const cabecalhosDeCartao = () =>
    [...hospedeiro.querySelectorAll("button[aria-expanded]")].filter((b) =>
      /Chave de acesso —/.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement[];

  const camposToken = () =>
    [
      ...hospedeiro.querySelectorAll('input[type="password"]'),
    ] as HTMLInputElement[];

  function corpoDoCartao(cabecalho: HTMLButtonElement): HTMLElement {
    const id = cabecalho.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    const corpo = document.getElementById(id ?? "");
    expect(corpo).toBeDefined();
    return corpo as HTMLElement;
  }

  async function clicar(b: HTMLElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function digitar(campo: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("provedor CONFIGURADO e sem pendência (Melhor Envio) nasce FECHADO: resumo visível, corpo com hidden", async () => {
    await abrir();
    const [cabecalhoME] = cabecalhosDeCartao();
    expect(cabecalhoME.getAttribute("aria-expanded")).toBe("false");
    expect(cabecalhoME.textContent).toContain("Ligado");
    const corpo = corpoDoCartao(cabecalhoME);
    expect(corpo.hidden).toBe(true);
    // O campo de chave está no DOM (o padrão escolhido é `hidden`, não
    // desmontar — ver comentário do arquivo), mas fica marcado como oculto
    // junto do corpo inteiro: nenhum campo do Melhor Envio fica alcançável
    // fora do `hidden` do próprio corpo.
    expect(corpo.contains(camposToken()[0])).toBe(true);
  });

  it("provedor SEM CHAVE (Frenet) nasce ABERTO: a pendência aparece sem clique", async () => {
    await abrir();
    const cabecalhoFrenet = cabecalhosDeCartao()[2];
    expect(cabecalhoFrenet.getAttribute("aria-expanded")).toBe("true");
    expect(cabecalhoFrenet.textContent).toContain("Sem chave");
    expect(corpoDoCartao(cabecalhoFrenet).hidden).toBe(false);
  });

  it("provedor com chave mas SEM E-MAIL exigido (SuperFrete) nasce ABERTO", async () => {
    await abrir();
    const cabecalhoSF = cabecalhosDeCartao()[1];
    expect(cabecalhoSF.getAttribute("aria-expanded")).toBe("true");
    expect(cabecalhoSF.textContent).toContain("Sem e-mail de contato");
    expect(corpoDoCartao(cabecalhoSF).hidden).toBe(false);
  });

  it("clique no cabeçalho expande o cartão fechado e o clique seguinte fecha de novo", async () => {
    await abrir();
    const [cabecalhoME] = cabecalhosDeCartao();
    expect(corpoDoCartao(cabecalhoME).hidden).toBe(true);

    await clicar(cabecalhoME);
    expect(cabecalhoME.getAttribute("aria-expanded")).toBe("true");
    expect(corpoDoCartao(cabecalhoME).hidden).toBe(false);

    await clicar(cabecalhoME);
    expect(cabecalhoME.getAttribute("aria-expanded")).toBe("false");
    expect(corpoDoCartao(cabecalhoME).hidden).toBe(true);
  });

  it("o cabeçalho é um <button> real — Enter e Espaço disparam o mesmo clique nativo que o mouse", async () => {
    await abrir();
    const [cabecalhoME] = cabecalhosDeCartao();
    expect(cabecalhoME.tagName).toBe("BUTTON");
    expect(cabecalhoME.type).toBe("button");
    // Alvo de toque >= 44px (min-h-11 = 2.75rem = 44px no Tailwind) e foco
    // visível — conferidos pela classe, já que jsdom não faz layout real.
    expect(cabecalhoME.className).toMatch(/min-h-11/);
    expect(cabecalhoME.className).toMatch(/focus-visible:ring/);
    // O clique nativo (o que o navegador dispara sozinho ao apertar Enter
    // ou Espaço num <button> focado) é o que o handler escuta.
    await clicar(cabecalhoME);
    expect(cabecalhoME.getAttribute("aria-expanded")).toBe("true");
  });

  it("rascunho digitado sobrevive fechar e reabrir o cartão", async () => {
    await abrir();
    const [cabecalhoME] = cabecalhosDeCartao();
    await clicar(cabecalhoME); // abre
    await digitar(camposToken()[0], "tok-me-em-digitacao");
    expect(camposToken()[0].value).toBe("tok-me-em-digitacao");

    await clicar(cabecalhoME); // fecha
    expect(corpoDoCartao(cabecalhoME).hidden).toBe(true);
    // O campo continua no DOM com o MESMO valor — o corpo só ficou oculto,
    // o rascunho mora no estado do pai (`TransportadorasSection`).
    expect(camposToken()[0].value).toBe("tok-me-em-digitacao");

    await clicar(cabecalhoME); // reabre
    expect(corpoDoCartao(cabecalhoME).hidden).toBe(false);
    expect(camposToken()[0].value).toBe("tok-me-em-digitacao");
  });

  it("o guia 'Como pegar a chave' de cada provedor abre por conta própria, com passos numerados e link oficial seguro", async () => {
    await abrir();
    const botaoGuiaME = [...hospedeiro.querySelectorAll("button")].filter((b) =>
      /Como pegar a chave/.test(b.textContent?.trim() ?? ""),
    )[0] as HTMLButtonElement;
    expect(botaoGuiaME).toBeDefined();
    expect(botaoGuiaME.getAttribute("aria-expanded")).toBe("false");

    await clicar(botaoGuiaME);
    expect(botaoGuiaME.getAttribute("aria-expanded")).toBe("true");

    const corpoGuia = corpoDoCartao(botaoGuiaME);
    expect(corpoGuia.hidden).toBe(false);
    const passos = corpoGuia.querySelectorAll("ol li");
    expect(passos.length).toBeGreaterThan(0);

    const link = corpoGuia.querySelector("a") as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("href")).toMatch(/^https:\/\//);
  });

  it("abrir o guia do Melhor Envio não abre o guia da SuperFrete nem da Frenet (cada um independente)", async () => {
    await abrir();
    const botoesGuia = [...hospedeiro.querySelectorAll("button")].filter((b) =>
      /Como pegar a chave/.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement[];
    expect(botoesGuia).toHaveLength(3);

    await clicar(botoesGuia[0]);
    expect(botoesGuia[0].getAttribute("aria-expanded")).toBe("true");
    expect(botoesGuia[1].getAttribute("aria-expanded")).toBe("false");
    expect(botoesGuia[2].getAttribute("aria-expanded")).toBe("false");
  });

  it("a chave salva NUNCA aparece em texto, com os cartões abertos ou fechados", async () => {
    await abrir();
    // Alterna os três (ME abre; SuperFrete e Frenet, que nascem abertas,
    // fecham) — o corpo escondido segue no DOM, então a asserção vale para
    // os dois estados. A fixture marca `tem_chave: true` para Melhor Envio E
    // SuperFrete, mas a edge NUNCA devolve o valor do segredo (só o
    // booleano). Os três campos de senha nascem vazios independente do
    // cartão estar aberto ou fechado — é essa vacuidade que garante que
    // não há segredo para vazar, porque o componente nunca o recebeu.
    for (const cabecalho of cabecalhosDeCartao()) {
      await clicar(cabecalho);
    }
    expect(camposToken().map((c) => c.value)).toEqual(["", "", ""]);
    // Nenhum selo "Chave salva" imprime o valor — só a frase fixa.
    const selos = [...hospedeiro.querySelectorAll("p")].filter((p) =>
      /Chave salva\./.test(p.textContent ?? ""),
    );
    for (const selo of selos) {
      expect(selo.textContent).toBe(
        "Chave salva. Por segurança ela não aparece aqui — para trocar, cole a nova e salve.",
      );
    }
  });
});
