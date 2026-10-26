// @vitest-environment jsdom
//
// Campo "Categoria" do formulário de produto: em vez de uma lista suspensa, um
// botão grande mostra a categoria escolhida (ou "Escolher categoria") e, ao
// tocar, uma folha de baixo mostra todas as categorias da loja em cartões com
// ícone, mais "Nova categoria" e "Organizar categorias". O contrato com o
// formulário não muda: `id="product-category"` no botão, `valor` é o NOME,
// `aoEscolher(nome)`, `aoCriar`, `aoGerenciar` e o recado do rascunho.
import { CampoDeCategoria } from "@/components/admin/products/CampoDeCategoria";
import { esquecerOsIconesPeloNome } from "@/hooks/useIconesPeloNome";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Nome = {
  id: string;
  nome: string;
  icone?: string | null;
  iconeForma?: string | null;
};

const TRES: Nome[] = [
  { id: "1", nome: "Calçados" },
  { id: "2", nome: "Camisetas" },
  { id: "3", nome: "Cama e Banho" },
];
const SETE: Nome[] = [
  ...TRES,
  { id: "4", nome: "Brinquedos" },
  { id: "5", nome: "Pet" },
  { id: "6", nome: "Papelaria" },
  { id: "7", nome: "Joias" },
];

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoEscolher = vi.fn();
const aoCriar = vi.fn();
const aoGerenciar = vi.fn();

beforeEach(() => {
  esquecerOsIconesPeloNome();
  // O catálogo de ícones não existe no teste: o campo segue com o ícone de sempre.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("sem rede no teste");
    }),
  );
  aoEscolher.mockReset();
  aoCriar.mockReset();
  aoGerenciar.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function montar(
  props: Partial<Parameters<typeof CampoDeCategoria>[0]> = {},
) {
  await act(async () => {
    raiz.render(
      <CampoDeCategoria
        valor=""
        nomes={TRES}
        aoEscolher={aoEscolher}
        aoCriar={aoCriar}
        aoGerenciar={aoGerenciar}
        categoriaDoRascunhoQueSumiu={null}
        {...props}
      />,
    );
  });
}

const texto = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const campo = () =>
  document.getElementById("product-category") as HTMLButtonElement;
const folha = () => document.querySelector<HTMLElement>('[role="dialog"]');
const botoesDaFolha = () => [
  ...(folha()?.querySelectorAll<HTMLButtonElement>("button") ?? []),
];
const cartao = (nome: string) => botoesDaFolha().find((b) => texto(b) === nome);
const busca = () =>
  folha()?.querySelector<HTMLInputElement>(
    'input[placeholder="Buscar categoria"]',
  ) ?? null;

async function clicar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** O Radix devolve o foco num `setTimeout(0)` ao desmontar a folha: espera esse turno. */
async function esperarOFoco() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 20));
  });
}

async function abrir() {
  await clicar(campo());
  expect(folha()).not.toBeNull();
}

async function digitarNaBusca(valor: string) {
  const el = busca();
  if (!el) throw new Error("campo de busca não está na tela");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CampoDeCategoria — o campo fechado", () => {
  it("com categoria escolhida: botão com o nome, a dica e o ícone da categoria", async () => {
    await montar({ valor: "Calçados" });
    const botao = campo();
    expect(botao.tagName).toBe("BUTTON");
    expect(botao.type).toBe("button");
    expect(botao.getAttribute("aria-haspopup")).toBe("dialog");
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(texto(botao)).toContain("Calçados");
    expect(texto(botao)).toContain("Toque para trocar");
    expect(texto(botao)).not.toContain("Escolher categoria");
    expect(botao.querySelector("svg[data-icone='calcados']")).not.toBeNull();
  });

  it("sem categoria: 'Escolher categoria', a dica da loja e o ícone de etiqueta", async () => {
    await montar({ valor: "" });
    const botao = campo();
    expect(texto(botao)).toContain("Escolher categoria");
    expect(texto(botao)).toContain("Toque para ver as categorias da loja");
    expect(texto(botao)).not.toContain("Toque para trocar");
    expect(botao.querySelector("svg[data-icone='etiqueta']")).not.toBeNull();
  });

  it("categoria que não está mais na lista (apagada ou escondida): o nome continua à vista, com etiqueta", async () => {
    await montar({ valor: "Antiga" });
    const botao = campo();
    expect(texto(botao)).toContain("Antiga");
    expect(texto(botao)).not.toContain("Escolher categoria");
    expect(botao.querySelector("svg[data-icone='etiqueta']")).not.toBeNull();
  });

  it("o rótulo 'Categoria *' aponta para o botão e o nome acessível do botão traz a categoria", async () => {
    await montar({ valor: "Calçados" });
    const rotulo = document.querySelector<HTMLLabelElement>(
      'label[for="product-category"]',
    );
    expect(texto(rotulo)).toBe("Categoria *");
    // O rótulo nativo SOZINHO esconderia a categoria do leitor de tela
    // ("Categoria *, botão"): o nome vem do rótulo MAIS o valor.
    const ids = (campo().getAttribute("aria-labelledby") ?? "").split(" ");
    const nome = ids.map((id) => texto(document.getElementById(id))).join(" ");
    expect(nome).toContain("Categoria *");
    expect(nome).toContain("Calçados");
  });

  it("o botão tem alvo de toque grande (68 px) e o ícone da forma salva ganha da chave", async () => {
    await montar({
      valor: "Calçados",
      nomes: [
        {
          id: "1",
          nome: "Calçados",
          icone: "pet",
          iconeForma: "M3 3h8l10 10",
        },
      ],
    });
    expect(campo().className).toContain("min-h-[68px]");
    expect(campo().className).toContain("border-solid");
    expect(campo().querySelector("svg[data-icone='forma']")).not.toBeNull();
  });

  it("a escolhida e a vazia se distinguem sem depender só de cor (a dica muda)", async () => {
    await montar({ valor: "Calçados" });
    const escolhida = campo().className;
    await montar({ valor: "" });
    expect(campo().className).not.toBe(escolhida);
  });
});

