// @vitest-environment jsdom
// A Home fica montada por baixo das telas secundárias (App.tsx: DeferredTabContent) e não reescreve o
// título quando a cliente volta. Por isso cada tela que escreve título e metas tem de devolvê-los ao sair:
// sem isso a aba, o histórico e o favorito do navegador ficavam com o título de "Termos de uso" ou do
// último produto visto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDocumentMeta } from "@/hooks/useDocumentMeta";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// O jsdom não traz CSS.escape; o hook o usa para o id do JSON-LD.
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (valor) => valor,
  };
}

function Tela({
  title,
  descricao,
  og,
  jsonLd,
}: {
  title?: string;
  descricao?: string;
  og?: string;
  jsonLd?: unknown;
}) {
  useDocumentMeta({
    title,
    names: { description: descricao },
    properties: { "og:title": og },
    jsonLd,
    jsonLdId: "teste-json-ld",
  });
  return null;
}

const meta = (attr: "name" | "property", key: string) =>
  document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);

describe("useDocumentMeta devolve o que escreveu ao sair da tela", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="description" content="Descrição da Home">';
    document.title = "Loja da Ana | Monte Carmelo";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.head.innerHTML = "";
  });

  it("o título da aba volta ao da Home quando a tela secundária sai", () => {
    act(() => root.render(<Tela title="Termos de uso | Loja da Ana" />));
    expect(document.title).toBe("Termos de uso | Loja da Ana");

    act(() => root.render(null));
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");
  });

  it("trocar de produto não acumula: sair do último devolve o título da Home", () => {
    act(() => root.render(<Tela title="Camiseta | Loja da Ana" />));
    act(() => root.render(<Tela title="Vestido | Loja da Ana" />));
    expect(document.title).toBe("Vestido | Loja da Ana");

    act(() => root.render(null));
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");
  });

  it("a descrição existente volta e a meta criada pela tela some", () => {
    act(() =>
      root.render(
        <Tela title="Camiseta" descricao="Camiseta de algodão" og="Camiseta" />,
      ),
    );
    expect(meta("name", "description")?.getAttribute("content")).toBe(
      "Camiseta de algodão",
    );
    expect(meta("property", "og:title")?.getAttribute("content")).toBe(
      "Camiseta",
    );

    act(() => root.render(null));
    expect(meta("name", "description")?.getAttribute("content")).toBe(
      "Descrição da Home",
    );
    expect(meta("property", "og:title")).toBeNull();
  });

  it("o dado estruturado do produto sai junto, como antes", () => {
    act(() =>
      root.render(<Tela title="Camiseta" jsonLd={{ "@type": "Product" }} />),
    );
    expect(document.getElementById("teste-json-ld")).not.toBeNull();

    act(() => root.render(null));
    expect(document.getElementById("teste-json-ld")).toBeNull();
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");
  });

  it("a Home montada por baixo: sair da tela secundária devolve o título da Home", () => {
    act(() =>
      root.render(
        <>
          <Tela key="home" title="Início | Loja da Ana" />
          <Tela key="termos" title="Termos de uso | Loja da Ana" />
        </>,
      ),
    );
    expect(document.title).toBe("Termos de uso | Loja da Ana");

    act(() => root.render(<Tela key="home" title="Início | Loja da Ana" />));
    expect(document.title).toBe("Início | Loja da Ana");

    act(() => root.render(null));
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");
  });

  it("fallback de animação: a tela nova escreve ANTES de a antiga limpar e o título da nova prevalece", () => {
    act(() => root.render(<Tela key="termos" title="Termos de uso" />));
    // as duas montadas ao mesmo tempo, a nova por cima
    act(() =>
      root.render(
        <>
          <Tela key="termos" title="Termos de uso" />
          <Tela key="privacidade" title="Privacidade" />
        </>,
      ),
    );
    expect(document.title).toBe("Privacidade");

    // só agora a antiga sai: não pode devolver o título da Home por cima da nova
    act(() => root.render(<Tela key="privacidade" title="Privacidade" />));
    expect(document.title).toBe("Privacidade");

    act(() => root.render(null));
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");
  });

  it("a mesma regra vale para as metas quando a tela nova entra antes de a antiga sair", () => {
    act(() => root.render(<Tela key="a" descricao="Descrição A" />));
    act(() =>
      root.render(
        <>
          <Tela key="a" descricao="Descrição A" />
          <Tela key="b" descricao="Descrição B" og="Título B" />
        </>,
      ),
    );
    act(() =>
      root.render(<Tela key="b" descricao="Descrição B" og="Título B" />),
    );
    expect(meta("name", "description")?.getAttribute("content")).toBe(
      "Descrição B",
    );
    expect(meta("property", "og:title")?.getAttribute("content")).toBe(
      "Título B",
    );

    act(() => root.render(null));
    expect(meta("name", "description")?.getAttribute("content")).toBe(
      "Descrição da Home",
    );
    expect(meta("property", "og:title")).toBeNull();
  });

  it("tela sem título não mexe no da aba", () => {
    act(() => root.render(<Tela descricao="Só a descrição" />));
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");

    act(() => root.render(null));
    expect(document.title).toBe("Loja da Ana | Monte Carmelo");
    expect(meta("name", "description")?.getAttribute("content")).toBe(
      "Descrição da Home",
    );
  });
});
