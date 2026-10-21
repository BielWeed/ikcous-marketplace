import { CriarBannerComIa } from "@/components/admin/banners/CriarBannerComIa";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag de testes do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("criar imagem do banner com IA", () => {
  let raiz: Root;
  let tela: HTMLDivElement;
  const aoVoltar = vi.fn();
  const aoEscolherImagem = vi.fn();
  const copiar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    copiar.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copiar },
    });
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
    act(() =>
      raiz.render(
        <CriarBannerComIa
          nomeDaLoja="Loja Exemplo"
          produtoInicial="Camiseta Azul"
          aoVoltar={aoVoltar}
          aoEscolherImagem={aoEscolherImagem}
        />,
      ),
    );
  });
  afterEach(() => {
    act(() => raiz.unmount());
    tela.remove();
    vi.restoreAllMocks();
  });

  function botao(nome: string) {
    const elemento = Array.from(tela.querySelectorAll("button")).find(
      (b) =>
        b.textContent?.trim() === nome || b.getAttribute("aria-label") === nome,
    );
    expect(elemento, nome).toBeTruthy();
    return elemento as HTMLButtonElement;
  }
  function texto() {
    const caixa = tela.querySelector("textarea");
    expect(caixa).not.toBeNull();
    return caixa as HTMLTextAreaElement;
  }
  async function clicar(nome: string) {
    await act(async () => botao(nome).click());
  }

  it("trocar objetivo e fundo atualiza o texto que será copiado", async () => {
    const inicial = texto().value;
    expect(inicial).toContain("Camiseta Azul");
    expect(inicial).toContain("Loja Exemplo");
    await clicar("Frete grátis");
    expect(texto().value).not.toBe(inicial);
    expect(texto().value).toContain("entrega rápida");
    expect(botao("Frete grátis").getAttribute("aria-pressed")).toBe("true");
    await clicar("Claro");
    expect(texto().value).toContain("fundo claro");
  });

  it("o campo de produto atualiza o texto e os campos têm rótulos", () => {
    const campo = tela.querySelector('input[type="text"]') as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.labels?.[0].textContent).toContain(
      "Nome do produto (opcional)",
    );
    expect(texto().labels?.[0].textContent).toContain("Copie este texto");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "Tênis Verde");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(texto().value).toContain("Tênis Verde");
    expect(texto().value).not.toContain("Camiseta Azul");
  });

  it("copia o texto exibido e confirma de forma acessível", async () => {
    const esperado = texto().value;
    await clicar("Copiar texto");
    expect(copiar).toHaveBeenCalledWith(esperado);
    expect(tela.querySelector('[role="status"]')?.textContent).toBe(
      "Texto copiado",
    );
  });

  it("seleciona o texto e usa a cópia antiga se o clipboard recusar", async () => {
    copiar.mockRejectedValue(new Error("indisponível"));
    let selecionado = "";
    const antigo = vi.fn(() => {
      selecionado = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: antigo,
    });
    await clicar("Copiar texto");
    expect(antigo).toHaveBeenCalledWith("copy");
    expect(selecionado).toBe(texto().value);
    expect(tela.querySelector('[role="status"]')?.textContent).toBe(
      "Texto copiado",
    );
  });

  it("usa o fallback também quando a API moderna não existe", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const antigo = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: antigo,
    });
    await clicar("Copiar texto");
    expect(antigo).toHaveBeenCalledWith("copy");
    expect(tela.querySelector('[role="status"]')?.textContent).toBe(
      "Texto copiado",
    );
  });

  it.each(["recusa", "exceção"])(
    "avisa sem quebrar quando ambos os meios falham (%s)",
    async (falha) => {
      copiar.mockRejectedValue(new Error("indisponível"));
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => {
          if (falha === "exceção") throw new Error("bloqueado");
          return false;
        },
      });
      await clicar("Copiar texto");
      expect(tela.querySelector('[role="status"]')?.textContent).toBe(
        "Não deu para copiar. Selecione o texto e copie.",
      );
      await clicar("Voltar");
      expect(aoVoltar).toHaveBeenCalledOnce();
    },
  );

  it("abre a escolha de imagem, entrega o arquivo e permite selecionar o mesmo novamente", async () => {
    const campo = tela.querySelector('input[type="file"]') as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.accept).toBe("image/*");
    expect(
      campo.labels?.length || campo.getAttribute("aria-label"),
    ).toBeTruthy();
    const abrir = vi.spyOn(campo, "click");
    await clicar("Enviar a imagem pronta");
    expect(abrir).toHaveBeenCalledOnce();
    const arquivo = new File(["imagem"], "banner.png", { type: "image/png" });
    Object.defineProperty(campo, "files", {
      configurable: true,
      value: [arquivo],
    });
    act(() => campo.dispatchEvent(new Event("change", { bubbles: true })));
    expect(aoEscolherImagem).toHaveBeenCalledWith(arquivo);
    expect(campo.value).toBe("");
    Object.defineProperty(campo, "files", { configurable: true, value: [] });
    act(() => campo.dispatchEvent(new Event("change", { bubbles: true })));
    expect(aoEscolherImagem).toHaveBeenCalledTimes(1);
  });

  it("voltar não envia imagem", async () => {
    await clicar("Voltar");
    expect(aoVoltar).toHaveBeenCalledOnce();
    expect(aoEscolherImagem).not.toHaveBeenCalled();
  });
});
