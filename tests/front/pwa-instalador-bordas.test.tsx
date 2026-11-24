// @vitest-environment jsdom
//
// Bordas do instalador no ponto de parada que o teste principal não alcança
// (achadas por mutação): a trava gasta por OUTRA aba durante a consulta, a
// desistência que acaba quando chega uma versão nova, o aviso de estado às
// outras abas, a consulta que não se duplica, o "voltei para o app" antes da
// graça acabar e o que o desmontar deixa para trás.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { IlhaDeAtualizacao } from "@/components/pwa/IlhaDeAtualizacao";
import {
  JANELA_DE_CONSULTA_MS,
  NOME_DO_CANAL_DE_ABAS,
  criarCoordenacaoEntreAbas,
} from "@/lib/atualizacao/coordenacao-entre-abas";
import {
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import { CHAVE_DA_RESERVA_DE_INSTALACAO } from "@/lib/atualizacao/exclusao-de-instalacao";
import {
  type OpcoesDoInstalador,
  useInstaladorNoPontoDeParada,
} from "@/lib/atualizacao/instalador";
import { CHAVE_DA_TRAVA_DE_ATUALIZACAO } from "@/lib/atualizacao/trava-anti-repeticao";
import { guardarPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Dublê de BroadcastChannel: entrega a todos do mesmo nome, menos a quem enviou.
class CanalDeTeste {
  static todos: CanalDeTeste[] = [];
  nome: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  fechado = false;
  constructor(nome: string) {
    this.nome = nome;
    CanalDeTeste.todos.push(this);
  }
  postMessage(dado: unknown) {
    for (const outro of CanalDeTeste.todos) {
      if (outro !== this && !outro.fechado && outro.nome === this.nome) {
        outro.onmessage?.({ data: dado });
      }
    }
  }
  close() {
    this.fechado = true;
  }
}
const fabrica = (nome: string) => new CanalDeTeste(nome);

const local = new Map<string, string>();
const sessao = new Map<string, string>();
const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, String(v));
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
  get length() {
    return m.size;
  },
  key: (i: number) => Array.from(m.keys()).at(i) ?? null,
});

