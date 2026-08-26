// @vitest-environment jsdom
//
// Auditoria de 26/08/2026 — o selo "Operações ao Vivo"/"Moderação Ativa" do
// painel acende quando a LISTA termina de carregar, não quando o canal
// realtime está vivo. `useOrders`, dentro de `channel.subscribe`, já tratava
// os quatro status que o supabase-js entrega ali (SUBSCRIBED, CHANNEL_ERROR,
// TIMED_OUT, CLOSED) — só que NENHUM ramo tinha `setState`: o handler falava
// só com `console.*` e `handleReconnect()`. O selo não estava mal ligado; ele
// não tinha a que se ligar.
//
// Achado BLOQUEANTE da revisão desta mesma correção (26/08/2026): B1 (o
// estado congela em "conectado" para sempre quando a instância CRIADORA do
// canal desmonta e outra reaproveita o mesmo canal físico), C1 (a entrada
// do mapa nunca era apagada — remount depois de perder rede lia um "verde"
// vencido) e C2 (a aba NÃO-LÍDER nunca escrevia estado — ficava
// "conectando" para sempre, mesmo recebendo pedido de verdade pelo
// BroadcastChannel), mais um mutante que sobrevivia (`statusAtual:
// entryFinal.status` trocado pelo literal fixo "conectando").
//
// Este arquivo tem duas partes:
//
// 1. Funções puras, testáveis sem montar o WebSocket inteiro — mesma ideia
//    de `use-orders-reconexao-nao-zera-lista-do-admin.test.ts`:
//    `proximoEstadoConexao`, `assinarStatusConexao`/`definirStatusConexao`,
//    `podeEscreverStatusDoCanal` (B1), `limparStatusConexao` (C1) e
//    `processarMensagemBroadcast` (C2).
// 2. O hook `useOrders` MONTADO de verdade (com `@vitest-environment
//    jsdom`), para provar o campo do retorno, o caminho `!enabled`, e o
//    cenário do elevador do B1 de ponta a ponta — não só na peça extraída.
import { act } from "react";
import { createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Estado mutável que os dublês abaixo leem em cada chamada — mesmo padrão
// de `admin-layout-cracha-pedidos-pendentes.test.tsx` (variável de módulo
// lida de DENTRO da factory do `vi.mock`, ajustada por teste). Só a Parte 2
// (hook montado) usa isto; a Parte 1 (funções puras) não toca em rede nem
// em sessão, e por isso o `supabase` segue mockado como objeto vazio nesses
// testes — só ganha `channel`/`removeChannel` de verdade quando a Parte 2
// os invoca.
let usuarioAtual: { id: string } | null = null;
let liderAtual = true;
let ultimoCanalCriado: { on: unknown; subscribe: unknown } | null = null;
let ultimoSubscribeCb:
  | ((status: string, err?: unknown) => void | Promise<void>)
  | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: vi.fn((_id: string) => {
      const canal = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn((cb: (status: string, err?: unknown) => void) => {
          ultimoSubscribeCb = cb;
        }),
      };
      ultimoCanalCriado = canal;
      return canal;
    }),
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: liderAtual }),
}));

import {
  assinarStatusConexao,
  definirStatusConexao,
  limparStatusConexao,
  podeEscreverStatusDoCanal,
  processarMensagemBroadcast,
  proximoEstadoConexao,
  useOrders,
} from "@/hooks/useOrders";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Sonda mínima: monta `useOrders` e devolve cada resultado renderizado,
 * para o teste ler `realtimeConnectionStatus` sem precisar de UI nenhuma. */
function Sonda(props: {
  enabled: boolean;
  isAdmin: boolean;
  onResultado: (resultado: ReturnType<typeof useOrders>) => void;
}) {
  const resultado = useOrders(props.enabled, props.isAdmin);
  props.onResultado(resultado);
  return null;
}

/**
 * Captura o último resultado que a `Sonda` renderizou, por trás de um
 * GETTER — não de um `let` reatribuído dentro do fechamento de
 * `onResultado`. `let x = null` reatribuído só dentro de um callback
 * aninhado faz o `tsc` estreitar `x` para `null` (depois `never` no
 * encadeamento opcional) no escopo de fora, mesmo com a anotação de tipo
 * explícita — uma propriedade de objeto lida por getter não sofre essa
 * análise de fluxo.
 */
