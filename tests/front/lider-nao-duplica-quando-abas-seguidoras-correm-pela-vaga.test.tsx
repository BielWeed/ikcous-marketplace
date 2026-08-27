import { CLAIM_DELAY_WINDOW_MS } from "@/hooks/useLeaderElection";
// @vitest-environment jsdom
//
// useLeaderElection.ts:169-174 — ao receber LEADER_RESIGNED, TODAS as abas
// seguidoras chamam claimLeadership() no mesmo instante. claimLeadership()
// (linhas 50-59, no código original) é um read-check-write em localStorage
// SEM trava: duas abas leem "vazio", as duas escrevem, as duas se
// consideram líder — até o próximo heartbeat (até ~2,5s depois) desfazer o
// empate. É um defeito de baixo impacto (autocorrige sozinho) mas real: dá
// para ligar duas checagens de atualização de PWA e dois sockets de banco
// ao mesmo tempo.
//
// Como o `localStorage` não tem compare-and-swap, a correção não pode
// "travar" a leitura-decisão-escrita — só pode fazer as abas concorrentes
// RE-CONFERIREM a vaga bem antes de escrever, trocando uma colisão
// permanente (a mesma dupla de abas perdendo pra sempre) por uma colisão
// rara — sorteada de novo a cada tentativa — que se autocorrige sozinha no
// heartbeat seguinte. Não elimina a corrida, encolhe ela. `useLeaderElection.ts`
// usa `TAB_ID` e o `BroadcastChannel` como singletons de MÓDULO (comentário
// original: "prevent multiple instances and closure errors on HMR"), e por
// bom motivo — dentro de UMA aba, ~10 pontos do app chamam o hook e todos
// têm que concordar sobre quem é "esta aba". Para simular DUAS ABAS DE
// VERDADE (identidades e canais de broadcast independentes), cada aba
// simulada aqui é uma reimportação FRESCA do módulo via `vi.resetModules()`
// — o mesmo idioma já usado em auth-admin-check.test.tsx e
// favoritos-write-ahead-nunca-fica-sem-dono-em-disco.test.tsx para módulos
// com estado próprio.
//
// A CORRIDA EM SI: Node é de uma thread só — sem ajuda, a segunda aba a
// processar a mensagem SEMPRE veria a escrita da primeira e recuaria
// corretamente, e o teste passaria mesmo contra o código quebrado (é
// exatamente o alarme de "concordância entre métodos que partilham a
// premissa" da memória). Para forçar a intercalação real — as DUAS abas
// lendo "vazio" ANTES de qualquer uma escrever — o `getItem` do
// `localStorage` falso tem um gancho: a PRIMEIRA leitura da chave de líder
// depois de "armado" entrega a mensagem de renúncia à SEGUNDA aba por
// INTEIRO antes de devolver o valor (ainda obsoleto) para a primeira. É a
// mesma intercalação que duas abas em processos de verdade produziriam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx e auth-admin-check.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LEADER_KEY = "pwa_leader_tab";
const LEADER_TTL = 5000;

// Orçamento de "ninguém respondeu ao PING, a aba assume": os 120ms de
// espera pelo LEADER_ALIVE + até CLAIM_DELAY_WINDOW_MS de atraso sorteado
// antes da reivindicação + margem de segurança. Escrito aqui, e não como
// "260" solto em cada `advanceTimersByTimeAsync`, porque se
// CLAIM_DELAY_WINDOW_MS mudar este número tem que mudar junto — foi essa
// dependência escondida que deixou dois testes intermitentes quando a
// janela real (100ms) divergiu do que o teste tinha escrito à mão (200ms).
const ORCAMENTO_PING_MAIS_RECLAIM_MS = 120 + CLAIM_DELAY_WINDOW_MS + 40;