let visibilidade: "visible" | "hidden" = "visible";
function definirVisibilidade(v: "visible" | "hidden") {
  visibilidade = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const ALVO = "1.5.32-sha.novo";

type Props = Omit<
  OpcoesDoInstalador,
  "alvo" | "versaoNova" | "modo" | "origem"
> &
  Partial<Pick<OpcoesDoInstalador, "alvo" | "versaoNova" | "modo" | "origem">>;

function Prova(props: Props) {
  useInstaladorNoPontoDeParada({
    alvo: ALVO,
    versaoNova: "1.5.32",
    modo: "instalar",
    origem: "1.31.0-sha.origem",
    fabricaDeCanal: fabrica,
    gracaDeInicializacaoMs: 0,
    ...props,
  });
  return <IlhaDeAtualizacao />;
}

/** Uma "outra aba" que só observa o que esta anuncia. */
function observarMensagens() {
  const mensagens: Array<{ tipo?: string }> = [];
  const canal = new CanalDeTeste(NOME_DO_CANAL_DE_ABAS);
  canal.onmessage = (e) => {
    mensagens.push(e.data as { tipo?: string });
  };
  return mensagens;
}

function observarOcupadas() {
  return criarCoordenacaoEntreAbas({
    estaLivre: () => true,
    fabricaDeCanal: fabrica,
    alvoDeCicloDeVida: null,
  });
}

describe("instalador — bordas", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let instalar: Mock<() => void | Promise<void>>;

  const base = { ativo: true, view: "home", adminDirty: false };

  function montar(extra: Partial<Props> = {}) {
    act(() => {
      raiz.render(<Prova {...base} instalar={instalar} {...extra} />);
    });
  }
  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  const esperarJanela = () => avancar(JANELA_DE_CONSULTA_MS + 5);

  beforeEach(() => {
    vi.useFakeTimers();
    CanalDeTeste.todos = [];
    local.clear();
    sessao.clear();
    vi.stubGlobal("localStorage", stub(local));
    vi.stubGlobal("sessionStorage", stub(sessao));
    visibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade,
    });
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    instalar = vi.fn<() => void | Promise<void>>();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
  });

  describe("trava gasta por outra aba durante a consulta", () => {
    function trava(count: number) {
      local.set(
        CHAVE_DA_TRAVA_DE_ATUALIZACAO,
        JSON.stringify({ alvo: ALVO, count, ultimaEm: Date.now() }),
      );
    }

    it("não instala, solta a reserva e passa ao aviso de 'pendente'", async () => {
      montar();
      montar({ view: "favorites" });
      // Nos 300 ms da consulta, outra aba gasta a última tentativa.
      trava(2);
      await esperarJanela();

      expect(instalar).not.toHaveBeenCalled();
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
      expect(obterEstadoDaAtualizacao().fase).toBe("pendente");
      expect(host.textContent).toContain("Atualização pendente");
    });

    it("chegando uma versão-alvo nova, a desistência anterior acaba e a próxima troca de tela instala", async () => {
      trava(2);
      montar();
      montar({ view: "favorites" });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
      expect(obterEstadoDaAtualizacao().fase).toBe("pendente");

      // O servidor passa a dizer outra versão: alvo virgem, nova vida.
      montar({
        view: "favorites",
        alvo: "1.5.33-sha.mais-nova",
        versaoNova: "1.5.33",
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      montar({
        view: "orders",
        alvo: "1.5.33-sha.mais-nova",
        versaoNova: "1.5.33",
      });
      await esperarJanela();

      expect(instalar).toHaveBeenCalledTimes(1);
    });
  });

  it("voltar para o app antes de a graça acabar cancela o 'foi para segundo plano'", async () => {
    visibilidade = "hidden";
    montar({ gracaDeInicializacaoMs: 5000 });
    // A pessoa volta: o segundo plano deixou de ser verdade.
    definirVisibilidade("visible");
    await avancar(5000 + JANELA_DE_CONSULTA_MS + 5);

    expect(instalar).not.toHaveBeenCalled();
  });

  it("controle: continuando em segundo plano depois da graça, instala", async () => {
    visibilidade = "hidden";
    montar({ gracaDeInicializacaoMs: 5000 });
    await avancar(5000 + JANELA_DE_CONSULTA_MS + 5);

    expect(instalar).toHaveBeenCalledTimes(1);
  });

  it("duas trocas de tela dentro da mesma consulta fazem UMA consulta às outras abas", async () => {
    const mensagens = observarMensagens();
    montar();
    montar({ view: "favorites" });
    montar({ view: "orders" });
    await esperarJanela();

    expect(mensagens.filter((m) => m.tipo === "consulta")).toHaveLength(1);
    expect(instalar).toHaveBeenCalledTimes(1);
  });

  describe("o que as outras abas ficam sabendo", () => {
    it("formulário que fica sujo na MESMA tela é anunciado como ocupada, e limpo volta a livre", () => {
      const outra = observarOcupadas();
      montar({ adminDirty: false });
      expect(outra.paresOcupados()).toBe(0);

      montar({ adminDirty: true });
      expect(outra.paresOcupados()).toBe(1);

      montar({ adminDirty: false });
      expect(outra.paresOcupados()).toBe(0);
      outra.fechar();
    });

    it("voltar ao app (mudança de visibilidade) reanuncia o estado atual", () => {
      const outra = observarOcupadas();
      montar({ ativo: false });
      expect(outra.paresOcupados()).toBe(0);

      // Um pedido PIX ficou pendente sem nenhum evento que avisasse as outras abas.
      guardarPedidoPendenteDoCheckout("u1", UUID);
      expect(outra.paresOcupados()).toBe(0);

      definirVisibilidade("hidden");
      expect(outra.paresOcupados()).toBe(1);
      outra.fechar();
    });
  });

  it("a fase 'instalando' não é pisada de volta para 'aguardando' quando as props mudam no meio", async () => {
    instalar = vi.fn<() => void | Promise<void>>(() => new Promise(() => {}));
    montar();
    montar({ view: "favorites" });
    await esperarJanela();
    expect(obterEstadoDaAtualizacao().fase).toBe("instalando");

    montar({ view: "favorites", versaoNova: "1.5.33" });

    expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
  });

  describe("desmontar", () => {
    it("no meio de uma instalação, solta a reserva de instalação desta aba", async () => {
      instalar = vi.fn<() => void | Promise<void>>(() => new Promise(() => {}));
      montar();
      montar({ view: "favorites" });
      await esperarJanela();
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeDefined();

      act(() => raiz.unmount());
      raiz = createRoot(host);

      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
    });

    it("quem nunca armou nada não mexe no estado que é de outra instância", () => {
      definirEstadoDaAtualizacao({ fase: "aguardando", versaoNova: "1.5.9" });
      montar({ ativo: false });

      act(() => raiz.unmount());
      raiz = createRoot(host);

      expect(obterEstadoDaAtualizacao()).toEqual({
        fase: "aguardando",
        versaoNova: "1.5.9",
      });
    });
  });
});
