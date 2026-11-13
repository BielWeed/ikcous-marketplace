// @vitest-environment jsdom
//
// Defeito: o aviso "1 devolução esperando sua resposta" conta só as
// devoluções `solicitada`, mas levava à tela Devoluções sem filtro ("Todas",
// mais recentes primeiro). Com 1 solicitação antiga e 50 concluídas mais
// novas, a lojista tocava em "1" e a primeira página mostrava 50 concluídas.
//
// O conserto usa o mesmo recado "de uma vez só e com validade" do atalho do
// Início para Pedidos: o aviso pede, a tela Devoluções (já aberta em segundo
// plano ou ainda por abrir) abre em "Solicitadas", sem busca. Quem abre
// Devoluções pelo menu, ou escolhe outro chip depois, não é tocado.
import type { View } from "@/types";
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  avisos: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    functions: { invoke: vi.fn() },
    storage: { from: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAvisosDoLojista", () => ({
  useAvisosDoLojista: () => ({
    avisos: h.avisos,
    quantidadeNoCracha: h.avisos.length,
    carregando: false,
    fontesComFalha: [],
    listasCortadas: [],
    recarregar: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = (id: string, protocolo: string, status: string) => ({
  id,
  protocolo,
  order_id: `ped-${id}`,
  cliente_nome: `Cliente ${protocolo}`,
  cliente_whatsapp: null,
  tipo: "arrependimento",
  motivo: "desisti",
  status,
  resolucao_desejada: "reembolso",
  metodo_retorno: "entrega_na_loja",
  modalidade: "local",
  valor_itens: 10,
  prazo_ate: "2026-12-01T00:00:00Z",
  created_at: "2026-10-01T10:00:00Z",
});

// O servidor: 1 solicitação antiga e 2 concluídas mais novas, nesta ordem.
const NO_SERVIDOR = [
  linha("dev-concluida-2", "DEV-C2", "concluida"),
  linha("dev-concluida-1", "DEV-C1", "concluida"),
  linha("dev-solicitada", "DEV-ANTIGA", "solicitada"),
];

function responderComoServidor() {
  h.rpc.mockImplementation(
    async (_nome: string, args: { p_status: string | null }) => {
      const itens = NO_SERVIDOR.filter(
        (i) => args.p_status === null || i.status === args.p_status,
      );
      return {
        data: {
          total: itens.length,
          contagem: { solicitada: 1, concluida: 2 },
          itens,
        },
        error: null,
      };
    },
  );
}

const ultimaConsulta = () => {
  const chamadas = h.rpc.mock.calls.filter(
    (c) => c[0] === "admin_devolucoes_listar",
  );
  return chamadas.at(-1)?.[1] as {
    p_status: string | null;
    p_busca: string | null;
  };
};

const cartoes = (raiz: ParentNode) =>
  Array.from(raiz.querySelectorAll<HTMLElement>("[data-devolucao]")).map(
    (el) => el.dataset.devolucao,
  );

describe("aviso de devolução → lista de solicitadas", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const menu = { abrir: () => {}, sair: () => {} };

  beforeEach(() => {
    vi.resetModules();
    h.rpc.mockReset();
    responderComoServidor();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }

  // Mesmo desenho do painel: as abas ficam montadas, só uma ativa
  // (`emSegundoPlano`), ou a Devoluções só nasce ao ser aberta.
  async function montar(opcoes: { emSegundoPlano: boolean }) {
    const { montarAvisos } = await import("@/utils/avisos-do-lojista");
    h.avisos = montarAvisos({
      pedidos: [],
      perguntasPendentes: 0,
      avaliacoes: [],
      produtos: [],
      devolucoesSolicitadas: 1,
    });
    const { AdminNotificationsView } = await import(
      "@/views/admin/AdminNotificationsView"
    );
    const { AdminDevolucoesView } = await import(
      "@/views/admin/AdminDevolucoesView"
    );
    function Casa() {
      const [tela, setTela] = useState<View>("admin-notifications");
      useEffect(() => {
        menu.abrir = () => setTela("admin-devolucoes");
        menu.sair = () => setTela("admin-notifications");
      }, []);
      const devolucoesAberta = tela === "admin-devolucoes";
      return (
        <>
          <AdminNotificationsView onNavigate={(destino) => setTela(destino)} />
          {(opcoes.emSegundoPlano || devolucoesAberta) && (
            <AdminDevolucoesView
              active={devolucoesAberta}
              onNavigate={(destino) => setTela(destino)}
            />
          )}
        </>
      );
    }
    await act(async () => {
      raiz.render(<Casa />);
    });
    await drenar();
  }

  const tocarNoAviso = async () => {
    await act(async () => {
      hospedeiro
        .querySelector<HTMLElement>('[data-aviso="devolucao"]')
        ?.click();
    });
    await drenar();
  };
  const abrirPeloMenu = async () => {
    await act(async () => menu.abrir());
    await drenar();
  };
  const sair = async () => {
    await act(async () => menu.sair());
    await drenar();
  };
  const escolherChip = async (rotulo: string) => {
    const grupo = hospedeiro.querySelector('[role="group"]')!;
    const alvo = Array.from(grupo.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith(rotulo),
    );
    await act(async () => {
      alvo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await drenar();
  };
  async function digitarBusca(texto: string) {
    vi.useFakeTimers();
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#busca-devolucoes")!;
    const atribuir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      atribuir?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    await drenar();
  }

  it("tela já aberta em segundo plano em 'Todas': o aviso abre só a solicitada que ele contou", async () => {
    await montar({ emSegundoPlano: true });
    // A lojista já visitou Devoluções (nasce em "Todas") e saiu.
    await abrirPeloMenu();
    await sair();
    expect(ultimaConsulta().p_status).toBeNull();

    await tocarNoAviso();

    expect(ultimaConsulta().p_status).toBe("solicitada");
    expect(cartoes(hospedeiro)).toEqual(["dev-solicitada"]);
    const chip = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Solicitadas"),
    );
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
  });

  it("tela ainda por abrir: nasce em 'Solicitadas', sem nunca pedir a lista toda", async () => {
    await montar({ emSegundoPlano: false });

    await tocarNoAviso();

    const consultas = h.rpc.mock.calls
      .filter((c) => c[0] === "admin_devolucoes_listar")
      .map((c) => (c[1] as { p_status: string | null }).p_status);
    expect(consultas).not.toContain(null);
    expect(cartoes(hospedeiro)).toEqual(["dev-solicitada"]);
  });

  it("a busca que ficou escrita também sai: ela esconderia a solicitada contada", async () => {
    await montar({ emSegundoPlano: true });
    await abrirPeloMenu();
    await digitarBusca("maria");
    expect(ultimaConsulta().p_busca).toBe("maria");
    await sair();

    await tocarNoAviso();

    expect(ultimaConsulta().p_status).toBe("solicitada");
    expect(ultimaConsulta().p_busca).toBeNull();
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#busca-devolucoes")?.value,
    ).toBe("");
  });

  it("tela que monta ainda escondida não gasta o recado: ele vale quando ela ficar à vista", async () => {
    const lib = await import("@/lib/aviso-leva-a-devolucoes-solicitadas");
    const { AdminDevolucoesView } = await import(
      "@/views/admin/AdminDevolucoesView"
    );
    lib.pedirDevolucoesSolicitadas();
    await act(async () => {
      raiz.render(<AdminDevolucoesView onNavigate={vi.fn()} active={false} />);
    });
    await drenar();
    const chipsMarcados = () =>
      Array.from(hospedeiro.querySelectorAll("button[aria-pressed=true]")).map(
        (b) => b.textContent?.split(/\d/)[0],
      );
    // Escondida, a tela não mexe no chip (o recado continua à espera).
    expect(chipsMarcados()).toEqual(["Todas"]);
    await act(async () => {
      raiz.render(<AdminDevolucoesView onNavigate={vi.fn()} active />);
    });
    await drenar();

    expect(ultimaConsulta().p_status).toBe("solicitada");
    expect(cartoes(hospedeiro)).toEqual(["dev-solicitada"]);
  });

  it("controle: abrir Devoluções pelo MENU não toca no que a lojista deixou", async () => {
    await montar({ emSegundoPlano: true });
    await abrirPeloMenu();
    await escolherChip("Concluídas");
    expect(ultimaConsulta().p_status).toBe("concluida");
    await sair();

    await abrirPeloMenu();

    expect(ultimaConsulta().p_status).toBe("concluida");
  });

  it("controle: o recado vale uma vez — depois de escolher outro chip, voltar pelo menu respeita a escolha", async () => {
    await montar({ emSegundoPlano: true });
    await tocarNoAviso();
    expect(ultimaConsulta().p_status).toBe("solicitada");
    await escolherChip("Todas");
    expect(ultimaConsulta().p_status).toBeNull();
    await sair();

    await abrirPeloMenu();

    expect(ultimaConsulta().p_status).toBeNull();
  });
});

describe("recado do aviso de devolução (vale uma vez, com validade)", () => {
  it("vale uma vez só", async () => {
    vi.resetModules();
    const lib = await import("@/lib/aviso-leva-a-devolucoes-solicitadas");
    lib.pedirDevolucoesSolicitadas(1_000);
    expect(lib.consumirPedidoDeDevolucoesSolicitadas(1_500)).toBe(true);
    expect(lib.consumirPedidoDeDevolucoesSolicitadas(1_600)).toBe(false);
  });

  it("sem pedido nenhum, não muda nada", async () => {
    vi.resetModules();
    const lib = await import("@/lib/aviso-leva-a-devolucoes-solicitadas");
    expect(lib.consumirPedidoDeDevolucoesSolicitadas(1_000)).toBe(false);
  });

  it("recado esquecido (a tela nunca abriu) vence: abrir pelo menu horas depois não filtra nada", async () => {
    vi.resetModules();
    const lib = await import("@/lib/aviso-leva-a-devolucoes-solicitadas");
    lib.pedirDevolucoesSolicitadas(1_000);
    const duasHorasDepois = 1_000 + 2 * 60 * 60 * 1000;
    expect(lib.consumirPedidoDeDevolucoesSolicitadas(duasHorasDepois)).toBe(
      false,
    );
  });
});
