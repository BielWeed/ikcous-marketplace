// @vitest-environment jsdom
//
// Quatro defeitos da lista de fotos do produto (painel):
//  1. Tocar duas vezes rápido em "Excluir" apagava DUAS fotos: o cartão que
//     está saindo (animação) ainda aceitava o 2º toque e apagava a foto que
//     tinha ocupado a posição. Agora a exclusão é pela FOTO, não pela posição.
//  2. Foto HEIC/HEIF (iPhone/Samsung) subia sem conversão e aparecia quebrada.
//     Agora é recusada com uma frase clara, nomeando o arquivo.
//  3. O limite de 30 MB era medido nos arquivos ORIGINAIS (antes de reduzir
//     cada foto) e o de 10 fotos recusava tudo. Agora entram as que cabem e o
//     aviso diz quantas ficaram de fora.
//  4. "Deslize para o lado" aparecia com 2 fotos (que já cabem) e piscava
//     para sempre. Hoje só aparece quando a faixa de miniaturas REALMENTE
//     rola de lado (não cabe), e não pisca.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(true),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: mocks.uploadProductImages,
    fetchProduct: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: mocks.toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function escolherFotos(arquivos: File[]) {
  const input = document.getElementById(
    "product-image-upload",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: arquivos,
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const foto = (nome: string, tipo = "image/jpeg", tamanho?: number) => {
  const f = new File(["x"], nome, { type: tipo, lastModified: 1 });
  if (tamanho !== undefined)
    Object.defineProperty(f, "size", { value: tamanho });
  return f;
};

const url = (n: number) => `https://cdn/${n}.jpg`;

const fotosNaTela = () =>
  [
    ...document.body.querySelectorAll(
      '[aria-label="Galeria de fotos do produto"] img',
    ),
  ]
    .map((i) => i.getAttribute("src"))
    .filter((src): src is string => !!src && src.startsWith("https://cdn/"));

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("AdminProductFormView — lista de fotos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let contador: number;
  let decodeFalha: boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    contador = 0;
    decodeFalha = false;
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    mocks.uploadProductImages.mockImplementation(async () => {
      contador += 1;
      return [url(contador)];
    });
    // Dublê de leitura de imagem: o jsdom não decodifica foto de verdade.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        width = 800;
        height = 800;
        naturalWidth = 800;
        naturalHeight = 800;
        crossOrigin = "";
        set src(_v: string) {
          queueMicrotask(() => (decodeFalha ? this.onerror : this.onload)?.());
        }
      },
    );
    URL.createObjectURL = () => "blob:teste";
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const armazem = new Map<string, string>();
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
  }

  async function enviar(arquivos: File[]) {
    await act(async () => {
      escolherFotos(arquivos);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const textoDosAvisos = () =>
    mocks.toastError.mock.calls.map((c) => String(c[0])).join(" | ");

  const miniaturas = () =>
    document.body.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Galeria de fotos do produto"] button[aria-pressed]',
    );
  // Os botões de ação da foto em foco, na ordem em que aparecem na tela.
  const acoes = () => [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[data-testid="foto-em-foco"] button',
    ),
  ];
  const botaoExcluir = () =>
    document.body.querySelector<HTMLButtonElement>('button[title="Excluir"]');
  const tocar = (el: HTMLElement | null | undefined) =>
    act(async () => {
      el?.click();
    });

  // O defeito de verdade acontece no celular: o 1º toque termina (a tela é
  // redesenhada) e SÓ ENTÃO chega o 2º. Dois `click()` dentro de um mesmo
  // `act` não reproduzem isso: o React ainda não redesenhou entre eles.
  it("duplo toque em Excluir com a foto do meio em foco apaga só ela (cada toque no seu act)", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5].map((n) => foto(`f${n}.jpg`)));
    expect(fotosNaTela()).toEqual([1, 2, 3, 4, 5].map(url));

    await tocar(miniaturas()[1]);
    expect(
      document.body.querySelectorAll('button[title="Excluir"]'),
    ).toHaveLength(1);
    // Os dois toques usam o botão que está na tela NO MOMENTO de cada toque,
    // como o dedo faz: o 2º cai no mesmo lugar, onde agora está a foto 3.
    await tocar(botaoExcluir());
    await tocar(botaoExcluir());
    await esperar(800);

    expect(fotosNaTela()).toEqual([url(1), url(3), url(4), url(5)]);
  });

  it("duplo toque em Excluir com a capa em foco (o estado de entrada) apaga só ela", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5].map((n) => foto(`f${n}.jpg`)));

    await tocar(botaoExcluir());
    await tocar(botaoExcluir());
    await esperar(800);

    expect(fotosNaTela()).toEqual([2, 3, 4, 5].map(url));
  });

  it("depois do toque o Excluir é um botão NOVO, ligado à foto que sobrou (não reaproveitado)", async () => {
    await montar();
    await enviar([1, 2, 3].map((n) => foto(`f${n}.jpg`)));

    const antes = botaoExcluir();
    await tocar(antes);

    expect(fotosNaTela()).toEqual([url(2), url(3)]);
    expect(antes?.isConnected).toBe(false);
    expect(botaoExcluir()).not.toBe(antes);
  });

  it("depois de excluir, uma segunda exclusão feita com calma (1 toque) apaga a próxima", async () => {
    await montar();
    await enviar([1, 2, 3].map((n) => foto(`f${n}.jpg`)));

    await tocar(botaoExcluir());
    await esperar(800);
    await tocar(botaoExcluir());
    await esperar(800);

    expect(fotosNaTela()).toEqual([url(3)]);
  });

  it("'Tornar principal' + toque no mesmo lugar não apaga a foto que acabou de virar capa", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5].map((n) => foto(`f${n}.jpg`)));

    await tocar(miniaturas()[2]);
    const lugar = acoes().findIndex((b) =>
      /Tornar principal/.test(b.getAttribute("aria-label") ?? ""),
    );
    expect(lugar).toBeGreaterThanOrEqual(0);
    await tocar(acoes().at(lugar));
    expect(fotosNaTela()).toEqual([3, 1, 2, 4, 5].map(url));

    // O 2º toque cai no MESMO lugar da tela, seja o que houver ali agora.
    await tocar(acoes().at(lugar));
    expect(fotosNaTela()).toEqual([3, 1, 2, 4, 5].map(url));
  });

  it("depois de 'Tornar principal' o Excluir não muda de lugar (não sobe para baixo do dedo)", async () => {
    await montar();
    await enviar([1, 2, 3].map((n) => foto(`f${n}.jpg`)));

    await tocar(miniaturas()[1]);
    const lugarDoExcluir = acoes().indexOf(botaoExcluir() as HTMLButtonElement);
    await tocar(
      acoes().find((b) =>
        /Tornar principal/.test(b.getAttribute("aria-label") ?? ""),
      ),
    );
    await esperar(800);

    expect(acoes().indexOf(botaoExcluir() as HTMLButtonElement)).toBe(
      lugarDoExcluir,
    );
  });

  it("depois de excluir, o foco do teclado fica nas ações da foto que sobrou (não cai no <body>)", async () => {
    await montar();
    await enviar([1, 2, 3].map((n) => foto(`f${n}.jpg`)));
    const excluir = botaoExcluir();
    await act(async () => {
      excluir?.focus();
    });
    expect(document.activeElement).toBe(excluir);

    await tocar(excluir);

    const grupo = document.body.querySelector('[data-testid="foto-em-foco"]');
    expect(grupo?.contains(document.activeElement)).toBe(true);
  });

  it("as ações travam por instantes depois de Excluir e 'Tornar principal' (2º toque é ignorado), e voltam depois", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5].map((n) => foto(`f${n}.jpg`)));

    await tocar(miniaturas()[3]);
    await tocar(
      acoes().find((b) =>
        /Tornar principal/.test(b.getAttribute("aria-label") ?? ""),
      ),
    );
    // Logo depois, qualquer ação da foto é ignorada.
    await tocar(botaoExcluir());
    expect(fotosNaTela()).toEqual([4, 1, 2, 3, 5].map(url));

    // Passado o instante, 1 toque é 1 toque.
    await esperar(800);
    await tocar(botaoExcluir());
    expect(fotosNaTela()).toEqual([1, 2, 3, 5].map(url));
  });

  it("enquanto a foto sobe, a faixa diz em palavras (visíveis) o que está acontecendo", async () => {
    await montar();
    await enviar([foto("a.jpg")]);
    let terminar: (urls: string[]) => void = () => {};
    mocks.uploadProductImages.mockImplementation(
      () => new Promise<string[]>((r) => (terminar = r)),
    );
    await act(async () => {
      escolherFotos([foto("b.jpg")]);
      await new Promise((r) => setTimeout(r, 0));
    });

    const estado = document.body.querySelector(
      '[role="status"].produto-fotos-enviando',
    );
    expect(estado).not.toBeNull();
    const legenda = estado?.querySelector("span");
    expect(legenda?.textContent).toMatch(/Enviando|Comprimindo/);
    expect(legenda?.className ?? "").not.toContain("sr-only");

    await act(async () => {
      terminar([url(2)]);
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("foto HEIC é recusada, nomeada, e não entra na lista", async () => {
    await montar();
    await enviar([foto("IMG_0001.HEIC", "image/heic")]);

    expect(fotosNaTela()).toEqual([]);
    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosAvisos()).toMatch(/IMG_0001\.HEIC/);
    expect(textoDosAvisos()).toMatch(/JPG ou PNG/);
  });

  it("foto que não abre (leitura falha) não é enviada nem vira 'Boa qualidade'", async () => {
    await montar();
    decodeFalha = true;
    await enviar([foto("quebrada.jpg", "image/jpeg", 500 * 1024)]);

    expect(fotosNaTela()).toEqual([]);
    expect(mocks.uploadProductImages).not.toHaveBeenCalled();
    expect(textoDosAvisos()).toMatch(/quebrada\.jpg/);
    expect(document.body.textContent).not.toContain("Boa qualidade");
  });

  it("8 fotos de 4,5 MB (36 MB) entram todas: o total original não conta", async () => {
    await montar();
    const mb = 1024 * 1024;
    await enviar(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
        foto(`g${n}.jpg`, "image/jpeg", 4.5 * mb),
      ),
    );

    expect(fotosNaTela()).toHaveLength(8);
    expect(textoDosAvisos()).not.toMatch(/30 MB/);
  });

  it("com 8 já no produto e 3 escolhidas, entram 2 e o aviso diz que 1 ficou de fora", async () => {
    await montar();
    await enviar([1, 2, 3, 4, 5, 6, 7, 8].map((n) => foto(`h${n}.jpg`)));
    expect(fotosNaTela()).toHaveLength(8);

    await enviar([foto("i1.jpg"), foto("i2.jpg"), foto("i3.jpg")]);

    expect(fotosNaTela()).toHaveLength(10);
    expect(textoDosAvisos()).toMatch(/1 foto ficou de fora/);
  });

  it("o aviso 'Deslize' só aparece quando a faixa de miniaturas realmente rola de lado, e não pisca", async () => {
    // O jsdom não mede largura: a faixa "não cabe" quando o dublê diz que
    // o conteúdo (900) é maior que a caixa (262).
    let faixaNaoCabe = false;
    const ehFaixa = (el: Element) =>
      el.getAttribute("aria-label") === "Galeria de fotos do produto";
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return ehFaixa(this) && faixaNaoCabe ? 900 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return ehFaixa(this) && faixaNaoCabe ? 262 : 0;
      },
    });
    try {
      await montar();
      await enviar([foto("a.jpg"), foto("b.jpg"), foto("c.jpg")]);
      // Cabem todas: nada para deslizar, nada de aviso (antes saía com 3).
      expect(document.body.textContent).not.toContain("Deslize para o lado");

      faixaNaoCabe = true;
      await enviar([foto("d.jpg")]);
      const aviso = [...document.body.querySelectorAll("span")].find((s) =>
        s.textContent?.includes("Deslize para o lado"),
      );
      expect(aviso).toBeDefined();
      expect(aviso?.className).not.toContain("animate-pulse");
    } finally {
      // Remove o dublê e volta ao getter do próprio jsdom.
      Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    }
  });
});
