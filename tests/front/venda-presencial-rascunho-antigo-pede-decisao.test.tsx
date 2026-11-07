// @vitest-environment jsdom
//
// Balcão — o cupom que ficou aberto de um dia para o outro. O rascunho do
// caixa não tinha data: abrir Vender no dia seguinte devolvia a venda de ontem
// (itens, cliente e até a tela de Fechar venda) sem nenhum aviso, e uma venda
// nova bipada por cima saía na conta da cliente antiga.
//
// O que se prova aqui, na máquina (sem tela):
//  - o rascunho agora leva o carimbo `salvoEm`, e o carimbo NÃO vira estado;
//  - rascunho de OUTRO dia (em São Paulo), de mais de 12 h, sem carimbo (gravado
//    antes desta mudança) ou com carimbo estragado volta marcado como "velho":
//    os itens e o cliente continuam lá (a lojista decide), mas a tela abre no
//    cupom, nunca no Fechar venda de ontem;
//  - nada apaga o rascunho velho em silêncio nem o "rejuvenesce" sozinho:
//    gravar por cima mantém o carimbo antigo até a lojista escolher;
//  - "continuar" recarimba com a hora de agora; "descartar" limpa de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDaVenda,
  type OpcoesDoVendaPresencial,
  type VendaPresencialEmUso,
  estadoInicialDaVenda,
  lerRascunho,
  lerRascunhoComIdade,
  serializarRascunho,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "admin_pdv_venda_draft";

/** São Paulo é UTC−3 o ano todo: 15:00Z = 12:00 em SP, quinta 06/11/2026. */
const AGORA = Date.parse("2026-11-06T15:00:00Z");
const HORA = 3_600_000;

const item = {
  chave: "prod-1::",
  productId: "prod-1",
  variantId: null,
  nome: "Caneca",
  variacao: null,
  preco: 10,
  quantidade: 1,
  estoque: 5,
  imagem: "",
};

function estadoDeOntem(extra: Partial<EstadoDaVenda> = {}): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-de-ontem"),
    etapa: "fechamento",
    itens: [item],
    cliente: { tipo: "avulso", nome: "Maria", whatsapp: "34999990000" },
    pagamento: "cash",
    ...extra,
  };
}

/** O que o app gravava ANTES desta mudança: o mesmo JSON, sem `salvoEm`. */
function rascunhoSemCarimbo(estado: EstadoDaVenda): string {
  const { salvoEm: _carimbo, ...semCarimbo } = JSON.parse(
    serializarRascunho(estado, AGORA),
  );
  return JSON.stringify(semCarimbo);
}

function comCarimbo(estado: EstadoDaVenda, salvoEm: unknown): string {
  const objeto = JSON.parse(serializarRascunho(estado, AGORA));
  objeto.salvoEm = salvoEm;
  return JSON.stringify(objeto);
}

