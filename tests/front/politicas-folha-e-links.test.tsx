// @vitest-environment jsdom
//
// Os três jeitos de a cliente chegar às políticas: a frase "Ao finalizar você
// concorda com…" (checkout e cadastro), o link "Trocas e devoluções" (produto)
// e os três links do rodapé da vitrine. A promessa central: o que abre por
// cima de uma tela em andamento é FOLHA — a tela de baixo não sai do lugar.
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
