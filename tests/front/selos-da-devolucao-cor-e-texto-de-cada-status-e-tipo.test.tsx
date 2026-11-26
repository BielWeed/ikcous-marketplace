// @vitest-environment jsdom
// Caça por mutação: os selos de status e de tipo da devolução (lista, detalhe e
// ficha do pedido). Status é "cor + texto, nunca só cor": o único teste que
// citava o arquivo só lia o código-fonte. Aqui renderiza cada status e cada tipo
// e confere o texto que a lojista lê e a cor do tom certo.
import {
  COR_DO_TOM_NO_PAINEL,
  SeloDoStatus,
  SeloDoTipo,
} from "@/components/admin/devolucoes/SelosDaDevolucao";
import type { StatusDevolucao, TipoDevolucao } from "@/types/devolucao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function selo() {
  return host.querySelector("span") as HTMLSpanElement;
}

const STATUS: [StatusDevolucao, string, string][] = [
  ["solicitada", "Solicitada", "amber"],
  ["aprovada", "Aprovada", "sky"],
  ["em_transito", "A caminho", "sky"],
  ["recebida", "Recebida", "sky"],
  ["concluida", "Concluída", "emerald"],
  ["recusada", "Recusada", "red"],
  ["cancelada", "Cancelada", "red"],
  ["reprovada", "Reprovada", "red"],
];
const TONS = ["amber", "sky", "emerald", "red"];

it.each(STATUS)(
  "selo do status %s diz '%s' e usa o tom %s (e só ele)",
  (status, texto, tom) => {
    act(() => root.render(<SeloDoStatus status={status} />));
    expect(selo().textContent).toBe(texto);
    const classes = [...selo().classList];
    expect(classes).toContain(`text-${tom}-300`);
    expect(classes).toContain(`border-${tom}-500/30`);
    expect(classes).toContain(`bg-${tom}-500/10`);
    for (const outro of TONS.filter((t) => t !== tom)) {
      expect(classes.some((c) => c.includes(`${outro}-`))).toBe(false);
    }
  },
);

const TIPOS: [TipoDevolucao, string, string][] = [
  ["arrependimento", "Arrependimento", "violet"],
  ["vicio", "Problema no produto", "orange"],
  ["troca", "Troca", "zinc"],
];
it.each(TIPOS)(
  "selo do tipo %s diz '%s' e usa a cor %s",
  (tipo, texto, cor) => {
    act(() => root.render(<SeloDoTipo tipo={tipo} />));
    expect(selo().textContent).toBe(texto);
    const classes = [...selo().classList];
    expect(classes).toContain(`text-${cor}-300`);
    expect(classes).toContain(`border-${cor}-500/30`);
    expect(classes).toContain(`bg-${cor}-500/10`);
    for (const outra of ["violet", "orange", "zinc"].filter((c) => c !== cor)) {
      expect(classes.some((c) => c.includes(`${outra}-`))).toBe(false);
    }
  },
);

it("className de fora entra no selo sem tirar o formato base, nos dois selos", () => {
  act(() =>
    root.render(
      <>
        <SeloDoStatus status="concluida" className="ml-9" />
        <SeloDoTipo tipo="troca" className="mr-7" />
      </>,
    ),
  );
  const [status, tipo] = [...host.querySelectorAll("span")];
  for (const [el, extra] of [
    [status, "ml-9"],
    [tipo, "mr-7"],
  ] as const) {
    expect(el.classList.contains(extra)).toBe(true);
    expect(el.classList.contains("rounded-md")).toBe(true);
    expect(el.classList.contains("border")).toBe(true);
    expect(el.classList.contains("uppercase")).toBe(true);
    expect(el.classList.contains("shrink-0")).toBe(true);
  }
});

it("o mapa de tons do painel tem exatamente os quatro tons", () => {
  expect([...COR_DO_TOM_NO_PAINEL.keys()].sort()).toEqual([
    "andamento",
    "atencao",
    "negativo",
    "sucesso",
  ]);
});
