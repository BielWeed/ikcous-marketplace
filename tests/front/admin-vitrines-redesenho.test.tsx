// @vitest-environment jsdom
//
// Redesenho da tela de admin "Vitrines" (aprovado pelo dono em 03/10/2026).
//
// O que este arquivo prende:
//   1. todas as vitrines usam o MESMO cartão (nome, liga/desliga, miniaturas);
//   2. vitrine desligada fica marcada (e legível de longe);
//   3. tocar no cartão abre o painel que sobe de baixo, e editar ali grava
//      EXATAMENTE o que a tela antiga gravava (mesmo `updateConfig`, mesmo
//      formato de `homeSections` — a loja do cliente lê esse formato);
//   4. reordenar — pelas setas E arrastando — grava a nova ordem pelo mesmo
//      caminho, e arrastar grava AO SOLTAR, nunca a cada pixel;
//   5. "Restaurar padrão" e "Excluir" NÃO apagam sem confirmar;
//   6. o botão diz "Nova vitrine" (sem o "+ +" duplicado).
//
// O arrastar de verdade (ponteiro) não existe no jsdom: o `Reorder` do
// framer-motion é substituído por um dublê que entrega ao teste o `onReorder`
// do grupo e o `onDragEnd` de cada item — que é a fronteira que o framer
// chama quando o dedo mexe e quando o dedo solta.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Secao = {
  id: string;
  title: string;
  active: boolean;
  type?: string;
  maxItems?: number;
  productIds?: string[];
  isCustom?: boolean;
};

const secaoLancamentos: Secao = {
  id: "new_arrivals",
  title: "Últimos Lançamentos",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: false,
};
const secaoKits: Secao = {
  id: "custom_1",
  title: "Kits de presente",
  active: true,
  maxItems: 6,
  productIds: ["p1", "p2"],
  isCustom: true,
};
const secaoDestaques: Secao = {
  id: "bestsellers",
  title: "Destaques em Alta",
  active: false,
  maxItems: 6,
  productIds: [],
  isCustom: false,
};

const produto = (id: string, nome: string, preco: number, criado: number) => ({
  id,
  name: nome,
  price: preco,
  category: "Perfumaria",
  images: [`https://img.exemplo/${id}.jpg`],
  stock: 5,
  isActive: true,
  createdTime: criado,
});
const PRODUTOS = [
  produto("p1", "Kit Perfume", 189.9, 4),
  produto("p2", "Caixa Rosé", 129, 3),
  produto("p3", "Fone Bluetooth", 249.9, 2),
  produto("p4", "Body Splash", 59.9, 1),
];

let configDaLoja: { homeSections?: Secao[] } = {};
const updateConfig = vi.fn(async (_: unknown) => true);
let offline = false;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, updateConfig }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: PRODUTOS }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => offline,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}));

// Fronteira do arrastar: o que o framer chama quando o dedo mexe/solta.
const arrastar: {
  onReorder: ((nova: Secao[]) => void) | null;
  aoSoltar: Map<string, () => void>;
} = { onReorder: null, aoSoltar: new Map() };

vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    Reorder: {
      Group: (props: {
        onReorder: (nova: Secao[]) => void;
        children: React.ReactNode;
      }) => {
        arrastar.onReorder = props.onReorder;
        return createElement("div", { "data-testid": "grupo" }, props.children);
      },
      Item: (props: {
        value: Secao;
        onDragEnd?: () => void;
        children: React.ReactNode;
      }) => {
        if (props.onDragEnd)
          arrastar.aoSoltar.set(props.value.id, props.onDragEnd);
        return createElement("div", null, props.children);
      },
    },
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const { AdminCarouselsView } = await import("@/views/admin/AdminCarouselsView");

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  await act(async () => {
    raiz.render(createElement(AdminCarouselsView, { onNavigate: vi.fn() }));
  });
}

const cartoes = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="cartao-vitrine"]'),
  );
