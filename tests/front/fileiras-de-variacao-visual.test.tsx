// @vitest-environment jsdom
import { FileirasDeVariacao } from "@/components/ui/custom/FileirasDeVariacao";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

function montar(valores: string[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <FileirasDeVariacao
      fileiras={[
        {
          nome: "Cor",
          valores: valores.map((valor) => ({
            valor,
            disponivel: valor !== "Branco",
            estoque: valor === "Branco" ? 0 : 2,
          })),
        },
      ]}
      escolha={{ Cor: "Azul" }}
      onEscolher={() => {}}
    />,
  );
  return host;
}

describe("apresentação acessível das fileiras", () => {
  it("cores conhecidas usam bolinhas de 36px dentro de alvos de 44px com nome e seleção", () => {
    const host = montar(["Azul", "Branco"]);
    const azul = host.querySelector('button[aria-label="Azul"]')!;
    const branco = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Branco"]',
    )!;
    expect(azul.getAttribute("aria-pressed")).toBe("true");
    expect(azul.classList.contains("min-h-11")).toBe(true);
    expect(azul.querySelector(".size-9")?.getAttribute("style")).toContain(
      "background-color",
    );
    expect(branco.disabled).toBe(true);
    expect(branco.querySelector(".size-9")?.classList.contains("border")).toBe(
      true,
    );
  });
  it("uma cor desconhecida faz a fileira inteira usar texto, sem misturar bolinhas", () => {
    const host = montar(["Azul", "Estampado"]);
    expect(host.querySelector("[style]")).toBeNull();
    expect(host.textContent).toContain("Azul");
    expect(host.textContent).toContain("Estampado");
    expect(
      host
        .querySelector('button[aria-label="Azul"]')
        ?.classList.contains("min-w-[72px]"),
    ).toBe(true);
  });
});
