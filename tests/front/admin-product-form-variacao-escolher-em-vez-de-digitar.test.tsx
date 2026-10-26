// @vitest-environment jsdom
//
// O lojista é leigo e reclamou: para criar uma variação ele digitava "Cor" e
// "Espacial Grey" em dois campos, enquanto a LOJA já mostra a cor como bolinha.
// Agora o modal "Nova variação" deixa ESCOLHER: toca a peça Cor e toca a
// bolinha. O que é gravado não mudou (o nome do atributo e o nome do valor).
//
// Provado aqui, na tela de verdade:
//   1. as seis peças aparecem e o campo de nome só existe em "Outro";
//   2. Cor + bolinha vira "Cor: Azul marinho" na lista;
//   3. o estoque anda no + e no −, e o − não passa de zero;
//   4. produto ANTIGO ("Cor" / "Espacial Grey", "Material" / "Algodão" ou
//      "Estampa" / "Listrada")
//      abre com o tipo certo marcado, o valor preservado, e salvar sem mexer
//      reproduz a mesma linha;
//   5. a combinação (Cor E Tamanho) usa o mesmo seletor em cada par;
//   6. trocar de Cor para Tamanho não deixa "Azul" virar um tamanho;
//   7. o interruptor "Aparece na loja" diz Ativo/Inativo;
//   8. salvar sem escolher nada continua sendo recusado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atributoMarcado,
  botaoDoAtributo,
  escolherAtributo,
} from "./helpers/atributo-da-variacao";