function criarCaptura<T>() {
  const caixa: { valor: T | null } = { valor: null };
  return {
    onResultado: (r: T) => {
      caixa.valor = r;
    },
    get valor(): T | null {
      return caixa.valor;
    },
  };
}

describe("proximoEstadoConexao — traduz o status cru do canal", () => {
  it("SUBSCRIBED vira 'conectado'", () => {
    expect(proximoEstadoConexao("SUBSCRIBED")).toBe("conectado");
  });

  it("CHANNEL_ERROR vira 'reconectando' — nunca 'desconectado', porque handleReconnect já dispara sozinho", () => {
    expect(proximoEstadoConexao("CHANNEL_ERROR")).toBe("reconectando");
  });

  it("TIMED_OUT vira 'reconectando'", () => {
    expect(proximoEstadoConexao("TIMED_OUT")).toBe("reconectando");
  });

  it("CLOSED vira 'reconectando'", () => {
    expect(proximoEstadoConexao("CLOSED")).toBe("reconectando");
  });
});

describe("assinarStatusConexao/definirStatusConexao — canal compartilhado entre instâncias", () => {
  it("canal nunca visto começa em 'conectando' — o 'ainda não sei' antes de qualquer resposta", () => {
    const { statusAtual } = assinarStatusConexao(
      "canal-inicial-nunca-visto",
      () => {},
    );
    expect(statusAtual).toBe("conectando");
  });

  it("duas instâncias do MESMO canal recebem a MESMA mudança de estado — não divergem", () => {
    // Simula duas telas montadas ao mesmo tempo (ex.: o painel de Pedidos e
    // um badge no menu), as duas chamando useOrders(true, true) e por isso
    // apontando para o MESMO channelId ("admin_order_updates").
    const channelId = "canal-duas-instancias";
    const recebidosInstanciaA: string[] = [];
    const recebidosInstanciaB: string[] = [];
    assinarStatusConexao(channelId, (s) => recebidosInstanciaA.push(s));
    assinarStatusConexao(channelId, (s) => recebidosInstanciaB.push(s));

    definirStatusConexao(channelId, "conectado");

    expect(recebidosInstanciaA).toEqual(["conectado"]);
    expect(recebidosInstanciaB).toEqual(["conectado"]);
  });

  it("a queda da conexão é visível como 'reconectando' para quem está ouvindo", () => {
    const channelId = "canal-queda-e-reconexao";
    const recebidos: string[] = [];
    assinarStatusConexao(channelId, (s) => recebidos.push(s));

    definirStatusConexao(channelId, proximoEstadoConexao("SUBSCRIBED"));
    definirStatusConexao(channelId, proximoEstadoConexao("CHANNEL_ERROR"));

    expect(recebidos).toEqual(["conectado", "reconectando"]);
  });

  it("status repetido não notifica de novo — trava de custo de render numa rede ruim", () => {
    // Uma rede ruim gera CHANNEL_ERROR várias vezes seguidas enquanto o
    // hook tenta reconectar sozinho; o estado VISÍVEL ("reconectando") não
    // muda entre uma tentativa e outra, então quem está ouvindo não pode
    // ser notificado (e re-renderizar) a cada tentativa.
    const channelId = "canal-idempotente";
    const chamadas: string[] = [];
    assinarStatusConexao(channelId, (s) => chamadas.push(s));

    definirStatusConexao(channelId, "reconectando");
    definirStatusConexao(channelId, "reconectando");
    definirStatusConexao(channelId, "reconectando");

    expect(chamadas).toEqual(["reconectando"]);
  });

  it("cancelar() para de receber atualizações — é o que o cleanup do efeito chama ao desmontar", () => {
    const channelId = "canal-cancelar";
    const recebidos: string[] = [];
    const { cancelar } = assinarStatusConexao(channelId, (s) =>
      recebidos.push(s),
    );

    definirStatusConexao(channelId, "conectado");
    cancelar();
    definirStatusConexao(channelId, "reconectando");

    expect(recebidos).toEqual(["conectado"]);
  });

  // Achado bloqueante da revisão de 26/08/2026: o mutante que troca
  // `statusAtual: entryFinal.status` por `statusAtual: "conectando"`
  // (linha fixa) sobrevivia — o único teste acima que olha `statusAtual`
  // ("canal nunca visto começa em 'conectando'") testa exatamente o caso
  // em que o valor real TAMBÉM é "conectando", então o literal cravado
  // pelo mutante bate por coincidência. Este teste monta o canal para
  // "conectado" ANTES de assinar, e é o único jeito de diferenciar "devolve
  // o status real" de "devolve sempre 'conectando'".
  it("instância que monta com o canal JÁ conectado lê 'conectado', não 'conectando' à toa — mata o mutante do literal fixo", () => {
    const channelId = "canal-ja-conectado-antes-do-mount";
    definirStatusConexao(channelId, "conectado");

    const { statusAtual } = assinarStatusConexao(channelId, () => {});

    expect(statusAtual).toBe("conectado");
  });
});

