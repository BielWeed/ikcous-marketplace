// @vitest-environment jsdom
/* eslint-disable security/detect-non-literal-fs-filename -- Lê apenas caminhos fixos de fontes locais definidos neste teste, nunca entrada de usuário. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FolhaInferior } from "@/components/admin/vitrines/FolhaInferior";
import { GAVETA_NO_COMPUTADOR } from "@/components/desktop/medidas";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE =
  "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-[130] flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500";
const DE_BAIXO =
  "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t";

function fonte(caminho: string) {
  return readFileSync(resolve("src", caminho), "utf8");
}

describe("folha de baixo no computador — gaveta sem mudar o celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    // Um pai transformado não pode virar o bloco de referência do fixed.
    hospedeiro.style.transform = "translateX(0)";
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(
    props: Partial<React.ComponentProps<typeof SheetContent>> = {},
    aoMudar = vi.fn(),
  ) {
    await act(async () => {
      raiz.render(
        <Sheet open onOpenChange={aoMudar}>
          <SheetContent side="bottom" {...props}>
            <SheetHeader>
              <SheetTitle>Opções</SheetTitle>
              <SheetDescription>Escolha uma opção.</SheetDescription>
            </SheetHeader>
            <button type="button">Escolher</button>
            <SheetFooter>Aplicar</SheetFooter>
          </SheetContent>
        </Sheet>,
      );
    });
    return document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!;
  }

  it("preserva as classes do celular e acrescenta posição, largura e animação só em lg", async () => {
    const folha = await montar();
    expect(classesDoCelular(folha.className)).toBe(`${BASE} ${DE_BAIXO}`);
    for (const token of [
      ...GAVETA_NO_COMPUTADOR.split(" "),
      "lg:inset-y-0",
      "lg:right-0",
      "lg:left-auto",
      "lg:bottom-auto",
      "lg:h-full",
      "lg:max-h-none",
      "lg:rounded-tr-none",
      "lg:overflow-hidden",
      "lg:data-[state=open]:slide-in-from-right",
      "lg:data-[state=closed]:slide-out-to-right",
      "lg:data-[state=open]:slide-in-from-bottom-0",
      "lg:data-[state=closed]:slide-out-to-bottom-0",
    ]) {
      expect(folha.className.split(" "), token).toContain(token);
    }
    expect(
      document.querySelector('[data-slot="sheet-header"]')!.className,
    ).toContain("lg:shrink-0");
    expect(
      document.querySelector('[data-slot="sheet-footer"]')!.className,
    ).toContain("lg:shrink-0");
  });

  it("continua no portal do body, com véu escuro inteiro, foco dentro e Esc delegado ao Radix", async () => {
    const aoMudar = vi.fn();
    const folha = await montar(
      { overlayClassName: "bottom-[var(--folha-acima-da-barra)]" },
      aoMudar,
    );
    expect(folha.parentElement).toBe(document.body);
    expect(hospedeiro.contains(folha)).toBe(false);
    const veu = document.querySelector('[data-slot="sheet-overlay"]')!;
    expect(veu.className).toContain("bg-black/50");
    expect(veu.className).toContain("lg:bottom-0");
    expect(folha.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(aoMudar).toHaveBeenCalledWith(false);
  });

  it("não acrescenta gaveta às janelas centralizadas nem às folhas já laterais", async () => {
    const central = await montar({ gavetaNoComputador: false });
    expect(central.className).toBe(`${BASE} ${DE_BAIXO}`);
    const direita = await montar({ side: "right" });
    expect(direita.className).not.toContain("lg:max-w-[440px]");
    expect(direita.className).toContain("sm:max-w-sm");
    for (const caminho of [
      "components/devolucao/SolicitarDevolucaoSheet.tsx",
      "components/politicas/PoliticaEmFolha.tsx",
    ]) {
      expect(
        fonte(caminho).includes("gavetaNoComputador={false}"),
        caminho,
      ).toBe(true);
      expect(fonte(caminho)).toContain("sm:top-1/2");
    }
  });

  it("acomoda a FolhaInferior sem perder o corpo rolável e as classes de celular", async () => {
    await act(async () => {
      raiz.render(
        <FolhaInferior
          titulo="Vitrine"
          descricao="Editar"
          aoFechar={() => {}}
          rodape={<button type="button">Salvar</button>}
        >
          Conteúdo
        </FolhaInferior>,
      );
    });
    const folha = document.querySelector<HTMLElement>(
      '[data-slot="sheet-content"]',
    )!;
    expect(classesDoCelular(folha.className)).toBe(
      `${BASE.replace("gap-4 ", "")} ${DE_BAIXO} mx-auto max-h-[92dvh] w-full gap-0 rounded-t-[28px] border-admin-border bg-zinc-950 p-0 text-white sm:max-w-xl`.replace(
        "bg-background ",
        "",
      ),
    );
    expect(folha.className).toContain("lg:max-w-[440px]");
    expect(folha.querySelector(".overflow-y-auto")!.className).toContain(
      "min-h-0 flex-1",
    );
  });

  it("reserva espaço para o X sem cobrir Limpar Tudo, somente no computador", () => {
    const busca = fonte("views/customer/SearchView.tsx");
    const cabecalho =
      busca.match(
        /<SheetHeader\s+className=\{cn\("mb-8",\s*"([^"]+)"\)\}/,
      )?.[1] ?? "";
    expect(cabecalho.split(" ")).toContain("lg:pr-14");
    expect(classesDoCelular(`mb-8 ${cabecalho}`)).toBe("mb-8");
  });

  it("mantém os literais do celular nos corpos e torna as ações persistentes no PC", () => {
    const busca = fonte("views/customer/SearchView.tsx");
    expect(busca).toContain(
      '"max-h-[90vh] overflow-y-auto rounded-t-[3rem] p-8"',
    );
    expect(busca).toContain('"space-y-8 pb-10"');
    expect(busca.includes("lg:min-h-0 lg:flex-1")).toBe(true);
    expect(busca.includes("lg:sticky lg:bottom-0")).toBe(true);
    const produto = fonte("views/customer/ProductView.tsx");
    expect(produto).toContain(
      '"min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 pb-[calc(20px+var(--safe-area-bottom,0px))]"',
    );
    expect(produto.includes("lg:sticky lg:bottom-0")).toBe(true);
    const opcoes = fonte("components/ui/custom/FolhaDeOpcoes.tsx");
    expect(opcoes).toContain(
      '"flex min-h-0 flex-col gap-3 px-4 pb-[calc(12px+var(--folha-folga-segura))] pt-3 text-zinc-900"',
    );
    expect(opcoes.includes("lg:flex-1 lg:w-full lg:overflow-hidden")).toBe(
      true,
    );
    expect(opcoes).toContain(
      '"min-h-0 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200"',
    );
  });
});
