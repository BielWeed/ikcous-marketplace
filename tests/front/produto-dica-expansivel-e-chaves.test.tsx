import { readFileSync } from "node:fs";
// @vitest-environment jsdom
//
// Formulário de produto (23/10/2026): (1) a seção "Na loja" aparecia com as três
// chaves lado a lado, espremidas — o envoltório da chave tinha o MESMO nome de
// classe da chave miniatura da lista de produtos (`.produto-interruptor`,
// `display:inline-flex; width:32px`) e herdava esse CSS. (2) As notas
// informativas viraram uma linha compacta que abre (DicaExpansivel).
//
// O jsdom não calcula CSS: a causa raiz é provada LENDO as regras dos dois
// arquivos .css; o comportamento é provado montando os componentes de verdade.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { DicaExpansivel } from "@/components/admin/products/DicaExpansivel";
import { InterruptorDoProduto } from "@/components/admin/products/InterruptorDoProduto";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let alvo: HTMLDivElement;
beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
});

const css = (arquivo: string) =>
  readFileSync(`src/components/admin/products/${arquivo}`, "utf8");

function declaracoesDe(fonte: string, seletor: string): Record<string, string> {
  const achadas: Record<string, string> = {};
  postcss.parse(fonte).walkRules((regra) => {
    if (regra.selectors.includes(seletor))
      regra.walkDecls((d) => {
        achadas[d.prop] = d.value;
      });
  });
  return achadas;
}

describe("seção Na loja — as chaves empilham em linha inteira", () => {
  it("o envoltório da chave não usa o nome da chave miniatura da lista", () => {
    const formulario = css("formulario-produto.css");
    const lista = css("catalogo-produtos.css");
    // A lista segue com a chave miniatura (inline-flex, 32px): não é defeito dela.
    expect(declaracoesDe(lista, ".produto-interruptor").display).toBe(
      "inline-flex",
    );
    // O componente do formulário NÃO usa essa classe...
    const componente = readFileSync(
      "src/components/admin/products/InterruptorDoProduto.tsx",
      "utf8",
    );
    expect(componente).not.toMatch(/className="produto-interruptor"/);
    expect(componente).toContain('className="produto-chave"');
    // ...e o que o envoltório dele recebe é bloco de largura total.
    const chave = declaracoesDe(formulario, ".produto-chave");
    expect(chave.display).toBe("block");
    expect(chave.width).toBe("100%");
    expect(formulario).not.toMatch(/(^|[\s,}])\.produto-interruptor\s*[{+,]/m);
    // A linha inteira é o botão, de largura total e com alvo de toque >= 56px.
    const botao = declaracoesDe(formulario, ".produto-interruptor-botao");
    expect(botao.display).toBe("flex");
    expect(botao.width).toBe("100%");
    expect(botao["min-height"]).toBe("56px");
  });

  it("as três chaves saem uma abaixo da outra, cada uma com seu botão de switch", () => {
    act(() =>
      raiz.render(
        <div>
          {["Aparece na loja", "Em destaque", "Frete grátis neste produto"].map(
            (r) => (
              <InterruptorDoProduto
                key={r}
                rotulo={r}
                descricao={`descrição de ${r}`}
                ligado={r === "Em destaque"}
                onAlternar={() => {}}
              />
            ),
          )}
        </div>,
      ),
    );
    const envoltorios = alvo.querySelectorAll(".produto-chave");
    expect(envoltorios).toHaveLength(3);
    expect(alvo.querySelectorAll(".produto-interruptor")).toHaveLength(0);
    const botoes = [...alvo.querySelectorAll('[role="switch"]')];
    expect(botoes.map((b) => b.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    for (const b of botoes)
      expect(b.getAttribute("aria-describedby")).toBeTruthy();
  });
});

describe("DicaExpansivel", () => {
  const montar = () =>
    act(() =>
      raiz.render(
        <DicaExpansivel
          idDoTexto="texto-da-dica"
          rotulo="Estoque vem das variações · 8 un"
        >
          O estoque é a soma das variações.
        </DicaExpansivel>,
      ),
    );
  const botao = () => alvo.querySelector("button") as HTMLButtonElement;

  it("nasce recolhida: uma linha-botão com aria-expanded=false apontando o texto", () => {
    montar();
    expect(botao().getAttribute("aria-expanded")).toBe("false");
    expect(botao().getAttribute("aria-controls")).toBe("texto-da-dica");
    expect(botao().textContent).toContain("Estoque vem das variações · 8 un");
    // O texto completo continua no DOM (alvo de aria-describedby), só invisível.
    expect(document.getElementById("texto-da-dica")?.textContent).toContain(
      "soma das variações",
    );
    expect(alvo.querySelector(".invisible")).not.toBeNull();
  });

  it("abre e fecha por clique", () => {
    montar();
    act(() => botao().click());
    expect(botao().getAttribute("aria-expanded")).toBe("true");
    expect(alvo.querySelector(".invisible")).toBeNull();
    act(() => botao().click());
    expect(botao().getAttribute("aria-expanded")).toBe("false");
  });

  it("é um <button> de verdade: Enter/Espaço do teclado disparam o clique nativo", () => {
    montar();
    expect(botao().tagName).toBe("BUTTON");
    expect(botao().getAttribute("type")).toBe("button");
    expect(botao().tabIndex).toBe(0);
    expect(botao().className).toContain("min-h-11");
  });

  it("respeita prefers-reduced-motion e usa a cor de info (azul), nunca âmbar", () => {
    montar();
    expect(alvo.innerHTML).toContain("motion-reduce:transition-none");
    expect(alvo.innerHTML).toContain("text-sky-300");
    expect(alvo.innerHTML).not.toMatch(/amber|admin-gold/);
  });
});
