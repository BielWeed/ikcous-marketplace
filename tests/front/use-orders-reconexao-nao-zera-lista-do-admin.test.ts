// PEDIDO-030 (#83) — a reconexão não pode zerar a lista de pedidos do painel.
//
// O DEFEITO: quando o socket do realtime cai e volta (comum em 4G, ou ao trazer
// o app do segundo plano), o `useOrders` recarregava os pedidos por três
// caminhos — `handleReconnect`, `handleVisibilityChange` e `handleOnline` — e os
// três chamavam `fetchUserOrders`, que é a consulta PESSOAL: filtra por
// `user_id = o próprio admin` e sobrescreve a lista com o resultado.
//
// A lojista não compra na própria loja, então esse filtro devolve zero. O painel
// passava a mostrar "Ainda não tem nenhum pedido" enquanto a paginação continuava
// indicando várias páginas — com pedidos reais parados na fila, esperando serem
// separados. Numa loja onde o maior risco operacional é pedido parado sem
// ninguém ver, esse é o pior defeito da operação.
//
// `escolherRecargaDeReconexao` é essa decisão isolada para poder ser medida: o
// caminho de reconexão vive dentro de um efeito com WebSocket, e provar o
// comportamento dali exigiria simular o realtime inteiro — um teste que mediria
// mais o dublê do socket do que a regra em julgamento.
import { describe, expect, it, vi } from "vitest";

// Importar o módulo do hook instancia o cliente real do Supabase, que tenta
// recuperar sessão do localStorage e derruba duas rejeições não tratadas no
// runner ("storage.getItem is not a function"). O dublê corta isso: a função em
// julgamento não toca em rede nem em sessão.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { escolherRecargaDeReconexao } from "@/hooks/useOrders";

describe("escolherRecargaDeReconexao (#83)", () => {
  it("cliente comum: continua recarregando os pedidos dele", async () => {
    // Critério de aceite da issue: o cliente comum NÃO pode perder a recarga ao
    // voltar do segundo plano — é assim que ele vê o status mudar.
    const fetchUserOrders = vi.fn().mockResolvedValue([]);
    const loadOrders = vi.fn().mockResolvedValue({ orders: [], total: 0 });

    const recarregar = escolherRecargaDeReconexao({
      isAdmin: false,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: null,
    });
    await recarregar();

    expect(fetchUserOrders).toHaveBeenCalledTimes(1);
    expect(loadOrders).not.toHaveBeenCalled();
  });

  it("admin: recarrega a consulta paginada, na MESMA página e com o MESMO filtro", async () => {
    const fetchUserOrders = vi.fn().mockResolvedValue([]);
    const loadOrders = vi.fn().mockResolvedValue({ orders: [], total: 0 });

    // Ela estava na página 3, filtrando por "pending", tendo buscado "maria".
    const ultimaConsultaAdmin = [
      2,
      20,
      "pending",
      "maria",
      "2026-08-01",
      "2026-08-18",
      false,
    ] as const;

    const recarregar = escolherRecargaDeReconexao({
      isAdmin: true,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: [...ultimaConsultaAdmin],
    });
    await recarregar();

    expect(fetchUserOrders).not.toHaveBeenCalled();
    expect(loadOrders).toHaveBeenCalledTimes(1);

    const argumentos = loadOrders.mock.calls[0];
    expect(argumentos.slice(0, 6)).toEqual([
      2,
      20,
      "pending",
      "maria",
      "2026-08-01",
      "2026-08-18",
    ]);
    // O último argumento é `silent`. Forçado para true: a recarga acontece
    // sozinha, no meio da operação dela, e acender o esqueleto de carregamento
    // por cima da lista é o mesmo susto que o defeito causava.
    expect(argumentos[6]).toBe(true);
  });

  it("admin que ainda não carregou nada: não dispara consulta nenhuma", async () => {
    // Sem consulta anterior não há página nem filtro a preservar, e a tela do
    // painel carrega sozinha ao montar. Chamar com valores padrão aqui jogaria a
    // lojista de volta para a página 1 sem filtro — o mesmo tipo de estrago,
    // com outra cara.
    const fetchUserOrders = vi.fn().mockResolvedValue([]);
    const loadOrders = vi.fn().mockResolvedValue({ orders: [], total: 0 });

    const recarregar = escolherRecargaDeReconexao({
      isAdmin: true,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: null,
    });
    await recarregar();

    expect(fetchUserOrders).not.toHaveBeenCalled();
    expect(loadOrders).not.toHaveBeenCalled();
  });

  it("admin: a consulta pessoal nunca é chamada, mesmo com consulta anterior vazia", async () => {
    // Trava contra a regressão exata do #83: qualquer caminho que leve o painel
    // a chamar `fetchUserOrders` traz o "nenhum pedido" de volta.
    const fetchUserOrders = vi.fn().mockResolvedValue([]);
    const loadOrders = vi.fn().mockResolvedValue({ orders: [], total: 0 });

    const recarregar = escolherRecargaDeReconexao({
      isAdmin: true,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: [0, 20, undefined, undefined, undefined, undefined],
    });
    await recarregar();

    expect(fetchUserOrders).not.toHaveBeenCalled();
    expect(loadOrders).toHaveBeenCalledTimes(1);
    expect(loadOrders.mock.calls[0][6]).toBe(true);
  });
});
