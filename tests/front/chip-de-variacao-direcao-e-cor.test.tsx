// @vitest-environment jsdom
// O selo de variação dos números do CRM (ex.: "+12,3% vs. 30 dias antes"),
// que nenhum teste lia direto (achado por mutação em 24/11/2026): a seta, o
// verbo que o leitor de tela fala, a cor (verde = bom, vermelho = ruim, cinza
// = igual) e a fronteira do zero. Uma queda não pode virar "Alta", um número
// que arredonda para 0 não pode virar "Alta de 0%", e a taxa de devolução
// (`sobeEBom=false`) pinta a SUBIDA de vermelho.
import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// @ts-expect-error flag interna de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar(props: Parameters<typeof ChipDeVariacao>[0]) {
  await act(async () => root.render(<ChipDeVariacao {...props} />));
  const selo = host.firstElementChild as HTMLElement;
  return {
    selo,
    falado: selo.querySelector(".sr-only")?.textContent ?? "",
    seta: selo.querySelector("svg")?.getAttribute("class") ?? "",
  };
}

const COMPARACAO = "vs. 30 dias antes";

it("sem base de comparação: diz isso, sem seta de alta nem de queda", async () => {
  const { selo } = await montar({ pct: null, comparacao: COMPARACAO });

  expect(selo.textContent).toContain("sem base de comparação");
  expect(selo.querySelector(".sr-only")).toBeNull();
});

it("alta: seta para cima, verbo 'Alta de', sinal de mais e verde", async () => {
  const { selo, falado, seta } = await montar({
    pct: 12.34,
    comparacao: COMPARACAO,
  });

  expect(falado).toBe("Alta de +12,3% vs. 30 dias antes");
  expect(seta).toContain("arrow-up-right");
  expect(selo.className).toContain("text-emerald-300");
});

it("queda: seta para baixo, verbo 'Queda de', sinal de menos de verdade e vermelho", async () => {
  const { selo, falado, seta } = await montar({
    pct: -4.04,
    comparacao: COMPARACAO,
  });

  expect(falado).toBe("Queda de −4% vs. 30 dias antes");
  expect(seta).toContain("arrow-down-right");
  expect(selo.className).toContain("text-rose-300");
});

it("zero e o que arredonda para zero são 'Estável', em cinza, sem seta de alta nem de queda", async () => {
  for (const pct of [0, 0.04, -0.04]) {
    const { selo, falado, seta } = await montar({
      pct,
      comparacao: COMPARACAO,
    });

    expect(falado, String(pct)).toBe("Estável: 0% vs. 30 dias antes");
    expect(seta, String(pct)).toContain("minus");
    expect(selo.className, String(pct)).toContain("text-zinc-300");
    expect(selo.className, String(pct)).not.toMatch(/emerald|rose/);
  }
});

it("0,05% já arredonda para 0,1 e conta como alta; -0,05% arredonda para -0,1 e conta como queda", async () => {
  expect((await montar({ pct: 0.06, comparacao: COMPARACAO })).falado).toBe(
    "Alta de +0,1% vs. 30 dias antes",
  );
  expect((await montar({ pct: -0.06, comparacao: COMPARACAO })).falado).toBe(
    "Queda de −0,1% vs. 30 dias antes",
  );
});

it("sobeEBom=false (taxa de devolução): subir é vermelho, cair é verde, igual segue cinza", async () => {
  const subiu = await montar({
    pct: 10,
    comparacao: COMPARACAO,
    sobeEBom: false,
  });
  expect(subiu.selo.className).toContain("text-rose-300");
  expect(subiu.falado).toBe("Alta de +10% vs. 30 dias antes");

  const caiu = await montar({
    pct: -10,
    comparacao: COMPARACAO,
    sobeEBom: false,
  });
  expect(caiu.selo.className).toContain("text-emerald-300");

  const igual = await montar({
    pct: 0,
    comparacao: COMPARACAO,
    sobeEBom: false,
  });
  expect(igual.selo.className).toContain("text-zinc-300");
  expect(igual.selo.className).not.toMatch(/emerald|rose/);
});

it("curto some com a legenda da tela, mas o leitor de tela ainda ouve a comparação inteira", async () => {
  const longo = await montar({ pct: 5, comparacao: COMPARACAO });
  expect(
    longo.selo.querySelector('[aria-hidden="true"]:not(svg)')?.textContent,
  ).toContain(COMPARACAO);

  const curto = await montar({ pct: 5, comparacao: COMPARACAO, curto: true });
  expect(
    curto.selo.querySelector('[aria-hidden="true"]:not(svg)')?.textContent,
  ).not.toContain(COMPARACAO);
  expect(curto.falado).toContain(COMPARACAO);
});