describe("rascunho do caixa — idade (lerRascunhoComIdade)", () => {
  it("grava o carimbo salvoEm em ISO e ele NÃO volta como parte do estado", () => {
    const bruto = serializarRascunho(estadoDeOntem(), AGORA);
    expect(JSON.parse(bruto).salvoEm).toBe(new Date(AGORA).toISOString());

    const lido = lerRascunhoComIdade(bruto, AGORA);
    expect(lido).not.toBeNull();
    expect(lido!.salvoEm).toBe(AGORA);
    expect(lido!.estado).not.toHaveProperty("salvoEm");
  });

  it("rascunho de 2 h atrás, no mesmo dia, é FRESCO e mantém a etapa Fechar venda", () => {
    const bruto = serializarRascunho(estadoDeOntem(), AGORA - 2 * HORA);
    const lido = lerRascunhoComIdade(bruto, AGORA)!;
    expect(lido.velho).toBe(false);
    expect(lido.estado.etapa).toBe("fechamento");
    expect(lido.estado.cliente).toEqual({
      tipo: "avulso",
      nome: "Maria",
      whatsapp: "34999990000",
    });
  });

  it("de OUTRO dia em São Paulo é velho mesmo com menos de 12 h (23:00 de ontem, 00:30 de hoje)", () => {
    const meiaNoiteEMeia = Date.parse("2026-11-06T03:30:00Z"); // 00:30 SP, 06/11
    const ontem23h = Date.parse("2026-11-06T02:00:00Z"); // 23:00 SP, 05/11
    const lido = lerRascunhoComIdade(
      serializarRascunho(estadoDeOntem(), ontem23h),
      meiaNoiteEMeia,
    )!;
    expect(lido.velho).toBe(true);
    expect(lido.salvoEm).toBe(ontem23h);
  });

  it("do MESMO dia, mas com mais de 12 h, é velho", () => {
    const agora = Date.parse("2026-11-06T15:30:00Z"); // 12:30 SP
    const quaseMeiaNoite = Date.parse("2026-11-06T03:10:00Z"); // 00:10 SP, mesmo dia
    const lido = lerRascunhoComIdade(
      serializarRascunho(estadoDeOntem(), quaseMeiaNoite),
      agora,
    )!;
    expect(lido.velho).toBe(true);
  });

  it("o limite é 12 h cravadas: 12 h ainda vale, 12 h e 1 ms já não", () => {
    const salvo = Date.parse("2026-11-06T09:00:00Z"); // 06:00 SP
    const bruto = serializarRascunho(estadoDeOntem(), salvo);
    expect(
      lerRascunhoComIdade(bruto, salvo + 12 * HORA)!.velho,
      "12 h exatas",
    ).toBe(false);
    expect(
      lerRascunhoComIdade(bruto, salvo + 12 * HORA + 1)!.velho,
      "12 h e 1 ms",
    ).toBe(true);
  });

  it("velho: a etapa abre no CUPOM (nunca no Fechar venda de ontem), mas itens, cliente e pagamento continuam lá", () => {
    const ontem = AGORA - 20 * HORA;
    const lido = lerRascunhoComIdade(
      serializarRascunho(
        estadoDeOntem({
          escolhaDeVariacao: {
            codigo: "789",
            produtoId: "p-9",
            produtoNome: "Camiseta",
            opcoes: [],
          },
          aviso: { tipo: "inativo", nome: "Antigo" },
        }),
        ontem,
      ),
      AGORA,
    )!;
    expect(lido.velho).toBe(true);
    expect(lido.estado.etapa).toBe("cupom");
    expect(lido.estado.escolhaDeVariacao).toBeNull();
    expect(lido.estado.aviso).toBeNull();
    expect(lido.estado.itens).toHaveLength(1);
    expect(lido.estado.cliente).toEqual({
      tipo: "avulso",
      nome: "Maria",
      whatsapp: "34999990000",
    });
    expect(lido.estado.pagamento).toBe("cash");
    expect(lido.estado.chaveDeIdempotencia).toBe("chave-de-ontem");
  });

  it("rascunho gravado ANTES desta mudança (sem carimbo) NÃO some: volta como velho, de data desconhecida", () => {
    const lido = lerRascunhoComIdade(
      rascunhoSemCarimbo(estadoDeOntem()),
      AGORA,
    );
    expect(lido).not.toBeNull();
    expect(lido!.velho).toBe(true);
    expect(lido!.salvoEm).toBeNull();
    expect(lido!.estado.itens).toHaveLength(1);
    expect(lido!.estado.etapa).toBe("cupom");
  });

  it.each([
    ["texto que não é data", "ontem à tarde"],
    ["número no lugar do texto", 1_762_000_000_000],
    ["nulo", null],
    ["vazio", ""],
    ["objeto", { dia: 5 }],
    ["data impossível", "2026-13-45T99:00:00Z"],
  ])(
    "carimbo estragado (%s) também vira velho, sem perder o cupom",
    (_n, valor) => {
      const lido = lerRascunhoComIdade(
        comCarimbo(estadoDeOntem(), valor),
        AGORA,
      );
      expect(lido).not.toBeNull();
      expect(lido!.velho).toBe(true);
      expect(lido!.salvoEm).toBeNull();
      expect(lido!.estado.itens).toHaveLength(1);
    },
  );

  it("carimbo no FUTURO de outro dia (relógio do aparelho mexido) é velho", () => {
    const lido = lerRascunhoComIdade(
      serializarRascunho(estadoDeOntem(), AGORA + 3 * 24 * HORA),
      AGORA,
    )!;
    expect(lido.velho).toBe(true);
  });

  it("JSON torto continua devolvendo null (o que já valia) e lerRascunho continua devolvendo só o estado", () => {
    expect(lerRascunhoComIdade("{itens: [", AGORA)).toBeNull();
    expect(lerRascunhoComIdade(null, AGORA)).toBeNull();
    const fresco = serializarRascunho(estadoDeOntem(), AGORA - HORA);
    expect(lerRascunho(fresco, AGORA)?.etapa).toBe("fechamento");
  });
});

