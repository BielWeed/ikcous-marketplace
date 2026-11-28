/**
 * O tempo real como o `@supabase/realtime-js` (2.117) se comporta nos três
 * pontos que importam para quem FECHA e REABRE um canal de mesmo nome — o
 * molde dos outros testes (um canal novo a cada `channel()`) esconde isto:
 *
 * 1. `channel(nome)` devolve o canal que AINDA está na lista com esse nome
 *    (`RealtimeClient.channel`: "If a channel with the same topic already
 *    exists it will be returned");
 * 2. `removeChannel` só tira o canal da lista quando a saída é confirmada
 *    (`_onClose` → `socket._remove`); até lá ele está "saindo";
 * 3. `subscribe()` só entra se o canal está FECHADO
 *    (`channelAdapter.isClosed()`); saindo, não faz nada.
 *
 * `confirmarSaidas()` é a resposta do servidor às saídas pedidas.
 */
type Ouvinte = (payload?: unknown) => void;

interface CanalFiel {
  nome: string;
  estado: "fechado" | "juntado" | "saindo";
  ouvintes: Array<{ tabela: string; ouvinte: Ouvinte }>;
  on: (tipo: string, filtro: { table: string }, ouvinte: Ouvinte) => CanalFiel;
  subscribe: (aoMudar?: (status: string) => void) => CanalFiel;
}

export function criarTempoRealFiel() {
  const lista: CanalFiel[] = [];
  const saidasPendentes: Array<() => void> = [];

  function channel(nome: string): CanalFiel {
    const existente = lista.find((c) => c.nome === nome);
    if (existente) return existente;
    const canal: CanalFiel = {
      nome,
      estado: "fechado",
      ouvintes: [],
      on: (_tipo, filtro, ouvinte) => {
        canal.ouvintes.push({ tabela: filtro.table, ouvinte });
        return canal;
      },
      subscribe: (aoMudar) => {
        if (canal.estado === "fechado") {
          canal.estado = "juntado";
          queueMicrotask(() => aoMudar?.("SUBSCRIBED"));
        }
        return canal;
      },
    };
    lista.push(canal);
    return canal;
  }

  function removeChannel(canal: CanalFiel): Promise<"ok"> {
    canal.estado = "saindo";
    return new Promise((resolve) => {
      saidasPendentes.push(() => {
        canal.estado = "fechado";
        const i = lista.indexOf(canal);
        if (i !== -1) lista.splice(i, 1);
        resolve("ok");
      });
    });
  }

  return {
    channel,
    removeChannel,
    confirmarSaidas() {
      for (const confirmar of saidasPendentes.splice(0)) confirmar();
    },
    juntados(nome: string) {
      return lista.filter((c) => c.nome === nome && c.estado === "juntado");
    },
    /** Uma mudança na tabela chega só a quem está JUNTADO, como no servidor. */
    emitir(tabela: string) {
      for (const canal of lista) {
        if (canal.estado !== "juntado") continue;
        for (const o of canal.ouvintes) if (o.tabela === tabela) o.ouvinte();
      }
    },
  };
}
