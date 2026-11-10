// @vitest-environment jsdom
// O modal e o gerador são reais: digitar "34/36" não é digitar o separador
// " / ". A linha entregue precisa reabrir nos mesmos pares e não renascer.
import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";
import type { ProductVariant } from "@/types";
import { dividirEmAtributos } from "@/utils/variante-composta";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botaoDoAtributo } from "./helpers/atributo-da-variacao";

const h = vi.hoisted(() => ({
  erro: vi.fn(),
  info: vi.fn(),
  efetivar: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: h.erro, info: h.info } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ModalVarianteGrade — barra dentro do valor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.efetivar.mockReturnValue(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function abrir(existentes: ProductVariant[] = [], aberto = true) {
    await act(async () => {
      raiz.render(
        <ModalVarianteGrade
          aberto={aberto}
          onFechar={vi.fn()}
          variantesExistentes={existentes}
          sugestoesDeAtributo={["Cor", "Tamanho", "Voltagem"]}
          grupoUnicoEmUso={existentes.at(0)?.name ?? null}
          skusDaLoja={[]}
          precoDoProduto="100"
          onEfetivar={h.efetivar}
        />,
      );
    });
  }

  function botao(texto: string) {
    const encontrado = [...document.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.trim() === texto ||
        b.getAttribute("aria-label") === texto,
    );
    if (!encontrado) throw new Error(`Botão ausente: ${texto}`);
    return encontrado;
  }
  async function tocar(elemento: HTMLElement) {
    await act(async () => {
      elemento.click();
    });
  }
  async function digitar(id: string, valor: string) {
    const campo = document.getElementById(id) as HTMLInputElement | null;
    if (!campo) throw new Error(`Campo ausente: ${id}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
    });
  }
  async function adicionarValor(posicao: number, valor: string) {
    await digitar(`grade-valor-${posicao}`, valor);
    await tocar(botao(`Adicionar valor do atributo ${posicao + 1}`));
  }
  async function combinarComCor() {
    await tocar(botao("+ Adicionar outro atributo"));
    await tocar(botaoDoAtributo(1, "Cor"));
    await tocar(botaoDoAtributo(1, "Preto"));
  }

  it.each([
    ["Tamanho", "34/36"],
    ["Tamanho", "P/M"],
    ["Voltagem", "110/220V"],
  ])(
    "digita %s %s, gera com Cor e reaproveita sem duplicar",
    async (nome, valor) => {
      await abrir();
      await tocar(botaoDoAtributo(0, nome));
      await adicionarValor(0, valor);
      expect(h.erro).not.toHaveBeenCalled();
      expect(botaoDoAtributo(0, valor).getAttribute("aria-pressed")).toBe(
        "true",
      );
      await combinarComCor();
      await tocar(botao("Gerar 1 combinação"));
      await tocar(botao("Salvar 1 variação"));
      expect(h.efetivar).toHaveBeenCalledTimes(1);

      const linhas = h.efetivar.mock.calls[0][0] as LinhaProntaDaGrade[];
      expect(linhas).toHaveLength(1);
      expect(dividirEmAtributos(linhas[0].name, linhas[0].value)).toEqual([
        { name: nome, value: valor },
        { name: "Cor", value: "Preto" },
      ]);
      const existentes = linhas.map((linha, i) => ({
        ...linha,
        id: `v${i}`,
        productId: "produto",
        createdAt: "2026-01-01",
      })) as ProductVariant[];
      await abrir(existentes, false);
      await abrir(existentes);
      expect(document.getElementById("grade-valor-0")).not.toBeNull();
      // Redigitar o valor usado seleciona o chip, sem criar outro.
      await adicionarValor(0, valor);
      await tocar(botaoDoAtributo(1, "Preto"));
      await tocar(botao("Gerar grade"));
      expect(h.info).toHaveBeenCalledWith(
        "Essas combinações já existem — nada a criar.",
      );
      expect(h.efetivar).toHaveBeenCalledTimes(1);
      expect(h.erro).not.toHaveBeenCalled();
    },
  );

  it("recusa o separador exato na digitação e conserva o texto para corrigir", async () => {
    await abrir();
    await tocar(botaoDoAtributo(0, "Tamanho"));
    await adicionarValor(0, "P / M");
    expect(h.erro).toHaveBeenCalledTimes(1);
    expect(String(h.erro.mock.calls[0][0])).toContain('" / "');
    expect(
      (document.getElementById("grade-valor-0") as HTMLInputElement).value,
    ).toBe("P / M");
    expect(h.efetivar).not.toHaveBeenCalled();
  });

  it("recusa nome com o separador exato ao gerar", async () => {
    await abrir();
    await tocar(botaoDoAtributo(0, "Outro"));
    await digitar("grade-nome-0", "Cor / Tamanho");
    await adicionarValor(0, "Preto");
    await tocar(botao("Gerar 1 opção"));
    expect(h.erro).toHaveBeenCalledTimes(1);
    expect(String(h.erro.mock.calls[0][0])).toContain('" / "');
    expect(h.efetivar).not.toHaveBeenCalled();
  });

  it("a junção recusa espaço antes da barra final de um valor anterior", async () => {
    await abrir();
    await tocar(botaoDoAtributo(0, "Tamanho"));
    await adicionarValor(0, "P /");
    await combinarComCor();
    h.erro.mockClear();
    await tocar(botao("Gerar 1 combinação"));
    expect(h.erro).toHaveBeenCalledTimes(1);
    expect(String(h.erro.mock.calls[0][0])).toContain('" / "');
    expect(h.efetivar).not.toHaveBeenCalled();
  });
});
