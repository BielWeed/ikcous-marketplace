// @vitest-environment jsdom
//
// Aba Clientes do CRM, com o hook `useCrmClientes` de verdade: a lojista abre a
// aba (consulta A, sem grupo) e toca num grupo (consulta B) enquanto A ainda
// voa. A resposta tardia do filtro velho não grava lista, erro nem "carregando":
// a lista, o número do card e a paginação são só os de B. As duas respostas são
// promessas controladas, resolvidas em ordem inversa.
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { SegmentoCrm } from "@/types/crm";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Resposta = { data: unknown; error: unknown };

function registro(chave: string, nome: string) {
  return {
    chave,
    user_id: null,
    nome,
    whatsapp: null,
    email: `${chave}@fixture.invalid`,
    pedidos: 1,
    receita: 10,
    segmento: null,
  };
}

function sucesso(
  clientes: ReturnType<typeof registro>[],
  total: number,
): Resposta {
  return { data: { total, clientes }, error: null };
}

const clientesDeA = Array.from({ length: 12 }, (_, i) =>
  registro(`antigo-${i}`, `Cliente Antigo ${i}`),
);
const respostaA = () => sucesso(clientesDeA, 40);
const respostaB = () => sucesso([registro("beatriz", "Beatriz Fixture")], 1);
const falha: Resposta = { data: null, error: { message: "Falha simulada" } };

function pendente() {
  let resolver: (resposta: Resposta) => void = () => {};
  let rejeitar: (motivo: unknown) => void = () => {};
  const promessa = new Promise<Resposta>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

// O CRM guarda o grupo escolhido acima da aba; aqui um estado faz esse papel.
function Casca() {
  const [segmento, setSegmento] = useState<SegmentoCrm | null>(null);
  return (
    <ClientesDoCrm
      segmentos={[]}
      carregandoSegmentos={false}
      segmento={segmento}
      aoMudarSegmento={setSegmento}
      active
      onNavigate={vi.fn()}
      sinalDeAtualizacao={0}
    />
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  rpc.mockReset();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// A (sem grupo) sai ao abrir a aba e fica em voo; tocar "Melhores clientes"
// manda B (grupo `campeoes`), também em voo.
async function abrirETocarOutroGrupo() {
  const a = pendente();
  const b = pendente();
  rpc.mockImplementationOnce(() => a.promessa);
  rpc.mockImplementationOnce(() => b.promessa);

  await act(async () => root.render(<Casca />));
  await avancar(150);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1]).toEqual(
    expect.objectContaining({ p_segmento: null }),
  );

  const chip = Array.from(
    host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Filtrar por grupo"] button',
    ),
  ).find((botao) => botao.textContent?.trim().startsWith("Melhores clientes"));
  if (!chip) throw new Error("Chip 'Melhores clientes' não encontrado");
  await act(async () => chip.click());
  await avancar(150);

  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[1][1]).toEqual(
    expect.objectContaining({ p_segmento: "campeoes" }),
  );
  return { a, b };
}

function cardDaListaFiltrada() {
  return host.querySelector(
    '[role="group"][aria-label="Na lista filtrada"] .tabular-nums',
  )?.textContent;
}

function listaEstaCarregando() {
  return host.querySelector('ul[aria-busy="true"]') !== null;
}

function esperarSoOFiltroNovo() {
  expect(host.textContent).toContain("Beatriz Fixture");
  expect(host.textContent).not.toContain("Cliente Antigo");
  expect(cardDaListaFiltrada()).toBe("1");
  const paginacao = host.querySelector('[data-testid="paginacao-admin"]');
  expect(paginacao?.textContent).toContain("Exibindo 1 - 1 de 1");
  // Com o total velho (40) a paginação teria 2 páginas, e portanto botões.
  expect(paginacao?.querySelectorAll("button")).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')).toBeNull();
}

describe("CRM Clientes — resposta tardia do filtro velho não vale", () => {
  it("B chega primeiro e A depois: lista, card e paginação ficam com B", async () => {
    const { a, b } = await abrirETocarOutroGrupo();

    await act(async () => b.resolver(respostaB()));
    esperarSoOFiltroNovo();

    await act(async () => a.resolver(respostaA()));

    esperarSoOFiltroNovo();
    expect(listaEstaCarregando()).toBe(false);
  });

  it("A chega antes de B, que ainda voa: nada de A aparece e a lista segue carregando", async () => {
    const { a, b } = await abrirETocarOutroGrupo();

    await act(async () => a.resolver(respostaA()));

    expect(host.textContent).not.toContain("Cliente Antigo");
    expect(listaEstaCarregando()).toBe(true);

    await act(async () => b.resolver(respostaB()));

    esperarSoOFiltroNovo();
    expect(listaEstaCarregando()).toBe(false);
  });

  it("A devolve erro depois de B carregar: não aparece 'Não foi possível carregar os clientes'", async () => {
    const { a, b } = await abrirETocarOutroGrupo();
    await act(async () => b.resolver(respostaB()));

    await act(async () => a.resolver(falha));

    esperarSoOFiltroNovo();
    expect(host.textContent).not.toContain(
      "Não foi possível carregar os clientes",
    );
  });

  it("A estoura (rede cai) depois de B carregar: também não aparece o aviso de falha", async () => {
    const { a, b } = await abrirETocarOutroGrupo();
    await act(async () => b.resolver(respostaB()));

    await act(async () => a.rejeitar(new Error("Rede caiu")));

    esperarSoOFiltroNovo();
    expect(host.textContent).not.toContain(
      "Não foi possível carregar os clientes",
    );
  });

  it("controle: sem filtro novo no meio, o erro da consulta atual aparece", async () => {
    const a = pendente();
    rpc.mockImplementationOnce(() => a.promessa);
    await act(async () => root.render(<Casca />));
    await avancar(150);

    await act(async () => a.resolver(falha));

    expect(host.textContent).toContain("Não foi possível carregar os clientes");
  });
});