// Margem de sobra para uma reivindicação atrasada (sorteada dentro de
// [0, CLAIM_DELAY_WINDOW_MS)) terminar de se resolver depois que a vaga já
// foi disputada — mesma dependência escondida do orçamento acima: se
// CLAIM_DELAY_WINDOW_MS mudar, esta margem tem que crescer junto, senão o
// teste fica vermelho com a mensagem errada (a leitora vai desconfiar da
// eleição, não do avanço de relógio do teste).
const MARGEM_PARA_REIVINDICACAO_SE_RESOLVER_MS = CLAIM_DELAY_WINDOW_MS * 2 + 50;

// Avanço "bem além" da janela máxima do atraso sorteado — usado nas provas
// de cleanup, onde o ponto é confirmar que um timer pendente NÃO dispara:
// se ele não tivesse sido cancelado, este avanço é tempo de sobra para
// disparar mesmo assim. Também escalado com CLAIM_DELAY_WINDOW_MS pelo
// mesmo motivo.
const MARGEM_MUITO_ALEM_DA_JANELA_MS = CLAIM_DELAY_WINDOW_MS * 5;

type Mensagem = { type: string; tabId: string };
type Ouvinte = (evento: { data: Mensagem }) => void;

/** BroadcastChannel falso com fan-out DE VERDADE entre instâncias do mesmo
 * nome — diferente do stub no-op usado em outros testes (que não precisam
 * de mensagem chegando em ninguém), aqui a mensagem PRECISA circular entre
 * "abas" para o cenário existir. `entregar` também é exposto para o teste
 * poder cravar a entrega manualmente, sem depender da ordem de um
 * `queueMicrotask`. */
class CanalFalso {
  static registro = new Map<string, Set<CanalFalso>>();
  static todas: CanalFalso[] = [];

  name: string;
  private ouvintes: Ouvinte[] = [];

  constructor(name: string) {
    this.name = name;
    if (!CanalFalso.registro.has(name)) {
      CanalFalso.registro.set(name, new Set());
    }
    CanalFalso.registro.get(name)?.add(this);
    CanalFalso.todas.push(this);
  }

  addEventListener(_tipo: "message", ouvinte: Ouvinte) {
    this.ouvintes.push(ouvinte);
  }

  removeEventListener(_tipo: "message", ouvinte: Ouvinte) {
    this.ouvintes = this.ouvintes.filter((o) => o !== ouvinte);
  }

  postMessage(data: Mensagem) {
    const pares = CanalFalso.registro.get(this.name);
    if (!pares) return;
    for (const outra of pares) {
      if (outra === this) continue;
      queueMicrotask(() => outra.entregar(data));
    }
  }

  entregar(data: Mensagem) {
    for (const ouvinte of [...this.ouvintes]) ouvinte({ data });
  }

  close() {
    CanalFalso.registro.get(this.name)?.delete(this);
  }

  static reiniciar() {
    CanalFalso.registro.clear();
    CanalFalso.todas = [];
  }
}

/** localStorage falso com um gancho de leitura de uso único: quando armado,
 * a PRIMEIRA leitura da chave de líder dispara um callback do teste ANTES
 * de devolver o valor — é o que força a intercalação descrita no cabeçalho. */
function criarLocalStorageFalso() {
  const armazem = new Map<string, string>();
  let ganchoDeLeitura: (() => void) | null = null;
  return {
    getItem(chave: string) {
      const valor = armazem.get(chave) ?? null;
      if (chave === LEADER_KEY && ganchoDeLeitura) {
        const gancho = ganchoDeLeitura;
        ganchoDeLeitura = null;
        gancho();
      }
      return valor;
    },
    setItem(chave: string, valor: string) {
      armazem.set(chave, valor);
    },
    removeItem(chave: string) {
      armazem.delete(chave);
    },
    armarGanchoDeLeitura(fn: () => void) {
      ganchoDeLeitura = fn;
    },
  };
}

