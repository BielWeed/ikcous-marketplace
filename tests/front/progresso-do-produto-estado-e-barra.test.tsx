// O anel "N/5" e a barra do cabeçalho do formulário de produto desenham a
// contagem dos cinco campos essenciais. O ESTADO (vazio, parcial, completo)
// escolhe a cor e se o arco aparece; a fronteira é "zero" e "todos". Sem teste
// próprio, trocar `<=`/`>=` deixava o anel verde com 4 de 5 (ou cinza com 1).
import {
  AnelDoProgresso,
  BarraDoProgresso,
  estadoDoProgresso,
} from "@/components/admin/products/ProgressoDoProduto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("estadoDoProgresso", () => {
  it("zero pronto é vazio; negativo também (lixo não vira 'parcial')", () => {
    expect(estadoDoProgresso(0, 5)).toBe("vazio");
    expect(estadoDoProgresso(-1, 5)).toBe("vazio");
  });

  it("de 1 a total-1 é parcial", () => {
    expect(estadoDoProgresso(1, 5)).toBe("parcial");
    expect(estadoDoProgresso(4, 5)).toBe("parcial");
  });

  it("todos prontos é completo; passar do total também (não volta a parcial)", () => {
    expect(estadoDoProgresso(5, 5)).toBe("completo");
    expect(estadoDoProgresso(6, 5)).toBe("completo");
  });

  it("total de 1: zero é vazio e um é completo", () => {
    expect(estadoDoProgresso(0, 1)).toBe("vazio");
    expect(estadoDoProgresso(1, 1)).toBe("completo");
  });
});

describe("AnelDoProgresso", () => {
  const anel = (preenchidos: number, total = 5) =>
    renderToStaticMarkup(
      <AnelDoProgresso preenchidos={preenchidos} total={total} />,
    );

  it("vazio: sem arco e sem a cor de progresso, escreve 0/5", () => {
    const html = anel(0);
    expect(html).toContain('data-estado="vazio"');
    expect(html).not.toContain("produto-anel-arco");
    expect(html).not.toContain("text-emerald-300");
    expect(html).toContain(">0/5<");
  });

  it("parcial: com arco, parte do círculo ainda por preencher", () => {
    const html = anel(2);
    expect(html).toContain('data-estado="parcial"');
    expect(html).toContain("produto-anel-arco");
    expect(html).toContain("text-emerald-300");
    const circ = 2 * Math.PI * 18;
    const desloc = Number(/stroke-dashoffset="([^"]+)"/.exec(html)?.[1]);
    expect(desloc).toBeCloseTo(circ * (1 - 2 / 5), 5);
  });

  it("completo: arco fechado (deslocamento zero)", () => {
    const html = anel(5);
    expect(html).toContain('data-estado="completo"');
    expect(Number(/stroke-dashoffset="([^"]+)"/.exec(html)?.[1])).toBeCloseTo(
      0,
      5,
    );
  });

  it("passou do total: o arco não passa de fechado (deslocamento nunca negativo)", () => {
    const html = anel(9);
    expect(Number(/stroke-dashoffset="([^"]+)"/.exec(html)?.[1])).toBeCloseTo(
      0,
      5,
    );
  });

  it("número negativo: o arco não aparece e o deslocamento não passa do círculo", () => {
    const html = anel(-3);
    expect(html).not.toContain("produto-anel-arco");
  });

  it("é decoração: escondido do leitor de tela", () => {
    expect(anel(3)).toContain('aria-hidden="true"');
  });
});

describe("BarraDoProgresso", () => {
  const barra = (preenchidos: number, total = 5) =>
    renderToStaticMarkup(
      <BarraDoProgresso preenchidos={preenchidos} total={total} />,
    );

  it("é um progressbar com os números e o texto para o leitor de tela", () => {
    const html = barra(3);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuetext="3 de 5 essenciais prontos"');
    expect(html).toContain('data-estado="parcial"');
  });

  it("o total vem da tela, não é fixo em 5", () => {
    const html = barra(2, 8);
    expect(html).toContain('aria-valuemax="8"');
    expect(html).toContain('aria-valuetext="2 de 8 essenciais prontos"');
    expect(html).toContain("width:25%");
  });

  it("a largura é a fração pronta, em porcentagem", () => {
    expect(barra(0)).toContain("width:0%");
    expect(barra(1)).toContain("width:20%");
    expect(barra(5)).toContain("width:100%");
  });
});
