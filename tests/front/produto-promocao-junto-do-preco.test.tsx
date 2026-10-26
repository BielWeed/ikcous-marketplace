// @vitest-environment jsdom
//
// Formulário de produto: a PROMOÇÃO (De/Por) mora junto do Preço de Venda, e
// não mais dentro de "Custo e lucro · só você vê". Motivo: a promoção é a
// única parte que o CLIENTE enxerga, e estava escondida numa área privada,
// longe do preço (frente "u180-promo").
//
//   1. o interruptor fica FORA de "Custo e lucro" e DEPOIS do Preço de Venda
//   2. ligar mostra o campo "De"; desligar apaga o "De"
//   3. a prévia "Na loja o cliente vai ver" só aparece com "De" > preço
//   4. "Custo e lucro" volta a falar só de custo e lucro
//   5. promoção ligada com o "De" vazio segue bloqueando, e a frase leva ao
//      campo "De" (agora no básico) sem abrir seção nenhuma à toa
//
// Montagem real (react-dom/client + jsdom), molde de
// produto-textos-avisos-e-botoes.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
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

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      id="product-category"
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  if (!el) throw new Error(`campo #${id} ausente`);
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await esperar(300);
  });
}

async function escolherCategoria(nome: string) {
  await act(async () => {
    escolherCategoriaDoProduto(nome);
    await esperar(50);
  });
}

const secao = (titulo: string) =>
  document.querySelector(`section[aria-label="${titulo}"]`) as HTMLElement;

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;

const previa = () =>
  document.querySelector(
    '[data-testid="previa-promocao"]',
  ) as HTMLElement | null;

const semEspacosEspeciais = (texto: string | null | undefined) =>
  (texto ?? "").replace(/\s+/g, " ").trim();

async function alternarPromocao() {
  await act(async () => {
    campo("product-promo-active").click();
  });
}

function barraDeAcoes(): HTMLElement {
  return document.querySelector(
    '[aria-label="Ações do produto"]',
  ) as HTMLElement;
}

