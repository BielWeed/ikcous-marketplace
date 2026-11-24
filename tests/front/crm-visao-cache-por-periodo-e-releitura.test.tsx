// @vitest-environment jsdom
// O cache da Visão geral do CRM por período e as regras de quando reler
// (achados por mutação em 24/11/2026; nenhum teste segurava estas bordas):
//  - 30 s de frescor, no milissegundo: aos 29,999 s reaproveita, aos 30 s relê;
//  - o cache guarda os 12 períodos mais recentes e descarta o MAIS ANTIGO
//    (voltar a um chip visto há pouco mostra o número na hora; um chip velho
//    demais é lido de novo);
//  - "Sincronizar" (atualizar) relê mesmo com o número fresco, mas SEM piscar
//    o esqueleto por cima do número que já está na tela;
//  - uma leitura lenta que termina DEPOIS de uma mais nova do mesmo período
//    não pode devolver o número velho ao cache;
//  - visitas: falha NÃO entra no cache (voltar à tela tenta de novo, em vez
//    de ficar 30 s sem número e sem erro), e a falha de um período não
//    aparece no período seguinte;
//  - clientes: a página pedida ao banco é pagina × porPagina (a página 3 de
//    25 começa no 50, não no 2), a busca vai sem espaços sobrando e o grupo
//    escolhido vai junto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "admin-fixture" } },
    isAdmin: true,
  }),
}));
vi.mock("@/hooks/useRevalidarAoVoltar", () => ({
  useRevalidarAoVoltar: vi.fn(),
}));
vi.mock("@/lib/dataVault", () => ({ DataVault: { init: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = new Date("2026-11-11T15:00:00Z").getTime();
// A leitura termina quando o relógio falso chega ao fim da espera de 250 ms.
const LIDO_EM = T0 + 250;

const resposta = (receita: number, pedidos: number) => ({
  data: { kpis: { receita, pedidos } },
  error: null,
});
const periodo = (dia: number) => ({
  inicio: `2026-10-${String(dia).padStart(2, "0")}`,
  fim: "2026-11-11",
});

describe("Visão geral do CRM: cache por período e releitura", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useCrmVisao: typeof import("@/hooks/useCrm").useCrmVisao;

  function Sonda({
    ativa,
    dia = 1,
  }: {
    ativa: boolean;
    dia?: number;
  }) {
    const estado = useCrmVisao(periodo(dia), ativa);
    return (
      <>
        <p>
          {estado.visao
            ? `${estado.visao.kpis.receita}/${estado.visao.kpis.pedidos}`
            : "aguardando"}
          {estado.carregando ? " carregando" : ""}
        </p>
        <button
          type="button"
          aria-label="sincronizar"
          onClick={estado.atualizar}
        />
      </>
    );
  }

  async function montar(ativa = true, dia = 1) {
    await act(async () => raiz.render(<Sonda ativa={ativa} dia={dia} />));
    await act(async () => vi.advanceTimersByTimeAsync(300));
  }
  // O botão "Sincronizar" da lojista: chama o `atualizar` do hook.
  function sincronizar() {
    hospedeiro
      .querySelector<HTMLButtonElement>('button[aria-label="sincronizar"]')
      ?.click();
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    h.rpc.mockReset().mockResolvedValue(resposta(500, 3));
    ({ useCrmVisao } = await import("@/hooks/useCrm"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("frescor de 30 s no milissegundo: aos 29,999 s reaproveita, aos 30 s relê", async () => {
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(1);

    await montar(false);
    vi.setSystemTime(new Date(LIDO_EM + 29_999));
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(1);

    await montar(false);
    vi.setSystemTime(new Date(LIDO_EM + 30_000));
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("guarda os 12 períodos mais recentes: o mais velho é lido de novo, o resto vem do cache", async () => {
    // 13 períodos diferentes, um depois do outro (dias 1 a 13).
    for (let dia = 1; dia <= 13; dia++) await montar(true, dia);
    expect(h.rpc).toHaveBeenCalledTimes(13);

    // Dia 13 (o mais novo) e dia 2 (o mais velho que ficou) vêm do cache.
    await montar(true, 13);
    await montar(true, 2);
    expect(h.rpc).toHaveBeenCalledTimes(13);

    // Dia 1 foi o descartado: volta a ser lido.
    await montar(true, 1);
    expect(h.rpc).toHaveBeenCalledTimes(14);
  });

  it("Sincronizar relê mesmo com o número fresco, e o número que já está na tela não vira esqueleto", async () => {
    await montar();
    expect(hospedeiro.textContent).toBe("500/3");

    // A releitura demora: o número antigo fica, sem "carregando".
    let resolver!: (valor: ReturnType<typeof resposta>) => void;
    h.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    await act(async () => sincronizar());
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toBe("500/3");

    await act(async () => resolver(resposta(300, 2)));
    expect(hospedeiro.textContent).toBe("300/2");
  });

  it("primeira leitura de um período sem cache mostra 'carregando' enquanto espera", async () => {
    let resolver!: (valor: ReturnType<typeof resposta>) => void;
    h.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    await montar();
    expect(hospedeiro.textContent).toBe("aguardando carregando");

    await act(async () => resolver(resposta(500, 3)));
    expect(hospedeiro.textContent).toBe("500/3");
  });

  it("leitura lenta que termina depois de uma mais nova do mesmo período não devolve o número velho ao cache", async () => {
    let resolverLenta!: (valor: ReturnType<typeof resposta>) => void;
    h.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolverLenta = resolve;
        }),
    );
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(1);

    // "Sincronizar" dispara a leitura nova (rápida), que traz 300/2.
    h.rpc.mockResolvedValue(resposta(300, 2));
    await act(async () => sincronizar());
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toBe("300/2");

    // A lenta chega por último, com o número velho.
    await act(async () => resolverLenta(resposta(500, 3)));
    expect(hospedeiro.textContent).toBe("300/2");

    // Sai da tela e volta dentro dos 30 s: o cache tem o número NOVO.
    await montar(false);
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toBe("300/2");
  });
});

describe("Visitas do funil: falha não entra no cache", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useCrmVisitas: typeof import("@/hooks/useCrm").useCrmVisitas;

  function Sonda({ ativa, dia = 1 }: { ativa: boolean; dia?: number }) {
    const { visitas, erro } = useCrmVisitas(periodo(dia), ativa);
    return (
      <p>
        {erro ? "erro" : visitas ? `visitas ${visitas.visitas}` : "sem número"}
      </p>
    );
  }

  async function montar(ativa = true, dia = 1) {
    await act(async () => raiz.render(<Sonda ativa={ativa} dia={dia} />));
    await act(async () => vi.advanceTimersByTimeAsync(300));
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    h.rpc.mockReset();
    ({ useCrmVisitas } = await import("@/hooks/useCrm"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("erro do banco: mostra o erro e, ao voltar à tela, tenta de novo (não fica 30 s preso no cache)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "falha do banco" },
    });
    await montar();
    expect(hospedeiro.textContent).toBe("erro");
    expect(h.rpc).toHaveBeenCalledTimes(1);

    h.rpc.mockResolvedValue({
      data: {
        contando_desde: "2026-09-01",
        visitas: 42,
        canais: [],
        previas: 0,
        no_teto: [],
      },
      error: null,
    });
    await montar(false);
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toBe("visitas 42");
  });

  it("a falha de um período não aparece no período seguinte", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "falha do banco" },
    });
    await montar(true, 1);
    expect(hospedeiro.textContent).toBe("erro");

    // Troca de período: a resposta nova ainda não chegou, e o erro do
    // período anterior já não vale.
    h.rpc.mockImplementationOnce(() => new Promise(() => undefined));
    await montar(true, 2);
    expect(hospedeiro.textContent).toBe("sem número");
  });
});

describe("Clientes do CRM: o que vai para o banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useCrmClientes: typeof import("@/hooks/useCrm").useCrmClientes;

  function Sonda() {
    const { lista } = useCrmClientes({
      segmento: "em_risco",
      busca: "  Ana   Teste  ",
      pagina: 2,
      porPagina: 25,
      active: true,
    });
    return <p>{lista ? `total ${lista.total}` : "aguardando"}</p>;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    h.rpc.mockReset().mockResolvedValue({
      data: { total: 0, clientes: [] },
      error: null,
    });
    ({ useCrmClientes } = await import("@/hooks/useCrm"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("pede a página 3 de 25 a partir do cliente 50, com a busca limpa e o grupo escolhido", async () => {
    await act(async () => raiz.render(<Sonda />));
    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(hospedeiro.textContent).toBe("total 0");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("crm_clientes", {
      p_segmento: "em_risco",
      p_busca: "Ana Teste",
      p_limite: 25,
      p_offset: 50,
    });
  });
});