const cartaoDe = (titulo: string) => {
  const achado = cartoes().find((c) => c.textContent?.includes(titulo));
  if (!achado) throw new Error(`sem cartão para "${titulo}"`);
  return achado;
};
const porRotulo = (
  rotulo: string | RegExp,
  raizBusca: ParentNode = document,
) => {
  const todos = Array.from(
    raizBusca.querySelectorAll<HTMLElement>("[aria-label]"),
  );
  const achado = todos.find((el) => {
    const r = el.getAttribute("aria-label") ?? "";
    return typeof rotulo === "string" ? r === rotulo : rotulo.test(r);
  });
  if (!achado) throw new Error(`sem elemento com aria-label ${String(rotulo)}`);
  return achado;
};
const botaoComTexto = (texto: string, raizBusca: ParentNode = document) => {
  const achado = Array.from(
    raizBusca.querySelectorAll<HTMLElement>("button"),
  ).find((b) => b.textContent?.trim() === texto);
  if (!achado) throw new Error(`sem botão "${texto}"`);
  return achado;
};
const painel = () => document.querySelector<HTMLElement>('[role="dialog"]');
const confirmacao = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}
async function abrirMenuMaisAcoes() {
  await act(async () => {
    porRotulo("Mais ações").dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: false,
      }),
    );
  });
}
async function digitar(input: HTMLInputElement, valor: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const ultimaGravacao = () =>
  updateConfig.mock.calls.at(-1)?.[0] as { homeSections: Secao[] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  offline = false;
  arrastar.onReorder = null;
  arrastar.aoSoltar.clear();
  configDaLoja = {
    homeSections: [secaoLancamentos, secaoKits, secaoDestaques],
  };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("cartão único", () => {
  it("toda vitrine ganha o MESMO cartão: nome, liga/desliga e miniaturas", async () => {
    await montar();
    expect(cartoes()).toHaveLength(3);
    for (const c of cartoes()) {
      expect(c.querySelector('[role="switch"]')).not.toBeNull();
      expect(c.querySelector("[data-miniaturas]")).not.toBeNull();
    }
    // a curada mostra as fotos dos produtos escolhidos, na ordem escolhida
    const fotos = Array.from(
      cartaoDe("Kits de presente").querySelectorAll("img"),
    ).map((i) => i.getAttribute("src"));
    expect(fotos).toEqual([
      "https://img.exemplo/p1.jpg",
      "https://img.exemplo/p2.jpg",
    ]);
  });

  it("o cabeçalho conta as vitrines e o botão diz 'Nova vitrine' sem o '+ +'", async () => {
    await montar();
    const texto = hospedeiro.textContent ?? "";
    expect(botaoComTexto("Nova vitrine", hospedeiro)).toBeTruthy();
    expect(texto).not.toMatch(/\+\s*\+/);
    expect(texto).toContain("2/3");
    // sem tipografia de máquina de escrever misturada
    expect(hospedeiro.querySelector(".font-mono")).toBeNull();
  });
});

describe("vitrine desligada", () => {
  it("fica marcada como desligada e diz que está oculta da loja", async () => {
    await montar();
    expect(cartaoDe("Destaques em Alta").getAttribute("data-ativa")).toBe(
      "false",
    );
    expect(cartaoDe("Destaques em Alta").textContent).toContain(
      "oculta da loja",
    );
    expect(cartaoDe("Kits de presente").getAttribute("data-ativa")).toBe(
      "true",
    );
  });

  it("o liga/desliga grava a vitrine com `active` invertido e o resto intacto", async () => {
    await montar();
    await clicar(
      cartaoDe("Destaques em Alta").querySelector<HTMLElement>(
        '[role="switch"]',
      ) as HTMLElement,
    );
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(ultimaGravacao()).toEqual({
      homeSections: [
        secaoLancamentos,
        secaoKits,
        { ...secaoDestaques, active: true },
      ],
    });
  });
});

describe("painel de edição (sobe de baixo)", () => {
  async function abrirKits() {
    await montar();
    await clicar(porRotulo("Editar vitrine Kits de presente"));
  }

  it("tocar no cartão abre o painel com nome, quantidade e produtos no mesmo lugar", async () => {
    await abrirKits();
    const p = painel();
    expect(p).not.toBeNull();
    expect(p?.textContent).toContain("Editar vitrine");
    const nome = p?.querySelector<HTMLInputElement>("#vitrine-title-custom_1");
    expect(nome?.value).toBe("Kits de presente");
    // quantidade atual marcada
    expect(
      botaoComTexto("6", p as HTMLElement).getAttribute("aria-pressed"),
    ).toBe("true");
    // produtos: os escolhidos vêm primeiro e marcados
    expect(
      p?.querySelector('[data-produto-id="p1"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      p?.querySelector('[data-produto-id="p3"]')?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("mudar a quantidade grava o mesmo que o seletor antigo gravava", async () => {
    await abrirKits();
    await clicar(botaoComTexto("8", painel() as HTMLElement));
    expect(ultimaGravacao()).toEqual({
      homeSections: [
        secaoLancamentos,
        { ...secaoKits, maxItems: 8 },
        secaoDestaques,
      ],
    });
  });

  it("renomear grava o novo título ao sair do campo", async () => {
    await abrirKits();
    const nome = painel()?.querySelector<HTMLInputElement>(
      "#vitrine-title-custom_1",
    ) as HTMLInputElement;
    await digitar(nome, "Presentes");
    await act(async () => {
      nome.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(ultimaGravacao()).toEqual({
      homeSections: [
        secaoLancamentos,
        { ...secaoKits, title: "Presentes" },
        secaoDestaques,
      ],
    });
  });

  it("abrir e fechar o painel SEM mexer em nada não grava nada", async () => {
    await abrirKits();
    const nome = painel()?.querySelector<HTMLInputElement>(
      "#vitrine-title-custom_1",
    ) as HTMLInputElement;
    await act(async () => {
      nome.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await clicar(botaoComTexto("Concluir", painel() as HTMLElement));
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("marcar um produto acrescenta ao fim; desmarcar tira — mesma regra de antes", async () => {
    await abrirKits();
    await clicar(
      painel()?.querySelector('[data-produto-id="p3"]') as HTMLElement,
    );
    expect(ultimaGravacao().homeSections[1].productIds).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    await clicar(
      painel()?.querySelector('[data-produto-id="p1"]') as HTMLElement,
    );
    expect(ultimaGravacao().homeSections[1].productIds).toEqual(["p2"]);
  });

  it("'Automático' devolve a vitrine à escolha da loja (productIds vazio)", async () => {
    await abrirKits();
    await clicar(botaoComTexto("Automático", painel() as HTMLElement));
    expect(ultimaGravacao().homeSections[1].productIds).toEqual([]);
  });

  it("numa vitrine automática, marcar o primeiro produto parte dos que já aparecem", async () => {
    await montar();
    await clicar(porRotulo("Editar vitrine Últimos Lançamentos"));
    // automática: aparecem p1..p4 (ordem da loja); desmarcar p4 fixa os 3 restantes
    await clicar(
      painel()?.querySelector('[data-produto-id="p4"]') as HTMLElement,
    );
    expect(ultimaGravacao().homeSections[0].productIds).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("a busca filtra por nome sem acento", async () => {
    await abrirKits();
    const busca = painel()?.querySelector<HTMLInputElement>(
      'input[type="search"], input[placeholder*="Buscar"]',
    ) as HTMLInputElement;
    await digitar(busca, "rose");
    const visiveis = Array.from(
      painel()?.querySelectorAll("[data-produto-id]") ?? [],
    ).map((el) => el.getAttribute("data-produto-id"));
    expect(visiveis).toEqual(["p2"]);
  });

  it("vitrine de fábrica não tem 'Excluir' no painel; personalizada tem", async () => {
    await montar();
    await clicar(porRotulo("Editar vitrine Últimos Lançamentos"));
    expect(
      Array.from(painel()?.querySelectorAll("button") ?? []).some(
        (b) => b.textContent?.trim() === "Excluir",
      ),
    ).toBe(false);
    await clicar(botaoComTexto("Concluir", painel() as HTMLElement));
    await clicar(porRotulo("Editar vitrine Kits de presente"));
    expect(botaoComTexto("Excluir", painel() as HTMLElement)).toBeTruthy();
  });

  it("sem internet, mudar a quantidade avisa e não grava", async () => {
    await abrirKits();
    offline = true;
    await montar(); // re-renderiza com offline
    await clicar(botaoComTexto("10", painel() as HTMLElement));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});

describe("reordenar", () => {
  it("as setas continuam gravando a ordem trocada", async () => {
    await montar();
    await clicar(porRotulo("Descer vitrine Últimos Lançamentos"));
    expect(ultimaGravacao()).toEqual({
      homeSections: [secaoKits, secaoLancamentos, secaoDestaques],
    });
    updateConfig.mockClear();
    await clicar(porRotulo("Subir vitrine Destaques em Alta"));
    expect(ultimaGravacao()).toEqual({
      homeSections: [secaoLancamentos, secaoDestaques, secaoKits],
    });
  });

  it("a primeira não sobe e a última não desce", async () => {
    await montar();
    expect(
      porRotulo("Subir vitrine Últimos Lançamentos").hasAttribute("disabled"),
    ).toBe(true);
    expect(
      porRotulo("Descer vitrine Destaques em Alta").hasAttribute("disabled"),
    ).toBe(true);
  });

  it("arrastar grava a nova ordem AO SOLTAR, uma vez, pelo mesmo caminho das setas", async () => {
    await montar();
    expect(arrastar.onReorder).not.toBeNull();
    // o dedo passa por duas posições antes de soltar: nada grava ainda
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoDestaques, secaoLancamentos]);
    });
    expect(updateConfig).not.toHaveBeenCalled();
    // solta
    await act(async () => {
      arrastar.aoSoltar.get("new_arrivals")?.();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(ultimaGravacao()).toEqual({
      homeSections: [secaoKits, secaoDestaques, secaoLancamentos],
    });
  });

  it("soltar sem ter mudado de lugar não grava", async () => {
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    await act(async () => {
      arrastar.onReorder?.([secaoLancamentos, secaoKits, secaoDestaques]);
    });
    await act(async () => {
      arrastar.aoSoltar.get("custom_1")?.();
    });
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("sem internet, soltar avisa e não grava", async () => {
    offline = true;
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    await act(async () => {
      arrastar.aoSoltar.get("custom_1")?.();
    });
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("se a gravação falhar, a lista volta à ordem que está salva", async () => {
    updateConfig.mockResolvedValueOnce(false);
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    await act(async () => {
      arrastar.aoSoltar.get("custom_1")?.();
    });
    const ordem = cartoes().map((c) => c.getAttribute("data-vitrine-id"));
    expect(ordem).toEqual(["new_arrivals", "custom_1", "bestsellers"]);
  });
});

describe("Restaurar padrão pergunta antes", () => {
  it("não apaga ao abrir o menu nem ao escolher; só ao confirmar", async () => {
    await montar();
    await abrirMenuMaisAcoes();
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent?.includes("Restaurar padrão"));
    expect(item).toBeTruthy();
    await clicar(item as HTMLElement);

    expect(updateConfig).not.toHaveBeenCalled();
    const d = confirmacao();
    expect(d).not.toBeNull();
    // diz o que vai acontecer: some a personalizada e os 2 produtos escolhidos
    expect(d?.textContent).toContain("Kits de presente");
    expect(d?.textContent).toMatch(/2 produtos escolhidos/);

    await clicar(botaoComTexto("Restaurar", d as HTMLElement));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    const gravado = ultimaGravacao().homeSections;
    expect(gravado.map((s) => s.id)).toEqual([
      "new_arrivals",
      "offers",
      "bestsellers",
    ]);
    expect(gravado.every((s) => s.active && s.maxItems === 6)).toBe(true);
  });

  it("Cancelar não grava nada", async () => {
    await montar();
    await abrirMenuMaisAcoes();
    await clicar(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((el) =>
        el.textContent?.includes("Restaurar padrão"),
      ) as HTMLElement,
    );
    await clicar(botaoComTexto("Cancelar", confirmacao() as HTMLElement));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(confirmacao()).toBeNull();
  });
});

describe("Excluir pede confirmação", () => {
  async function pedirExclusao() {
    await montar();
    await clicar(porRotulo("Editar vitrine Kits de presente"));
    await clicar(botaoComTexto("Excluir", painel() as HTMLElement));
  }

  it("não apaga ao tocar em Excluir; só ao confirmar", async () => {
    await pedirExclusao();
    expect(updateConfig).not.toHaveBeenCalled();
    const d = confirmacao();
    expect(d).not.toBeNull();
    expect(d?.textContent).toContain("Kits de presente");

    await clicar(botaoComTexto("Excluir", d as HTMLElement));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(ultimaGravacao()).toEqual({
      homeSections: [secaoLancamentos, secaoDestaques],
    });
  });

  it("Cancelar mantém a vitrine, não grava e devolve ao painel de edição", async () => {
    await pedirExclusao();
    await clicar(botaoComTexto("Cancelar", confirmacao() as HTMLElement));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(confirmacao()).toBeNull();
    expect(painel()?.textContent).toContain("Editar vitrine");
  });
});

describe("Nova vitrine", () => {
  async function abrirNova() {
    await montar();
    await clicar(botaoComTexto("Nova vitrine", hospedeiro));
  }

  it("sem nome, não cria e avisa", async () => {
    await abrirNova();
    await clicar(botaoComTexto("Criar vitrine", painel() as HTMLElement));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("com nome, grava no fim da lista, ligada, com limite 6 e sem produtos", async () => {
    await abrirNova();
    const campo = painel()?.querySelector<HTMLInputElement>(
      "#titulo-da-nova-vitrine",
    ) as HTMLInputElement;
    await digitar(campo, "  Coleção verão ");
    await clicar(botaoComTexto("Criar vitrine", painel() as HTMLElement));
    const gravado = ultimaGravacao().homeSections;
    expect(gravado).toHaveLength(4);
    expect(gravado.slice(0, 3)).toEqual([
      secaoLancamentos,
      secaoKits,
      secaoDestaques,
    ]);
    expect(gravado[3]).toMatchObject({
      title: "Coleção verão",
      active: true,
      isCustom: true,
      maxItems: 6,
      productIds: [],
    });
    expect(gravado[3].id).toMatch(/^custom_\d+$/);
  });

  it("a sugestão rápida preenche o nome (sem '+' na frente)", async () => {
    await abrirNova();
    const sugestao = botaoComTexto("Kits de Presente", painel() as HTMLElement);
    await clicar(sugestao);
    expect(
      painel()?.querySelector<HTMLInputElement>("#titulo-da-nova-vitrine")
        ?.value,
    ).toBe("Kits de Presente");
  });

  it("se a gravação falhar, o painel continua aberto com o nome digitado", async () => {
    updateConfig.mockResolvedValueOnce(false);
    await abrirNova();
    const campo = painel()?.querySelector<HTMLInputElement>(
      "#titulo-da-nova-vitrine",
    ) as HTMLInputElement;
    await digitar(campo, "Linha skincare");
    await clicar(botaoComTexto("Criar vitrine", painel() as HTMLElement));
    expect(painel()).not.toBeNull();
    expect(
      painel()?.querySelector<HTMLInputElement>("#titulo-da-nova-vitrine")
        ?.value,
    ).toBe("Linha skincare");
  });
});

describe("sem personalização salva (config.homeSections ausente)", () => {
  it("mostra as 3 vitrines de fábrica no mesmo cartão", async () => {
    configDaLoja = {};
    await montar();
    expect(cartoes().map((c) => c.getAttribute("data-vitrine-id"))).toEqual([
      "new_arrivals",
      "offers",
      "bestsellers",
    ]);
  });
});

// ── Correções da revisão Opus (03/10/2026) ───────────────────────────────

const secaoVerao: Secao = {
  id: "custom_2",
  title: "Coleção verão",
  active: true,
  maxItems: 6,
  productIds: [],
  isCustom: true,
};

describe("lista travada enquanto a ordem arrastada é gravada", () => {
  // Antes: depois de soltar e ANTES do banco confirmar, a tela mostrava a ordem
  // nova mas setas/liga-desliga montavam a gravação sobre a ordem ANTIGA —
  // o arrasto era desfeito em silêncio. Agora a lista trava até confirmar.
  let confirmar: (salvou: boolean) => void = () => {};

  async function soltarComGravacaoPendente() {
    configDaLoja = {
      homeSections: [secaoLancamentos, secaoKits, secaoDestaques, secaoVerao],
    };
    updateConfig.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolver) => {
          confirmar = resolver;
        }),
    );
    await montar();
    await act(async () => {
      arrastar.onReorder?.([
        secaoVerao,
        secaoLancamentos,
        secaoKits,
        secaoDestaques,
      ]);
    });
    await act(async () => {
      arrastar.aoSoltar.get("custom_2")?.();
    });
  }

  it("com a gravação pendente, setas, liga/desliga, alça, cartão e Nova vitrine ficam desabilitados e nenhuma segunda gravação sai", async () => {
    await soltarComGravacaoPendente();
    expect(updateConfig).toHaveBeenCalledTimes(1);

    const desabilitado = (el: Element) => el.hasAttribute("disabled");
    const interruptorDestaques = cartaoDe("Destaques em Alta").querySelector(
      '[role="switch"]',
    ) as HTMLElement;
    expect(desabilitado(porRotulo("Descer vitrine Últimos Lançamentos"))).toBe(
      true,
    );
    expect(desabilitado(porRotulo("Subir vitrine Kits de presente"))).toBe(
      true,
    );
    expect(desabilitado(interruptorDestaques)).toBe(true);
    expect(desabilitado(porRotulo(/^Arrastar vitrine Kits/))).toBe(true);
    expect(desabilitado(porRotulo("Editar vitrine Kits de presente"))).toBe(
      true,
    );
    expect(desabilitado(botaoComTexto("Nova vitrine", hospedeiro))).toBe(true);
    expect(desabilitado(porRotulo("Mais ações"))).toBe(true);
    expect(hospedeiro.textContent).toContain("Salvando ordem");

    // tocar nelas não grava nada
    await clicar(porRotulo("Descer vitrine Últimos Lançamentos"));
    await clicar(interruptorDestaques);
    await clicar(porRotulo("Editar vitrine Kits de presente"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(painel()).toBeNull();
  });

  it("um segundo arrasto na janela não grava nem zera a ordem em curso", async () => {
    await soltarComGravacaoPendente();
    await act(async () => {
      arrastar.onReorder?.([
        secaoLancamentos,
        secaoKits,
        secaoDestaques,
        secaoVerao,
      ]);
      arrastar.aoSoltar.get("new_arrivals")?.();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    // a tela segue mostrando a ordem que está sendo gravada
    expect(cartoes().map((c) => c.getAttribute("data-vitrine-id"))).toEqual([
      "custom_2",
      "new_arrivals",
      "custom_1",
      "bestsellers",
    ]);
  });

  it("ao confirmar, tudo volta a funcionar", async () => {
    await soltarComGravacaoPendente();
    await act(async () => {
      confirmar(true);
    });
    expect(
      porRotulo("Descer vitrine Kits de presente").hasAttribute("disabled"),
    ).toBe(false);
    expect(hospedeiro.textContent).not.toContain("Salvando ordem");
    await clicar(porRotulo("Descer vitrine Kits de presente"));
    expect(updateConfig).toHaveBeenCalledTimes(2);
  });

  it("se a gravação falhar, também destrava (e a lista volta à ordem salva)", async () => {
    await soltarComGravacaoPendente();
    await act(async () => {
      confirmar(false);
    });
    expect(
      porRotulo("Descer vitrine Kits de presente").hasAttribute("disabled"),
    ).toBe(false);
    expect(cartoes().map((c) => c.getAttribute("data-vitrine-id"))).toEqual([
      "new_arrivals",
      "custom_1",
      "bestsellers",
      "custom_2",
    ]);
  });
});

describe("ao soltar, grava sobre o estado ATUAL das vitrines (por id)", () => {
  it("uma mudança confirmada no meio do arrasto não é desfeita", async () => {
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    // no meio do arrasto, a vitrine de Lançamentos foi desligada e renomeada
    configDaLoja = {
      homeSections: [
        { ...secaoLancamentos, active: false, title: "Novidades" },
        secaoKits,
        secaoDestaques,
      ],
    };
    await montar();
    await act(async () => {
      arrastar.aoSoltar.get("custom_1")?.();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(ultimaGravacao()).toEqual({
      homeSections: [
        secaoKits,
        { ...secaoLancamentos, active: false, title: "Novidades" },
        secaoDestaques,
      ],
    });
  });

  it("lista incompleta (faltou vitrine) não grava", async () => {
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos]);
    });
    await act(async () => {
      arrastar.aoSoltar.get("custom_1")?.();
    });
    expect(updateConfig).not.toHaveBeenCalled();
    expect(cartoes()).toHaveLength(3);
  });

  it("vitrine que sumiu do estado atual durante o arrasto não grava", async () => {
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    configDaLoja = {
      homeSections: [secaoLancamentos, secaoDestaques, secaoVerao],
    };
    await montar();
    await act(async () => {
      arrastar.aoSoltar.get("custom_1")?.();
    });
    expect(updateConfig).not.toHaveBeenCalled();
  });
});

describe("dado antigo e avisos", () => {
  async function escolherRestaurarNoMenu() {
    await abrirMenuMaisAcoes();
    await clicar(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((el) =>
        el.textContent?.includes("Restaurar padrão"),
      ) as HTMLElement,
    );
  }

  it("vitrine sem título (dado antigo) não quebra a tela, o painel nem o restaurar", async () => {
    const semTitulo = {
      id: "custom_9",
      active: true,
      isCustom: true,
      productIds: [],
    } as unknown as Secao;
    configDaLoja = { homeSections: [secaoLancamentos, semTitulo] };
    await montar();
    expect(cartaoDe("Sem nome")).toBeTruthy();
    await clicar(porRotulo("Editar vitrine Sem nome"));
    expect(
      painel()?.querySelector<HTMLInputElement>("#vitrine-title-custom_9")
        ?.value,
    ).toBe("");
    await clicar(botaoComTexto("Concluir", painel() as HTMLElement));
    await escolherRestaurarNoMenu();
    expect(confirmacao()?.textContent).toContain("Sem nome");
  });

  it("duas personalizadas com o mesmo nome no diálogo de restaurar não repetem chave", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    configDaLoja = {
      homeSections: [
        { ...secaoKits, id: "custom_a", productIds: [] },
        { ...secaoKits, id: "custom_b", productIds: [] },
      ],
    };
    await montar();
    await escolherRestaurarNoMenu();
    const avisosDeChave = erro.mock.calls.filter((c) =>
      String(c[0]).includes("same key"),
    );
    erro.mockRestore();
    expect(avisosDeChave).toHaveLength(0);
    const linhas =
      confirmacao()?.textContent?.match(/Some a vitrine "Kits de presente"/g) ??
      [];
    expect(linhas).toHaveLength(2);
  });

  it("Escolher numa vitrine automática sem produto em exibição avisa, e não grava", async () => {
    // nenhum produto em oferta: a vitrine "offers" automática fica vazia
    configDaLoja = {
      homeSections: [{ ...secaoDestaques, active: true, id: "offers" }],
    };
    await montar();
    await clicar(porRotulo(/^Editar vitrine Destaques em Alta/));
    await clicar(botaoComTexto("Escolher", painel() as HTMLElement));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(painel()?.textContent).toContain("Nenhum produto aparece");
  });
});
