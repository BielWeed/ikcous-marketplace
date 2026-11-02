// @vitest-environment jsdom
//
// useCrmVisitas (src/hooks/useCrm.ts): lê `crm_visitas` SEM mexer em
// `useCrmVisao`. Função ausente na loja (PGRST202/42883, migration ainda não
// aplicada) = some em silêncio; outro erro marca `erro` sem derrubar a visão;
// trocar de período nunca deixa o número do período anterior na tela.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrmVisitas } from "@/hooks/useCrm";
import type { IntervaloDeDatas, VisitasDoCrm } from "@/types/crm";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (nome: string, args: unknown) => h.rpc(nome, args) },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const json = (visitas: number) => ({
  contando_desde: "2026-09-01",
  visitas,
  canais: [{ canal: "direto", visitas }],
  previas: 0,
  periodo_completo: true,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ultimo: { visitas: VisitasDoCrm | null; erro: boolean };

// Uma sonda só: re-renderizar com outro período é o que o chip de período faz
// (o estado do hook sobrevive à troca).
function Sonda({
  intervalo,
  active,
}: Readonly<{ intervalo: IntervaloDeDatas; active: boolean }>) {
  const lido = useCrmVisitas(intervalo, active);
  useEffect(() => {
    ultimo = lido;
  });
  return null;
}

async function montar(intervalo: IntervaloDeDatas, active = true) {
  await act(async () => {
    raiz.render(<Sonda intervalo={intervalo} active={active} />);
  });
}

const esperar = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

beforeEach(() => {
  vi.useFakeTimers();
  h.rpc.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useCrmVisitas", () => {
  it("chama crm_visitas com o período e devolve a leitura", async () => {
    h.rpc.mockResolvedValue({ data: json(42), error: null });
    await montar({ inicio: "2026-01-01", fim: "2026-01-31" });
    await esperar();
    expect(h.rpc).toHaveBeenCalledWith("crm_visitas", {
      p_inicio: "2026-01-01",
      p_fim: "2026-01-31",
    });
    expect(ultimo.visitas?.visitas).toBe(42);
    expect(ultimo.erro).toBe(false);
  });

  it("aba fechada não consulta", async () => {
    await montar({ inicio: "2026-02-01", fim: "2026-02-28" }, false);
    await esperar();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("função ausente (PGRST202 / 42883): em silêncio, sem erro e sem repetir", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const periodo = { inicio: "2026-03-01", fim: "2026-03-31" };
    await montar(periodo);
    await esperar();
    expect(ultimo).toEqual({ visitas: null, erro: false });
    // Fechar e reabrir a aba com o MESMO período: o resultado "ausente"
    // também fica guardado, então não pergunta de novo.
    await montar(periodo, false);
    await montar(periodo, true);
    await esperar();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(erro).not.toHaveBeenCalled();

    h.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    await montar({ inicio: "2026-03-02", fim: "2026-03-31" });
    await esperar();
    expect(ultimo).toEqual({ visitas: null, erro: false });
    erro.mockRestore();
  });

  it("outro erro marca erro e não devolve número", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "500" } });
    await montar({ inicio: "2026-04-01", fim: "2026-04-30" });
    await esperar();
    expect(ultimo).toEqual({ visitas: null, erro: true });
  });

  it("formato inesperado também marca erro", async () => {
    h.rpc.mockResolvedValue({ data: { canais: "x" }, error: null });
    await montar({ inicio: "2026-05-01", fim: "2026-05-31" });
    await esperar();
    expect(ultimo).toEqual({ visitas: null, erro: true });
  });

  it("trocar de período nunca mostra o número do anterior", async () => {
    h.rpc.mockResolvedValue({ data: json(42), error: null });
    await montar({ inicio: "2026-06-01", fim: "2026-06-30" });
    await esperar();
    expect(ultimo.visitas?.visitas).toBe(42);

    h.rpc.mockResolvedValue({ data: json(7), error: null });
    await montar({ inicio: "2026-07-01", fim: "2026-07-31" });
    expect(ultimo.visitas).toBeNull();
    await esperar();
    expect(ultimo.visitas?.visitas).toBe(7);
  });
});
