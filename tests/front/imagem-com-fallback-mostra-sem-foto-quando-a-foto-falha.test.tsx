// @vitest-environment jsdom
import { ImagemComFallback } from "@/components/ui/custom/ImagemComFallback";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const falhar = () =>
  act(() => {
    host.querySelector("img")!.dispatchEvent(new Event("error"));
  });
describe("foto que não carrega", () => {
  it("troca a imagem quebrada pelo substituto", () => {
    act(() =>
      root.render(<ImagemComFallback src="/apagada.jpg" alt="Produto" />),
    );
    falhar();
    expect(host.textContent).toContain("Sem foto");
    expect(host.querySelector("img")).toBeNull();
  });
  it("permite carregar outra URL depois de uma falha", () => {
    act(() =>
      root.render(<ImagemComFallback src="/apagada.jpg" alt="Produto" />),
    );
    falhar();
    expect(host.querySelector("img")).toBeNull();
    act(() => root.render(<ImagemComFallback src="/nova.jpg" alt="Produto" />));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/nova.jpg");
    expect(host.textContent).not.toContain("Sem foto");
  });
  it("mantém a imagem e repassa seus atributos enquanto não há erro", () => {
    act(() =>
      root.render(
        <ImagemComFallback
          src="/foto.jpg"
          alt="Produto"
          loading="lazy"
          width={48}
          height={48}
          className="size-12"
          decoding="async"
        />,
      ),
    );
    const img = host.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/foto.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("48");
    expect(img.getAttribute("height")).toBe("48");
    expect(img.getAttribute("class")).toBe("size-12");
    expect(img.getAttribute("decoding")).toBe("async");
  });
  it("tenta a original antes de desistir e aceita substituto próprio", () => {
    act(() =>
      root.render(
        <ImagemComFallback
          src="/miniatura.jpg"
          original="/original.jpg"
          alt="Produto"
          fallback={<span>Foto indisponível</span>}
        />,
      ),
    );
    falhar();
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "/original.jpg",
    );
    falhar();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Foto indisponível");
  });
});
