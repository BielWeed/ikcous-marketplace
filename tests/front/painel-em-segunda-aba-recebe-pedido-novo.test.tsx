// @vitest-environment jsdom
//
// Caça 14-C, item 1 (lote 263) — a lojista com a loja numa aba e o painel em
// outra não via o pedido novo chegar no painel.
//
// O defeito: a liderança é por ABA (um TAB_ID por aba), mas quem abre a
// conexão de tempo real é cada TELA, e só se a aba dela for a líder. Aba líder
// sem a tela de Pedidos montada = ninguém abre o canal `admin_order_updates`, e
// a aba do painel (seguidora) esperava para sempre um repasse que não vinha.
//
// O desenho que se prova aqui: a seguidora pergunta ao líder "tem alguém
// servindo esta tela?" (`conn_status_request`); sem resposta em ~1 s, ELA abre
// o canal — e a partir daí passa a se bastar (ignora o repasse de outras abas,
// para o aviso nunca tocar duas vezes) e a servir as outras. A pergunta se
// repete de tempos em tempos, para o caso de quem servia sair da tela.
//
// DUAS ABAS DE VERDADE: cada aba é uma reimportação fresca dos módulos
// (`vi.resetModules()`), com TAB_ID e `globalOrderSubscriptions` próprios — o
// mesmo idioma de `lider-nao-duplica-quando-abas-seguidoras-correm-pela-vaga`.
// O `BroadcastChannel` falso entrega para as OUTRAS instâncias do mesmo nome
// (inclusive da mesma aba), como o do navegador. O dublê do Supabase REGISTRA
// cada canal aberto de verdade e se ele ainda está vivo — a prova é sobre
// quantos canais existem, não sobre o que o código diz que fez.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type CanalRegistrado = {
  aba: string;
  id: string;
  vivo: boolean;
  handlers: Array<(payload: unknown) => unknown>;
};

type Estado = { canais: CanalRegistrado[] };

const estado = (): Estado => (globalThis as any).__t263 as Estado;

/** Dublê do Supabase de UMA aba: registra cada canal aberto de verdade. É
 * registrado com `vi.doMock` a cada aba nova (o `vi.mock` fixo guardaria o
 * rótulo da primeira aba para todas, pois a fábrica dele não roda de novo). */
function criarSupabaseDaAba(aba: string) {
  const g = globalThis as any;
  let idPedido = "pedido-novo-0001";
  const cadeia: any = {
    select: () => cadeia,
    eq: (_coluna: string, valor: string) => {
      idPedido = valor;
      return cadeia;
    },
    single: () =>
      Promise.resolve({
        data: {
          id: idPedido,
          user_id: "cliente-1",
          customer_name: "Maria",
          customer_data: {},
          total: 50,
          status: "pending",
          payment_status: "pago",
          items: [],
        },
        error: null,
      }),
  };
  return {
    supabase: {
      channel: (id: string) => {
        const reg: CanalRegistrado = { aba, id, vivo: true, handlers: [] };
        g.__t263.canais.push(reg);
        const canal: any = {
          __reg: reg,
          on: (_tipo: string, _filtro: unknown, handler: any) => {
            reg.handlers.push(handler);
            return canal;
          },
          subscribe: (cb: (status: string) => void) => {
            Promise.resolve().then(() => cb("SUBSCRIBED"));
            return canal;
          },
        };
        return canal;
      },
      removeChannel: (canal: any) => {
        if (canal?.__reg) canal.__reg.vivo = false;
        return Promise.resolve("ok");
      },
      from: () => cadeia,
    },
  };
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, isAdmin: true }),
}));

// ---- BroadcastChannel falso, com fan-out para as OUTRAS instâncias ----------

type Ouvinte = (evento: { data: any }) => void;

class CanalFalso {
  static registro = new Map<string, Set<CanalFalso>>();
  name: string;
  private ouvintes: Ouvinte[] = [];
  private fechado = false;

