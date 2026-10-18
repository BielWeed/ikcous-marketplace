// @vitest-environment jsdom
import { BarraDeBusca } from "@/components/admin/BarraDeBusca";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

function Tela({ produtos = false }: { produtos?: boolean }) {
  const [modo, setModo] = useState<"compact" | "detailed">("compact");
  const [categoria, setCategoria] = useState("all");
  const [busca, setBusca] = useState("Coleira");
  return (
    <BarraDeBusca
      id="busca-teste"
      rotulo="Buscar produtos"
      placeholder="Buscar produto, código…"
      value={busca}
      onChange={setBusca}
      modo={modo}
      onMudarModo={setModo}
      produtos={produtos}
      grupo="Categorias dos produtos"
      tituloFiltro="Categoria"
      filtrosAtivos={Number(categoria !== "all")}
      opcoes={["all", "Acessórios"].map((valor) => ({
        valor,
        rotulo: valor === "all" ? "Todas as categorias" : valor,
        selecionada: categoria === valor,
        onClick: () => setCategoria(valor),
      }))}
      onLimpar={
        busca || categoria !== "all"
          ? () => {
              setBusca("");
              setCategoria("all");
            }
          : undefined
      }
    />
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("mantém busca, modo e filtros nessa ordem, antes dos chips, e alterna o próximo modo", async () => {
  await act(async () => root.render(<Tela />));
  const campo = host.querySelector("input")!;
  const modo = host.querySelector<HTMLButtonElement>(
    '[aria-label="Mostrar detalhado"]',
  )!;
  const filtros = host.querySelector('[aria-label="Filtros"]')!;
  const chips = host.querySelector('[aria-label="Categorias dos produtos"]')!;
  for (const [antes, depois] of [
    [campo, modo],
    [modo, filtros],
    [filtros, chips],
  ]) {
    expect(
      antes.compareDocumentPosition(depois) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  // O nome já diz a ação; aria-pressed junto faria o leitor de tela se contradizer.
  expect(modo.hasAttribute("aria-pressed")).toBe(false);
  await act(async () => modo.click());
  expect(modo.getAttribute("aria-label")).toBe("Mostrar compacto");
  await act(async () => modo.click());
  expect(modo.getAttribute("aria-label")).toBe("Mostrar detalhado");
  expect(host.querySelectorAll('button[aria-label^="Mostrar"]')).toHaveLength(
    1,
  );
});

it("grade/lista usa a mesma convenção de próximo modo", async () => {
  await act(async () => root.render(<Tela produtos />));
  const modo = host.querySelector<HTMLButtonElement>(
    '[aria-label="Mostrar em lista com detalhes"]',
  )!;
  await act(async () => modo.click());
  expect(modo.getAttribute("aria-label")).toBe("Mostrar em grade");
});

it("chip seleciona, folha repete a escolha, selo conta e limpar remove busca e categoria", async () => {
  await act(async () => root.render(<Tela />));
  const filtros = host.querySelector<HTMLButtonElement>(
    '[aria-label="Filtros"]',
  )!;
  expect(filtros.querySelector("span")).toBeNull();
  const categoria = [
    ...host.querySelectorAll<HTMLButtonElement>("[aria-pressed]"),
  ].find((b) => b.textContent === "Acessórios")!;
  await act(async () => categoria.click());
  expect(categoria.getAttribute("aria-pressed")).toBe("true");
  expect(filtros.querySelector("span")?.textContent).toBe("1");
  await act(async () => filtros.click());
  expect(filtros.getAttribute("aria-expanded")).toBe("true");
  const folha = document.querySelector('[role="dialog"]')!;
  expect(folha.querySelector('button[aria-pressed="true"]')?.textContent).toBe(
    "Acessórios",
  );
  const limpar = [...folha.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Limpar tudo",
  )!;
  await act(async () => limpar.click());
  expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("");
  expect(filtros.querySelector("span")).toBeNull();
  expect(folha.querySelector('button[aria-pressed="true"]')?.textContent).toBe(
    "Todas as categorias",
  );
});