describe("podeEscreverStatusDoCanal — a guarda é por IDENTIDADE DO CANAL, nunca por instância (B1)", () => {
  // Achado B1 da revisão de 26/08/2026: `channel.subscribe` guardava a
  // escrita do estado atrás de `isUnmounting`, uma flag POR INSTÂNCIA do
  // hook (fechada sobre a execução do efeito que criou o canal). O canal
  // físico sobrevive ao desmonte de quem o criou — o remount reaproveita
  // via `refCount++` sem chamar `channel.subscribe` de novo (ver o ramo
  // `existing` de `setupRealtime`) — então o callback registrado na
  // criação continua sendo a ÚNICA fonte de status daquele canal. Guardar
  // por `isUnmounting` da instância CRIADORA congelava o estado para
  // sempre assim que ela desmontava, mesmo com outra instância viva
  // usando o MESMO canal.
  //
  // A guarda certa nunca olha para instância — só para se o canal desta
  // execução ainda é o REGISTRADO para este `channelId`.
  it("permite escrever quando o canal desta execução ainda é o canal registrado", () => {
    const canalVivo = { id: "canal-1" };
    const subscriptions = new Map([["c1", { channel: canalVivo }]]);

    expect(podeEscreverStatusDoCanal("c1", canalVivo, subscriptions)).toBe(
      true,
    );
  });

  it("recusa quando o canal desta execução já foi SUBSTITUÍDO por outro (teardown completo + recriação)", () => {
    const canalVelho = { id: "canal-velho" };
    const canalNovo = { id: "canal-novo" };
    const subscriptions = new Map([["c1", { channel: canalNovo }]]);

    expect(podeEscreverStatusDoCanal("c1", canalVelho, subscriptions)).toBe(
      false,
    );
  });

  it("recusa quando não há NADA registrado para o canal (já foi removido do mapa)", () => {
    const canal = { id: "canal-orfao" };
    const subscriptions = new Map<string, { channel: unknown }>();

    expect(podeEscreverStatusDoCanal("c1", canal, subscriptions)).toBe(false);
  });

  it("cenário do elevador (B1): a instância CRIADORA desmonta, mas o canal sobrevive via refCount — o próximo status AINDA chega a quem ficou ouvindo", () => {
    // Reproduz o cenário exato do pedido, com as peças exportadas: "Meus
    // Pedidos" cria o canal e se inscreve; desmonta (troca de tela); a
    // ficha do pedido reaproveita o MESMO canal físico e se inscreve por
    // conta própria; o socket cai — e o callback que dispara é o MESMO
    // registrado na criação, fechado sobre o `canal` físico, não sobre
    // nenhuma instância.
    const channelId = "canal-elevador";
    const canal = { id: "unico-canal-fisico" };
    const subscriptions = new Map([[channelId, { channel: canal }]]);

    const recebidosTelaAntiga: string[] = [];
    const recebidosTelaNova: string[] = [];

    const inscricaoAntiga = assinarStatusConexao(channelId, (s) =>
      recebidosTelaAntiga.push(s),
    );
    expect(inscricaoAntiga.statusAtual).toBe("conectando");

    if (podeEscreverStatusDoCanal(channelId, canal, subscriptions)) {
      definirStatusConexao(channelId, proximoEstadoConexao("SUBSCRIBED"));
    }
    expect(recebidosTelaAntiga).toEqual(["conectado"]);

    // "Meus Pedidos" desmonta: cancela a PRÓPRIA inscrição. O canal
    // físico continua registrado em `subscriptions` (refCount não zerou
    // de verdade, ou o debounce ainda não disparou) — ninguém tirou a
    // entrada de `subscriptions`.
    inscricaoAntiga.cancelar();

    // A ficha do pedido monta, reaproveitando o MESMO canal.
    const inscricaoNova = assinarStatusConexao(channelId, (s) =>
      recebidosTelaNova.push(s),
    );
    expect(inscricaoNova.statusAtual).toBe("conectado");

    // O socket cai. O callback registrado na CRIAÇÃO do canal dispara de
    // novo — com a guarda por INSTÂNCIA (o bug), isto nunca escreveria,
    // porque a instância criadora já desmontou. Com a guarda por
    // IDENTIDADE DO CANAL, o canal ainda é o registrado, e a escrita
    // acontece.
    if (podeEscreverStatusDoCanal(channelId, canal, subscriptions)) {
      definirStatusConexao(channelId, proximoEstadoConexao("CHANNEL_ERROR"));
    }

    // A tela viva (a ficha) recebe a queda — o selo NÃO fica congelado em
    // "conectado" para sempre.
    expect(recebidosTelaNova).toEqual(["reconectando"]);
  });
});

