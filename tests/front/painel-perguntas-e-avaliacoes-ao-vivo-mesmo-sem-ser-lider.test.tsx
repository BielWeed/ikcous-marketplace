// @vitest-environment jsdom
//
// Defeito: a lojista com a LOJA aberta numa aba e o PAINEL em outra não via a
// pergunta ou a avaliação nova chegar na lista do painel. A liderança é por
// ABA (fixa, não migra por visibilidade) e só a aba líder abria o canal de
// tempo real de `questions`/`answers`/`reviews`. Com a vitrine aberta primeiro
// (líder) e o painel como seguidor, a lista só atualizava ao voltar o foco
// (30 s), e o aviso repassado pela líder podia nem chegar (na página de um
// produto a líder assina com filtro de produto, e o painel não recebia).
//
// O conserto segue o precedente do `AdminLayout` (bolinhas): quando QUEM CHAMA
// é uma tela do painel (opção `independenteDaLideranca`) e a pessoa é admin, a
// aba visível assina o PRÓPRIO canal, mesmo sendo seguidora. A aba pública e a
// cliente logada continuam EXATAMENTE como eram: sem canal fora da líder
// (teto de conexões do plano).
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CanalRegistrado = {
  nome: string;
  vivo: boolean;
  tabelas: string[];
  handlers: Array<(payload: unknown) => void>;
  aoMudarOStatus: ((status: string) => void) | null;
};

const h = vi.hoisted(() => ({
  lider: false,
  user: { id: "admin-1" } as { id: string } | null,
  isAdmin: true,
  canais: [] as Array<{
    nome: string;
    vivo: boolean;
    tabelas: string[];
    handlers: Array<(payload: unknown) => void>;
    aoMudarOStatus: ((status: string) => void) | null;
  }>,
  ouvintesDoCanalEntreAbas: new Set<unknown>(),
}));

