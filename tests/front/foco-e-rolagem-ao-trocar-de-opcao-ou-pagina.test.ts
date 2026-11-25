// @vitest-environment jsdom
// Dois pequenos ajudantes de foco/rolagem sem teste próprio:
//  - `focarEscolhaDaFolha`: ao abrir um eixo (cor, tamanho) na folha de opções
//    do cartão do produto, o foco vai ao primeiro botão HABILITADO do painel
//    daquele eixo; sem eixo (ou sem botão habilitado) cai no "Adicionar".
//  - `rolarAoTopo`: ao trocar de página nas listas do painel, rola o
//    contêiner certo, na ordem: o da própria lista, o ativo, o <main>.
import { rolarAoTopo } from "@/components/admin/atendimento/controles";
import { focarEscolhaDaFolha } from "@/components/ui/custom/FolhaDeOpcoes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const por = (id: string) => document.getElementById(id) as HTMLElement;

function montarFolha(painel: string) {
  document.body.innerHTML = `
    <div id="folha">
      <div id="folha-cor">${painel}</div>
      <div id="folha-tamanho"><button id="tam-m">M</button></div>
      <button data-testid="product-card-options-add" id="adicionar">Adicionar</button>
    </div>`;
}

describe("focarEscolhaDaFolha", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("com eixo aberto: foca o primeiro botão do painel desse eixo", () => {
    montarFolha(
      `<button id="azul">Azul</button><button id="preto">Preto</button>`,
    );
    focarEscolhaDaFolha("folha", "cor");
    expect(document.activeElement).toBe(por("azul"));
  });

  it("pula o botão desabilitado e foca o primeiro habilitado", () => {
    montarFolha(
      `<button id="azul" disabled>Azul</button><button id="preto">Preto</button>`,
    );
    focarEscolhaDaFolha("folha", "cor");
    expect(document.activeElement).toBe(por("preto"));
  });

  it("usa o painel do eixo pedido, não o de outro eixo", () => {
    montarFolha(`<button id="azul">Azul</button>`);
    focarEscolhaDaFolha("folha", "tamanho");
    expect(document.activeElement).toBe(por("tam-m"));
  });

  it("sem eixo aberto (null): foca o botão Adicionar da folha", () => {
    montarFolha(`<button id="azul">Azul</button>`);
    focarEscolhaDaFolha("folha", null);
    expect(document.activeElement).toBe(por("adicionar"));
  });

  it("painel sem botão habilitado: cai no Adicionar", () => {
    montarFolha(`<button id="azul" disabled>Azul</button>`);
    focarEscolhaDaFolha("folha", "cor");
    expect(document.activeElement).toBe(por("adicionar"));
  });

  it("eixo que não existe na folha: cai no Adicionar", () => {
    montarFolha(`<button id="azul">Azul</button>`);
    focarEscolhaDaFolha("folha", "material");
    expect(document.activeElement).toBe(por("adicionar"));
  });

  it("folha que não existe na página: não quebra e não move o foco", () => {
    document.body.innerHTML = `<button id="outro">Outro</button>`;
    por("outro").focus();
    expect(() => focarEscolhaDaFolha("folha", "cor")).not.toThrow();
    expect(() => focarEscolhaDaFolha("folha", null)).not.toThrow();
    expect(document.activeElement).toBe(por("outro"));
  });

  it("outra folha na página não rouba o foco (o id decide)", () => {
    document.body.innerHTML = `
      <div id="a"><div id="a-cor"><button id="a1">a1</button></div></div>
      <div id="b"><div id="b-cor"><button id="b1">b1</button></div></div>`;
    focarEscolhaDaFolha("b", "cor");
    expect(document.activeElement).toBe(por("b1"));
  });
});

describe("rolarAoTopo", () => {
  const rolagens = new Map<string, ReturnType<typeof vi.fn>>();

  function espiar(el: Element, nome: string) {
    const fn = vi.fn();
    rolagens.set(nome, fn);
    (el as HTMLElement).scrollTo = fn as unknown as HTMLElement["scrollTo"];
  }

  afterEach(() => {
    rolagens.clear();
    document.body.innerHTML = "";
  });

  it("rola o contêiner da própria lista, suave, até o topo", () => {
    document.body.innerHTML = `
      <main id="principal">
        <div class="admin-scroll-container" id="lista"><button id="pagina">2</button></div>
      </main>
      <div class="active-scroll-container" id="ativo"></div>`;
    for (const [id, nome] of [
      ["lista", "lista"],
      ["ativo", "ativo"],
      ["principal", "main"],
    ] as const) {
      espiar(por(id), nome);
    }
    rolarAoTopo(por("pagina"));
    expect(rolagens.get("lista")).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
    expect(rolagens.get("ativo")).not.toHaveBeenCalled();
    expect(rolagens.get("main")).not.toHaveBeenCalled();
  });

  it("sem contêiner da lista: rola o contêiner ativo", () => {
    document.body.innerHTML = `
      <main id="principal"><button id="pagina">2</button></main>
      <div class="active-scroll-container" id="ativo"></div>`;
    espiar(por("ativo"), "ativo");
    espiar(por("principal"), "main");
    rolarAoTopo(por("pagina"));
    expect(rolagens.get("ativo")).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
    expect(rolagens.get("main")).not.toHaveBeenCalled();
  });

  it("sem os dois: rola o <main>", () => {
    document.body.innerHTML = `<main id="principal"><button id="pagina">2</button></main>`;
    espiar(por("principal"), "main");
    rolarAoTopo(por("pagina"));
    expect(rolagens.get("main")).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("sem nenhum contêiner: não quebra", () => {
    document.body.innerHTML = `<button id="pagina">2</button>`;
    expect(() => rolarAoTopo(por("pagina"))).not.toThrow();
  });
});
