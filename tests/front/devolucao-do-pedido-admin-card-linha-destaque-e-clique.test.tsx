// @vitest-environment jsdom
// Caça por mutação: o resumo "Devolução do produto" da ficha do pedido. Os
// testes vizinhos viam só o título e "Aguardando a sua resposta"; ninguém olhava
// o realce da devolução que espera resposta, o botão sem destino, o clique que
// leva o id certo, a seta de aberta/fechada nem a linha de resolução/método/valor/dia.
import { DevolucaoDoPedidoAdminCard } from "@/components/admin/orders/DevolucaoDoPedidoAdminCard";
import type { ResumoDevolucao } from "@/types/devolucao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const solicitada: ResumoDevolucao = {
  id: "dev-id-1",
  protocolo: "DEV-0001",
  status: "solicitada",
  tipo: "arrependimento",
  resolucao_desejada: "reembolso",
  metodo_retorno: "entrega_na_loja",
  valor_itens: 120.5,
  created_at: "2026-11-12T15:00:00Z",
};
const aprovada: ResumoDevolucao = {
  id: "dev-id-2",
  protocolo: "DEV-0002",
  status: "aprovada",
  tipo: "vicio",
  resolucao_desejada: "troca",
  metodo_retorno: "etiqueta_reversa",
  valor_itens: 80,
  created_at: "2026-11-13T15:00:00Z",
};
const concluida: ResumoDevolucao = {
  ...aprovada,
  id: "dev-id-3",
  protocolo: "DEV-0003",
  status: "concluida",
  resolucao_desejada: "vale",
  metodo_retorno: "coleta",
  created_at: "2026-11-14T15:00:00Z",
};

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

function mostrar(
  devolucoes: ResumoDevolucao[],
  onAbrirDevolucoes?: (id: string) => void,
) {
  act(() => {
    root.render(
      <DevolucaoDoPedidoAdminCard
        leituraDeDevolucoes={{
          devolucoes,
          carregando: false,
          erro: false,
          recarregar: vi.fn(),
        }}
        onAbrirDevolucoes={onAbrirDevolucoes}
      />,
    );
  });
}
const botaoDe = (protocolo: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("li button")].find((b) =>
    b.textContent?.includes(protocolo),
  )!;
const seta = (b: HTMLElement) => b.querySelector("svg.lucide-chevron-right");

it("cada devolução resume resolução, método, valor dos itens e o dia do pedido", () => {
  mostrar([solicitada, aprovada, concluida], vi.fn());
  const linha = (p: string) =>
    botaoDe(p).querySelector("p")!.textContent?.replace(/\s+/g, " ");
  expect(linha("DEV-0001")).toMatch(
    /^Reembolso · Entregar na loja · Valor dos itens: R\$\s?120,50 · 12\/11\/2026/,
  );
  expect(linha("DEV-0002")).toMatch(
    /^Troca · Código de postagem dos Correios · Valor dos itens: R\$\s?80,00 · 13\/11\/2026/,
  );
  expect(linha("DEV-0003")).toMatch(
    /^Vale-troca · Coleta no endereço do pedido · Valor dos itens: R\$\s?80,00 · 14\/11\/2026/,
  );
});

it("só a devolução que espera resposta ganha o realce âmbar e o aviso", () => {
  mostrar([solicitada, aprovada], vi.fn());
  expect(botaoDe("DEV-0001").className).toContain("border-amber-500/30");
  expect(botaoDe("DEV-0002").className).not.toContain("border-amber-500/30");
  expect(botaoDe("DEV-0001").textContent).toContain(
    "Aguardando a sua resposta",
  );
  expect(botaoDe("DEV-0002").textContent).not.toContain(
    "Aguardando a sua resposta",
  );
  expect(host.textContent?.match(/Aguardando a sua resposta/g)).toHaveLength(1);
});

it("sem destino o resumo só informa: botão travado, sem seta e clique sem efeito", () => {
  mostrar([solicitada, aprovada]);
  for (const p of ["DEV-0001", "DEV-0002"]) {
    expect(botaoDe(p).disabled).toBe(true);
    expect(seta(botaoDe(p))).toBeNull();
  }
  // Os selos de status e tipo continuam aparecendo.
  expect(botaoDe("DEV-0001").textContent).toContain("Solicitada");
  expect(botaoDe("DEV-0001").textContent).toContain("Arrependimento");
});

it("com destino o clique leva o id da devolução clicada, não o protocolo nem a primeira", () => {
  const abrir = vi.fn();
  mostrar([solicitada, aprovada], abrir);
  expect(botaoDe("DEV-0002").disabled).toBe(false);
  act(() => botaoDe("DEV-0002").click());
  expect(abrir).toHaveBeenCalledTimes(1);
  expect(abrir).toHaveBeenCalledWith("dev-id-2");
  act(() => botaoDe("DEV-0001").click());
  expect(abrir).toHaveBeenLastCalledWith("dev-id-1");
});

it("a seta é dourada para devolução aberta e cinza para a já encerrada", () => {
  mostrar([solicitada, aprovada, concluida], vi.fn());
  const classes = (p: string) => seta(botaoDe(p))!.classList;
  expect(classes("DEV-0001").contains("text-admin-gold")).toBe(true);
  expect(classes("DEV-0001").contains("text-zinc-500")).toBe(false);
  expect(classes("DEV-0002").contains("text-admin-gold")).toBe(true);
  expect(classes("DEV-0003").contains("text-zinc-500")).toBe(true);
  expect(classes("DEV-0003").contains("text-admin-gold")).toBe(false);
});

it("sem devolução nenhuma o card não existe", () => {
  mostrar([], vi.fn());
  expect(host.querySelector('[data-testid="devolucao-do-pedido-admin"]')).toBe(
    null,
  );
  expect(host.textContent).toBe("");
});