describe("AdminProductFormView — promoção junto do preço (u180)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-1" });
    updateProduct.mockResolvedValue({ id: "prod-1" });
    rpcDoSupabase.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
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

  describe("1. onde o interruptor mora", () => {
    it("fica FORA de 'Custo e lucro' e DEPOIS do Preço de Venda no mesmo formulário", async () => {
      await montar();
      const interruptor = campo("product-promo-active");
      const preco = campo("product-sale-price");
      expect(interruptor).not.toBeNull();
      expect(preco).not.toBeNull();
      expect(secao("Custo e lucro").contains(interruptor)).toBe(false);
      // Nem dentro de qualquer seção recolhível: é do básico, sempre à vista.
      expect(interruptor.closest("section[aria-label]")).toBeNull();
      expect(
        preco.compareDocumentPosition(interruptor) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // A linha inteira é o rótulo (alvo de toque), com o nome e a explicação.
      const linha = interruptor.closest("label") as HTMLLabelElement;
      expect(linha.textContent).toContain("Em promoção");
      expect(linha.textContent).toContain(
        "Mostra na loja o preço de antes, riscado",
      );
      expect(interruptor.getAttribute("aria-label")).toBe(
        "Produto em Promoção",
      );
      expect(interruptor.name).toBe("isPromoActive");
    });

    it("o campo 'De' também nasce fora de 'Custo e lucro'", async () => {
      await montar();
      await alternarPromocao();
      const de = campo("product-original-price");
      expect(de).not.toBeNull();
      expect(secao("Custo e lucro").contains(de)).toBe(false);
      expect(de.closest("section[aria-label]")).toBeNull();
      expect(de.name).toBe("originalPrice");
      expect(
        campo("product-sale-price").compareDocumentPosition(de) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe("2. ligar e desligar", () => {
    it("ligar mostra o campo 'De'; desligar o tira da tela", async () => {
      await montar();
      expect(campo("product-original-price")).toBeNull();
      await alternarPromocao();
      expect(campo("product-original-price")).not.toBeNull();
      expect(
        document
          .querySelector('label[for="product-original-price"]')
          ?.textContent?.trim(),
      ).toBe('Preço de antes ("De")');
      await alternarPromocao();
      expect(campo("product-original-price")).toBeNull();
    });

    it("desligar APAGA o 'De': ligar de novo volta vazio", async () => {
      await montar();
      await alternarPromocao();
      await digitarCampo("product-original-price", "9990");
      expect(campo("product-original-price").value).not.toBe("");
      await alternarPromocao();
      await alternarPromocao();
      expect(campo("product-original-price").value).toBe("");
    });
  });

  describe("3. a prévia 'Na loja o cliente vai ver'", () => {
    it("com 'De' maior que o preço: mostra o preço, o 'De' riscado e -20%", async () => {
      await montar();
      await digitarCampo("product-sale-price", "7990");
      await alternarPromocao();
      expect(previa()).toBeNull();
      await digitarCampo("product-original-price", "9990");
      const caixa = previa();
      expect(caixa).not.toBeNull();
      const texto = semEspacosEspeciais(caixa?.textContent);
      expect(texto).toContain("Na loja o cliente vai ver");
      expect(texto).toContain("79,90");
      expect(texto).toContain("99,90");
      expect(texto).toContain("-20%");
      const riscado = caixa?.querySelector(".line-through");
      expect(semEspacosEspeciais(riscado?.textContent)).toContain("99,90");
      expect(semEspacosEspeciais(riscado?.textContent)).not.toContain("79,90");
    });

    it("acompanha o preço de venda: mudar o preço refaz a conta do selo", async () => {
      await montar();
      await digitarCampo("product-sale-price", "7990");
      await alternarPromocao();
      await digitarCampo("product-original-price", "9990");
      await digitarCampo("product-sale-price", "4995");
      const texto = semEspacosEspeciais(previa()?.textContent);
      expect(texto).toContain("49,95");
      expect(texto).toContain("-50%");
    });

    it("some com 'De' igual ao preço, menor que ele ou vazio (e o erro de hoje continua)", async () => {
      await montar();
      await digitarCampo("product-sale-price", "7990");
      await alternarPromocao();
      expect(previa()).toBeNull();

      await digitarCampo("product-original-price", "7990");
      expect(previa()).toBeNull();
      expect(
        document.getElementById("product-original-error")?.textContent,
      ).toBe('Preço original ("De:") deve ser maior que o preço promocional.');
      expect(campo("product-original-price").getAttribute("aria-invalid")).toBe(
        "true",
      );
      expect(
        campo("product-original-price").getAttribute("aria-describedby"),
      ).toBe("product-original-error");

      await digitarCampo("product-original-price", "5000");
      expect(previa()).toBeNull();

      await digitarCampo("product-original-price", "9990");
      expect(previa()).not.toBeNull();
      expect(document.getElementById("product-original-error")).toBeNull();
    });

    it("sem preço de venda não há prévia nem selo, mesmo com 'De' preenchido", async () => {
      await montar();
      await alternarPromocao();
      await digitarCampo("product-original-price", "9990");
      expect(previa()).toBeNull();
      expect(document.body.textContent).not.toContain("-100%");
    });

    it("promoção desligada não tem prévia", async () => {
      await montar();
      await digitarCampo("product-sale-price", "7990");
      expect(previa()).toBeNull();
    });
  });

  describe("4. 'Custo e lucro' volta a falar só de custo e lucro", () => {
    it("o resumo não cita promoção, antes nem depois de ligá-la", async () => {
      await montar();
      const antes = secao("Custo e lucro").textContent ?? "";
      expect(antes).toContain("Custo · opcional");
      expect(antes).not.toMatch(/romo/);
      await alternarPromocao();
      await digitarCampo("product-original-price", "9990");
      const depois = secao("Custo e lucro").textContent ?? "";
      expect(depois).toContain("Custo · opcional");
      expect(depois).not.toMatch(/romo/);
      expect(depois).not.toContain("De/Por");
    });

    it("com custo e preço o resumo é o de lucro de sempre", async () => {
      await montar();
      await digitarCampo("product-sale-price", "10000");
      await digitarCampo("product-cost-price", "6000");
      const resumo = secao("Custo e lucro").textContent ?? "";
      expect(resumo).toContain("Lucro");
      expect(resumo).toContain("margem");
      expect(resumo).not.toMatch(/romo/);
    });

    it("o painel de 'Custo e lucro' não tem mais o interruptor nem o campo 'De'", async () => {
      await montar();
      await alternarPromocao();
      const painel = secao("Custo e lucro");
      expect(painel.querySelector("#product-promo-active")).toBeNull();
      expect(painel.querySelector("#product-original-price")).toBeNull();
      expect(painel.textContent).not.toContain("Produto em Promoção");
      expect(painel.textContent).not.toContain("Preço Original");
      // O que é de custo segue lá.
      expect(painel.querySelector("#product-cost-price")).not.toBeNull();
    });

    it("erro no 'De' não pinta o aviso da seção de custo: ele está à vista no básico", async () => {
      await montar();
      await digitarCampo("product-sale-price", "7990");
      await alternarPromocao();
      await digitarCampo("product-original-price", "5000");
      expect(secao("Custo e lucro").textContent).not.toContain(
        "Preço original",
      );
      expect(document.getElementById("product-original-error")).not.toBeNull();
      // O contador de progresso continua dizendo que há aviso.
      expect(
        document.querySelector('[data-testid="progresso-do-produto"]')
          ?.textContent,
      ).toContain("há avisos");
    });
  });

  describe("5. promoção ligada com o 'De' vazio", () => {
    const frase = () =>
      barraDeAcoes().querySelector(
        '[data-testid="motivo-do-bloqueio"] button',
      ) as HTMLButtonElement | null;

    async function preencherOBasico() {
      await digitarCampo("product-name", "Produto Teste");
      await digitarCampo("product-description", "Descrição de teste");
      await digitarCampo("product-sale-price", "7990");
      await digitarCampo("product-stock", "5");
      await escolherCategoria("Geral");
    }

    it("bloqueia o Publicar, diz o que fazer e a frase leva ao 'De' sem abrir seção", async () => {
      await montar();
      await preencherOBasico();
      const publicar = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Publicar"),
      ) as HTMLButtonElement;
      expect(publicar.disabled).toBe(false);

      await alternarPromocao();
      expect(publicar.disabled).toBe(true);
      expect(frase()?.textContent).toContain(
        "Escreva o preço original (De:) ou desligue a promoção",
      );

      const abertasAntes = [
        ...document.querySelectorAll("button[aria-expanded]"),
      ].map((b) => b.getAttribute("aria-expanded"));
      await act(async () => {
        frase()?.click();
        await esperar(50);
      });
      expect(document.activeElement?.id).toBe("product-original-price");
      const abertasDepois = [
        ...document.querySelectorAll("button[aria-expanded]"),
      ].map((b) => b.getAttribute("aria-expanded"));
      expect(abertasDepois).toEqual(abertasAntes);
      expect(addProduct).not.toHaveBeenCalled();

      await digitarCampo("product-original-price", "9990");
      expect(publicar.disabled).toBe(false);
    });

    it("com preço de venda E promoção sem 'De' vazios, a frase manda preencher o preço primeiro", async () => {
      await montar();
      await digitarCampo("product-name", "Produto Teste");
      await digitarCampo("product-description", "Descrição de teste");
      await digitarCampo("product-stock", "5");
      await escolherCategoria("Geral");
      await alternarPromocao();
      expect(frase()?.textContent).toContain("falta preencher: preço de venda");
      await act(async () => {
        frase()?.click();
        await esperar(50);
      });
      expect(document.activeElement?.id).toBe("product-sale-price");
    });

    it("o salvar manda o 'De' e o preço como números (nada mudou no que é gravado)", async () => {
      await montar();
      await preencherOBasico();
      await alternarPromocao();
      await digitarCampo("product-original-price", "9990");
      const publicar = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Publicar"),
      ) as HTMLButtonElement;
      await act(async () => {
        publicar.click();
        await esperar(100);
      });
      expect(addProduct).toHaveBeenCalledTimes(1);
      const enviado = addProduct.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(enviado).toMatchObject({ price: 79.9, originalPrice: 99.9 });
    });
  });
});
