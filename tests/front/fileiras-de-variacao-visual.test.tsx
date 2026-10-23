import { readFileSync } from "node:fs";
// @vitest-environment jsdom
import { FileirasDeVariacao } from "@/components/ui/custom/FileirasDeVariacao";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

function montar(valores: string[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <FileirasDeVariacao
      fileiras={[
        {
          nome: "Cor",
          valores: valores.map((valor) => ({
            valor,
            disponivel: valor !== "Branco",
            estoque: valor === "Branco" ? 0 : 2,
          })),
        },
      ]}
      escolha={{ Cor: "Azul" }}
      onEscolher={() => {}}
    />,
  );
  return host;
}

// Mesma conversão HSL e luminância WCAG de tema-do-painel.test.tsx.
function hslParaRgb(canais: string): number[] {
  const [h, s, l] = canais.trim().split(/\s+/).map(Number.parseFloat);
  const sf = s / 100;
  const lf = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) =>
    lf - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}

function contraste(a: number[], b: number[]): number {
  const luminancia = ([r, g, b]: number[]) => {
    const linear = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [x, y] = [luminancia(a), luminancia(b)].sort((a, b) => b - a);
  return (x + 0.05) / (y + 0.05);
}

describe("apresentação acessível das fileiras", () => {
  for (const tema of [":root", ".dark"]) {
    for (const cor of ["Branco", "Creme"]) {
      it(`contorno de ${cor} não selecionado tem pelo menos 3:1 em ${tema}`, () => {
        expect(contraste([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
        const inicio = css.indexOf(`${tema} {`);
        expect(inicio).toBeGreaterThanOrEqual(0);
        const bloco = css.slice(inicio, css.indexOf("}", inicio));
        const fundo = hslParaRgb(bloco.match(/--background:\s*([^;]+);/)![1]);
        const frente = hslParaRgb(bloco.match(/--foreground:\s*([^;]+);/)![1]);
        const host = montar(["Azul", cor]);
        const botao = host.querySelector<HTMLButtonElement>(
          `button[aria-label="${cor}"]`,
        )!;
        expect(botao.getAttribute("aria-pressed")).toBe("false");
        const bolinha = botao.querySelector<HTMLElement>("[style]")!;
        const borda = bolinha.className
          .split(" ")
          .find((classe) => classe.startsWith("border-foreground"));
        expect(borda).toBeDefined();
        const opacidade = botao.disabled
          ? Number(
              botao.className.match(/disabled:opacity-(\d+)/)?.[1] ?? 100,
            ) / 100
          : 1;
        const alfa = (Number(borda?.split("/").at(1) ?? 100) / 100) * opacidade;
        const contorno = frente.map(
          (canal, i) => canal * alfa + fundo.at(i)! * (1 - alfa),
        );
        expect(
          contraste(contorno, fundo),
          `${cor} em ${tema}`,
        ).toBeGreaterThanOrEqual(3);
        expect(bolinha.classList.contains(borda!)).toBe(true);
      });
    }
  }
  it("cores conhecidas usam amostra de 18px à esquerda do nome, em chip de 44px, com nome e seleção", () => {
    const host = montar(["Azul", "Branco"]);
    const azul = host.querySelector('button[aria-label="Azul"]')!;
    const branco = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Branco"]',
    )!;
    expect(azul.getAttribute("aria-pressed")).toBe("true");
    expect(azul.classList.contains("h-11")).toBe(true);
    const amostra = azul.querySelector('[aria-hidden="true"]')!;
    expect(amostra.classList.contains("size-[18px]")).toBe(true);
    expect(amostra.getAttribute("style")).toContain("background-color");
    expect(azul.firstElementChild).toBe(amostra);
    expect(amostra.nextElementSibling?.textContent).toBe("Azul");
    expect(branco.disabled).toBe(true);
    expect(
      branco
        .querySelector('[aria-hidden="true"]')
        ?.classList.contains("border"),
    ).toBe(true);
  });
  it("uma cor desconhecida não derruba a fileira: só ela fica sem amostra", () => {
    const host = montar(["Azul", "Estampado"]);
    const azul = host.querySelector('button[aria-label="Azul"]')!;
    const estampado = host.querySelector('button[aria-label="Estampado"]')!;
    expect(azul.querySelector("[style]")).not.toBeNull();
    expect(estampado.querySelector("[style]")).toBeNull();
    expect(estampado.textContent).toContain("Estampado");
    expect(host.querySelectorAll("[style]").length).toBe(1);
  });
  it("nome composto vira amostra dividida em faixas iguais; uma só cor vira fundo liso", () => {
    const host = montar(["Preto", "Xadrez Preto, Cinza e Branco"]);
    const lisa = host.querySelector<HTMLElement>(
      'button[aria-label="Preto"] [style]',
    )!;
    expect(lisa.getAttribute("style")).toContain("background-color");
    expect(lisa.getAttribute("style")).not.toContain("linear-gradient");
    const dividida = host.querySelector<HTMLElement>(
      'button[aria-label="Xadrez Preto, Cinza e Branco"] [style]',
    )!;
    const estilo = dividida.getAttribute("style")!;
    expect(estilo).toContain("linear-gradient(to bottom");
    // três cores, cada uma com UMA parada de duas posições (início e fim da faixa)
    expect(estilo.match(/#[0-9a-f]{6}/gi)?.length).toBe(3);
    expect(estilo).toContain(" 0%");
    expect(estilo).toContain(" 100%");
    expect(estilo.match(/33\.33\d*%/g)?.length).toBe(2);
    expect(estilo.match(/66\.66\d*%/g)?.length).toBe(2);
  });
  it("só as fileiras Cor/Cores/Color têm amostra: Tamanho com nome de cor é chip de texto", () => {
    const montarFileira = (nome: string) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <FileirasDeVariacao
          fileiras={[
            {
              nome,
              valores: [{ valor: "Preto", disponivel: true, estoque: 1 }],
            },
          ]}
          escolha={{}}
          onEscolher={() => {}}
        />,
      );
      return host;
    };
    expect(montarFileira("Tamanho").querySelector("[style]")).toBeNull();
    for (const nome of ["Cor", "Cores", "Color", " cor "])
      expect(montarFileira(nome).querySelector("[style]"), nome).not.toBeNull();
  });
  it("o rótulo fica acima dos chips: nome mono à esquerda, valor escolhido (ou Escolha) à direita", () => {
    const fileiras = [
      {
        nome: "Tamanho",
        valores: [{ valor: "M", disponivel: true, estoque: 2 }],
      },
    ];
    const montarCom = (escolha: Record<string, string>) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <FileirasDeVariacao
          fileiras={fileiras}
          escolha={escolha}
          onEscolher={() => {}}
        />,
      );
      return host;
    };
    const cabecalho = (h: HTMLElement) =>
      h.querySelector('[role="group"]')!.firstElementChild!;
    const sem = montarCom({});
    const [nome, valor] = cabecalho(sem).children;
    expect(nome.textContent).toBe("Tamanho");
    for (const c of ["font-mono", "text-[11px]", "uppercase"])
      expect(nome.classList.contains(c), c).toBe(true);
    expect(valor.textContent).toBe("Escolha");
    const com = montarCom({ Tamanho: "M" });
    const [, escolhido] = cabecalho(com).children;
    expect(escolhido.textContent).toBe("M");
    expect(escolhido.classList.contains("text-[13px]")).toBe(true);
    expect(escolhido.classList.contains("font-semibold")).toBe(true);
    // o rótulo não é mais uma coluna lateral de 80px
    expect(com.innerHTML).not.toContain("w-20");
    const grupo = com.querySelector('[role="group"]')!;
    expect(
      cabecalho(com).compareDocumentPosition(grupo.querySelector("button")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("todo botão de opção tem alvo de toque h-11 (44px), com ou sem amostra", () => {
    const host = montar(["Azul", "Branco"]);
    const botoes = host.querySelectorAll("button");
    expect(botoes.length).toBe(2);
    for (const b of botoes) expect(b.classList.contains("h-11")).toBe(true);
    const texto = document.createElement("div");
    texto.innerHTML = renderToStaticMarkup(
      <FileirasDeVariacao
        fileiras={[
          {
            nome: "Tamanho",
            valores: [{ valor: "Pp", disponivel: true, estoque: 1 }],
          },
        ]}
        escolha={{}}
        onEscolher={() => {}}
      />,
    );
    const b = texto.querySelector("button")!;
    expect(b.classList.contains("h-11")).toBe(true);
    expect(b.classList.contains("rounded-[14px]")).toBe(true);
    expect(b.classList.contains("px-3.5")).toBe(true);
    expect(b.querySelector("[style]")).toBeNull();
  });
  it("escolhido é tinta (bg-foreground), nunca a cor da marca; a amostra ganha anel", () => {
    const host = montar(["Azul", "Creme"]);
    const azul = host.querySelector('button[aria-label="Azul"]')!;
    const creme = host.querySelector('button[aria-label="Creme"]')!;
    for (const c of ["bg-foreground", "text-background", "border-foreground"])
      expect(azul.classList.contains(c), c).toBe(true);
    expect(azul.className).not.toContain("bg-primary");
    expect(creme.classList.contains("bg-foreground")).toBe(false);
    expect(
      azul.querySelector("[style]")!.classList.contains("ring-background"),
    ).toBe(true);
    expect(
      creme.querySelector("[style]")!.classList.contains("ring-background"),
    ).toBe(false);
  });
  it("esgotado: riscado, esmaecido, desabilitado e avisado ao leitor de tela", () => {
    const host = montar(["Azul", "Branco"]);
    const branco = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Branco"]',
    )!;
    expect(branco.disabled).toBe(true);
    expect(branco.classList.contains("line-through")).toBe(true);
    expect(branco.className).toContain("disabled:text-muted-foreground");
    expect(branco.className).toContain("disabled:border-border/60");
    expect(branco.getAttribute("title")).toBe("Branco — Esgotado");
    expect(branco.querySelector(".sr-only")?.textContent).toBe(" (Esgotado)");
    const azul = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Azul"]',
    )!;
    expect(azul.getAttribute("title")).toBe("Azul");
    expect(azul.querySelector(".sr-only")).toBeNull();
    expect(azul.classList.contains("line-through")).toBe(false);
  });
  it("esgotado que já é a opção ativa continua clicável (para poder desmarcar)", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <FileirasDeVariacao
        fileiras={[
          {
            nome: "Tamanho",
            valores: [{ valor: "GG", disponivel: false, estoque: 0 }],
          },
        ]}
        escolha={{ Tamanho: "GG" }}
        onEscolher={() => {}}
      />,
    );
    const gg = host.querySelector<HTMLButtonElement>("button")!;
    expect(gg.disabled).toBe(false);
    expect(gg.getAttribute("aria-pressed")).toBe("true");
    expect(gg.classList.contains("line-through")).toBe(true);
  });
  it("o grupo é nomeado pelo rótulo (role=group + aria-labelledby)", () => {
    const host = montar(["Azul"]);
    const grupo = host.querySelector('[role="group"]')!;
    const id = grupo.getAttribute("aria-labelledby")!;
    expect(id).toBeTruthy();
    expect(host.querySelector(`[id="${id}"]`)?.textContent).toBe("Cor");
  });
  it("clicar numa opção chama onEscolher(nome da fileira, valor); esgotada não chama", async () => {
    const chamadas: [string, string][] = [];
    const raiz = document.createElement("div");
    document.body.appendChild(raiz);
    const root = createRoot(raiz);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => {
      root.render(
        <FileirasDeVariacao
          fileiras={[
            {
              nome: "Cor",
              valores: [
                {
                  valor: "Xadrez Preto, Cinza e Branco",
                  disponivel: true,
                  estoque: 3,
                },
                { valor: "Branco", disponivel: false, estoque: 0 },
              ],
            },
          ]}
          escolha={{}}
          onEscolher={(nome, valor) => chamadas.push([nome, valor])}
        />,
      );
    });
    await act(async () => {
      raiz
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Xadrez Preto, Cinza e Branco"]',
        )!
        .click();
      raiz
        .querySelector<HTMLButtonElement>('button[aria-label="Branco"]')!
        .click();
    });
    expect(chamadas).toEqual([["Cor", "Xadrez Preto, Cinza e Branco"]]);
    await act(async () => root.unmount());
    raiz.remove();
  });
  it("três chips longos quebram linha sem rolagem lateral (320/360/390)", () => {
    const longos = [
      "Xadrez Preto, Cinza e Branco",
      "Listrado Azul Marinho e Branco",
      "Estampado Floral Rosa e Verde Militar",
    ];
    const host = montar(longos);
    const fileira = host.querySelector('[role="group"]')!;
    const linha = fileira.lastElementChild!;
    // flex-wrap deixa o chip descer de linha; min-w-0 no pai e max-w-full +
    // truncate no chip impedem que um nome enorme alargue a página.
    for (const c of ["flex", "flex-wrap", "min-w-0", "gap-2"])
      expect(linha.classList.contains(c), c).toBe(true);
    expect(fileira.classList.contains("min-w-0")).toBe(true);
    for (const b of host.querySelectorAll("button")) {
      expect(b.classList.contains("max-w-full")).toBe(true);
      expect(b.querySelector(".truncate")).not.toBeNull();
      expect(b.className).not.toMatch(/whitespace-nowrap|\bw-\[/);
    }
    expect(host.innerHTML).not.toMatch(/overflow-x-(auto|scroll)/);
  });
  it("o ProductView não desenha mais o título Opções nem o cartão em volta das fileiras", () => {
    const src = readFileSync("src/views/customer/ProductView.tsx", "utf8");
    const i = src.indexOf("<FileirasDeVariacao");
    expect(i).toBeGreaterThan(0);
    const antes = src.slice(i - 400, i);
    expect(antes).not.toContain("Opções");
    expect(antes).not.toContain("rounded-3xl");
  });
});
