// @vitest-environment jsdom
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
const updateConfig = vi.fn(async (_: { homeSections: Secao[] }) => true);
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
  updateConfig.mockReset();
  updateConfig.mockImplementation(async (updates) => {
    configDaLoja = updates;
    return true;
  });
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

// Mesmo contrato do StoreContext: publica a configuração só após confirmar.
function gravacaoPendente() {
  let confirmar!: (salvou: boolean) => void;
  const resposta = new Promise<boolean>((resolver) => {
    confirmar = resolver;
  });
  updateConfig.mockImplementationOnce(async (updates) => {
    const salvou = await resposta;
    if (salvou) configDaLoja = updates;
    return salvou;
  });
  return async (salvou: boolean) => {
    await act(async () => confirmar(salvou));
  };
}

async function abrirEdicao() {
  await montar();
  await clicar(porRotulo("Editar vitrine Kits de presente"));
}

async function renomear(titulo: string) {
  const nome = document.querySelector<HTMLInputElement>(
    "#vitrine-title-custom_1",
  ) as HTMLInputElement;
  await act(async () => nome.focus());
  await digitar(nome, titulo);
  await act(async () => nome.blur());
  return nome;
}

describe("gravações concorrentes das vitrines", () => {
  it("não envia a quantidade sobre o snapshot de um nome ainda não confirmado", async () => {
    const confirmar = gravacaoPendente();
    await abrirEdicao();
    await renomear("Presentes");
    await clicar(botaoComTexto("8", painel() as HTMLElement));

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartaoDe("Kits de presente")).toBeTruthy();
    expect(
      botaoComTexto("6", painel() as HTMLElement).getAttribute("aria-pressed"),
    ).toBe("true");

    await confirmar(true);
    await clicar(botaoComTexto("8", painel() as HTMLElement));
    expect(updateConfig).toHaveBeenCalledTimes(2);
    expect(ultimaGravacao().homeSections[1]).toEqual({
      ...secaoKits,
      title: "Presentes",
      maxItems: 8,
    });
    expect(cartaoDe("Presentes").textContent).toContain("Até 8");
  });

  it("não envia a edição de outra vitrine enquanto a primeira grava", async () => {
    const confirmar = gravacaoPendente();
    await abrirEdicao();
    await renomear("Presentes");
    await clicar(porRotulo("Fechar", painel() as HTMLElement));
    await clicar(porRotulo("Editar vitrine Últimos Lançamentos"));

    expect(painel()).toBeNull();
    expect(updateConfig).toHaveBeenCalledTimes(1);
    await confirmar(true);
    await clicar(porRotulo("Editar vitrine Últimos Lançamentos"));
    await clicar(botaoComTexto("8", painel() as HTMLElement));
    expect(ultimaGravacao().homeSections[1].title).toBe("Presentes");
  });

  it("não começa arrasto enquanto um nome grava, nem reaproveita esse arrasto depois", async () => {
    const confirmar = gravacaoPendente();
    await abrirEdicao();
    await renomear("Presentes");
    await clicar(porRotulo("Fechar", painel() as HTMLElement));
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
      arrastar.aoSoltar.get("custom_1")?.();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartoes().map((c) => c.dataset.vitrineId)).toEqual([
      "new_arrivals",
      "custom_1",
      "bestsellers",
    ]);
    await confirmar(true);
    await act(async () => arrastar.aoSoltar.get("custom_1")?.());
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it("dois toques em visibilidade no mesmo turno enviam uma única gravação", async () => {
    const confirmar = gravacaoPendente();
    await montar();
    const interruptor = porRotulo("Exibir na loja: Kits de presente");
    await act(async () => {
      interruptor.click();
      interruptor.click();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartaoDe("Kits de presente").dataset.ativa).toBe("true");
    expect(
      porRotulo("Subir vitrine Kits de presente").hasAttribute("disabled"),
    ).toBe(true);
    await confirmar(true);
    expect(cartaoDe("Kits de presente").dataset.ativa).toBe("false");
  });

  it("seta em voo bloqueia visibilidade e a próxima gravação usa a ordem confirmada", async () => {
    const confirmar = gravacaoPendente();
    await montar();
    await clicar(porRotulo("Subir vitrine Kits de presente"));
    await clicar(porRotulo("Exibir na loja: Destaques em Alta"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    await confirmar(true);
    await clicar(porRotulo("Exibir na loja: Destaques em Alta"));
    expect(ultimaGravacao().homeSections.map((s) => s.id)).toEqual([
      "custom_1",
      "new_arrivals",
      "bestsellers",
    ]);
    expect(ultimaGravacao().homeSections[2].active).toBe(true);
  });

  it("Enter repetido durante a criação envia uma vez e só insere após confirmar", async () => {
    const confirmar = gravacaoPendente();
    await montar();
    await clicar(botaoComTexto("Nova vitrine", hospedeiro));
    const nome = document.querySelector<HTMLInputElement>(
      "#titulo-da-nova-vitrine",
    ) as HTMLInputElement;
    await digitar(nome, "Verão");
    const enter = () =>
      nome.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    await act(async () => {
      enter();
      enter();
    });
    await act(async () => {
      enter();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartoes()).toHaveLength(3);
    await confirmar(true);
    expect(cartoes()).toHaveLength(4);
    expect(cartaoDe("Verão")).toBeTruthy();
    expect(painel()).toBeNull();
  });

  it("exclusão pendente impede outra gravação de ressuscitar a vitrine", async () => {
    const confirmar = gravacaoPendente();
    await abrirEdicao();
    await clicar(botaoComTexto("Excluir", painel() as HTMLElement));
    await clicar(botaoComTexto("Excluir", confirmacao() as HTMLElement));
    await clicar(porRotulo("Exibir na loja: Destaques em Alta"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartoes()).toHaveLength(3);
    await confirmar(true);
    expect(cartoes()).toHaveLength(2);
    await clicar(porRotulo("Exibir na loja: Destaques em Alta"));
    expect(ultimaGravacao().homeSections.map((s) => s.id)).toEqual([
      "new_arrivals",
      "bestsellers",
    ]);
  });

  it("falha não publica o snapshot e libera uma nova tentativa", async () => {
    const confirmar = gravacaoPendente();
    await montar();
    await clicar(porRotulo("Exibir na loja: Kits de presente"));
    await clicar(porRotulo("Subir vitrine Kits de presente"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    await confirmar(false);
    expect(cartaoDe("Kits de presente").dataset.ativa).toBe("true");
    await clicar(porRotulo("Exibir na loja: Kits de presente"));
    expect(updateConfig).toHaveBeenCalledTimes(2);
    expect(cartaoDe("Kits de presente").dataset.ativa).toBe("false");
  });

  it("blur repetido do mesmo nome aguarda a mesma confirmação para concluir", async () => {
    const confirmar = gravacaoPendente();
    await abrirEdicao();
    const nome = await renomear("Presentes");
    await act(async () => {
      nome.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await clicar(botaoComTexto("Concluir", painel() as HTMLElement));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(painel()).not.toBeNull();
    await confirmar(true);
    expect(painel()).toBeNull();
    expect(cartaoDe("Presentes")).toBeTruthy();
  });

  it("gravação iniciada durante o arrasto descarta o preview anterior", async () => {
    const confirmar = gravacaoPendente();
    await montar();
    await act(async () => {
      arrastar.onReorder?.([secaoKits, secaoLancamentos, secaoDestaques]);
    });
    await clicar(porRotulo("Editar vitrine Kits de presente"));
    await renomear("Presentes");
    await act(async () => arrastar.aoSoltar.get("custom_1")?.());
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartoes().map((c) => c.dataset.vitrineId)).toEqual([
      "new_arrivals",
      "custom_1",
      "bestsellers",
    ]);
    await confirmar(true);
    await act(async () => arrastar.aoSoltar.get("custom_1")?.());
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it("restauração pendente bloqueia gravações sobre as vitrines anteriores", async () => {
    const confirmar = gravacaoPendente();
    await montar();
    await abrirMenuMaisAcoes();
    const restaurar = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((el) => el.textContent?.includes("Restaurar padrão")) as HTMLElement;
    await clicar(restaurar);
    await clicar(botaoComTexto("Restaurar", confirmacao() as HTMLElement));
    await clicar(porRotulo("Exibir na loja: Kits de presente"));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(cartoes()).toHaveLength(3);
    await confirmar(true);
    expect(cartoes().map((c) => c.dataset.vitrineId)).toEqual([
      "new_arrivals",
      "offers",
      "bestsellers",
    ]);
  });
});
