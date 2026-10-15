// @vitest-environment jsdom
//
// Os três jeitos de a cliente chegar às políticas: a frase "Ao finalizar você
// concorda com…" (checkout e cadastro), o link "Trocas e devoluções" (produto)
// e os três links do rodapé da vitrine. A promessa central: o que abre por
// cima de uma tela em andamento é FOLHA — a tela de baixo não sai do lugar.
import { readFileSync } from "node:fs";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja da Ana" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () =>
          Promise.resolve({ data: null, error: { message: "fora do ar" } }),
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("folha e links das políticas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar(node: React.ReactNode) {
    await act(async () => {
      raiz.render(node);
    });
    await act(async () => {
      await esperar();
    });
  }

  const botaoPorTexto = (texto: string): HTMLButtonElement => {
    const achado = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(achado, `botão "${texto}"`).toBeDefined();
    return achado as HTMLButtonElement;
  };

  // A folha é carregada sob demanda (import dinâmico): espera ela aparecer.
  async function aguardarFolha(): Promise<Element> {
    for (let i = 0; i < 80; i++) {
      const folha = document.querySelector('[data-testid="folha-politica"]');
      if (folha) return folha;
      await act(async () => {
        await esperar(25);
      });
    }
    throw new Error("a folha da política não abriu");
  }

  it("frase de aceite: texto exato, com os dois links, sem caixa de marcar", async () => {
    const { FraseDeAceite } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    await renderizar(<FraseDeAceite acao="finalizar" />);
    const frase = hospedeiro.querySelector('[data-testid="frase-de-aceite"]');
    expect(frase?.textContent).toBe(
      "Ao finalizar você concorda com os Termos de uso e a Política de Privacidade.",
    );
    expect(hospedeiro.querySelector('input[type="checkbox"]')).toBeNull();
    expect(frase?.querySelectorAll("button")).toHaveLength(2);
  });

  it("alvo de toque de 44px com caixa REAL: sem margem negativa, sem remendo de padding, links na mesma linha", async () => {
    const { FraseDeAceite, LinkDeTrocas } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    await renderizar(
      <>
        <FraseDeAceite acao="finalizar" />
        <LinkDeTrocas />
      </>,
    );
    const frase = hospedeiro.querySelector(
      '[data-testid="frase-de-aceite"]',
    ) as HTMLElement;
    const todos = [frase, ...frase.querySelectorAll("*")].concat([
      ...hospedeiro.querySelectorAll(
        '[data-testid="link-trocas-e-devolucoes"]',
      ),
    ]);
    for (const el of todos) {
      const classes = (el.getAttribute("class") ?? "").split(/\s+/);
      // Margem negativa faz a área de toque invadir o vizinho (o botão
      // Finalizar fica a 6px da frase): proibida.
      expect(
        classes.filter((c) => /^-m[trblxy]?-/.test(c)),
        `margem negativa em <${el.tagName.toLowerCase()}>`,
      ).toEqual([]);
    }
    const botoes = [...frase.querySelectorAll("button")];
    expect(botoes).toHaveLength(2);
    for (const b of botoes) {
      const classes = (b.getAttribute("class") ?? "").split(/\s+/);
      // A altura de 44px é da própria caixa do botão, não de padding que
      // vaza para fora dela.
      expect(classes).toContain("min-h-11");
      expect(classes.filter((c) => /^py-/.test(c))).toEqual([]);
    }
    // O link do produto também tem caixa de 44px.
    const trocas = hospedeiro.querySelector(
      '[data-testid="link-trocas-e-devolucoes"]',
    ) as HTMLElement;
    expect(trocas.getAttribute("class")).toContain("min-h-11");
    // Os dois links da frase dividem a MESMA linha: uma quebra de linha só,
    // ANTES do primeiro, e nenhuma entre eles (senão uma linha de 44px viraria
    // duas, e a frase cresceria no checkout).
    const filhos = [...(botoes[0].parentElement?.childNodes ?? [])];
    const posicao = (n: Node) => filhos.indexOf(n as ChildNode);
    const quebras = filhos.filter((n) => n.nodeName === "BR");
    expect(quebras).toHaveLength(1);
    expect(posicao(quebras[0])).toBeLessThan(posicao(botoes[0]));
    expect(botoes[1].parentElement).toBe(botoes[0].parentElement);
  });

  it("nenhum lugar de uso empurra o link para cima do vizinho com margem negativa", () => {
    for (const arquivo of [
      "../../src/views/customer/ProductView.tsx",
      "../../src/views/customer/CheckoutView.tsx",
      "../../src/views/shared/AuthView.tsx",
    ]) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminhos fixos do proprio repositorio
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      const usos = fonte.match(/<(LinkDeTrocas|FraseDeAceite)\b[^>]*>/g) ?? [];
      expect(usos.length, arquivo).toBeGreaterThan(0);
      for (const uso of usos) {
        expect(uso, arquivo).not.toMatch(/className="([^"]*\s)?-m[trblxy]?-/);
      }
    }
  });

  it("a folha tem fundo OPACO do tema (no modo glass o --background é transparente) e contraste AA nos dois temas", async () => {
    // Tokens REAIS de src/index.css. Caminho relativo à raiz (no jsdom o `URL`
    // global é o do jsdom e o `fs` recusa endereço `file:` dele).
    const css = readFileSync("src/index.css", "utf8").replace(/\r\n/g, "\n");
    const { PoliticaEmFolha } = await import(
      "@/components/politicas/PoliticaEmFolha"
    );
    await renderizar(<PoliticaEmFolha tipo="termos" onFechar={() => {}} />);
    const folha = await aguardarFolha();
    const classes = (folha.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("bg-card");
    expect(classes).not.toContain("bg-background");
    expect(classes).toContain("text-card-foreground");

    const bloco = (seletor: string): string => {
      const i = css.indexOf(`${seletor} {`);
      expect(i, `bloco ${seletor}`).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf("}", i));
    };
    const token = (b: string, nome: string): [number, number, number] => {
      const m = new RegExp(
        `--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`,
      ).exec(b);
      expect(m, `--${nome}`).not.toBeNull();
      return [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
    };
    const luz = ([h, s, l]: [number, number, number]): number => {
      const S = s / 100;
      const L = l / 100;
      const k = (n: number) => (n + h / 30) % 12;
      const a = S * Math.min(L, 1 - L);
      const f = (n: number) =>
        L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      const lin = (c: number) =>
        c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
    };
    const razao = (a: number, b: number) =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    for (const tema of [":root", ".dark"]) {
      const b = bloco(tema);
      const fundo = luz(token(b, "card"));
      // No claro o `.dark` herda o resto do :root; aqui só interessam os
      // tokens que o tema define (todos os três existem nos dois blocos).
      for (const frente of [
        "card-foreground",
        "foreground",
        "muted-foreground",
      ]) {
        expect(
          razao(fundo, luz(token(b, frente))),
          `${tema}: ${frente} sobre card`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // O modo glass só zera o --background: --card segue opaco.
    expect(bloco('[data-theme-mode="glass"]')).not.toMatch(/--card:/);
  });

  it("os links abrem a política por cima e fechar devolve a tela intacta", async () => {
    const { FraseDeAceite } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    // A "tela de baixo": um campo que a cliente já preencheu.
    function TelaEmAndamento() {
      const [nome, setNome] = useState("Maria da Silva");
      return (
        <div>
          <input
            aria-label="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <FraseDeAceite acao="finalizar" />
        </div>
      );
    }
    await renderizar(<TelaEmAndamento />);
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    expect(campo.value).toBe("Maria da Silva");

    // Antes de tocar, nada de folha: o peso dela só vem sob demanda.
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    act(() => botaoPorTexto("Termos de uso").click());
    const folha = await aguardarFolha();
    expect(folha.textContent).toContain("Termos de uso");
    expect(folha?.textContent).toContain("Loja da Ana");
    // A tela de baixo continua montada, com o campo intacto.
    expect(hospedeiro.querySelector("input")).toBe(campo);
    expect(campo.value).toBe("Maria da Silva");

    const fechar = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar"]',
    );
    expect(fechar, "botão Fechar da folha").not.toBeNull();
    await act(async () => {
      fechar?.click();
      await esperar(300);
    });
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    expect(hospedeiro.querySelector("input")).toBe(campo);
    expect(campo.value).toBe("Maria da Silva");

    act(() => botaoPorTexto("Política de Privacidade").click());
    expect((await aguardarFolha()).textContent).toContain("Que dados pedimos");
  });

  it("link de trocas: abre a folha de Trocas e devoluções", async () => {
    const { LinkDeTrocas } = await import(
      "@/components/politicas/LinksDasPoliticas"
    );
    await renderizar(<LinkDeTrocas />);
    const link = hospedeiro.querySelector(
      '[data-testid="link-trocas-e-devolucoes"]',
    ) as HTMLButtonElement;
    expect(link.textContent).toBe("Trocas e devoluções");
    expect(document.querySelector('[data-testid="folha-politica"]')).toBeNull();
    act(() => link.click());
    const folha = await aguardarFolha();
    expect(folha.textContent).toContain("Trocas e devoluções");
    // Banco "fora do ar" no dublê: só o mínimo da lei, nunca prazo inventado.
    await vi.waitFor(() => expect(folha.textContent).toContain("7 dias"));
  });

  it("rodapé: três links, cada um navega para a sua página", async () => {
    const { RodapeDasPoliticas } = await import(
      "@/components/politicas/RodapeDasPoliticas"
    );
    const onNavigate = vi.fn();
    await renderizar(<RodapeDasPoliticas onNavigate={onNavigate} />);
    const nomes = [...hospedeiro.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(nomes).toEqual([
      "Termos de uso",
      "Política de Privacidade",
      "Trocas e devoluções",
    ]);
    act(() => botaoPorTexto("Termos de uso").click());
    act(() => botaoPorTexto("Política de Privacidade").click());
    act(() => botaoPorTexto("Trocas e devoluções").click());
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      "terms",
      "privacy",
      "returns-policy",
    ]);
  });
});
