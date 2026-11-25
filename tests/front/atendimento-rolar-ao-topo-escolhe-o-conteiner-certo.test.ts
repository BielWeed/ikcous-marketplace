// @vitest-environment jsdom
// Ao trocar de página em Perguntas e Avaliações a lista volta ao topo
// (`rolarAoTopo`). Quem rola é o PRIMEIRO contêiner que existir, nesta ordem:
// o ancestral `.admin-scroll-container` do botão clicado, depois o
// `.active-scroll-container` da página, depois o `<main>`. Sem nenhum, nada
// acontece (e nada quebra). Nenhum teste citava a função.
import { rolarAoTopo } from "@/components/admin/atendimento/controles";
import { afterEach, describe, expect, it, vi } from "vitest";

function comRolagem<T extends HTMLElement>(elemento: T): T {
  // jsdom não implementa `Element.scrollTo`: cada candidato ganha o seu espião.
  Object.defineProperty(elemento, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  return elemento;
}

function criar(
  tag: string,
  classe?: string,
  pai: HTMLElement = document.body,
): HTMLElement {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  pai.append(el);
  return comRolagem(el);
}

const rolou = (el: HTMLElement) =>
  el.scrollTo as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("rolarAoTopo — qual contêiner rola", () => {
  it("o ancestral .admin-scroll-container do botão vence os outros dois", () => {
    const ativo = criar("div", "active-scroll-container");
    const principal = criar("main");
    const painel = criar("div", "admin-scroll-container");
    const botao = criar("button", undefined, painel);

    rolarAoTopo(botao);

    expect(rolou(painel)).toHaveBeenCalledTimes(1);
    expect(rolou(painel)).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(rolou(ativo)).not.toHaveBeenCalled();
    expect(rolou(principal)).not.toHaveBeenCalled();
  });

  it("sem ancestral próprio, rola o .active-scroll-container da página antes do <main>", () => {
    const principal = criar("main");
    const ativo = criar("div", "active-scroll-container");
    const botao = criar("button");

    rolarAoTopo(botao);

    expect(rolou(ativo)).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(rolou(principal)).not.toHaveBeenCalled();
  });

  it("sem nenhum dos dois, rola o <main>", () => {
    const principal = criar("main");
    const botao = criar("button");

    rolarAoTopo(botao);

    expect(rolou(principal)).toHaveBeenCalledTimes(1);
    expect(rolou(principal)).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("um .admin-scroll-container que NÃO é ancestral do botão não é usado", () => {
    const vizinho = criar("div", "admin-scroll-container");
    const principal = criar("main");
    const botao = criar("button");

    rolarAoTopo(botao);

    expect(rolou(vizinho)).not.toHaveBeenCalled();
    expect(rolou(principal)).toHaveBeenCalledTimes(1);
  });

  it("sem contêiner nenhum na página, não faz nada e não lança erro", () => {
    const botao = criar("button");
    expect(() => rolarAoTopo(botao)).not.toThrow();
  });
});