  constructor(name: string) {
    this.name = name;
    if (!CanalFalso.registro.has(name))
      CanalFalso.registro.set(name, new Set());
    CanalFalso.registro.get(name)?.add(this);
  }

  addEventListener(_tipo: "message", ouvinte: Ouvinte) {
    this.ouvintes.push(ouvinte);
  }

  removeEventListener(_tipo: "message", ouvinte: Ouvinte) {
    this.ouvintes = this.ouvintes.filter((o) => o !== ouvinte);
  }

  postMessage(data: unknown) {
    if (this.fechado) {
      throw new DOMException("Channel is closed", "InvalidStateError");
    }
    for (const outra of CanalFalso.registro.get(this.name) ?? []) {
      if (outra === this) continue;
      queueMicrotask(() => outra.entregar(data));
    }
  }

  entregar(data: unknown) {
    for (const ouvinte of [...this.ouvintes]) ouvinte({ data });
  }

  close() {
    this.fechado = true;
    CanalFalso.registro.get(this.name)?.delete(this);
  }

  static reiniciar() {
    CanalFalso.registro.clear();
  }
}

// ---- Abas simuladas ---------------------------------------------------------

type Aba = {
  rotulo: string;
  lider: typeof import("@/hooks/useLeaderElection");
  pedidos: typeof import("@/hooks/useOrders");
  raizes: Root[];
};

let abas: Aba[] = [];
let hosts: HTMLDivElement[] = [];

async function novaAba(rotulo: string): Promise<Aba> {
  vi.resetModules();
  vi.doMock("@/lib/supabase", () => criarSupabaseDaAba(rotulo));
  const lider = await import("@/hooks/useLeaderElection");
  const pedidos = await import("@/hooks/useOrders");
  const aba: Aba = { rotulo, lider, pedidos, raizes: [] };
  abas.push(aba);
  return aba;
}

function renderizar(aba: Aba, elemento: React.ReactElement): Root {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const raiz = createRoot(host);
  aba.raizes.push(raiz);
  act(() => {
    raiz.render(elemento);
  });
  return raiz;
}

function desmontar(aba: Aba, raiz: Root) {
  act(() => {
    raiz.unmount();
  });
  aba.raizes = aba.raizes.filter((r) => r !== raiz);
}

/** Só a eleição de líder — a aba da LOJA, sem nenhuma tela de pedidos. */
function montarSoLideranca(aba: Aba): { isLeader: () => boolean; raiz: Root } {
  let ultimo = false;
  function Sonda() {
    ultimo = aba.lider.useLeaderElection().isLeader;
    return null;
  }
  const raiz = renderizar(aba, <Sonda />);
  return { isLeader: () => ultimo, raiz };
}

