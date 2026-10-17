// @vitest-environment jsdom
import { PerfilDaLoja } from "@/components/admin/inicio/PerfilDaLoja";
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
});

const serie = Array.from({ length: 14 }, (_, i) => ({
  dia: `2026-10-${String(i + 4).padStart(2, "0")}`,
  receita: (i + 1) * 10,
}));

it("as setas escolhem um dia, respeitam as pontas e anunciam data e valor", () => {
  act(() => raiz.render(<SerieDe14Dias serie={serie} carregando={false} />));
  const anterior = tela.querySelector<HTMLButtonElement>(
    '[aria-label="Dia anterior"]',
  )!;
  const proximo = tela.querySelector<HTMLButtonElement>(
    '[aria-label="Próximo dia"]',
  )!;
  expect(proximo.disabled).toBe(true);
  act(() => anterior.click());
  expect(tela.querySelector('[aria-live="polite"]')?.textContent).toContain(
    "16/10/2026",
  );
  expect(tela.querySelector('[aria-live="polite"]')?.textContent).toMatch(
    /130,00/,
  );
  expect(proximo.disabled).toBe(false);
  for (let i = 0; i < 12; i++) act(() => anterior.click());
  expect(anterior.disabled).toBe(true);
  expect(tela.querySelector('[aria-live="polite"]')?.textContent).toContain(
    "04/10/2026",
  );
});

it("abre a mesma tabela de 14 dias, permite selecionar e recolher sem perder os dados acessíveis", () => {
  act(() => raiz.render(<SerieDe14Dias serie={serie} carregando={false} />));
  const alternar = tela.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
  expect(alternar.textContent).toContain("Ver os 14 dias em tabela");
  expect(alternar.getAttribute("aria-expanded")).toBe("false");
  act(() => alternar.click());
  expect(alternar.getAttribute("aria-expanded")).toBe("true");
  expect(tela.querySelectorAll("tbody tr")).toHaveLength(14);
  const escolher = tela.querySelector<HTMLButtonElement>(
    'tbody button[aria-label="Selecionar 04/10/2026"]',
  )!;
  act(() => escolher.click());
  expect(escolher.getAttribute("aria-pressed")).toBe("true");
  expect(tela.querySelector('[aria-live="polite"]')?.textContent).toContain(
    "04/10/2026",
  );
  act(() => alternar.click());
  expect(tela.querySelector("table")?.className).toContain("sr-only");
  expect(tela.querySelectorAll("tbody tr")).toHaveLength(14);
  expect(tela.querySelectorAll("tbody button")).toHaveLength(0);
});

it("o perfil conserva nome e responsável longos sem truncar", () => {
  const nome = "Casa Aurora — presentes, papelaria e pequenos encantos";
  act(() =>
    raiz.render(
      <PerfilDaLoja
        nome={nome}
        logoUrl={null}
        cidade="Vila Serena"
        uf="SP"
        responsavel="Marina Flores de Alencar"
      />,
    ),
  );
  expect(tela.querySelector("h2")?.textContent).toBe(nome);
  expect(
    tela.querySelector(".truncate, .line-clamp-1, .line-clamp-2"),
  ).toBeNull();
  expect(tela.textContent).toContain("Marina Flores de Alencar");
  expect(
    tela.querySelector('[aria-label="Compartilhar o link da loja"]'),
  ).not.toBeNull();
});

it("distingue vazio, erro e carregamento sem inventar vendas", () => {
  act(() => raiz.render(<SerieDe14Dias serie={[]} carregando={false} />));
  expect(tela.textContent).toContain(
    "Sem vendas registradas nos últimos 14 dias.",
  );
  act(() =>
    raiz.render(<SerieDe14Dias serie={[]} carregando={false} falhou />),
  );
  expect(tela.textContent).toContain("Falha Operacional");
  expect(tela.textContent).not.toContain("Sem vendas registradas");
  expect(tela.textContent).not.toMatch(/R\$\s*0,00/);
  act(() => raiz.render(<SerieDe14Dias serie={[]} carregando />));
  expect(tela.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(tela.textContent).not.toContain("Falha Operacional");
});
