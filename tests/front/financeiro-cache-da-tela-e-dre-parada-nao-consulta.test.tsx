// @vitest-environment jsdom
// Duas regras do Financeiro que a leitura por período não protegia:
//  1) voltar a um período já visto mostra o valor de antes NA HORA (do cache da
//     tela), enquanto a leitura nova ainda está a caminho;
//  2) a DRE de uma aba parada (ou sem período escolhido) não vai ao banco.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import {
  ContextoDoCacheFinanceiro,
  useDreFinanceira,
  useExtratoFinanceiro,
} from "@/hooks/useFinanceiro";
import type { IntervaloDeDatas } from "@/types/financeiro";

const SETEMBRO: IntervaloDeDatas = { inicio: "2026-09-01", fim: "2026-09-30" };
const CHAVE_SETEMBRO = "extrato:2026-09-01:2026-09-30:todas";

const DADOS_DE_ANTES = [
  {
    id: "lancamento-de-antes",
    data: "2026-09-10",
    valor: 10,
    origem: "manual",
    tipo: "entrada",
    status: "realizado",
    descricao: "valor de antes",
    editavel: false,
  },
];

function SondaDoExtrato({
  intervalo,
}: { readonly intervalo: IntervaloDeDatas }) {
  const c = useExtratoFinanceiro(intervalo, null, true, 0);
  return (
    <div
      data-sonda=""
      data-carregando={String(c.carregando)}
      data-dados={c.dados === null ? "" : JSON.stringify(c.dados)}
    />
  );
}

function SondaDaDre({
  intervalo,
  ativo,
}: {
  readonly intervalo: IntervaloDeDatas | null;
  readonly ativo: boolean;
}) {
  const c = useDreFinanceira(intervalo, ativo, 0);
  return (
    <div
      data-sonda=""
      data-carregando={String(c.carregando)}
      data-dados={c.dados === null ? "" : "tem"}
    />
  );
}

let host: HTMLDivElement;
let root: Root;
const sonda = () =>
  host.querySelector<HTMLElement>("[data-sonda]") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Financeiro — cache da tela e DRE parada", () => {
  it("período já visto: mostra o valor de antes enquanto a leitura nova não chega", async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    const cache = new Map<string, unknown>([[CHAVE_SETEMBRO, DADOS_DE_ANTES]]);
    await act(async () =>
      root.render(
        <ContextoDoCacheFinanceiro.Provider value={cache}>
          <SondaDoExtrato intervalo={SETEMBRO} />
        </ContextoDoCacheFinanceiro.Provider>,
      ),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sonda().dataset.carregando).toBe("true");
    expect(sonda().dataset.dados).toBe(JSON.stringify(DADOS_DE_ANTES));
  });

  it("sem cache da tela: não há valor de antes (começa vazio, carregando)", async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<SondaDoExtrato intervalo={SETEMBRO} />));
    expect(sonda().dataset.carregando).toBe("true");
    expect(sonda().dataset.dados).toBe("");
  });

  it("DRE com a aba parada não consulta o banco, mesmo com período escolhido", async () => {
    await act(async () =>
      root.render(<SondaDaDre intervalo={SETEMBRO} ativo={false} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(sonda().dataset.carregando).toBe("false");
    expect(sonda().dataset.dados).toBe("");
  });

  it("DRE ativa mas sem período escolhido não consulta o banco", async () => {
    await act(async () =>
      root.render(<SondaDaDre intervalo={null} ativo={true} />),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(sonda().dataset.carregando).toBe("false");
  });

  it("DRE ativa com período consulta uma vez a fin_dre do período", async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    await act(async () =>
      root.render(<SondaDaDre intervalo={SETEMBRO} ativo={true} />),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fin_dre", {
      p_inicio: SETEMBRO.inicio,
      p_fim: SETEMBRO.fim,
    });
  });
});