vi.mock("@/lib/canal-de-abas", () => ({
  criarCanalDeAbas: () => ({
    postMessage: vi.fn(),
    close: vi.fn(),
    addEventListener: (_tipo: string, ouvinte: unknown) =>
      h.ouvintesDoCanalEntreAbas.add(ouvinte),
    removeEventListener: (_tipo: string, ouvinte: unknown) =>
      h.ouvintesDoCanalEntreAbas.delete(ouvinte),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.user,
    profile: null,
    isAdmin: h.isAdmin,
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: h.lider }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    channel: (nome: string) => {
      const reg: CanalRegistrado = {
        nome,
        vivo: true,
        tabelas: [],
        handlers: [],
        aoMudarOStatus: null,
      };
      h.canais.push(reg);
      const canal: any = {
        __reg: reg,
        on: (_tipo: string, filtro: { table: string }, handler: any) => {
          reg.tabelas.push(filtro.table);
          reg.handlers.push(handler);
          return canal;
        },
        subscribe: (aoMudarOStatus?: (status: string) => void) => {
          reg.aoMudarOStatus = aoMudarOStatus ?? null;
          return canal;
        },
      };
      return canal;
    },
    removeChannel: (canal: any) => {
      if (canal?.__reg) canal.__reg.vivo = false;
      return Promise.resolve("ok");
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Opcoes = { independenteDaLideranca?: boolean };
type Assinar = (
  aoMudar: () => void,
  productId?: string,
  opcoes?: Opcoes,
) => () => void;

const casos = [
  {
    nome: "perguntas",
    tabelas: ["questions", "answers"],
    canalDoPainel: "questions_all_painel",
    canalDaLider: "questions_all",
    importar: async (): Promise<() => Assinar> => {
      const { useQuestions } = await import("@/hooks/useQuestions");
      return () => useQuestions().subscribeToQuestions as Assinar;
    },
  },
  {
    nome: "avaliacoes",
    tabelas: ["reviews"],
    canalDoPainel: "reviews_all_painel",
    canalDaLider: "reviews_all",
    importar: async (): Promise<() => Assinar> => {
      const { useReviews } = await import("@/hooks/useReviews");
      return () => useReviews().subscribeToReviews as Assinar;
    },
  },
];

const vivos = () => h.canais.filter((c) => c.vivo);

let visibilidade: "visible" | "hidden" = "visible";

function definirVisibilidade(estado: "visible" | "hidden") {
  visibilidade = estado;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe.each(casos)(
  "painel de $nome — tempo real sem depender da liderança",
  (caso) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;
    let aoMudar: ReturnType<typeof vi.fn>;
    let recarregar: () => void;

    beforeEach(() => {
      vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      });
      h.lider = false;
      h.user = { id: "admin-1" };
      h.isAdmin = true;
      h.canais.length = 0;
      h.ouvintesDoCanalEntreAbas.clear();
      visibilidade = "visible";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibilidade,
      });
      vi.spyOn(console, "log").mockImplementation(() => {});
      aoMudar = vi.fn();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(async () => {
      await act(async () => raiz.unmount());
      hospedeiro.remove();
      Reflect.deleteProperty(document, "visibilityState");
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    async function montar(opcoes?: Opcoes, productId?: string) {
      const usarAssinar = await caso.importar();
      function Prova() {
        const assinar = usarAssinar();
        const [, setRodada] = useState(0);
        useEffect(() => {
          recarregar = () => setRodada((n) => n + 1);
        }, []);
        useEffect(
          () => assinar(aoMudar, productId, opcoes),
          // `opcoes` é literal novo a cada render de propósito: só a função de
          // assinar (que o hook devolve estável) decide quando reassina.
          [assinar],
        );
        return null;
      }
      await act(async () => {
        raiz.render(<Prova />);
      });
    }

    function aviso() {
      act(() => {
        for (const canal of vivos()) {
          for (const handler of canal.handlers)
            handler({ eventType: "INSERT" });
        }
      });
    }

    it("seguidora do PAINEL (admin + opção) abre o próprio canal e relê quando o banco avisa", async () => {
      await montar({ independenteDaLideranca: true });

      expect(vivos().map((c) => c.nome)).toEqual([caso.canalDoPainel]);
      expect(vivos()[0].tabelas).toEqual(caso.tabelas);
      // O canal próprio é a fonte: não escuta também o repasse da líder (leria
      // duas vezes o mesmo aviso).
      expect(h.ouvintesDoCanalEntreAbas.size).toBe(0);

      aviso();

      expect(aoMudar).toHaveBeenCalledTimes(caso.tabelas.length);
    });

    it("CONTROLE: aba PÚBLICA seguidora (sem a opção) continua sem canal, só ouvindo a líder", async () => {
      await montar();

      expect(h.canais).toHaveLength(0);
      expect(h.ouvintesDoCanalEntreAbas.size).toBe(1);
    });

    it("CONTROLE: o admin na página de um produto (com productId) continua como antes, mesmo com a opção", async () => {
      await montar({ independenteDaLideranca: true }, "prod-1");

      expect(h.canais).toHaveLength(0);
      expect(h.ouvintesDoCanalEntreAbas.size).toBe(1);
    });

    it("CONTROLE: cliente logada (não admin) com a opção NÃO abre canal fora da líder", async () => {
      h.isAdmin = false;
      h.user = { id: "cliente-1" };

      await montar({ independenteDaLideranca: true });

      expect(h.canais).toHaveLength(0);
    });

    it("CONTROLE: visitante sem login, mesmo com a opção, não abre canal", async () => {
      h.user = null;
      h.isAdmin = false;

      await montar({ independenteDaLideranca: true });

      expect(h.canais).toHaveLength(0);
    });

    it("LÍDER que também é painel: um canal só, o da líder — sem canal duplicado na mesma aba", async () => {
      h.lider = true;

      await montar({ independenteDaLideranca: true });

      expect(h.canais).toHaveLength(1);
      expect(h.canais[0].nome).toBe(caso.canalDaLider);
      aviso();
      expect(aoMudar).toHaveBeenCalledTimes(caso.tabelas.length);
    });

    it("desmontar a tela fecha o canal próprio", async () => {
      await montar({ independenteDaLideranca: true });
      expect(vivos()).toHaveLength(1);

      await act(async () => raiz.render(null));

      expect(vivos()).toHaveLength(0);
      expect(h.canais).toHaveLength(1);
    });

    it("render repetido NÃO recria o canal (sem laço de reconexão)", async () => {
      await montar({ independenteDaLideranca: true });

      act(() => recarregar());
      act(() => recarregar());
      act(() => recarregar());

      expect(h.canais).toHaveLength(1);
      expect(vivos()).toHaveLength(1);
    });

    it("aba ESCONDIDA fecha o canal; ao voltar abre de novo e relê UMA vez o que passou", async () => {
      await montar({ independenteDaLideranca: true });
      // Primeira confirmação: a lista acabou de ser lida pela tela, não relê.
      act(() => vivos()[0].aoMudarOStatus?.("SUBSCRIBED"));
      expect(aoMudar).not.toHaveBeenCalled();

      definirVisibilidade("hidden");
      expect(vivos()).toHaveLength(0);

      definirVisibilidade("visible");
      expect(vivos().map((c) => c.nome)).toEqual([caso.canalDoPainel]);
      expect(h.canais).toHaveLength(2);

      act(() => vivos()[0].aoMudarOStatus?.("SUBSCRIBED"));
      expect(aoMudar).toHaveBeenCalledTimes(1);
      // Confirmação repetida, sem queda no meio, não relê de novo.
      act(() => vivos()[0].aoMudarOStatus?.("SUBSCRIBED"));
      expect(aoMudar).toHaveBeenCalledTimes(1);
    });

    it("aba que nasce ESCONDIDA não abre canal até aparecer; esconder de novo fecha", async () => {
      visibilidade = "hidden";

      await montar({ independenteDaLideranca: true });
      expect(h.canais).toHaveLength(0);

      definirVisibilidade("visible");
      expect(vivos()).toHaveLength(1);

      definirVisibilidade("hidden");
      expect(vivos()).toHaveLength(0);
    });

    it("desmontar com a aba escondida não deixa canal nem ouvinte de visibilidade", async () => {
      await montar({ independenteDaLideranca: true });
      definirVisibilidade("hidden");

      await act(async () => raiz.render(null));
      definirVisibilidade("visible");

      expect(vivos()).toHaveLength(0);
      expect(h.canais).toHaveLength(1);
    });

    it("a aba vira LÍDER no meio: o canal próprio some e fica só o da líder", async () => {
      await montar({ independenteDaLideranca: true });
      expect(vivos().map((c) => c.nome)).toEqual([caso.canalDoPainel]);

      h.lider = true;
      act(() => recarregar());

      expect(vivos().map((c) => c.nome)).toEqual([caso.canalDaLider]);
    });
  },
);
