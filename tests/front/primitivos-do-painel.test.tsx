// @vitest-environment jsdom
//
// Painel simples, B6 + B7: primitivos de base do painel. A cor nunca é a única
// pista (selo = ícone + texto), o vazio explica e oferece um próximo passo, o
// esqueleto avisa o leitor de tela, e a seção recolhível nunca perde o que a
// lojista digitou (conteúdo fechado continua montado, só `hidden`).
import { Package } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

describe("SeloDeStatus", () => {
  it("tem ícone aria-hidden E texto visível (a cor não é a única pista)", async () => {
    const { SeloDeStatus } = await import(
      "@/components/admin/primitivos/SeloDeStatus"
    );
    await act(async () => {
      raiz.render(<SeloDeStatus tom="ok">Pago</SeloDeStatus>);
    });

    const selo = hospedeiro.firstElementChild as HTMLElement;
    expect(selo.textContent).toContain("Pago");
    const icone = selo.querySelector("svg");
    expect(icone).toBeTruthy();
    expect(icone!.getAttribute("aria-hidden")).toBe("true");
    expect(selo.className).toContain("rounded-full");
  });

  it("cada tom tem um ícone próprio (não só uma cor diferente)", async () => {
    const { SeloDeStatus } = await import(
      "@/components/admin/primitivos/SeloDeStatus"
    );
    const tons = ["ok", "atencao", "erro", "neutro"] as const;
    const formas = new Set<string>();
    for (const tom of tons) {
      await act(async () => {
        raiz.render(<SeloDeStatus tom={tom}>x</SeloDeStatus>);
      });
      formas.add(hospedeiro.querySelector("svg")!.innerHTML);
    }
    expect(formas.size).toBe(tons.length);
  });
});

describe("EstadoVazio", () => {
  it("mostra título e frase, sem botão quando não há ação", async () => {
    const { EstadoVazio } = await import(
      "@/components/admin/primitivos/EstadoVazio"
    );
    await act(async () => {
      raiz.render(
        <EstadoVazio
          icone={Package}
          titulo="Nenhum pedido ainda"
          frase="Quando alguém comprar, o pedido aparece aqui."
        />,
      );
    });

    expect(hospedeiro.textContent).toContain("Nenhum pedido ainda");
    expect(hospedeiro.textContent).toContain(
      "Quando alguém comprar, o pedido aparece aqui.",
    );
    expect(hospedeiro.querySelector("button")).toBeNull();
  });

  it("com ação, o botão tem 44px e dispara o clique", async () => {
    const { EstadoVazio } = await import(
      "@/components/admin/primitivos/EstadoVazio"
    );
    const aoClicar = vi.fn();
    await act(async () => {
      raiz.render(
        <EstadoVazio
          titulo="Sem produtos"
          frase="Cadastre o primeiro."
          acao={{ rotulo: "Novo produto", aoClicar }}
        />,
      );
    });

    const botao = hospedeiro.querySelector("button")!;
    expect(botao.textContent).toBe("Novo produto");
    expect(botao.className).toContain("min-h-11");
    await act(async () => {
      botao.click();
    });
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });
});

describe("EsqueletoDaLista", () => {
  it("tem aria-busy e o texto sr-only Carregando…", async () => {
    const { EsqueletoDaLista } = await import(
      "@/components/admin/primitivos/EsqueletoDaLista"
    );
    await act(async () => {
      raiz.render(<EsqueletoDaLista linhas={3} />);
    });

    const caixa = hospedeiro.firstElementChild as HTMLElement;
    expect(caixa.getAttribute("aria-busy")).toBe("true");
    const aviso = caixa.querySelector(".sr-only");
    expect(aviso?.textContent).toBe("Carregando…");
  });

  it("desenha o número de linhas pedido", async () => {
    const { EsqueletoDaLista } = await import(
      "@/components/admin/primitivos/EsqueletoDaLista"
    );
    await act(async () => {
      raiz.render(<EsqueletoDaLista linhas={4} />);
    });

    expect(hospedeiro.querySelectorAll("[data-linha-do-esqueleto]").length).toBe(
      4,
    );
  });
});

describe("SecaoRecolhivel", () => {
  async function montar(
    props: { temErro?: boolean; abertaInicial?: boolean } = {},
  ) {
    const { SecaoRecolhivel } = await import(
      "@/components/admin/primitivos/SecaoRecolhivel"
    );
    await act(async () => {
      raiz.render(
        <SecaoRecolhivel titulo="Dados fiscais" {...props}>
          <input aria-label="CNPJ" defaultValue="" />
        </SecaoRecolhivel>,
      );
    });
  }

  const cabecalho = () => hospedeiro.querySelector("button")!;
  const campo = () => hospedeiro.querySelector("input")!;

  it("começa fechada e aria-expanded alterna a cada clique", async () => {
    await montar();

    expect(cabecalho().getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      cabecalho().click();
    });
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      cabecalho().click();
    });
    expect(cabecalho().getAttribute("aria-expanded")).toBe("false");
  });

  it("o botão aponta (aria-controls) para a região do conteúdo", async () => {
    await montar();

    const alvo = document.getElementById(
      cabecalho().getAttribute("aria-controls")!,
    );
    expect(alvo).toBeTruthy();
    expect(alvo!.contains(campo())).toBe(true);
  });

  it("fechada, o conteúdo continua MONTADO, só hidden", async () => {
    await montar();

    expect(campo()).toBeTruthy();
    const regiao = document.getElementById(
      cabecalho().getAttribute("aria-controls")!,
    )!;
    expect(regiao.hidden).toBe(true);
    await act(async () => {
      cabecalho().click();
    });
    expect(regiao.hidden).toBe(false);
  });

  it("fechar de novo não perde o que foi digitado", async () => {
    await montar({ abertaInicial: true });

    const entrada = campo();
    entrada.value = "12.345.678/0001-99";
    await act(async () => {
      cabecalho().click();
    });
    expect(campo()).toBe(entrada);
    expect(campo().value).toBe("12.345.678/0001-99");
  });

  it("com temErro abre sozinha", async () => {
    await montar({ temErro: true });

    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
  });

  it("o erro que aparece depois abre a seção que estava fechada", async () => {
    await montar();
    expect(cabecalho().getAttribute("aria-expanded")).toBe("false");

    await montar({ temErro: true });
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true");
  });

  it("o cabeçalho tem alvo de 44px", async () => {
    await montar();

    expect(cabecalho().className).toContain("min-h-11");
  });
});