function criarArmazenamentoEmMemoria() {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
  };
}

function Sonda({
  opcoes,
  aoAtualizar,
}: {
  readonly opcoes: OpcoesDoVendaPresencial;
  readonly aoAtualizar: (venda: VendaPresencialEmUso) => void;
}) {
  const venda = useVendaPresencial(opcoes);
  aoAtualizar(venda);
  return null;
}

const ultimo = (f: ReturnType<typeof vi.fn>): VendaPresencialEmUso =>
  f.mock.calls.at(-1)?.[0];

describe("rascunho do caixa — o hook pede decisão em vez de decidir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function montar(
    armazenamento: ReturnType<typeof criarArmazenamentoEmMemoria>,
    userId: string | undefined = "lojista-1",
    aoAtualizar = vi.fn(),
  ) {
    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            userId,
            gerarChave: () => "chave-nova",
            atrasoDeGravacaoMs: 50,
          }}
          aoAtualizar={aoAtualizar}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    return aoAtualizar;
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  const CHAVE = `${BASE}:lojista-1`;

  it("rascunho de ontem: volta marcado, abre no cupom e o disco NÃO é apagado nem recarimbado", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const deOntem = serializarRascunho(estadoDeOntem(), AGORA - 20 * HORA);
    armazenamento.mapa.set(CHAVE, deOntem);

    const aoAtualizar = await montar(armazenamento);
    await passar(500); // bem mais que o atraso de gravação

    const venda = ultimo(aoAtualizar);
    expect(venda.restaurado).toBe(true);
    expect(venda.rascunhoAntigo).toMatchObject({ salvoEm: AGORA - 20 * HORA });
    // `lidoEm` = o instante da leitura (relógio de mentira, uns ms depois de AGORA)
    expect(venda.rascunhoAntigo!.lidoEm).toBeGreaterThanOrEqual(AGORA);
    expect(venda.rascunhoAntigo!.lidoEm).toBeLessThan(AGORA + HORA);
    expect(venda.estado.etapa).toBe("cupom");
    expect(venda.estado.itens).toHaveLength(1);
    expect(venda.estado.cliente.tipo).toBe("avulso");
    // O carimbo antigo continua valendo no disco: o rascunho não "rejuvenesceu".
    expect(JSON.parse(armazenamento.mapa.get(CHAVE)!).salvoEm).toBe(
      new Date(AGORA - 20 * HORA).toISOString(),
    );
  });

  it("rascunho de hoje (2 h): sem aviso, e a etapa Fechar venda volta como sempre voltou", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(
      CHAVE,
      serializarRascunho(estadoDeOntem(), AGORA - 2 * HORA),
    );

    const aoAtualizar = await montar(armazenamento);

    const venda = ultimo(aoAtualizar);
    expect(venda.restaurado).toBe(true);
    expect(venda.rascunhoAntigo).toBeNull();
    expect(venda.estado.etapa).toBe("fechamento");
  });

  it("cupom velho SEM carimbo (gravado antes da mudança) pede decisão, com data desconhecida", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(CHAVE, rascunhoSemCarimbo(estadoDeOntem()));

    const aoAtualizar = await montar(armazenamento);
    await passar(500);

    const venda = ultimo(aoAtualizar);
    expect(venda.rascunhoAntigo).toMatchObject({ salvoEm: null });
    expect(venda.estado.itens).toHaveLength(1);
    // Ainda sem carimbo no disco: nada o disfarçou de "de hoje".
    expect(JSON.parse(armazenamento.mapa.get(CHAVE)!)).not.toHaveProperty(
      "salvoEm",
    );
  });

  it("mexer no cupom velho (bipar mais uma peça) grava a mudança, mas MANTÉM o carimbo antigo", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(
      CHAVE,
      serializarRascunho(estadoDeOntem(), AGORA - 20 * HORA),
    );
    const aoAtualizar = await montar(armazenamento);

    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "item_adicionado_manualmente",
        item: { ...item, chave: "prod-2::", productId: "prod-2" },
        em: 0,
      });
    });
    await passar(500);

    const gravado = JSON.parse(armazenamento.mapa.get(CHAVE)!);
    expect(gravado.itens).toHaveLength(2); // a mudança não se perdeu
    expect(gravado.salvoEm).toBe(new Date(AGORA - 20 * HORA).toISOString());
    expect(ultimo(aoAtualizar).rascunhoAntigo).not.toBeNull();
  });

  it("continuar: o aviso some, o carimbo vira AGORA e o mesmo cupom (com a mesma chave de idempotência) segue", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(
      CHAVE,
      serializarRascunho(estadoDeOntem(), AGORA - 20 * HORA),
    );
    const aoAtualizar = await montar(armazenamento);

    await act(async () => {
      ultimo(aoAtualizar).continuarVendaAntiga();
    });
    await passar(500);

    const venda = ultimo(aoAtualizar);
    expect(venda.rascunhoAntigo).toBeNull();
    expect(venda.estado.itens).toHaveLength(1);
    expect(venda.estado.chaveDeIdempotencia).toBe("chave-de-ontem");
    const gravado = JSON.parse(armazenamento.mapa.get(CHAVE)!);
    // O relógio de mentira andou uns ms desde AGORA: "de agora" = AGORA + ruído,
    // e de jeito nenhum as 20 h do carimbo de ontem.
    const carimbo = Date.parse(gravado.salvoEm);
    expect(carimbo).toBeGreaterThanOrEqual(AGORA);
    expect(carimbo).toBeLessThan(AGORA + HORA);
    expect(gravado.itens).toHaveLength(1);

    // F5 logo depois: o cupom que ela escolheu continuar volta SEM aviso.
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    const depois = await montar(armazenamento);
    expect(ultimo(depois).rascunhoAntigo).toBeNull();
    expect(ultimo(depois).restaurado).toBe(true);
  });

  it("descartar (limparCupom): o aviso some, o disco é apagado e a chave de idempotência gira", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(
      CHAVE,
      serializarRascunho(estadoDeOntem(), AGORA - 20 * HORA),
    );
    const aoAtualizar = await montar(armazenamento);

    await act(async () => {
      ultimo(aoAtualizar).limparCupom();
    });
    await passar(500);

    const venda = ultimo(aoAtualizar);
    expect(venda.rascunhoAntigo).toBeNull();
    expect(venda.estado.itens).toEqual([]);
    expect(venda.estado.cliente.tipo).toBe("sem_cliente");
    expect(venda.estado.chaveDeIdempotencia).toBe("chave-nova");
    expect(armazenamento.mapa.has(CHAVE)).toBe(false);
  });

  it("sem decisão nenhuma, nada é registrado nem apagado: o aviso espera quanto for preciso", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const deOntem = serializarRascunho(estadoDeOntem(), AGORA - 20 * HORA);
    armazenamento.mapa.set(CHAVE, deOntem);
    const aoAtualizar = await montar(armazenamento);

    await passar(60 * 60 * 1000); // uma hora parada na tela

    expect(ultimo(aoAtualizar).rascunhoAntigo).not.toBeNull();
    // O disco guarda o MESMO cupom e o MESMO carimbo antigo; a única diferença
    // aceitável é a etapa, que passou a ser a que a lojista está vendo (cupom).
    const antes = JSON.parse(deOntem);
    const depois = JSON.parse(armazenamento.mapa.get(CHAVE)!);
    expect({ ...depois, etapa: antes.etapa }).toEqual(antes);
    expect(depois.etapa).toBe("cupom");
  });

  it("outro dono entra na tela: o aviso do anterior não passa para ele", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(
      CHAVE,
      serializarRascunho(estadoDeOntem(), AGORA - 20 * HORA),
    );
    const aoAtualizar = await montar(armazenamento, "lojista-1");
    expect(ultimo(aoAtualizar).rascunhoAntigo).not.toBeNull();

    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            userId: "lojista-2",
            gerarChave: () => "chave-nova",
            atrasoDeGravacaoMs: 50,
          }}
          aoAtualizar={aoAtualizar}
        />,
      );
    });
    await passar(100);

    expect(ultimo(aoAtualizar).rascunhoAntigo).toBeNull();
    expect(ultimo(aoAtualizar).estado.itens).toEqual([]);
    // e o rascunho velho do primeiro dono continua intacto no disco dele
    expect(armazenamento.mapa.has(CHAVE)).toBe(true);
  });
});