/** A tela de Pedidos do painel: `useOrders(true, true)` com o aviso do painel. */
function montarTelaDePedidos(aba: Aba) {
  const avisos: any[] = [];
  let ultimo: ReturnType<typeof aba.pedidos.useOrders> | null = null;
  function Sonda() {
    ultimo = aba.pedidos.useOrders(true, true, {
      onRealtimeEvent: (payload) => {
        avisos.push(payload);
      },
    });
    return null;
  }
  const raiz = renderizar(aba, <Sonda />);
  return {
    raiz,
    avisos,
    ids: () => (ultimo?.orders ?? []).map((o) => o.id),
  };
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const PING_MAIS_SORTEIO_MS = 120 + 100 + 60;

/** A aba vira líder (ninguém responde ao PING dela). */
async function tornarLider(aba: Aba) {
  const lideranca = montarSoLideranca(aba);
  await avancar(PING_MAIS_SORTEIO_MS);
  expect(lideranca.isLeader()).toBe(true);
  return lideranca;
}

/** O banco avisa: pedido novo na tabela, entregue a cada canal VIVO. */
async function inserirPedidoNoBanco(
  opcoes: { id?: string; tipo?: "INSERT" | "UPDATE"; instante?: string } = {},
) {
  const { id = "pedido-novo-0001", tipo = "INSERT", instante } = opcoes;
  // O Supabase carimba cada evento com o instante do commit: é o que distingue
  // "o mesmo evento chegando por dois caminhos" de "dois eventos de verdade".
  const payload = {
    eventType: tipo,
    commit_timestamp: instante ?? `2026-10-28T12:00:00.000Z#${id}#${tipo}`,
    new: tipo === "INSERT" ? { id } : { id, status: "processing" },
    old: tipo === "INSERT" ? {} : { id },
  };
  await act(async () => {
    for (const canal of estado().canais.filter((c) => c.vivo)) {
      for (const handler of canal.handlers) await handler(payload);
    }
    await vi.advanceTimersByTimeAsync(50);
  });
}

const vivos = () => estado().canais.filter((c) => c.vivo);

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).__t263 = { canais: [] };
  CanalFalso.reiniciar();
  localStorage.clear();
  vi.stubGlobal("BroadcastChannel", CanalFalso);
  abas = [];
  hosts = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  act(() => {
    for (const aba of abas) for (const raiz of aba.raizes) raiz.unmount();
  });
  for (const host of hosts) host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("painel numa segunda aba — pedido novo ao vivo", () => {
  it("TRÊS ABAS: dois soquetes vivos (p1 e a líder) e uma terceira aba seguidora — o aviso toca UMA vez em cada aba", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const p1Aba = await novaAba("p1");
    const telaP1 = montarTelaDePedidos(p1Aba);
    await avancar(1600); // ninguém serve: p1 abre o canal dela

    const telaDaLoja = montarTelaDePedidos(lojaAba);
    await avancar(200); // a líder também abre o dela
    expect(
      vivos()
        .map((c) => c.aba)
        .sort(),
    ).toEqual(["loja", "p1"]);

    const p2Aba = await novaAba("p2");
    const telaP2 = montarTelaDePedidos(p2Aba);
    await avancar(1600); // recebe resposta das duas e não abre canal
    expect(vivos()).toHaveLength(2);

    await inserirPedidoNoBanco();

    // O banco entregou o MESMO evento aos dois soquetes; p2 o recebe pelos dois
    // repasses e só pode avisar uma vez.
    expect(telaP2.avisos).toHaveLength(1);
    expect(telaP1.avisos).toHaveLength(1);
    expect(telaDaLoja.avisos).toHaveLength(1);
    expect(telaP2.ids().filter((i) => i === "pedido-novo-0001")).toHaveLength(
      1,
    );
  });

  it("CONTROLE: dois pedidos DIFERENTES seguidos chegam por repasse e tocam dois avisos — a deduplicação não engole evento legítimo", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);
    montarTelaDePedidos(lojaAba);
    await avancar(200);

    const painelAba = await novaAba("painel");
    const tela = montarTelaDePedidos(painelAba);
    await avancar(1600);
    expect(estado().canais).toHaveLength(1); // só o da líder: o repasse é o único caminho

    await inserirPedidoNoBanco({ id: "pedido-A" });
    await inserirPedidoNoBanco({ id: "pedido-B" });

    expect(tela.avisos.map((a) => a.new.id)).toEqual(["pedido-A", "pedido-B"]);
    expect(tela.ids()).toEqual(
      expect.arrayContaining(["pedido-A", "pedido-B"]),
    );
  });

  it("CONTROLE: o mesmo pedido com um UPDATE depois (instante diferente) continua sendo processado", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);
    montarTelaDePedidos(lojaAba);
    await avancar(200);

    const painelAba = await novaAba("painel");
    const tela = montarTelaDePedidos(painelAba);
    await avancar(1600);

    await inserirPedidoNoBanco({ id: "pedido-A" });
    await inserirPedidoNoBanco({ id: "pedido-A", tipo: "UPDATE" });

    expect(tela.avisos.map((a) => a.eventType)).toEqual(["INSERT", "UPDATE"]);
  });

  it("DEFEITO: aba líder SEM a tela de pedidos; a seguidora com a tela abre o canal sozinha e recebe o pedido UMA vez", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const painelAba = await novaAba("painel");
    const tela = montarTelaDePedidos(painelAba);
    await avancar(1600);

    // A aba da loja não tem tela de pedidos: sem o conserto, ninguém abre o
    // canal e a lista abaixo nunca recebe nada.
    expect(vivos().map((c) => c.aba)).toEqual(["painel"]);
    expect(vivos().map((c) => c.id)).toEqual(["admin_order_updates"]);

    await inserirPedidoNoBanco();

    expect(tela.ids()).toContain("pedido-novo-0001");
    // O aviso do painel toca exatamente uma vez.
    expect(tela.avisos).toHaveLength(1);
    expect(tela.avisos[0].eventType).toBe("INSERT");
  });

  it("CONTROLE (a): aba líder COM a tela montada serve a seguidora — um canal só no total, aviso uma vez", async () => {
    const lojaAba = await novaAba("lider-com-tela");
    await tornarLider(lojaAba);
    const telaDoLider = montarTelaDePedidos(lojaAba);
    await avancar(200);

    const painelAba = await novaAba("seguidora");
    const telaSeguidora = montarTelaDePedidos(painelAba);
    await avancar(1600);

    // Um canal só no aparelho: o da líder. A seguidora NÃO abriu o dela.
    expect(estado().canais).toHaveLength(1);
    expect(estado().canais[0].aba).toBe("lider-com-tela");

    await inserirPedidoNoBanco();

    expect(telaDoLider.ids()).toContain("pedido-novo-0001");
    expect(telaSeguidora.ids()).toContain("pedido-novo-0001");
    expect(telaDoLider.avisos).toHaveLength(1);
    expect(telaSeguidora.avisos).toHaveLength(1);
    expect(estado().canais).toHaveLength(1);
  });

  it("CONTROLE (b): a líder fecha — a seguidora assume SEM canal duplicado", async () => {
    const lojaAba = await novaAba("lider");
    await tornarLider(lojaAba);
    const telaDoLider = montarTelaDePedidos(lojaAba);
    await avancar(200);

    const painelAba = await novaAba("seguidora");
    const telaSeguidora = montarTelaDePedidos(painelAba);
    await avancar(1600);
    expect(vivos()).toHaveLength(1);

    // A aba da líder fecha: aviso de saída, tela desmontada.
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    for (const raiz of [...lojaAba.raizes]) desmontar(lojaAba, raiz);
    expect(telaDoLider.raiz).toBeTruthy();

    // Dá tempo para a seguidora assumir a liderança, a limpeza da antiga (4 s)
    // e algumas rodadas da pergunta periódica.
    await avancar(40_000);

    // Nunca mais de um canal vivo por vez no aparelho; e no fim é o da
    // seguidora.
    expect(vivos().map((c) => c.aba)).toEqual(["seguidora"]);
    const canaisDaSeguidora = estado().canais.filter(
      (c) => c.aba === "seguidora",
    );
    expect(canaisDaSeguidora).toHaveLength(1);

    await inserirPedidoNoBanco();
    expect(telaSeguidora.ids()).toContain("pedido-novo-0001");
    expect(telaSeguidora.avisos).toHaveLength(1);
  });

  it("CONTROLE: quem servia sai da tela de pedidos (a aba segue líder) — a seguidora percebe e abre o canal", async () => {
    const lojaAba = await novaAba("lider");
    await tornarLider(lojaAba);
    const telaDoLider = montarTelaDePedidos(lojaAba);
    await avancar(200);

    const painelAba = await novaAba("seguidora");
    const telaSeguidora = montarTelaDePedidos(painelAba);
    await avancar(1600);
    expect(vivos().map((c) => c.aba)).toEqual(["lider"]);

    // A líder troca de tela (a aba continua líder: o hook de eleição segue
    // montado em outra raiz).
    montarSoLideranca(lojaAba);
    desmontar(lojaAba, telaDoLider.raiz);

    await avancar(40_000);

    expect(vivos().map((c) => c.aba)).toEqual(["seguidora"]);
    await inserirPedidoNoBanco();
    expect(telaSeguidora.ids()).toContain("pedido-novo-0001");
    expect(telaSeguidora.avisos).toHaveLength(1);
  });

  it("NUNCA dois canais na mesma aba: duas telas de pedidos na seguidora compartilham o mesmo canal próprio", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const painelAba = await novaAba("painel");
    const tela1 = montarTelaDePedidos(painelAba);
    const tela2 = montarTelaDePedidos(painelAba);
    await avancar(1600);

    expect(estado().canais).toHaveLength(1);
    expect(vivos()).toHaveLength(1);

    await inserirPedidoNoBanco();
    expect(tela1.ids()).toContain("pedido-novo-0001");
    expect(tela2.ids()).toContain("pedido-novo-0001");
    expect(tela1.avisos).toHaveLength(1);
    expect(tela2.avisos).toHaveLength(1);
  });

  it("tela montada DEPOIS na aba que já tem canal próprio entra nele — e o canal sobrevive à saída da primeira tela", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const painelAba = await novaAba("painel");
    const tela1 = montarTelaDePedidos(painelAba);
    await avancar(1600);
    expect(vivos()).toHaveLength(1);

    const tela2 = montarTelaDePedidos(painelAba);
    await avancar(500);
    // Entrou no canal que a aba já tinha: nenhum canal novo.
    expect(estado().canais).toHaveLength(1);

    desmontar(painelAba, tela1.raiz);
    await avancar(6000); // passa da limpeza de 4 s, sem chegar na pergunta periódica
    expect(vivos()).toHaveLength(1);

    await inserirPedidoNoBanco();
    expect(tela2.ids()).toContain("pedido-novo-0001");
    expect(tela2.avisos).toHaveLength(1);
  });

  it("aviso nunca toca em dobro: a seguidora com canal próprio ignora o repasse da líder que depois abriu a tela", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const painelAba = await novaAba("painel");
    const telaSeguidora = montarTelaDePedidos(painelAba);
    await avancar(1600);
    expect(vivos().map((c) => c.aba)).toEqual(["painel"]);

    // Agora a líder abre a tela de pedidos: passa a ter canal próprio e repassa
    // cada evento pelo BroadcastChannel. São dois soquetes no aparelho (o da
    // seguidora continua), e cada aba cuida do seu — o banco entrega o MESMO
    // pedido aos dois, e a seguidora deve avisar UMA vez.
    montarTelaDePedidos(lojaAba);
    await avancar(500);

    await inserirPedidoNoBanco();

    expect(telaSeguidora.ids().filter((i) => i === "pedido-novo-0001")).toEqual(
      ["pedido-novo-0001"],
    );
    expect(telaSeguidora.avisos).toHaveLength(1);
  });

  it("CONTROLE (c): o temporizador de espera não vaza — desmontar antes do prazo não abre canal e não deixa timer", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const painelAba = await novaAba("painel");
    const tela = montarTelaDePedidos(painelAba);
    await avancar(300); // ainda dentro da espera de ~1 s
    desmontar(painelAba, tela.raiz);

    await avancar(60_000);
    expect(estado().canais).toHaveLength(0);

    // Fora a eleição de líder da aba da loja (que segue montada), não sobra
    // nenhum temporizador da seguidora: desmontar a loja zera tudo.
    for (const raiz of [...lojaAba.raizes]) desmontar(lojaAba, raiz);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("CONTROLE (c2): depois de ter aberto o canal, desmontar a tela não deixa a pergunta periódica rodando", async () => {
    const lojaAba = await novaAba("loja");
    await tornarLider(lojaAba);

    const painelAba = await novaAba("painel");
    const tela = montarTelaDePedidos(painelAba);
    await avancar(1600);
    expect(vivos()).toHaveLength(1);

    desmontar(painelAba, tela.raiz);
    await avancar(10_000); // a limpeza do canal (4 s) acontece
    expect(vivos()).toHaveLength(0);

    for (const raiz of [...lojaAba.raizes]) desmontar(lojaAba, raiz);
    expect(vi.getTimerCount()).toBe(0);
  });
});