describe("useLeaderElection — corrida entre abas seguidoras pela vaga de líder", () => {
  let roots: Root[];
  let hosts: HTMLDivElement[];
  let storage: ReturnType<typeof criarLocalStorageFalso>;

  async function montarAba() {
    vi.resetModules();
    const mod = await import("@/hooks/useLeaderElection");
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    hosts.push(hospedeiro);
    const raiz = createRoot(hospedeiro);
    roots.push(raiz);
    const estados: Array<{ isLeader: boolean; tabId: string }> = [];
    function Sonda() {
      const { isLeader, tabId } = mod.useLeaderElection();
      estados.push({ isLeader, tabId });
      return null;
    }
    act(() => {
      raiz.render(<Sonda />);
    });
    const canal = CanalFalso.todas.at(-1);
    if (!canal) throw new Error("canal de broadcast não foi criado no mount");
    return { estados, canal, raiz };
  }

  /** Simula a aba TRAVANDO (crash, sem `beforeunload`): desmonta a raiz —
   * o efeito para de rodar (heartbeat parado, sem refresh do próprio TTL) —
   * sem passar por `onUnload`, então NENHUM `LEADER_RESIGNED` sai e a chave
   * de líder continua no localStorage com o `ts` antigo até vencer. */
  function travarAba(aba: { raiz: Root }) {
    act(() => {
      aba.raiz.unmount();
    });
    roots = roots.filter((r) => r !== aba.raiz);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    CanalFalso.reiniciar();
    storage = criarLocalStorageFalso();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("BroadcastChannel", CanalFalso);
    roots = [];
    hosts = [];
  });

  afterEach(() => {
    act(() => {
      for (const raiz of roots) raiz.unmount();
    });
    for (const host of hosts) host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("apos a lider renunciar, no maximo uma seguidora assume mesmo quando as duas leem a vaga vazia ao mesmo tempo", async () => {
    const abaA = await montarAba();
    // Ninguém respondeu ao PING de A dentro dos 120ms — A assume a liderança.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaA.estados.at(-1)?.isLeader).toBe(true);

    const abaB = await montarAba();
    const abaC = await montarAba();
    // B e C recebem o LEADER_ALIVE de A em resposta ao próprio PING e não
    // tentam reivindicar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaB.estados.at(-1)?.isLeader).toBe(false);
    expect(abaC.estados.at(-1)?.isLeader).toBe(false);

    const idA = abaA.estados[0].tabId;

    // A renuncia: o onUnload de verdade manda LEADER_RESIGNED e SÓ DEPOIS
    // limpa a chave — aqui a ordem é reproduzida manualmente para poder
    // controlar com precisão o instante em que B e C recebem o aviso.
    storage.removeItem(LEADER_KEY);

    // Arma a intercalação: a primeira leitura da chave de líder que B fizer
    // (dentro do próprio claimLeadership) entrega a MESMA renúncia para C
    // por inteiro antes de B seguir adiante — as duas leem "vazio" antes de
    // qualquer uma escrever.
    storage.armarGanchoDeLeitura(() => {
      act(() => {
        abaC.canal.entregar({ type: "LEADER_RESIGNED", tabId: idA });
      });
    });

    await act(async () => {
      abaB.canal.entregar({ type: "LEADER_RESIGNED", tabId: idA });
    });

    // Tempo para qualquer reivindicação atrasada (a correção adia a
    // re-checagem por um sorteio, não por um desempate determinístico —
    // ver o comentário de CLAIM_DELAY_WINDOW_MS em useLeaderElection.ts)
    // terminar de se resolver.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        MARGEM_PARA_REIVINDICACAO_SE_RESOLVER_MS,
      );
    });

    const lideres = [
      abaB.estados.at(-1)?.isLeader,
      abaC.estados.at(-1)?.isLeader,
    ].filter(Boolean).length;

    // Controle negativo 1 — sempre existe um líder: "nunca duas" não pode
    // ser satisfeito trivialmente por "nunca nenhuma".
    expect(lideres).toBeGreaterThanOrEqual(1);
    // O defeito em si: nunca duas ao mesmo tempo.
    expect(lideres).toBe(1);
  });

  it("controle negativo 2 — se a lider some sem renunciar, uma seguidora ainda assume quando o TTL vence", async () => {
    const abaA = await montarAba();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaA.estados.at(-1)?.isLeader).toBe(true);

    const abaB = await montarAba();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaB.estados.at(-1)?.isLeader).toBe(false);

    // A trava (crash): a raiz é desmontada sem passar por `onUnload`, então
    // nenhum LEADER_RESIGNED sai e o `ts` gravado por A para de se
    // atualizar (o heartbeat dela também parou). Só o heartbeat de B (a
    // cada 2,5s) e o TTL (5s) podem recuperar a eleição.
    travarAba(abaA);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEADER_TTL + 3000);
    });

    expect(abaB.estados.at(-1)?.isLeader).toBe(true);
  });

  // As duas provas abaixo existem porque a prova de "no maximo um lider" lá
  // em cima, sozinha, NÃO cobre o desempate. Sob `vi.useFakeTimers()` num
  // processo só, dois `setTimeout` vencidos no mesmo instante disparam
  // serializados por ordem de inserção — o segundo SEMPRE relê depois do
  // primeiro já ter escrito, não importa se o atraso de cada aba foi sorteado
  // direito ou se as duas foram para 0. Ou seja: mutar o cálculo do atraso
  // para "sempre 0" continua passando na prova de cima, porque o que ela
  // prova é o ADIAMENTO (agendar-e-reconferir), nunca o VALOR do atraso.
  // Para pegar esse mutante é preciso olhar o valor que de fato foi passado
  // ao `setTimeout`, não só o resultado final de `isLeader` — daí o espião
  // abaixo. E para "clearTimeout sumiu do cleanup" o inverso: a prova de
  // cima nunca desmonta uma aba com reivindicação pendente, então esse
  // mutante nem é exercitado; a prova depois desta cobre exatamente isso.
  it("o atraso de reivindicacao e sorteado de novo a cada tentativa, nao fica preso na mesma colisao para sempre", async () => {
    const abaA = await montarAba();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaA.estados.at(-1)?.isLeader).toBe(true);

    const abaB = await montarAba();
    const abaC = await montarAba();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaB.estados.at(-1)?.isLeader).toBe(false);
    expect(abaC.estados.at(-1)?.isLeader).toBe(false);

    const idA = abaA.estados[0].tabId;
    storage.removeItem(LEADER_KEY);

    // Espiona o setTimeout REAL (o fake-timer instalado pelo vitest) a
    // partir daqui — os únicos agendamentos que sobram sao os das duas
    // reivindicações de B e C que o resto deste teste vai disparar.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    storage.armarGanchoDeLeitura(() => {
      act(() => {
        abaC.canal.entregar({ type: "LEADER_RESIGNED", tabId: idA });
      });
    });

    await act(async () => {
      abaB.canal.entregar({ type: "LEADER_RESIGNED", tabId: idA });
    });

    // Controle: exatamente duas reivindicações foram agendadas (uma por
    // aba) — se este número não bater, o espião não está medindo o que a
    // gente pensa que está medindo.
    expect(setTimeoutSpy.mock.calls.length).toBe(2);
    const [atrasoB, atrasoC] = setTimeoutSpy.mock.calls.map(
      (chamada) => chamada[1],
    );
    setTimeoutSpy.mockRestore();

    // O achado: os dois atrasos sorteados são diferentes. Com o mutante
    // "delay sempre 0" os dois seriam exatamente 0 e esta asserção cairia.
    // Ressalva: esta asserção compara os valores CRUS que saem de
    // computeClaimDelayMs — os mesmos que o código passa para o setTimeout,
    // mas ANTES de chegarem à truncagem WebIDL que o setTimeout de um
    // navegador de verdade aplica ao argumento de atraso (ver o comentário
    // de CLAIM_DELAY_WINDOW_MS em useLeaderElection.ts: essa truncagem já
    // acontece hoje em produção, não é uma mudança hipotética de código, e
    // é ela — não um Math.floor() a mais no código-fonte — que faz duas
    // reivindicações colidirem de verdade, cerca de 1 em
    // CLAIM_DELAY_WINDOW_MS vezes). Por comparar os floats crus, e não o
    // que o setTimeout de verdade faria com eles, esta asserção não observa
    // aquela truncagem e não fica intermitente por causa dela — ela cobre
    // só "o sorteio foi refeito a cada tentativa", nunca "o sorteio colide
    // depois de truncado".
    expect(atrasoB).not.toBe(atrasoC);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        MARGEM_PARA_REIVINDICACAO_SE_RESOLVER_MS,
      );
    });
    const lideres = [
      abaB.estados.at(-1)?.isLeader,
      abaC.estados.at(-1)?.isLeader,
    ].filter(Boolean).length;
    expect(lideres).toBe(1);
  });

  it("desmontar antes do timer de reivindicacao disparar cancela a escrita (clearTimeout do cleanup)", async () => {
    const aba = await montarAba();

    // O ping (120ms) roda claimLeadership, que acha a vaga vazia e agenda o
    // timer de reivindicação (atraso entre 0 e quase CLAIM_DELAY_WINDOW_MS
    // ms). Avançamos só os 120ms do ping — SEM avançar o atraso da
    // reivindicação — e desmontamos no meio dessa janela, com o timer
    // ainda pendente.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(storage.getItem(LEADER_KEY)).toBeNull();

    act(() => {
      aba.raiz.unmount();
    });
    roots = roots.filter((r) => r !== aba.raiz);

    // Avança bem além da janela máxima do atraso (0 a quase
    // CLAIM_DELAY_WINDOW_MS ms). Se o cleanup NÃO tivesse cancelado o timer
    // pendente (mutante: clearTimeout do claimTimeoutRef removido), a
    // callback dispararia aqui mesmo com a aba desmontada e escreveria essa
    // aba fantasma como líder.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARGEM_MUITO_ALEM_DA_JANELA_MS);
    });

    expect(storage.getItem(LEADER_KEY)).toBeNull();
  });

  // A guarda `claimTimeoutRef.current === null` (useLeaderElection.ts:98)
  // não é só "não desperdiçar um timer": sem ela, uma segunda chamada de
  // claimLeadership() enquanto a primeira reivindicação ainda está pendente
  // SOBRESCREVERIA claimTimeoutRef.current com o handle do segundo timer,
  // perdendo o handle do primeiro (que continua vivo, só que órfão). Se a
  // aba desmontar depois disso, o cleanup só cancela o timer que o ref
  // aponta NAQUELE momento — o órfão dispara mesmo assim, numa aba
  // desmontada, e grava um líder fantasma. A prova de cima nunca faz duas
  // chamadas de claimLeadership() colidirem na MESMA aba, então esse
  // mutante sobrevive a ela; esta prova cobre exatamente esse buraco.
  it("segunda chamada de claimLeadership enquanto uma reivindicacao ja esta pendente nao agenda um segundo timer (guarda contra handle orfao)", async () => {
    const aba = await montarAba();

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    // O ping (120ms) roda claimLeadership, acha a vaga vazia e agenda a
    // ÚNICA reivindicação pendente.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    const agendamentosAposPing = setTimeoutSpy.mock.calls.length;
    expect(agendamentosAposPing).toBeGreaterThan(0);

    // Uma segunda chamada a claimLeadership() chega enquanto a primeira
    // reivindicação ainda está pendente — aqui, via LEADER_RESIGNED de uma
    // aba fantasma. Com a guarda, isto é um no-op: nenhum timer novo é
    // agendado e o ref continua apontando para o primeiro.
    await act(async () => {
      aba.canal.entregar({ type: "LEADER_RESIGNED", tabId: "aba-fantasma" });
    });
    expect(setTimeoutSpy.mock.calls.length).toBe(agendamentosAposPing);
    setTimeoutSpy.mockRestore();

    // Desmonta com a (única) reivindicação ainda pendente — o cleanup
    // cancela exatamente o timer que o ref aponta.
    act(() => {
      aba.raiz.unmount();
    });
    roots = roots.filter((r) => r !== aba.raiz);

    // Se a guarda tivesse sido burlada, o timer órfão da primeira chamada
    // ainda dispararia aqui, mesmo com a aba desmontada, e escreveria um
    // líder fantasma.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARGEM_MUITO_ALEM_DA_JANELA_MS);
    });

    expect(storage.getItem(LEADER_KEY)).toBeNull();
  });

  // Cobre o ramo perdedor em useLeaderElection.ts:106-108 — dentro do
  // callback da reivindicação adiada, quando a re-checagem acha que OUTRA
  // aba já escreveu a chave primeiro. Cenário: esta aba era líder; a chave
  // some por baixo dela (aqui, direto no storage, sem passar por
  // resignLeadership — simula perda por causa externa, não por renúncia);
  // uma mensagem LEADER_RESIGNED de uma aba qualquer chega e dispara
  // claimLeadership() nesta aba MESMO ela achando que ainda é líder (o
  // handler de LEADER_RESIGNED chama claimLeadership() incondicionalmente);
  // como a chave está vazia, a reivindicação é adiada; antes do timer
  // disparar, uma aba concorrente escreve a chave primeiro. Sem o
  // `updateLeadership(stillExisting.tabId === TAB_ID)` do ramo perdedor,
  // esta aba continuaria com isLeader === true — dois líderes — até o
  // heartbeat seguinte (até LEADER_TTL / 2 = 2,5s) desfazer sozinho.
  it("aba que era lider e perde a vaga pra outra durante a reivindicacao adiada se demove IMEDIATAMENTE, sem esperar o heartbeat", async () => {
    const abaX = await montarAba();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORCAMENTO_PING_MAIS_RECLAIM_MS);
    });
    expect(abaX.estados.at(-1)?.isLeader).toBe(true);

    // A chave de líder desta aba some por baixo dela — sem passar por
    // resignLeadership, então isLeaderRef desta aba continua true.
    storage.removeItem(LEADER_KEY);

    // Qualquer LEADER_RESIGNED de outra aba dispara claimLeadership() aqui
    // mesmo esta aba (erradamente) ainda se achando líder — a vaga vazia
    // agenda a reivindicação adiada.
    await act(async () => {
      abaX.canal.entregar({ type: "LEADER_RESIGNED", tabId: "aba-terceira" });
    });

    // Outra aba vence a corrida e escreve a chave ANTES do timer adiado de
    // X disparar.
    storage.setItem(
      LEADER_KEY,
      JSON.stringify({ tabId: "aba-vencedora", ts: Date.now() }),
    );

    // Avança só o bastante para o timer adiado de X disparar — bem menos
    // que os 2,5s do próximo heartbeat, para que a demoção só possa vir do
    // ramo perdedor, não do heartbeat.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        MARGEM_PARA_REIVINDICACAO_SE_RESOLVER_MS,
      );
    });

    expect(abaX.estados.at(-1)?.isLeader).toBe(false);
    // Controle: a chave continua com a aba vencedora, não foi sobrescrita
    // por X (prova que X não tentou se declarar líder de novo).
    expect(JSON.parse(storage.getItem(LEADER_KEY) ?? "null")?.tabId).toBe(
      "aba-vencedora",
    );
  });
});

// A função de atraso é pura (não depende de TAB_ID de módulo nem de
// localStorage), então testá-la direto, fora do cenário de abas, é a forma
// mais direta de pegar um mutante que zere ou congele o atraso — sem
// depender de o resto do hook conseguir observar a diferença.
describe("computeClaimDelayMs — o sorteio é redesenhado a cada chamada", () => {
  it("chamadas repetidas produzem atrasos diferentes, todos dentro da janela [0, CLAIM_DELAY_WINDOW_MS)", async () => {
    const mod = await import("@/hooks/useLeaderElection");
    const atrasos = Array.from({ length: 30 }, () => mod.computeClaimDelayMs());

    // Se o sorteio tivesse sumido ou virado constante, as 30 chamadas
    // dariam o mesmo número.
    expect(new Set(atrasos).size).toBeGreaterThan(1);

    for (const atraso of atrasos) {
      expect(atraso).toBeGreaterThanOrEqual(0);
      expect(atraso).toBeLessThan(mod.CLAIM_DELAY_WINDOW_MS);
    }
  });
});
