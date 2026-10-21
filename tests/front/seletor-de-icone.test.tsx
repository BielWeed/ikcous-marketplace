// @vitest-environment jsdom
//
// O seletor de ícone das categorias (painel): busca sem acento, grupos, prévia, sugestão pelo nome e o que
// acontece quando o catálogo não chega. Escolher só devolve a escolha ao pai; quem grava é o pai.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type EscolhaDeIcone,
  SeletorDeIcone,
} from "@/components/admin/categorias/SeletorDeIcone";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOGO: { chave: string; nome: string; grupo: string; d: string }[] =
  JSON.parse(
    readFileSync(
      join(__dirname, "..", "..", "public", "icons", "categorias.json"),
      "utf8",
    ),
  );
const d = (chave: string) => CATALOGO.find((i) => i.chave === chave)?.d;
const fetchMock = vi.fn();
const espera = () => new Promise<void>((r) => setTimeout(r, 0));

type Props = Partial<Parameters<typeof SeletorDeIcone>[0]>;

describe("SeletorDeIcone", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  const aoEscolher = vi.fn<(e: EscolhaDeIcone) => void>();

  beforeEach(() => {
    esquecerOCatalogoCarregado();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO });
    vi.stubGlobal("fetch", fetchMock);
    aoEscolher.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function montar(props: Props = {}) {
    await act(async () => {
      raiz.render(
        <SeletorDeIcone
          nomeDaCategoria="Vestuário"
          nomeParaSugerir="Vestuário"
          gravado={{}}
          desabilitado={false}
          aoEscolher={aoEscolher}
          {...props}
        />,
      );
    });
  }
  async function abrir() {
    await act(async () => {
      botao("Escolher ícone").click();
    });
    await act(async () => {
      await espera();
    });
  }
  function botao(nome: string): HTMLButtonElement {
    const achado = [...host.querySelectorAll("button")].find(
      (b) =>
        b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
    );
    if (!achado) throw new Error(`botão "${nome}" não está na tela`);
    return achado as HTMLButtonElement;
  }
  const tem = (nome: string) =>
    [...host.querySelectorAll("button")].some(
      (b) =>
        b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
    );
  const rotulosDasPecas = () =>
    [...host.querySelectorAll("fieldset button")].map((b) =>
      b.textContent?.trim(),
    );
  async function digitar(texto: string) {
    const campo = host.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("fechado não pede nada; ao abrir pede o catálogo UMA vez e mostra clássicos e grupos", async () => {
    await montar();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(botao("Escolher ícone").getAttribute("aria-expanded")).toBe("false");
    await abrir();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(botao("Escolher ícone").getAttribute("aria-expanded")).toBe("true");
    const secoes = [...host.querySelectorAll("fieldset section")].map((s) =>
      s.getAttribute("aria-label"),
    );
    expect(secoes[0]).toBe("Clássicos");
    expect(secoes).toContain("Roupas");
    expect(secoes).toContain("Calçados");
    // fechar e abrir de novo não pede outra vez (fica em memória)
    await act(async () => botao("Escolher ícone").click());
    await abrir();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("busca sem acento, sem caixa e com plural; sem resultado diz isso", async () => {
    await montar();
    await abrir();
    await digitar("TENIS");
    expect(tem("Ícone Tênis para Vestuário")).toBe(true);
    expect(tem("Ícone Blusa para Vestuário")).toBe(false);
    await digitar("bolsas");
    expect(tem("Ícone Bolsa para Vestuário")).toBe(true);
    expect(tem("Ícone Bota para Vestuário")).toBe(false);
    await digitar("calça");
    expect(tem("Ícone Calça para Vestuário")).toBe(true);
    // palavra que só existe no catálogo ("palavras"), não no nome
    await digitar("camiseta");
    expect(tem("Ícone Camiseta para Vestuário")).toBe(true);
    await digitar("xyzxyz");
    expect(host.textContent).toMatch(/Nenhum ícone com “xyzxyz”/);
    expect(rotulosDasPecas()).toEqual([]);
    await digitar("");
    expect(tem("Ícone Blusa para Vestuário")).toBe(true);
  });

  it("os grupos filtram: um grupo mostra só os dele; Clássicos mostra só os 14 e o Automático", async () => {
    await montar();
    await abrir();
    await act(async () => botao("Calçados").click());
    expect(tem("Ícone Tênis para Vestuário")).toBe(true);
    expect(tem("Ícone Blusa para Vestuário")).toBe(false);
    expect(tem("Ícone Moda para Vestuário")).toBe(false); // clássico fora do grupo
    expect(botao("Calçados").getAttribute("aria-pressed")).toBe("true");
    await act(async () => botao("Clássicos").click());
    expect(rotulosDasPecas()).toHaveLength(15);
    expect(tem("Ícone Tênis para Vestuário")).toBe(false);
    await act(async () => botao("Todos").click());
    expect(tem("Ícone Blusa para Vestuário")).toBe(true);
    expect(tem("Ícone Moda para Vestuário")).toBe(true);
  });

  it("escolher devolve a escolha: catálogo guarda a FORMA; clássico guarda a chave; Automático esvazia as duas", async () => {
    await montar();
    await abrir();
    await act(async () => botao("Ícone Blusa para Vestuário").click());
    expect(aoEscolher).toHaveBeenLastCalledWith({
      icone: null,
      forma: d("blusa"),
    });
    await act(async () => botao("Ícone Moda para Vestuário").click());
    expect(aoEscolher).toHaveBeenLastCalledWith({ icone: "moda", forma: null });
    await act(async () => botao("Ícone Automático para Vestuário").click());
    expect(aoEscolher).toHaveBeenLastCalledWith({ icone: null, forma: null });
    expect(aoEscolher).toHaveBeenCalledTimes(3);
  });

  it("a escolha gravada aparece marcada e na prévia grande, com o nome do ícone", async () => {
    await montar({ gravado: { forma: d("bota") } });
    await abrir();
    expect(host.textContent).toContain("Ícone atual");
    expect(host.textContent).toContain("Bota");
    expect(
      botao("Ícone Bota para Vestuário").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      botao("Ícone Blusa para Vestuário").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      botao("Ícone Automático para Vestuário").getAttribute("aria-pressed"),
    ).toBe("false");
    const previa = host.querySelector("svg[data-icone='forma'] path");
    expect(previa?.getAttribute("d")).toBe(d("bota"));
  });

  it("clássico gravado aparece marcado; só ele", async () => {
    await montar({ gravado: { icone: "casa" } });
    await abrir();
    expect(
      botao("Ícone Casa para Vestuário").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(host.textContent).toContain("Ícone atual");
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2); // a peça e o chip "Todos"
  });

  describe("sugestão pelo nome", () => {
    it("categoria sem ícone escolhido: destaca a sugestão e 'Usar sugestão' a aplica", async () => {
      await montar({ nomeDaCategoria: "Calças", nomeParaSugerir: "Calças" });
      await abrir();
      const grupo = host.querySelector(
        '[role="group"][aria-label^="Sugestão"]',
      );
      expect(grupo?.textContent).toContain("Sugestão para “Calças”");
      expect(grupo?.textContent).toContain("Calça");
      await act(async () => botao("Usar sugestão").click());
      expect(aoEscolher).toHaveBeenCalledWith({
        icone: null,
        forma: d("calca"),
      });
    });

    it("acompanha o nome que a lojista digita", async () => {
      await montar({ nomeParaSugerir: "Bolsas" });
      await abrir();
      expect(host.textContent).toContain("Sugestão para “Bolsas”");
      await montar({ nomeParaSugerir: "Tênis" });
      expect(host.textContent).toContain("Sugestão para “Tênis”");
      await act(async () => botao("Usar sugestão").click());
      expect(aoEscolher).toHaveBeenCalledWith({
        icone: null,
        forma: d("tenis"),
      });
    });

    it("nome genérico cai no clássico que a vitrine já deduzia", async () => {
      await montar({ nomeParaSugerir: "Moda feminina" });
      await abrir();
      await act(async () => botao("Usar sugestão").click());
      expect(aoEscolher).toHaveBeenCalledWith({ icone: "moda", forma: null });
    });

    it("NUNCA aparece (nem troca sozinha) se a lojista já escolheu: forma, clássico", async () => {
      await montar({
        nomeParaSugerir: "Calças",
        gravado: { forma: d("bota") },
      });
      await abrir();
      expect(host.textContent).not.toContain("Sugestão para");
      expect(tem("Usar sugestão")).toBe(false);
      await montar({ nomeParaSugerir: "Calças", gravado: { icone: "casa" } });
      expect(tem("Usar sugestão")).toBe(false);
      expect(aoEscolher).not.toHaveBeenCalled();
    });

    it("nome sem sugestão possível não mostra o bloco", async () => {
      await montar({ nomeParaSugerir: "Xpto" });
      await abrir();
      expect(tem("Usar sugestão")).toBe(false);
    });

    it("forma gravada inválida (dado antigo ou adulterado) conta como sem escolha e nunca é desenhada", async () => {
      await montar({
        nomeParaSugerir: "Calças",
        gravado: { forma: "<script>alert(1)</script>" },
      });
      await abrir();
      expect(tem("Usar sugestão")).toBe(true);
      expect(host.innerHTML).not.toContain("<script");
      // a prévia grande (size-10) cai no automático: nenhuma forma própria
      expect(
        host.querySelector("svg.size-10")?.getAttribute("data-icone"),
      ).not.toBe("forma");
      for (const caminho of host.querySelectorAll("path"))
        expect(caminho.getAttribute("d")).not.toMatch(/script|alert/);
    });
  });

  describe("catálogo que não chega", () => {
    it("sem internet: avisa, mantém os 14 clássicos e o ícone já gravado, e deixa tentar de novo", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await montar({ gravado: { forma: d("bota") }, nomeParaSugerir: "Moda" });
      await abrir();
      expect(host.querySelector('[role="alert"]')?.textContent).toMatch(
        /Não deu para carregar os ícones novos agora/,
      );
      expect(rotulosDasPecas()).toHaveLength(15);
      // o que já estava gravado continua na prévia, mesmo sem o catálogo
      expect(
        host.querySelector("svg[data-icone='forma'] path")?.getAttribute("d"),
      ).toBe(d("bota"));
      expect(host.textContent).toContain("Ícone escolhido");
      // a rede volta
      fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO });
      await act(async () => botao("Tentar de novo").click());
      await act(async () => {
        await espera();
      });
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(tem("Ícone Bota para Vestuário")).toBe(true);
      expect(host.textContent).toContain("Bota");
    });

    it("arquivo ausente (o servidor devolve a página inicial): mesmo caminho, sem quebrar", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      });
      await montar();
      await abrir();
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(rotulosDasPecas()).toHaveLength(15);
    });

    it("sem catálogo ainda sugere o clássico do nome", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await montar({ nomeParaSugerir: "Calçados" });
      await abrir();
      expect(host.textContent).toContain("Sugestão para “Calçados”");
      await act(async () => botao("Usar sugestão").click());
      expect(aoEscolher).toHaveBeenCalledWith({
        icone: "calcados",
        forma: null,
      });
    });

    it("durante a busca mostra 'carregando' e já oferece os clássicos", async () => {
      let liberar: (valor: unknown) => void = () => {};
      fetchMock.mockReturnValue(new Promise((r) => (liberar = r)));
      await montar();
      await act(async () => botao("Escolher ícone").click());
      expect(host.querySelector('[role="status"]')?.textContent).toMatch(
        /Carregando/,
      );
      expect(rotulosDasPecas()).toHaveLength(15);
      await act(async () => {
        liberar({ ok: true, json: async () => CATALOGO });
        await espera();
      });
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(tem("Ícone Blusa para Vestuário")).toBe(true);
    });
  });

  it("gravação em andamento: nenhuma peça responde (fieldset desabilitado) e todas têm toque de 44px", async () => {
    await montar({ desabilitado: true });
    await abrir();
    expect(host.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
    for (const peca of host.querySelectorAll("fieldset button")) {
      expect((peca as HTMLButtonElement).disabled).toBe(true);
      expect(peca.className).toContain("min-h-16"); // 64px
    }
    for (const rotulo of ["Todos", "Clássicos", "Roupas"])
      expect(botao(rotulo).className).toContain("min-h-11"); // 44px
    expect(botao("Escolher ícone").className).toContain("min-h-11");
    // o campo de busca tem rótulo para leitor de tela
    expect(host.querySelector("label")?.textContent).toMatch(/Buscar ícone/);
  });
});
