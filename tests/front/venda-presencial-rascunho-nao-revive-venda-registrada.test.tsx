// @vitest-environment jsdom
//
// Repro dos achados da rodada de correção da tarefa C3.1 sobre o rascunho do
// caixa (src/hooks/useVendaPresencial.ts) — os que dependem de tempo real
// (debounce + timeout) e por isso não cabem no arquivo puro
// (`venda-presencial-maquina-de-estados.test.tsx`, que roda em
// `environment: "node"` de propósito: reducer e derivados são função pura).
// Este arquivo testa a MOLDURA do hook (os dois `useEffect`), não o reducer.
//
//  1. BLOQUEIA — o rascunho não é apagado quando a venda é registrada: havia
//     DOIS `useEffect` concorrendo pelo MESMO `localStorage` no mesmo
//     commit — o de gravar (um `setTimeout` já agendado num commit
//     ANTERIOR, da venda ainda em curso) e o de apagar (síncrono, disparado
//     por `estado.recibo` deixar de ser null). O apagar rodava primeiro,
//     mas o timeout de gravação disparava `atrasoDeGravacaoMs` depois e
//     REGRAVAVA o cupom vendido — com `etapa: "recibo"` e a chave de
//     idempotência já consumida. Um F5 nessa janela reabriria a tela de
//     recibo como se a venda estivesse em curso, e continuar dali levaria a
//     RPC a receber a MESMA chave já gasta (idempotência: pedido velho
//     devolvido, zero item novo gravado — dinheiro no caixa, venda que
//     nunca existe no banco).
//  2. ANTES DE CRESCER — só ABRIR a tela (sem despachar nada) já gravava um
//     rascunho do cupom inicial vazio, inclusive a chave de idempotência
//     recém-gerada: a abertura seguinte "restaurava" um cupom que nunca
//     existiu, e a chave deixava de ser "uma por cupom" para virar "uma por
//     primeira abertura da tela".
//  3. BLOQUEIA (2ª rodada) — o efeito de gravar/apagar (já unificado num só)
//     ainda rodava, no MESMO commit da montagem, contra o estado PRISTINO:
//     o efeito de leitura (declarado primeiro) despacha a restauração, mas
//     essa ação só vira `estado` de verdade no commit SEGUINTE — o efeito
//     de gravação, rodando em seguida no mesmo flush, via `cupomSemNadaAGuardar`
//     ainda `true` e apagava um rascunho válido em disco, síncrono, antes
//     mesmo de a restauração aparecer na tela. O cupom só voltava ao disco
//     `atrasoDeGravacaoMs` depois (quando o re-render com o estado
//     restaurado reagendava a gravação) — um F5/remontagem dentro dessa
//     janela cancelava o timeout no cleanup e o rascunho sumia para sempre.
//
// Mesmo padrão de tests/front/admin-cache-limpa-no-logout.test.tsx e
// tests/front/admin-product-form-draft-e-duplo-clique.test.tsx: sem
// @testing-library/react (vitest.config.ts documenta a escolha), `createRoot`
// + `act` puro do React, Sonda que reporta o hook por CALLBACK (não por
// mutação de variável fechada), fake timers para o debounce da gravação —
// ativados ANTES do render, para o `setTimeout` existir no relógio fake
// desde o commit inicial.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EstadoDaVenda,
  type OpcoesDoVendaPresencial,
  type VendaPresencialEmUso,
  estadoInicialDaVenda,
  serializarRascunho,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft";

function criarArmazenamentoEmMemoria() {
  const mapa = new Map<string, string>();
  return {
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
  readonly opcoes?: OpcoesDoVendaPresencial;
  readonly aoAtualizar: (venda: VendaPresencialEmUso) => void;
}) {
  const venda = useVendaPresencial(opcoes);
  aoAtualizar(venda);
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): VendaPresencialEmUso {
  const chamadas = aoAtualizar.mock.calls;
  return chamadas.at(-1)![0];
}

