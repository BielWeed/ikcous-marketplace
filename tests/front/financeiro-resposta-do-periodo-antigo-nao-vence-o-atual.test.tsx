// @vitest-environment jsdom
// Remover as guardas `if (!viva) return` permite que A, já abandonado,
// grave cache/estado depois de B. As respostas abaixo chegam antes dos 20 s.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import {
  ContextoDoCacheFinanceiro,
  useExtratoFinanceiro,
} from "@/hooks/useFinanceiro";
import type { IntervaloDeDatas } from "@/types/financeiro";

const A = { inicio: "2026-09-01", fim: "2026-09-30" } as const;
const B = { inicio: "2026-10-01", fim: "2026-10-31" } as const;
const CHAVE_A = "extrato:2026-09-01:2026-09-30:todas";
const CHAVE_B = "extrato:2026-10-01:2026-10-31:todas";
const extrato = (id: string, data: string, valor: number) => [
  {
    id,
    data,
    valor,
    origem: "manual",
    tipo: "entrada",
    status: "realizado",
    descricao: id,
    editavel: false,
  },
];
const DADOS_A = extrato("periodo-a", A.inicio, 10);
const DADOS_B = extrato("periodo-b", B.inicio, 20);

function leituraPendente() {
  let entregar!: (resposta: { data: unknown; error: unknown }) => void;
  const promessa = new Promise<{ data: unknown; error: unknown }>((resolve) => {
    entregar = resolve;
  });
  return { promessa, entregar };
}

function Sonda({ intervalo }: { readonly intervalo: IntervaloDeDatas }) {
  const c = useExtratoFinanceiro(intervalo, null, true, 0);
  return (
    <div
      data-sonda=""
      data-carregando={String(c.carregando)}
      data-erro={c.erro ?? ""}
      data-dados={c.dados === null ? "" : JSON.stringify(c.dados)}
    />
  );
}

let host: HTMLDivElement;
let root: Root;
let cache: Map<string, unknown>;
const sondaNaTela = () =>
  host.querySelector<HTMLElement>("[data-sonda]") as HTMLElement;
const avancar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
async function montar(intervalo: IntervaloDeDatas) {
  await act(async () =>
    root.render(
      <ContextoDoCacheFinanceiro.Provider value={cache}>
        <Sonda intervalo={intervalo} />
      </ContextoDoCacheFinanceiro.Provider>,
    ),
  );
}
async function responder(
  leitura: ReturnType<typeof leituraPendente>,
  data: unknown,
  error: unknown = null,
) {
  await act(async () => {
    leitura.entregar({ data, error });
    await Promise.resolve();
  });
  await avancar(0);
}
function conferirB() {
  expect(sondaNaTela().dataset.dados).toBe(JSON.stringify(cache.get(CHAVE_B)));
  expect(sondaNaTela().dataset.dados).toContain('"id":"periodo-b"');
  expect(sondaNaTela().dataset.carregando).toBe("false");
  expect(sondaNaTela().dataset.erro).toBe("");
  expect(cache.get(CHAVE_B)).toEqual([
    expect.objectContaining({ id: "periodo-b", valor: 20 }),
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  cache = new Map();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function iniciarDuasLeituras() {
  const a = leituraPendente();
  const b = leituraPendente();
  rpc.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
  await montar(A);
  await montar(B);
  expect(rpc.mock.calls).toEqual([
    ["fin_extrato", { p_inicio: A.inicio, p_fim: A.fim, p_conta_id: null }],
    ["fin_extrato", { p_inicio: B.inicio, p_fim: B.fim, p_conta_id: null }],
  ]);
  expect(sondaNaTela().dataset.carregando).toBe("true");
  expect(cache.size).toBe(0);
  await avancar(1_000);
  return { a, b };
}

describe("Financeiro — resposta do período abandonado não vence o atual", () => {
  it("B chega antes de A: mantém B e voltar a A consulta de novo sem cache tardio", async () => {
    const { a, b } = await iniciarDuasLeituras();
    await responder(b, DADOS_B);
    conferirB();
    const cacheB = cache.get(CHAVE_B);
    await avancar(1_000);
    await responder(a, DADOS_A);
    conferirB();
    expect(cache.get(CHAVE_B)).toBe(cacheB);
    expect(cache.has(CHAVE_A)).toBe(false);

    const novaA = leituraPendente();
    rpc.mockReturnValueOnce(novaA.promessa);
    await montar(A);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenLastCalledWith("fin_extrato", {
      p_inicio: A.inicio,
      p_fim: A.fim,
      p_conta_id: null,
    });
    expect(sondaNaTela().dataset.dados).toBe("");
    expect(sondaNaTela().dataset.carregando).toBe("true");
    expect(cache.has(CHAVE_A)).toBe(false);

    await responder(novaA, extrato("periodo-a-reconsultado", A.inicio, 30));
    expect(sondaNaTela().dataset.dados).toContain(
      '"id":"periodo-a-reconsultado"',
    );
    expect(sondaNaTela().dataset.dados).toBe(
      JSON.stringify(cache.get(CHAVE_A)),
    );
    expect(sondaNaTela().dataset.carregando).toBe("false");
    expect(sondaNaTela().dataset.erro).toBe("");
    expect(cache.get(CHAVE_B)).toBe(cacheB);
  });

  it("controle: A chega primeiro, enquanto B está pendente, e depois B aparece", async () => {
    const { a, b } = await iniciarDuasLeituras();
    await responder(a, DADOS_A);
    expect(sondaNaTela().dataset.dados).toBe("");
    expect(sondaNaTela().dataset.carregando).toBe("true");
    expect(sondaNaTela().dataset.erro).toBe("");
    expect(cache.has(CHAVE_A)).toBe(false);
    await responder(b, DADOS_B);
    conferirB();
  });

  it("erro tardio de A não apaga os dados nem cria erro no período B", async () => {
    const { a, b } = await iniciarDuasLeituras();
    await responder(b, DADOS_B);
    conferirB();
    const cacheB = cache.get(CHAVE_B);
    await avancar(1_000);
    await responder(a, null, { code: "42501", message: "permission denied" });
    conferirB();
    expect(cache.get(CHAVE_B)).toBe(cacheB);
    expect(cache.has(CHAVE_A)).toBe(false);
  });
});