const fetchProduct = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/components/LazyImage", () => ({
  LazyImage: ({ src, alt }: { src: string; alt?: string }) => (
    <img src={src} alt={alt ?? ""} />
  ),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function clicarTexto(texto: string) {
  const botao = botaoPorTexto(texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  await act(async () => {
    botao.click();
  });
}

async function tocarNaPeca(posicao: number, texto: string) {
  await act(async () => {
    botaoDoAtributo(posicao, texto).click();
  });
}

async function clicarRotulo(rotulo: string) {
  const botao = document.body.querySelector<HTMLButtonElement>(
    `[aria-label="${rotulo}"]`,
  );
  if (!botao) throw new Error(`"${rotulo}" não está na tela.`);
  await act(async () => {
    botao.click();
  });
}

async function digitar(id: string, valor: string) {
  await act(async () => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) throw new Error(`Campo "${id}" não está na tela.`);
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}

const valorDoCampo = (id: string) =>
  (document.getElementById(id) as HTMLInputElement | null)?.value;

const variantesNaTela = () =>
  [...document.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

const produto = (variants: unknown[] = []) => ({
  id: "p-1",
  name: "Camiseta",
  description: "",
  price: 50,
  stock: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants,
});

describe("AdminProductFormView — escolher a variação em vez de digitar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(variants: unknown[] = [], images: string[] = []) {
    fetchProduct.mockResolvedValue({ ...produto(variants), images });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="p-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function abrirNovaVariacao() {
    await clicarTexto("+ Novo");
  }

  async function abrirEdicaoDaLinha(trecho: string) {
    const rotulo = [
      ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
    ].find((el) => el.textContent?.includes(trecho));
    if (!rotulo) throw new Error(`Linha "${trecho}" não está na tela.`);
    const caneta = rotulo.closest("div.group")?.querySelector("button");
    await act(async () => {
      (caneta as HTMLButtonElement).click();
    });
  }

  const linhaAntiga = (name: string, value: string) => ({
    id: "v1",
    productId: "p-1",
    name,
    value,
    sku: undefined,
    stockIncrement: 3,
    priceOverride: undefined,
    active: true,
    imageUrl: undefined,
  });

  it("abre com as seis peças, nenhuma marcada, e SEM campo de nome", async () => {
    await montar();
    await abrirNovaVariacao();

    expect(document.getElementById("titulo-da-variacao")?.textContent).toBe(
      "Nova variação",
    );
    for (const peca of [
      "Cor",
      "Tamanho",
      "Voltagem",
      "Capacidade",
      "Material",
      "Outro",
    ]) {
      expect(botaoDoAtributo(0, peca).getAttribute("aria-pressed")).toBe(
        "false",
      );
    }
    expect(atributoMarcado(0)).toBeNull();
    expect(document.getElementById("variant-name")).toBeNull();
  });

  it("toca Cor e a bolinha Azul marinho: a linha entra como 'Cor: Azul marinho'", async () => {
    await montar();
    await abrirNovaVariacao();

    await tocarNaPeca(0, "Cor");
    expect(atributoMarcado(0)).toBe("Cor");
    await clicarRotulo("Azul marinho");
    expect(valorDoCampo("variant-value")).toBe("Azul marinho");
    expect(
      document.querySelector('[data-testid="escolha-atual"]')?.textContent,
    ).toContain("Azul marinho");

    await clicarTexto("Salvar variação");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Azul marinho"]);
  });

  it("o estoque anda no + e no −, e o − não passa de zero", async () => {
    await montar();
    await abrirNovaVariacao();
    expect(valorDoCampo("variant-stock")).toBe("0");

    await clicarRotulo("Diminuir estoque");
    expect(valorDoCampo("variant-stock")).toBe("0");
    await clicarRotulo("Aumentar estoque");
    await clicarRotulo("Aumentar estoque");
    await clicarRotulo("Aumentar estoque");
    expect(valorDoCampo("variant-stock")).toBe("3");
    await clicarRotulo("Diminuir estoque");
    expect(valorDoCampo("variant-stock")).toBe("2");
  });

  it("o + parte do que foi digitado, e texto que não é número volta a 0 antes de contar", async () => {
    await montar();
    await abrirNovaVariacao();
    await digitar("variant-stock", "10");
    await clicarRotulo("Aumentar estoque");
    expect(valorDoCampo("variant-stock")).toBe("11");
    await digitar("variant-stock", "1,5");
    await clicarRotulo("Aumentar estoque");
    expect(valorDoCampo("variant-stock")).toBe("1");
  });

  it("produto antigo 'Cor' / 'Espacial Grey' abre com a peça Cor marcada e o valor intacto; salvar sem mexer reproduz a linha", async () => {
    await montar([linhaAntiga("Cor", "Espacial Grey")]);
    expect(variantesNaTela()).toEqual(["Cor: Espacial Grey"]);

    await abrirEdicaoDaLinha("Espacial Grey");
    expect(document.getElementById("titulo-da-variacao")?.textContent).toBe(
      "Editar variação",
    );
    expect(atributoMarcado(0)).toBe("Cor");
    expect(valorDoCampo("variant-value")).toBe("Espacial Grey");

    await clicarTexto("Salvar");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: Espacial Grey"]);
  });

  it("produto antigo 'Material' / 'Algodão' abre na peça Material com o botão Algodão marcado e os textos preservados", async () => {
    await montar([linhaAntiga("Material", "Algodão")]);
    await abrirEdicaoDaLinha("Algodão");

    expect(atributoMarcado(0)).toBe("Material");
    expect(document.getElementById("variant-name")).toBeNull();
    expect(valorDoCampo("variant-value")).toBe("Algodão");
    expect(
      document
        .querySelector('[aria-label="Material Algodão"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    await clicarTexto("Salvar");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Material: Algodão"]);
  });

  it("produto antigo 'Estampa' / 'Listrada' (sem peça própria) abre em Outro com os dois textos preservados", async () => {
    await montar([linhaAntiga("Estampa", "Listrada")]);
    await abrirEdicaoDaLinha("Listrada");

    expect(atributoMarcado(0)).toBe("Outro");
    expect(valorDoCampo("variant-name")).toBe("Estampa");
    expect(valorDoCampo("variant-value")).toBe("Listrada");

    await clicarTexto("Salvar");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Estampa: Listrada"]);
  });

  it("produto que já usa 'Material': a peça Material já vem escolhível, sem redigitar o nome", async () => {
    await montar([linhaAntiga("Material", "Algodão")]);
    await abrirNovaVariacao();

    // Num produto que já tem um grupo só sobram a peça dele e Outro.
    expect(
      [...document.querySelectorAll('[role="group"] > button')].map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(["Material", "Outro"]);
    await tocarNaPeca(0, "Material");
    await digitar("variant-value", "Linho");
    await clicarTexto("Salvar variação");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Material: Algodão", "Material: Linho"]);
  });

  it("produto que já usa 'Estampa': o nome vira atalho, sem redigitar", async () => {
    await montar([linhaAntiga("Estampa", "Listrada")]);
    await abrirNovaVariacao();

    const atalho = document.querySelector<HTMLButtonElement>(
      '[data-testid="atalho-de-atributo"]',
    );
    expect(atalho?.textContent).toBe("Estampa");
    await act(async () => {
      atalho?.click();
    });
    await digitar("variant-value", "Lisa");
    await clicarTexto("Salvar variação");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Estampa: Listrada", "Estampa: Lisa"]);
  });

  it("Capacidade e Material tocados num produto novo gravam o nome canônico e o botão escolhido", async () => {
    await montar();
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Capacidade");
    await clicarRotulo("Capacidade 128 GB");
    expect(valorDoCampo("variant-value")).toBe("128 GB");
    await clicarTexto("Salvar variação");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Capacidade: 128 GB"]);
  });

  it("celular 'Memória / Armazenamento' (dois nomes do mesmo tipo): a peça grava um nome em cada par e salvar reproduz a linha", async () => {
    await montar([
      {
        ...linhaAntiga("Memória / Armazenamento", "4 GB / 64 GB"),
        id: "v-cel",
      },
    ]);
    await abrirNovaVariacao();

    // Os dois nomes do produto viram atalhos com o nome REAL.
    expect(
      [...document.querySelectorAll('[data-testid="atalho-de-atributo"]')].map(
        (a) => a.textContent?.trim(),
      ),
    ).toEqual(["Memória", "Armazenamento"]);

    await tocarNaPeca(0, "Capacidade");
    expect(valorDoCampo("variant-name")).toBeUndefined();
    await clicarTexto("+ Outra coisa que muda");
    await tocarNaPeca(1, "Capacidade");

    // Cada par ficou com um nome: o cartão diz o nome gravado, não "Capacidade".
    const titulos = [
      ...document.querySelectorAll('[data-testid^="atributo-"]'),
    ].map(
      (c) =>
        c.querySelector('[role="group"] > button[aria-pressed="true"]')
          ?.textContent,
    );
    expect(titulos).toEqual(["Capacidade", "Capacidade"]);
    await clicarRotulo("Capacidade 16 GB");
    await act(async () => {
      botaoDoAtributo(1, "128 GB").click();
    });
    await clicarTexto("Salvar variação");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "Memória / Armazenamento: 4 GB / 64 GB",
      "Memória / Armazenamento: 16 GB / 128 GB",
    ]);
  });

  it("celular 'Memória / Armazenamento': abrir a linha e salvar sem mexer reproduz o mesmo texto", async () => {
    await montar([
      {
        ...linhaAntiga("Memória / Armazenamento", "4 GB / 64 GB"),
        id: "v-cel",
      },
    ]);
    await abrirEdicaoDaLinha("4 GB / 64 GB");
    expect(valorDoCampo("variant-value")).toBe("4 GB");
    expect(valorDoCampo("variant-value-1")).toBe("64 GB");
    await clicarTexto("Salvar");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "Memória / Armazenamento: 4 GB / 64 GB",
    ]);
  });

  it("'Outro' revela o campo do nome: um atributo livre continua possível", async () => {
    await montar();
    await abrirNovaVariacao();
    await escolherAtributo(0, "Material", "variant-name", digitar);
    await digitar("variant-value", "Linho");
    await clicarTexto("Salvar variação");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Material: Linho"]);
  });

  it("combinação: cada par usa o seletor, e a linha sai 'Cor / Tamanho: Azul / M'", async () => {
    await montar();
    await abrirNovaVariacao();

    await escolherAtributo(0, "Cor", "variant-name", digitar);
    await clicarRotulo("Azul");
    await clicarTexto("+ Outra coisa que muda");
    await escolherAtributo(1, "Tamanho", "variant-name-1", digitar);
    await act(async () => {
      botaoDoAtributo(1, "M").click();
    });
    expect(valorDoCampo("variant-value-1")).toBe("M");

    await clicarTexto("Salvar variação");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor / Tamanho: Azul / M"]);
  });

  it("trocar de Cor para Tamanho depois de escolher Azul não deixa 'Azul' virar um tamanho", async () => {
    await montar();
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Cor");
    await clicarRotulo("Azul");
    expect(valorDoCampo("variant-value")).toBe("Azul");

    await act(async () => {
      botaoDoAtributo(0, "Tamanho").click();
    });
    expect(atributoMarcado(0)).toBe("Tamanho");
    expect(valorDoCampo("variant-value")).toBe("");

    await clicarTexto("Salvar variação");
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(variantesNaTela()).toEqual([]);
  });

  it("o interruptor 'Aparece na loja' diz Ativo e Inativo e segue a semântica de sempre", async () => {
    await montar();
    await abrirNovaVariacao();
    const interruptor = document.getElementById("variant-status");
    expect(interruptor?.getAttribute("role")).toBe("switch");
    expect(interruptor?.getAttribute("aria-checked")).toBe("true");
    expect(interruptor?.textContent).toContain("Ativo");

    await act(async () => {
      interruptor?.click();
    });
    expect(interruptor?.getAttribute("aria-checked")).toBe("false");
    expect(interruptor?.textContent).toContain("Inativo");
    expect(interruptor?.textContent).not.toContain("Offline");
  });

  it("salvar sem escolher nada continua recusado (o seletor não relaxa a validação)", async () => {
    await montar();
    await abrirNovaVariacao();
    await clicarTexto("Salvar variação");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(variantesNaTela()).toEqual([]);
  });

  // O defeito que a revisão achou: a peça gravava "Cor" canônico, e a loja
  // compara o nome EXATO -- um produto com "cor" virava dois grupos ("cor" e
  // "Cor") na vitrine. A peça tem de gravar a grafia que o produto já usa.
  const comoAVitrineVe = async () => {
    const { fileirasDeVariacao } = await import("@/utils/fileiras-de-variacao");
    const linhas = variantesNaTela().map((texto, i) => {
      const [name, value] = texto.split(": ");
      return {
        id: `v${i}`,
        productId: "p-1",
        name,
        value,
        stockIncrement: 3,
        active: true,
      };
    });
    return fileirasDeVariacao(linhas as never, {}).fileiras;
  };

  it("produto com 'cor' minúsculo: tocar a peça Cor e a bolinha grava 'cor' e a vitrine vê UM grupo só", async () => {
    await montar([linhaAntiga("cor", "Rosa")]);
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Cor");
    await clicarRotulo("Preto");
    await clicarTexto("Salvar variação");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["cor: Rosa", "cor: Preto"]);
    const fileiras = await comoAVitrineVe();
    expect(fileiras.map((f) => f.nome)).toEqual(["cor"]);
    expect(fileiras.at(0)?.valores.map((v) => v.valor)).toEqual([
      "Rosa",
      "Preto",
    ]);
  });

  it("produto com 'cor / tamanho' minúsculo: cada par grava a grafia da sua parte e a vitrine vê duas fileiras, não quatro", async () => {
    await montar([linhaAntiga("cor / tamanho", "Rosa / M")]);
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Cor");
    await clicarRotulo("Preto");
    await clicarTexto("+ Outra coisa que muda");
    await tocarNaPeca(1, "Tamanho");
    await act(async () => {
      botaoDoAtributo(1, "G").click();
    });
    await clicarTexto("Salvar variação");

    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "cor / tamanho: Rosa / M",
      "cor / tamanho: Preto / G",
    ]);
    const fileiras = await comoAVitrineVe();
    // Gravado "cor / tamanho", mas a vitrine mostra o tamanho primeiro.
    expect(fileiras.map((f) => f.nome)).toEqual(["tamanho", "cor"]);
  });

  it("produto com a cor 'azul' minúscula: tocar a bolinha Azul grava 'azul', não 'Azul' (uma só cor na vitrine)", async () => {
    await montar([linhaAntiga("Cor", "azul")]);
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Cor");
    await clicarRotulo("Azul");
    expect(valorDoCampo("variant-value")).toBe("azul");
    expect(
      document
        .querySelector('[aria-label="Azul"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("abrir a edição de 'Cor: azul' e sair do campo sem editar não troca 'azul' por 'Azul'", async () => {
    await montar([linhaAntiga("Cor", "azul")]);
    await abrirEdicaoDaLinha("azul");
    const campo = document.getElementById("variant-value") as HTMLInputElement;
    await act(async () => {
      campo.focus();
    });
    await act(async () => {
      campo.blur();
    });
    expect(valorDoCampo("variant-value")).toBe("azul");
    // "Salvar variação" (o do modal), não "Salvar" (o do produto, que o `includes`
    // acharia primeiro): é este clique que regravaria o valor.
    await clicarTexto("Salvar variação");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Cor: azul"]);
  });

  async function digitarNoCampoESair(id: string, texto: string) {
    const campo = document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      campo.focus();
    });
    await digitar(id, texto);
    await act(async () => {
      campo.blur();
    });
  }

  it("editar 'Estampa: Vovo' digitando 'Vovô' grava 'Vovô' e o campo mostra o mesmo", async () => {
    await montar([linhaAntiga("Estampa", "Vovo")]);
    await abrirEdicaoDaLinha("Vovo");
    await digitarNoCampoESair("variant-value", "Vovô");
    expect(valorDoCampo("variant-value")).toBe("Vovô");
    await clicarTexto("Salvar variação");
    expect(variantesNaTela()).toEqual(["Estampa: Vovô"]);
  });

  it("nova variação 'Vovô' com 'Vovó' já gravado grava 'Vovô' (texto digitado nunca é trocado)", async () => {
    await montar([linhaAntiga("Estampa", "Vovó")]);
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Estampa");
    await digitarNoCampoESair("variant-value", "Vovô");
    expect(valorDoCampo("variant-value")).toBe("Vovô");
    await clicarTexto("Salvar variação");
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual(["Estampa: Vovó", "Estampa: Vovô"]);
  });

  it("editar 'Cor: azul' digitando 'Azul' corrige só a caixa: grava 'Azul'", async () => {
    await montar([linhaAntiga("Cor", "azul")]);
    await abrirEdicaoDaLinha("azul");
    await digitarNoCampoESair("variant-value", "Azul");
    await clicarTexto("Salvar variação");
    expect(variantesNaTela()).toEqual(["Cor: Azul"]);
  });

  it("editar 'Cor: azul' e tocar a bolinha Azul grava 'Azul': o próprio valor da linha não conta como 'em uso'", async () => {
    await montar([linhaAntiga("Cor", "azul")]);
    await abrirEdicaoDaLinha("azul");
    await clicarRotulo("Azul");
    expect(valorDoCampo("variant-value")).toBe("Azul");
    await clicarTexto("Salvar variação");
    expect(variantesNaTela()).toEqual(["Cor: Azul"]);
  });

  it("editar uma linha e tocar a bolinha Azul quando OUTRA linha grava 'azul' continua gravando 'azul'", async () => {
    await montar([
      linhaAntiga("Cor", "azul"),
      { ...linhaAntiga("Cor", "Rosa"), id: "v2" },
    ]);
    await abrirEdicaoDaLinha("Rosa");
    await clicarRotulo("Azul");
    expect(valorDoCampo("variant-value")).toBe("azul");
  });

  it("todo botão do modal com contorno tem border-solid (o reset global do botão apaga o contorno)", async () => {
    await montar(
      [],
      ["https://exemplo.test/a.png", "https://exemplo.test/b.png"],
    );
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Cor");
    const modal = document
      .getElementById("titulo-da-variacao")
      ?.closest('[role="dialog"]');
    expect(modal).toBeTruthy();
    const comContorno = [...(modal?.querySelectorAll("button") ?? [])].filter(
      (b) => [...b.classList].some((c) => c === "border" || c === "border-2"),
    );
    // controle: o modal tem de ter botões com contorno (peças, interruptor, fotos).
    expect(comContorno.length).toBeGreaterThan(8);
    expect(
      document.querySelectorAll('[data-testid="foto-da-variacao"]').length,
    ).toBe(2);
    // "Cancelar" é o botão antigo do modal (sem contorno desde sempre); ligar o
    // contorno nele mudaria uma tela que não faz parte deste pedido.
    const semSolido = comContorno
      .filter((b) => b.textContent?.trim() !== "Cancelar")
      .filter(
        (b) =>
          !b.classList.contains("border-solid") &&
          !b.classList.contains("border-dashed"),
      )
      .map(
        (b) => b.id || b.getAttribute("aria-label") || b.className.slice(0, 60),
      );
    expect(semSolido).toEqual([]);
  });

  it("a bolinha e o campo livre andam juntos: escolher outra desmarca a anterior, e digitar desmarca todas", async () => {
    await montar();
    await abrirNovaVariacao();
    await tocarNaPeca(0, "Cor");
    await clicarRotulo("Preto");
    await clicarRotulo("Rosa");
    expect(valorDoCampo("variant-value")).toBe("Rosa");
    expect(
      document
        .querySelector('[aria-label="Preto"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    await digitar("variant-value", "Espacial Grey");
    expect(
      document
        .querySelector('[aria-label="Rosa"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