describe("useVendaPresencial — o rascunho do caixa não pode reviver uma venda já registrada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("registrar a venda apaga o rascunho, e o debounce já agendado antes não regrava a chave depois", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            gerarChave: () => "chave-fixa",
            atrasoDeGravacaoMs: 50,
          }}
          aoAtualizar={aoAtualizar}
        />,
      );
    });

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

    await act(async () => {
      ultimoEstado(aoAtualizar).despachar({
        tipo: "item_adicionado_manualmente",
        item,
        em: 0,
      });
    });
    await act(async () => {
      ultimoEstado(aoAtualizar).despachar({
        tipo: "pagamento_escolhido",
        pagamento: "cash",
      });
    });

    // Deixa o debounce (50ms) gravar o rascunho do cupom ainda em curso —
    // é o timeout que, no defeito original, sobrevivia ao registro da venda.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).not.toBeNull();

    // Registra a venda: no MESMO commit o rascunho tem de sumir.
    await act(async () => {
      ultimoEstado(aoAtualizar).despachar({
        tipo: "venda_registrada",
        recibo: {
          orderId: "ped-1",
          numero: "PED001",
          criadoEm: new Date(0).toISOString(),
          total: 10,
          subtotal: 10,
          desconto: 0,
          pagamento: "cash",
          cliente: { tipo: "sem_cliente" },
          itens: [],
          jaExistia: false,
        },
      });
    });

    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).toBeNull();

    // A prova do achado BLOQUEIA: passado o mesmo atraso de novo (tempo de
    // sobra para qualquer timeout de gravação que ainda estivesse pendurado
    // de antes do registro), a chave continua apagada — não regrava sozinha.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
  });

  it("só abrir a tela sem despachar nada não grava rascunho — a próxima abertura não pode 'restaurar' um cupom que nunca existiu", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const aoAtualizarA = vi.fn();

    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            gerarChave: () => "K1",
            atrasoDeGravacaoMs: 50,
          }}
          aoAtualizar={aoAtualizarA}
        />,
      );
    });

    // Tempo de sobra para o debounce disparar, se algo tivesse sido
    // agendado só por causa da montagem.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).toBeNull();

    // Segunda "abertura" (outra montagem, MESMA storage): sem nada gravado,
    // não há o que restaurar.
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    const aoAtualizarB = vi.fn();
    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            gerarChave: () => "K2",
            atrasoDeGravacaoMs: 50,
          }}
          aoAtualizar={aoAtualizarB}
        />,
      );
    });

    const segunda = ultimoEstado(aoAtualizarB);
    expect(segunda.restaurado).toBe(false);
    expect(segunda.estado.chaveDeIdempotencia).toBe("K2");
    expect(segunda.estado.itens).toHaveLength(0);
  });

  it("montar com um rascunho válido em disco NÃO apaga o rascunho — nem no instante da montagem, nem depois do debounce", async () => {
    // Achado BLOQUEIA (2ª rodada, o que sobrou depois de unificar os dois
    // efeitos): medido em /tmp/repro/tests/revisao-c31.test.tsx (caso A) e
    // /tmp/repro/tests/revisao-c31-b.test.tsx. A asserção que importa é a
    // PRIMEIRA — logo após `act(...)` da montagem, ANTES de qualquer
    // `advanceTimersByTime` — porque o defeito original apagava o
    // rascunho SÍNCRONO, no mesmo commit, sem precisar de tempo nenhum
    // passar.
    const armazenamento = criarArmazenamentoEmMemoria();
    const itemSalvo = {
      chave: "prod-1::",
      productId: "prod-1",
      variantId: null,
      nome: "Caneca",
      variacao: null,
      preco: 10,
      quantidade: 2,
      estoque: 5,
      imagem: "",
    };
    const rascunhoEmDisco: EstadoDaVenda = {
      ...estadoInicialDaVenda(() => "K-RASCUNHO"),
      itens: [itemSalvo],
      pagamento: "cash",
    };
    armazenamento.setItem(
      CHAVE_DO_RASCUNHO,
      serializarRascunho(rascunhoEmDisco),
    );

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            gerarChave: () => "K-NOVA",
            atrasoDeGravacaoMs: 300,
          }}
          aoAtualizar={aoAtualizar}
        />,
      );
    });

    // A prova do achado: IMEDIATAMENTE após a montagem, sem avançar
    // nenhum timer, o rascunho continua em disco e o hook já restaurou o
    // item em memória — as duas coisas TÊM de ser verdade ao mesmo tempo.
    expect(armazenamento.getItem(CHAVE_DO_RASCUNHO)).not.toBeNull();
    expect(ultimoEstado(aoAtualizar).restaurado).toBe(true);
    expect(ultimoEstado(aoAtualizar).estado.itens).toHaveLength(1);

    // Desmonta DENTRO da janela do debounce (100ms de 300ms) — no defeito
    // original, isto era o momento em que o cleanup cancelava o único
    // `setTimeout` de gravação pendente e o cupom sumia para sempre.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      raiz.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Remonta com a MESMA storage: o rascunho continua vivo e restaura de
    // novo — não "some" por causa de uma remontagem rápida.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const aoAtualizarDepoisDoF5 = vi.fn();
    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            gerarChave: () => "K-NOVA-2",
            atrasoDeGravacaoMs: 300,
          }}
          aoAtualizar={aoAtualizarDepoisDoF5}
        />,
      );
    });
    expect(ultimoEstado(aoAtualizarDepoisDoF5).restaurado).toBe(true);
    expect(ultimoEstado(aoAtualizarDepoisDoF5).estado.itens).toHaveLength(1);
  });
});