describe("CampoDeCategoria — a folha de baixo", () => {
  it("tocar no campo abre a folha com título e subtítulo; fechada, ela não existe", async () => {
    await montar({ valor: "Calçados" });
    expect(folha()).toBeNull();
    await abrir();
    const titulo = document.getElementById(
      folha()?.getAttribute("aria-labelledby") ?? "",
    );
    expect(texto(titulo)).toBe("Categoria");
    expect(texto(folha())).toContain("Onde este produto aparece na loja");
    expect(campo().getAttribute("aria-expanded")).toBe("true");
  });

  it("a grade tem um cartão por categoria, na ordem recebida, e 'Nova categoria' por último", async () => {
    await montar({ valor: "" });
    await abrir();
    const rotulos = botoesDaFolha()
      .map(texto)
      .filter(
        (t) => t !== "" && t !== "Fechar" && t !== "Organizar categorias",
      );
    expect(rotulos).toEqual([
      "Calçados",
      "Camisetas",
      "Cama e Banho",
      "Nova categoria",
    ]);
  });

  it("cada cartão desenha o ícone da categoria (o salvo ganha do nome)", async () => {
    await montar({
      nomes: [
        { id: "1", nome: "Calçados" },
        { id: "2", nome: "Xpto", icone: "pet" },
        { id: "3", nome: "Yzw", iconeForma: "M3 3h8l10 10" },
        { id: "4", nome: "Sem pista" },
      ],
    });
    await abrir();
    const icone = (nome: string) =>
      cartao(nome)?.querySelector("svg")?.getAttribute("data-icone");
    expect(icone("Calçados")).toBe("calcados");
    expect(icone("Xpto")).toBe("pet");
    expect(icone("Yzw")).toBe("forma");
    expect(icone("Sem pista")).toBe("etiqueta");
  });

  it("a categoria escolhida é a única com aria-pressed='true'", async () => {
    await montar({ valor: "Camisetas" });
    await abrir();
    const pressionados = botoesDaFolha().filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(pressionados.map(texto)).toEqual(["Camisetas"]);
    expect(cartao("Calçados")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("tocar numa categoria chama aoEscolher com o NOME e fecha a folha", async () => {
    await montar({ valor: "" });
    await abrir();
    await clicar(cartao("Cama e Banho"));
    expect(aoEscolher).toHaveBeenCalledTimes(1);
    expect(aoEscolher).toHaveBeenCalledWith("Cama e Banho");
    expect(folha()).toBeNull();
    expect(aoCriar).not.toHaveBeenCalled();
    expect(aoGerenciar).not.toHaveBeenCalled();
  });

  it("tocar de novo na categoria que já estava escolhida não a desmarca", async () => {
    await montar({ valor: "Calçados" });
    await abrir();
    await clicar(cartao("Calçados"));
    expect(aoEscolher).toHaveBeenCalledWith("Calçados");
    expect(folha()).toBeNull();
  });

  it("'Nova categoria' fecha a folha e chama aoCriar (sem escolher nada)", async () => {
    await montar({ valor: "Calçados" });
    await abrir();
    await clicar(cartao("Nova categoria"));
    expect(aoCriar).toHaveBeenCalledTimes(1);
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(folha()).toBeNull();
  });

  it("'Organizar categorias' fecha a folha e chama aoGerenciar (sem escolher nada)", async () => {
    await montar({ valor: "Calçados" });
    await abrir();
    await clicar(cartao("Organizar categorias"));
    expect(aoGerenciar).toHaveBeenCalledTimes(1);
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(folha()).toBeNull();
  });

  it("Esc fecha a folha sem escolher nada, e o foco volta ao botão do campo", async () => {
    await montar({ valor: "Calçados" });
    await abrir();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await esperarOFoco();
    expect(folha()).toBeNull();
    expect(aoEscolher).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo());
  });

  it("depois de escolher, o foco volta ao botão do campo", async () => {
    await montar({ valor: "" });
    await abrir();
    await clicar(cartao("Calçados"));
    await esperarOFoco();
    expect(document.activeElement).toBe(campo());
  });

  it("depois de 'Nova categoria', o foco NÃO é puxado de volta (a outra folha já o tem)", async () => {
    await montar({ valor: "" });
    await abrir();
    await clicar(cartao("Nova categoria"));
    await esperarOFoco();
    expect(document.activeElement).not.toBe(campo());
  });

  it("ao abrir, o foco vai para a própria folha, não para a busca (o teclado do celular não sobe)", async () => {
    await montar({ valor: "", nomes: SETE });
    await abrir();
    expect(busca()).not.toBeNull();
    expect(document.activeElement).toBe(folha());
  });

  it("toda ação da folha é um botão de verdade, de tipo 'button', e o corpo rola por dentro", async () => {
    await montar({ valor: "" });
    await abrir();
    for (const b of botoesDaFolha()) expect(b.type).toBe("button");
    expect(folha()?.className).toContain("max-h-[85dvh]");
    expect(folha()?.className).toContain("rounded-t-[28px]");
    // O corpo (grade) rola; o rodapé "Organizar categorias" fica fora dele.
    const corpo = cartao("Calçados")?.closest(".overflow-y-auto");
    expect(corpo).not.toBeNull();
    expect(corpo?.contains(cartao("Organizar categorias") ?? null)).toBe(false);
  });
});

describe("CampoDeCategoria — a busca", () => {
  it("com 6 categorias ou menos não há busca; com 7 há", async () => {
    await montar({ nomes: SETE.slice(0, 6) });
    await abrir();
    expect(busca()).toBeNull();
    await clicar(cartao("Calçados"));
    await montar({ nomes: SETE });
    await abrir();
    expect(busca()).not.toBeNull();
    expect(busca()?.className).toContain("text-base");
  });

  it("filtra pelo nome sem ligar para maiúsculas, acento e espaços nas pontas", async () => {
    await montar({ nomes: SETE });
    await abrir();
    await digitarNaBusca("  CALCADOS ");
    const rotulos = botoesDaFolha()
      .map(texto)
      .filter(
        (t) => t !== "" && t !== "Fechar" && t !== "Organizar categorias",
      );
    expect(rotulos).toEqual(["Calçados", "Nova categoria"]);
    await digitarNaBusca("cama");
    expect(cartao("Cama e Banho")).toBeDefined();
    expect(cartao("Camisetas")).toBeUndefined();
  });

  it("sem resultado: mensagem curta e 'Nova categoria' continua à vista", async () => {
    await montar({ nomes: SETE });
    await abrir();
    await digitarNaBusca("zzzz");
    expect(texto(folha())).toContain("Nenhuma categoria com esse nome");
    expect(cartao("Calçados")).toBeUndefined();
    await clicar(cartao("Nova categoria"));
    expect(aoCriar).toHaveBeenCalledTimes(1);
  });

  it("a busca começa limpa a cada vez que a folha abre", async () => {
    await montar({ nomes: SETE });
    await abrir();
    await digitarNaBusca("pet");
    await clicar(cartao("Pet"));
    await abrir();
    expect(busca()?.value).toBe("");
    expect(cartao("Calçados")).toBeDefined();
  });
});

describe("CampoDeCategoria — loja sem categoria nenhuma", () => {
  it("mostra a mensagem, sem busca, com 'Nova categoria' em destaque e 'Organizar categorias' ainda no rodapé", async () => {
    await montar({ valor: "", nomes: [] });
    await abrir();
    expect(texto(folha())).toContain("Você ainda não tem categorias");
    expect(busca()).toBeNull();
    expect(cartao("Nova categoria")).toBeDefined();
    await clicar(cartao("Nova categoria"));
    expect(aoCriar).toHaveBeenCalledTimes(1);
    expect(folha()).toBeNull();
  });

  it("o campo fechado, com valor de rascunho e lista vazia, ainda mostra o nome", async () => {
    await montar({ valor: "Brinquedo", nomes: [] });
    expect(texto(campo())).toContain("Brinquedo");
  });
});

describe("CampoDeCategoria — recado do rascunho que sumiu", () => {
  const AVISO = '[data-testid="categoria-do-rascunho-sumiu"]';

  it("aparece com valor vazio, e some quando há categoria escolhida", async () => {
    await montar({ valor: "", categoriaDoRascunhoQueSumiu: "Brinquedo" });
    const aviso = document.querySelector(AVISO);
    expect(aviso?.getAttribute("role")).toBe("alert");
    expect(texto(aviso)).toContain("Brinquedo");
    await montar({
      valor: "Calçados",
      categoriaDoRascunhoQueSumiu: "Brinquedo",
    });
    expect(document.querySelector(AVISO)).toBeNull();
  });

  it("não aparece quando não há rascunho perdido", async () => {
    await montar({ valor: "", categoriaDoRascunhoQueSumiu: null });
    expect(document.querySelector(AVISO)).toBeNull();
  });
});