describe("limparStatusConexao — apaga a entrada quando o canal é removido de vez (C1)", () => {
  // Achado C1: nenhuma referência ao mapa fazia `delete`. Depois do
  // último canal cair e o debounce de limpeza rodar, a entrada ficava
  // parada no último status ("conectado", na maioria dos casos) — e o
  // PRÓXIMO remount, depois de perder rede por 30s, nascia com o selo
  // verde antes de qualquer canal existir.
  it("depois de limparStatusConexao, o próximo assinarStatusConexao nasce em 'conectando' — não no verde vencido", () => {
    const channelId = "canal-limpeza";
    definirStatusConexao(channelId, "conectado");
    expect(assinarStatusConexao(channelId, () => {}).statusAtual).toBe(
      "conectado",
    );

    limparStatusConexao(channelId);

    const { statusAtual } = assinarStatusConexao(channelId, () => {});
    expect(statusAtual).toBe("conectando");
  });
});

describe("processarMensagemBroadcast — a saúde do socket da aba NÃO-LÍDER é a saúde do socket do LÍDER (C2)", () => {
  // Achado C2: o ramo não-líder nunca chamava `definirStatusConexao` — a
  // semente ficava em "conectando" para sempre, mesmo essa aba recebendo
  // atualização de pedido de verdade pelo BroadcastChannel. Com zero
  // consumidor a régua tolerava; com três telas ligadas ao campo, um selo
  // que nunca sai de "conectando…" ensina a pessoa a ignorar TODOS os
  // selos, inclusive o da aba líder, onde ele está certo.
  it("líder recebe conn_status_request e responde com o status ATUAL", () => {
    const responder = vi.fn();
    processarMensagemBroadcast(
      { type: "conn_status_request", channelId: "c1" },
      "c1",
      true,
      { onEvent: vi.fn(), definirStatus: vi.fn(), responderStatusAtual: responder },
    );
    expect(responder).toHaveBeenCalledTimes(1);
  });

  it("não-líder IGNORA conn_status_request — só quem tem o socket sabe responder", () => {
    const responder = vi.fn();
    processarMensagemBroadcast(
      { type: "conn_status_request", channelId: "c1" },
      "c1",
      false,
      { onEvent: vi.fn(), definirStatus: vi.fn(), responderStatusAtual: responder },
    );
    expect(responder).not.toHaveBeenCalled();
  });

  it("não-líder GRAVA o conn_status recebido — é assim que o selo dela deixa de ficar preso em 'conectando'", () => {
    const definirStatus = vi.fn();
    processarMensagemBroadcast(
      { type: "conn_status", channelId: "c1", status: "conectado" },
      "c1",
      false,
      { onEvent: vi.fn(), definirStatus, responderStatusAtual: vi.fn() },
    );
    expect(definirStatus).toHaveBeenCalledWith("c1", "conectado");
  });

  it("líder IGNORA conn_status recebido — ele é a fonte, nunca o destino", () => {
    const definirStatus = vi.fn();
    processarMensagemBroadcast(
      { type: "conn_status", channelId: "c1", status: "reconectando" },
      "c1",
      true,
      { onEvent: vi.fn(), definirStatus, responderStatusAtual: vi.fn() },
    );
    expect(definirStatus).not.toHaveBeenCalled();
  });

  it("mensagem de OUTRO canal é ignorada — duas abas em pedidos diferentes não podem se contaminar", () => {
    const definirStatus = vi.fn();
    const onEvent = vi.fn();
    processarMensagemBroadcast(
      { type: "conn_status", channelId: "canal-de-outra-aba", status: "conectado" },
      "c1",
      false,
      { onEvent, definirStatus, responderStatusAtual: vi.fn() },
    );
    expect(definirStatus).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("tipo desconhecido não quebra e não chama nada — mensagem de uma versão futura do app não pode derrubar a atual", () => {
    const definirStatus = vi.fn();
    const onEvent = vi.fn();
    const responder = vi.fn();
    expect(() =>
      processarMensagemBroadcast(
        { type: "algo_que_ainda_nao_existe", channelId: "c1" },
        "c1",
        false,
        { onEvent, definirStatus, responderStatusAtual: responder },
      ),
    ).not.toThrow();
    expect(definirStatus).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(responder).not.toHaveBeenCalled();
  });

  it("order_change do não-líder continua chamando onEvent — não regride", () => {
    const onEvent = vi.fn();
    processarMensagemBroadcast(
      { type: "order_change", channelId: "c1", payload: { eventType: "UPDATE" } },
      "c1",
      false,
      { onEvent, definirStatus: vi.fn(), responderStatusAtual: vi.fn() },
    );
    expect(onEvent).toHaveBeenCalledWith({ eventType: "UPDATE" });
  });

  it("order_change do LÍDER é ignorado pelo próprio broadcast — ele já recebeu o evento direto do canal, não pelo BroadcastChannel", () => {
    const onEvent = vi.fn();
    processarMensagemBroadcast(
      { type: "order_change", channelId: "c1", payload: { eventType: "UPDATE" } },
      "c1",
      true,
      { onEvent, definirStatus: vi.fn(), responderStatusAtual: vi.fn() },
    );
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("wiring real: um listener assinado com assinarStatusConexao recebe o conn_status processado por processarMensagemBroadcast usando a função de verdade", () => {
    // Combina a peça pura com `definirStatusConexao` real (não mock) —
    // prova que a MENSAGEM que o líder manda de verdade (o mesmo formato
    // que o teardown do hook agora emite) chega a quem está ouvindo o
    // canal, não só que a função mock foi chamada.
    const channelId = "canal-wiring-c2";
    const recebidos: string[] = [];
    assinarStatusConexao(channelId, (s) => recebidos.push(s));

    processarMensagemBroadcast(
      { type: "conn_status", channelId, status: "conectado" },
      channelId,
      false,
      {
        onEvent: vi.fn(),
        definirStatus: definirStatusConexao,
        responderStatusAtual: vi.fn(),
      },
    );

    expect(recebidos).toEqual(["conectado"]);
  });
});

function stubBroadcastChannelVazio() {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
}

describe("useOrders (hook real, montado) — o campo do retorno e o caminho !enabled", () => {
  let raiz: Root | null = null;
  let hospedeiro: HTMLDivElement | null = null;

  beforeEach(() => {
    usuarioAtual = { id: "user-enabled-false" };
    liderAtual = true;
    ultimoCanalCriado = null;
    ultimoSubscribeCb = null;
    stubBroadcastChannelVazio();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
  });

  afterEach(() => {
    if (raiz) {
      act(() => {
        raiz?.unmount();
      });
      raiz = null;
    }
    hospedeiro?.remove();
    hospedeiro = null;
    vi.unstubAllGlobals();
  });

  it("enabled=false: `realtimeConnectionStatus` do retorno do hook é 'desconectado', com o nome exato que o parceiro vai consumir nas três telas", () => {
    const captura = criarCaptura<ReturnType<typeof useOrders>>();
    raiz = createRoot(hospedeiro as HTMLDivElement);
    act(() => {
      raiz?.render(
        createElement(Sonda, {
          enabled: false,
          isAdmin: false,
          onResultado: captura.onResultado,
        }),
      );
    });

    expect(captura.valor).not.toBeNull();
    expect(captura.valor?.realtimeConnectionStatus).toBe("desconectado");
    // "conectando" mentiria que uma tentativa de inscrição está em curso —
    // com enabled=false nenhuma acontece, e nenhum canal é criado.
    expect(ultimoCanalCriado).toBeNull();
  });
});

describe("useOrders (hook real, montado) — cenário do elevador reproduzido de ponta a ponta (B1)", () => {
  let raizAntiga: Root | null = null;
  let raizNova: Root | null = null;
  let hospedeiroAntigo: HTMLDivElement | null = null;
  let hospedeiroNovo: HTMLDivElement | null = null;

  beforeEach(() => {
    usuarioAtual = { id: "user-elevador-b1" };
    liderAtual = true;
    ultimoCanalCriado = null;
    ultimoSubscribeCb = null;
    stubBroadcastChannelVazio();
    hospedeiroAntigo = document.createElement("div");
    hospedeiroNovo = document.createElement("div");
    document.body.appendChild(hospedeiroAntigo);
    document.body.appendChild(hospedeiroNovo);
  });

  afterEach(() => {
    if (raizAntiga) {
      act(() => {
        raizAntiga?.unmount();
      });
      raizAntiga = null;
    }
    if (raizNova) {
      act(() => {
        raizNova?.unmount();
      });
      raizNova = null;
    }
    hospedeiroAntigo?.remove();
    hospedeiroNovo?.remove();
    hospedeiroAntigo = null;
    hospedeiroNovo = null;
    vi.unstubAllGlobals();
  });

  it("'Meus Pedidos' desmonta, a ficha do pedido reaproveita o MESMO canal, e a queda do socket AINDA chega — o selo não fica preso em 'conectado' para sempre", async () => {
    const capturaAntiga = criarCaptura<ReturnType<typeof useOrders>>();
    const capturaNova = criarCaptura<ReturnType<typeof useOrders>>();

    // 1. "Meus Pedidos" monta e cria o canal.
    raizAntiga = createRoot(hospedeiroAntigo as HTMLDivElement);
    act(() => {
      raizAntiga?.render(
        createElement(Sonda, {
          enabled: true,
          isAdmin: false,
          onResultado: capturaAntiga.onResultado,
        }),
      );
    });

    expect(ultimoCanalCriado).not.toBeNull();
    expect(ultimoSubscribeCb).not.toBeNull();

    // 2. O canal conecta.
    await act(async () => {
      await ultimoSubscribeCb?.("SUBSCRIBED");
    });
    expect(capturaAntiga.valor?.realtimeConnectionStatus).toBe("conectado");

    // 3. "Meus Pedidos" desmonta (troca de tela). O canal físico SOBREVIVE:
    // o `refCount` some para 0, mas o debounce de 4s ainda não rodou —
    // nada apagou a entrada de `globalOrderSubscriptions`.
    act(() => {
      raizAntiga?.unmount();
    });

    // 4. A ficha do pedido monta, MESMO usuário → MESMO channelId →
    // reaproveita o canal existente (refCount++, SEM chamar
    // channel.subscribe de novo).
    const canalAntesDoSegundoMount = ultimoCanalCriado;
    raizNova = createRoot(hospedeiroNovo as HTMLDivElement);
    act(() => {
      raizNova?.render(
        createElement(Sonda, {
          enabled: true,
          isAdmin: false,
          onResultado: capturaNova.onResultado,
        }),
      );
    });

    // Nenhum canal NOVO foi criado — é o mesmo objeto de antes.
    expect(ultimoCanalCriado).toBe(canalAntesDoSegundoMount);
    // A nova instância já nasce sabendo que está conectada (sincroniza com
    // o estado JÁ conhecido do canal compartilhado).
    expect(capturaNova.valor?.realtimeConnectionStatus).toBe("conectado");

    // 5. O socket cai. Quem dispara é o callback registrado na CRIAÇÃO do
    // canal — fechado sobre a instância ANTIGA, já desmontada.
    await act(async () => {
      await ultimoSubscribeCb?.("CHANNEL_ERROR", {
        message: "socket closed: 1006 (abnormal)",
      });
    });

    // A tela viva recebe a queda. Sem a correção do B1 (guarda por
    // instância em vez de por identidade do canal), isto ficaria preso em
    // "conectado" para sempre — o exato defeito da auditoria de
    // 26/08/2026.
    expect(capturaNova.valor?.realtimeConnectionStatus).toBe("reconectando");
  });
});

describe("useOrders (hook real, montado) — o líder BROADCASTA conn_status de verdade (C2, wiring real)", () => {
  let raiz: Root | null = null;
  let hospedeiro: HTMLDivElement | null = null;
  let mensagensEnviadas: Array<{ type?: unknown; [k: string]: unknown }> = [];
  // Cada teste precisa do PRÓPRIO channelId — `globalOrderSubscriptions` é
  // um mapa de MÓDULO que sobrevive entre `it`s do mesmo arquivo. Reusar o
  // mesmo user.id faria o segundo mount encontrar uma entrada "existing"
  // (refCount 0, debounce ainda não disparou) deixada pelo primeiro e
  // NUNCA chamar `channel.subscribe` de novo — o teste erraria por colisão
  // de estado entre testes, não por defeito no hook.
  let contadorDeUsuario = 0;

  beforeEach(() => {
    contadorDeUsuario += 1;
    usuarioAtual = { id: `user-c2-wiring-${contadorDeUsuario}` };
    liderAtual = true;
    ultimoCanalCriado = null;
    ultimoSubscribeCb = null;
    mensagensEnviadas = [];
    // Espião — diferente do stub vazio dos blocos acima: precisa GRAVAR o
    // que o líder manda, para provar que `channel.subscribe` de verdade
    // dispara o `postMessage`, não só que a peça pura `processarMensagemBroadcast`
    // sabe reagir a uma mensagem já pronta.
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage(data: { type?: unknown; [k: string]: unknown }) {
          mensagensEnviadas.push(data);
        }
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
  });

  afterEach(() => {
    if (raiz) {
      act(() => {
        raiz?.unmount();
      });
      raiz = null;
    }
    hospedeiro?.remove();
    hospedeiro = null;
    vi.unstubAllGlobals();
  });

  it("SUBSCRIBED dispara um postMessage conn_status/'conectado' — é o que alimenta a aba não-líder", async () => {
    const captura = criarCaptura<ReturnType<typeof useOrders>>();
    raiz = createRoot(hospedeiro as HTMLDivElement);
    act(() => {
      raiz?.render(
        createElement(Sonda, {
          enabled: true,
          isAdmin: false,
          onResultado: captura.onResultado,
        }),
      );
    });

    await act(async () => {
      await ultimoSubscribeCb?.("SUBSCRIBED");
    });

    expect(captura.valor?.realtimeConnectionStatus).toBe("conectado");
    const mensagem = mensagensEnviadas.find(
      (m) => m.type === "conn_status" && m.status === "conectado",
    );
    expect(mensagem).toBeDefined();
    expect(mensagem?.channelId).toBe(`order_updates_${usuarioAtual?.id}`);
  });

  it("CHANNEL_ERROR dispara um postMessage conn_status/'reconectando'", async () => {
    raiz = createRoot(hospedeiro as HTMLDivElement);
    act(() => {
      raiz?.render(
        createElement(Sonda, {
          enabled: true,
          isAdmin: false,
          onResultado: () => {},
        }),
      );
    });

    await act(async () => {
      await ultimoSubscribeCb?.("CHANNEL_ERROR", { message: "1006 abnormal" });
    });

    const mensagem = mensagensEnviadas.find(
      (m) => m.type === "conn_status" && m.status === "reconectando",
    );
    expect(mensagem).toBeDefined();
  });
});
