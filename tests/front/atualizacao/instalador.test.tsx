// @vitest-environment jsdom
//
// O INSTALADOR NO PONTO DE PARADA — a peça que decide QUANDO recarregar.
// Atualização obrigatória e sem botão de recusar: tudo o que protege a pessoa
// (compra, PIX, venda, formulário sujo, outras abas, loop) mora aqui, e é o que
// estes testes prendem. Os controles negativos decidem: um instalador que nunca
// instala passaria em todos os "não instala" — por isso cada bloqueio tem o
// caso irmão em que, liberado, ELE INSTALA.
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

import { AtualizacaoAdiada } from "@/lib/atualizacao/adiamento";
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
  GRACA_DE_INICIALIZACAO_MS,
  JANELA_DO_BOOT_MS,
  type OpcoesDoInstalador,
  PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS,
  useInstaladorNoPontoDeParada,
} from "@/lib/atualizacao/instalador";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  CHAVE_DA_TRAVA_DE_ATUALIZACAO,
  tentativasDaOrigem,
  tentativasFeitas,
} from "@/lib/atualizacao/trava-anti-repeticao";
import {
  momentoSeguroAgora,
  recarregarSeSeguro,
} from "@/lib/atualizacao/veto-de-recarga";
import { guardarPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── Dublê de BroadcastChannel: entrega a todos do mesmo nome, menos a quem
// enviou (como o navegador). ─────────────────────────────────────────────────
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

// ── Storages em memória ───────────────────────────────────────────────────────
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

// ── Visibilidade do documento ────────────────────────────────────────────────
let visibilidade: "visible" | "hidden" = "visible";
function definirVisibilidade(v: "visible" | "hidden") {
  visibilidade = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

const UUID = "123e4567-e89b-12d3-a456-426614174000";

type Props = Omit<
  OpcoesDoInstalador,
  "alvo" | "versaoNova" | "instalar" | "modo" | "origem"
> &
  Partial<
    Pick<OpcoesDoInstalador, "alvo" | "versaoNova" | "modo" | "origem">
  > & {
    instalar: OpcoesDoInstalador["instalar"];
  };

function Prova(props: Props) {
  useInstaladorNoPontoDeParada({
    alvo: "1.5.32-sha.novo",
    versaoNova: "1.5.32",
    modo: "instalar",
    origem: "1.31.0-sha.origem",
    fabricaDeCanal: fabrica,
    // Sem a graça de inicialização por padrão: os testes dela ligam de propósito.
    gracaDeInicializacaoMs: 0,
    ...props,
  });
  return null;
}

describe("instalador no ponto de parada", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let instalar: Mock<() => void | Promise<void>>;

  const base: Omit<Props, "instalar"> = {
    ativo: true,
    view: "home",
    adminDirty: false,
  };

  function montar(extra: Partial<Props> = {}) {
    act(() => {
      raiz.render(<Prova {...base} instalar={instalar} {...extra} />);
    });
  }
  async function esperarJanela() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
    });
  }
  async function navegarPara(view: string, extra: Partial<Props> = {}) {
    montar({ view, ...extra });
    await esperarJanela();
  }

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

  // ─── o caminho feliz e o ponto de parada ────────────────────────────────────

  it("atualização esperando: fase 'aguardando' com a versão — e NADA é instalado numa tela parada", async () => {
    montar();
    await esperarJanela();
    expect(obterEstadoDaAtualizacao()).toEqual({
      fase: "aguardando",
      versaoNova: "1.5.32",
    });
    expect(instalar).not.toHaveBeenCalled();
    // passa muito tempo parado: continua sem instalar (sem prazo máximo, sem pressa)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(instalar).not.toHaveBeenCalled();
  });

  it("trocou de tela em tela segura: instala UMA vez e a fase vira 'instalando'", async () => {
    montar();
    await navegarPara("favorites");
    expect(instalar).toHaveBeenCalledTimes(1);
    expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
    expect(obterEstadoDaAtualizacao().versaoNova).toBe("1.5.32");
  });

  it("app indo para segundo plano numa tela segura: instala", async () => {
    montar();
    await act(async () => {
      definirVisibilidade("hidden");
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
    });
    expect(instalar).toHaveBeenCalledTimes(1);
  });

  it("a atualização que chega com o app JÁ em segundo plano instala sem esperar gesto nenhum", async () => {
    visibilidade = "hidden";
    montar();
    await esperarJanela();
    expect(instalar).toHaveBeenCalledTimes(1);
  });

  it("sem atualização (ativo=false): nunca instala, nem na troca de tela, e a fase fica 'nenhuma'", async () => {
    montar({ ativo: false });
    await navegarPara("favorites", { ativo: false });
    expect(instalar).not.toHaveBeenCalled();
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
  });

  it("a atualização que deixa de existir desarma a espera (volta a 'nenhuma')", async () => {
    montar();
    expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    montar({ ativo: false });
    expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
  });

  // ─── o que nunca pode ser interrompido ──────────────────────────────────────

  it("CHECKOUT: nem trocando de tela até lá, nem com o app em segundo plano — e instala ao sair (controle)", async () => {
    montar();
    await navegarPara("checkout");
    await act(async () => {
      definirVisibilidade("hidden");
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
    });
    expect(instalar).not.toHaveBeenCalled();
    expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");

    visibilidade = "visible";
    await navegarPara("home");
    expect(instalar).toHaveBeenCalledTimes(1);
  });

  for (const tela of [
    "cart",
    "address-form",
    "order-success",
    "auth",
    "login",
  ]) {
    it(`tela de compra '${tela}': não instala`, async () => {
      montar();
      await navegarPara(tela);
      expect(instalar).not.toHaveBeenCalled();
    });
  }

  it("PDV/formulário do painel SUJO: não instala ao trocar de tela; limpo, instala (controle)", async () => {
    montar({ view: "admin-pdv", adminDirty: true });
    await navegarPara("admin-orders", { adminDirty: true });
    expect(instalar).not.toHaveBeenCalled();

    // a venda termina (adminDirty cai) e a pessoa troca de tela
    montar({ view: "admin-orders", adminDirty: false });
    await navegarPara("admin-dashboard", { adminDirty: false });
    expect(instalar).toHaveBeenCalledTimes(1);
  });

  it("PIX PENDENTE guardado na aba: não instala mesmo fora do checkout e com o app em segundo plano", async () => {
    guardarPedidoPendenteDoCheckout("u1", UUID);
    montar({ view: "profile" });
    await act(async () => {
      definirVisibilidade("hidden");
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
    });
    await navegarPara("orders");
    expect(instalar).not.toHaveBeenCalled();

    sessao.clear(); // o pedido saiu de pendente
    visibilidade = "visible";
    await navegarPara("profile");
    expect(instalar).toHaveBeenCalledTimes(1);
  });

  it("CORRIDA: a pessoa troca de tela e, DENTRO da janela de consulta, entra no carrinho — não instala", async () => {
    montar();
    montar({ view: "favorites" }); // ponto de parada: abre a consulta
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    montar({ view: "cart" }); // mudou de ideia antes de a janela fechar
    await esperarJanela();
    expect(instalar).not.toHaveBeenCalled();
  });

  it("CORRIDA: o trabalho fica sujo dentro da janela de consulta — não instala", async () => {
    montar({ view: "admin-pdv" });
    montar({ view: "admin-orders" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    montar({ view: "admin-orders", adminDirty: true });
    await esperarJanela();
    expect(instalar).not.toHaveBeenCalled();
  });

  // ─── as outras abas (cortesia) e a exclusão mútua ───────────────────────────

  describe("outras abas", () => {
    const par = (estaLivre: () => boolean) =>
      criarCoordenacaoEntreAbas({
        estaLivre,
        fabricaDeCanal: fabrica,
        alvoDeCicloDeVida: null,
      });

    it("OUTRA ABA ocupada (checkout): esta aba NÃO instala; quando a outra libera, a próxima parada instala", async () => {
      let outraLivre = false;
      const outra = par(() => outraLivre);
      montar();
      await navegarPara("favorites");
      expect(instalar).not.toHaveBeenCalled();
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");

      outraLivre = true;
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(1);
      outra.fechar();
    });

    it("par que anunciou 'ocupada' e CALOU (congelado) continua adiando; descartado após 10 min sem sinal", async () => {
      montar();
      const fantasma = new CanalDeTeste(NOME_DO_CANAL_DE_ABAS);
      fantasma.postMessage({
        tipo: "estado",
        de: "aba-congelada",
        livre: false,
      });
      await navegarPara("favorites");
      expect(instalar).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      });
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("a aba que NÃO tem atualização esperando ainda responde 'ocupada' às outras", async () => {
      montar({ ativo: false, view: "checkout" });
      const consultante = par(() => true);
      await expect(consultante.perguntarSeTodasLivres()).resolves.toBe(false);
      montar({ ativo: false, view: "home" });
      const p = consultante.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
      await expect(p).resolves.toBe(true);
      consultante.fechar();
    });

    it("a aba com PIX pendente responde 'ocupada' mesmo parada numa tela segura", async () => {
      guardarPedidoPendenteDoCheckout("u1", UUID);
      montar({ ativo: false, view: "profile" });
      const consultante = par(() => true);
      await expect(consultante.perguntarSeTodasLivres()).resolves.toBe(false);
      consultante.fechar();
    });

    it("sem BroadcastChannel nenhum: pares desconhecidos, instala pelo veto local + trava", async () => {
      montar({ fabricaDeCanal: () => null });
      await navegarPara("favorites", { fabricaDeCanal: () => null });
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("OUTRA aba já está instalando (reserva vigente no localStorage): esta NÃO instala e não gasta tentativa", async () => {
      local.set(
        CHAVE_DA_RESERVA_DE_INSTALACAO,
        JSON.stringify({ id: "outra-aba", em: Date.now() }),
      );
      montar();
      await navegarPara("favorites");
      expect(instalar).not.toHaveBeenCalled();
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(0);
    });

    it("reserva de outra aba EXPIRADA (30 s): esta instala", async () => {
      local.set(
        CHAVE_DA_RESERVA_DE_INSTALACAO,
        JSON.stringify({ id: "aba-morta", em: Date.now() - 31_000 }),
      );
      montar();
      await navegarPara("favorites");
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("ao instalar, esta aba segura a reserva; ao falhar, solta (a próxima tentativa pode vir)", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      const reserva = JSON.parse(
        local.get(CHAVE_DA_RESERVA_DE_INSTALACAO) ?? "null",
      );
      expect(reserva).toMatchObject({ id: expect.any(String) });
      // o prazo de segurança vence sem reload: solta a reserva
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS + 100,
        );
      });
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
    });
  });

  // ─── operação sensível (veto local) ─────────────────────────────────────────

  describe("operação sensível em andamento", () => {
    it("upload/fila/venda em andamento: não instala; ao terminar, a próxima parada instala (controle)", async () => {
      const desmarcar = marcarOperacaoSensivel("upload-de-imagem");
      montar();
      await navegarPara("favorites");
      await act(async () => {
        definirVisibilidade("hidden");
        await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
      });
      expect(instalar).not.toHaveBeenCalled();

      desmarcar();
      visibilidade = "visible";
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("a marca feita DENTRO da janela de consulta também veta (reavalia ao vivo)", async () => {
      montar();
      montar({ view: "favorites" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const desmarcar = marcarOperacaoSensivel("fila-offline");
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
      desmarcar();
    });

    it("a aba anuncia 'ocupada' às outras assim que a operação começa", async () => {
      montar({ ativo: false });
      const observador = criarCoordenacaoEntreAbas({
        estaLivre: () => true,
        fabricaDeCanal: fabrica,
        alvoDeCicloDeVida: null,
      });
      expect(observador.paresOcupados()).toBe(0);
      const desmarcar = marcarOperacaoSensivel("pdv-gravando-venda");
      expect(observador.paresOcupados()).toBe(1);
      desmarcar();
      expect(observador.paresOcupados()).toBe(0);
      observador.fechar();
    });

    it("modo só-recarregar também respeita (o reload do SW não fura a operação sensível)", async () => {
      const desmarcar = marcarOperacaoSensivel("upload");
      montar({ modo: "so-recarregar" });
      await navegarPara("favorites", { modo: "so-recarregar" });
      expect(instalar).not.toHaveBeenCalled();
      desmarcar();
    });
  });

  // ─── a inicialização (graça de ~8 s) ────────────────────────────────────────

  describe("graça de inicialização", () => {
    const comGraca = { gracaDeInicializacaoMs: GRACA_DE_INICIALIZACAO_MS };

    it("o padrão é ~8 s", () => {
      expect(GRACA_DE_INICIALIZACAO_MS).toBe(8000);
    });

    it("troca de tela dentro da graça: NÃO instala na hora — e instala quando a graça acaba, se continua seguro", async () => {
      montar(comGraca);
      await navegarPara("favorites", comGraca);
      expect(instalar).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          GRACA_DE_INICIALIZACAO_MS + JANELA_DE_CONSULTA_MS + 50,
        );
      });
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("se no fim da graça a pessoa já está no carrinho, NÃO instala", async () => {
      montar(comGraca);
      await navegarPara("favorites", comGraca);
      await navegarPara("cart", comGraca);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(GRACA_DE_INICIALIZACAO_MS + 1000);
      });
      expect(instalar).not.toHaveBeenCalled();
    });

    it("durante a graça a aba responde 'ocupada' às outras (o PDV ainda está restaurando o rascunho)", async () => {
      montar({ ativo: false, ...comGraca });
      const consultante = criarCoordenacaoEntreAbas({
        estaLivre: () => true,
        fabricaDeCanal: fabrica,
        alvoDeCicloDeVida: null,
      });
      await expect(consultante.perguntarSeTodasLivres()).resolves.toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(GRACA_DE_INICIALIZACAO_MS + 100);
      });
      const p = consultante.perguntarSeTodasLivres();
      await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
      await expect(p).resolves.toBe(true);
      consultante.fechar();
    });

    it("atualização obrigatória no boot respeita a mesma graça", async () => {
      montar({ pontoDeParadaInicial: true, ...comGraca });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          GRACA_DE_INICIALIZACAO_MS + JANELA_DE_CONSULTA_MS + 50,
        );
      });
      expect(instalar).toHaveBeenCalledTimes(1);
    });
  });

  // ─── a trava anti-repetição ─────────────────────────────────────────────────

  describe("trava de 2 tentativas por versão-alvo", () => {
    it("a 3ª tentativa para a MESMA versão-alvo não instala e a fase volta a 'nenhuma' (desiste em silêncio)", async () => {
      instalar.mockImplementation(() => {
        throw new Error("o SW não assumiu");
      });
      montar();
      await navegarPara("favorites");
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(2);

      await navegarPara("favorites");
      expect(instalar).toHaveBeenCalledTimes(2); // a terceira NÃO aconteceu
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
      // e não volta a tentar nas próximas paradas
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);
    });

    it("versão-alvo NOVA com a MESMA origem esgotada: NÃO tenta (o teto por build de origem não depende do alvo)", async () => {
      instalar.mockImplementation(() => {
        throw new Error("o SW não assumiu");
      });
      montar();
      await navegarPara("favorites");
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);

      const novo = { alvo: "1.5.33-sha.mais-novo", versaoNova: "1.5.33" };
      montar({ view: "home", ...novo });
      await navegarPara("favorites", novo);
      await navegarPara("home", novo);
      expect(instalar).toHaveBeenCalledTimes(2);
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("ALTERNAR a chave (versão real, desconhecida-de, lixo do realtime) NÃO dá tentativas a mais: teto de 2 saindo da mesma origem", async () => {
      instalar.mockImplementation(() => {
        throw new Error("o SW não assumiu");
      });
      const chaves = [
        { alvo: "1.5.32-sha.real", versaoNova: "1.5.32" },
        { alvo: "desconhecida-de-1.31.0-sha.origem", versaoNova: null },
        { alvo: "binary-v24", versaoNova: null },
        { alvo: "1.5.32-sha.real", versaoNova: "1.5.32" },
        { alvo: "1.5.33-sha.outra", versaoNova: "1.5.33" },
        { alvo: "desconhecida-de-1.31.0-sha.origem", versaoNova: null },
      ];
      montar(chaves[0]);
      for (const [i, chave] of chaves.entries()) {
        await navegarPara(i % 2 === 0 ? "favorites" : "home", chave);
      }
      expect(instalar).toHaveBeenCalledTimes(2);
      expect(tentativasDaOrigem("1.31.0-sha.origem")).toBe(2);
    });

    it("origem DIFERENTE (o app foi atualizado de verdade) volta a tentar", async () => {
      instalar.mockImplementation(() => {
        throw new Error("o SW não assumiu");
      });
      montar();
      await navegarPara("favorites");
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);
      const nova = { origem: "1.5.32-sha.nova", alvo: "1.5.40-sha.z" };
      montar({ view: "home", ...nova });
      await navegarPara("favorites", nova);
      expect(instalar).toHaveBeenCalledTimes(3);
    });

    it("trava já esgotada ANTES de montar (recarregou 2x e a versão não entrou): nem arma a espera", async () => {
      local.set(
        CHAVE_DA_TRAVA_DE_ATUALIZACAO,
        JSON.stringify({ alvo: "1.5.32-sha.novo", count: 2, ultimaEm: 1 }),
      );
      montar();
      await navegarPara("favorites");
      expect(instalar).not.toHaveBeenCalled();
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("a tentativa é gasta ANTES de instalar (um reload no meio já contou)", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
    });

    it("storage LANÇANDO em tudo: o instalador não cai e NÃO instala (sem confirmar a trava, não recarrega)", async () => {
      const quebrado = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
        get length(): number {
          throw new Error("SecurityError");
        },
        key: () => {
          throw new Error("SecurityError");
        },
      };
      vi.stubGlobal("localStorage", quebrado);
      vi.stubGlobal("sessionStorage", quebrado);
      montar();
      await navegarPara("favorites");
      expect(instalar).not.toHaveBeenCalled();
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("a gravação da trava não confirma (leitura de volta diferente): NÃO instala", async () => {
      vi.stubGlobal("localStorage", {
        getItem: (k: string) =>
          k === CHAVE_DA_TRAVA_DE_ATUALIZACAO ? null : (local.get(k) ?? null),
        setItem: (k: string, v: string) => {
          if (k !== CHAVE_DA_TRAVA_DE_ATUALIZACAO) local.set(k, v);
        },
        removeItem: (k: string) => {
          local.delete(k);
        },
      });
      montar();
      await navegarPara("favorites");
      expect(instalar).not.toHaveBeenCalled();
    });
  });

  // ─── recusa ANTES de começar: a tentativa é devolvida ───────────────────────

  describe("recusa agora-nao antes de apagar qualquer coisa (offline, operação sensível)", () => {
    it("instalar que lança AtualizacaoAdiada NÃO gasta tentativa: dá para recusar 10 vezes e ainda restam as 2", async () => {
      instalar.mockImplementation(() => {
        throw new AtualizacaoAdiada("sem rede agora");
      });
      montar();
      for (let i = 0; i < 10; i += 1) {
        await navegarPara(i % 2 === 0 ? "favorites" : "home");
      }
      expect(instalar).toHaveBeenCalledTimes(10);
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(0);
      expect(tentativasDaOrigem("1.31.0-sha.origem")).toBe(0);
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
    });

    it("e quando a rede volta, a tentativa acontece (duas trocas offline não esgotaram a trava)", async () => {
      let offline = true;
      instalar.mockImplementation(() => {
        if (offline) throw new AtualizacaoAdiada("sem rede agora");
      });
      montar();
      await navegarPara("favorites");
      await navegarPara("home");
      await navegarPara("favorites");
      offline = false;
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(4);
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
    });

    it("a mesma recusa vinda de uma REJEIÇÃO (a purga é assíncrona) também devolve a tentativa", async () => {
      instalar.mockImplementation(() =>
        Promise.reject(new AtualizacaoAdiada("operação sensível")),
      );
      montar();
      await navegarPara("favorites");
      await esperarJanela();
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(0);
      expect(tentativasDaOrigem("1.31.0-sha.origem")).toBe(0);
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });

    it("controle: erro comum (recusa que repetir não conserta) CONTINUA gastando a tentativa", async () => {
      instalar.mockImplementation(() => {
        throw new Error("trava da purga esgotada");
      });
      montar();
      await navegarPara("favorites");
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
    });

    it("controle: instalação pendurada (prazo de segurança) continua contando a tentativa", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS + 100,
        );
      });
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
    });
  });

  // ─── execução VENCIDA não fala pela seguinte ────────────────────────────────

  describe("callback atrasado de uma execução vencida (cada tentativa tem identidade)", () => {
    // A 1ª tentativa estoura o prazo de 15 s (conta, solta a reserva) e a 2ª
    // começa. Depois a rejeição da 1ª finalmente chega. Ela NÃO pode devolver a
    // tentativa da 2ª nem soltar a reserva da 2ª — senão uma 3ª instalação
    // começaria com a 2ª ainda pendente.
    async function ate2aTentativaEmCurso() {
      let rejeitarPrimeira: (e: unknown) => void = () => {};
      instalar
        .mockImplementationOnce(
          () =>
            new Promise<void>((_ok, rejeitar) => {
              rejeitarPrimeira = rejeitar;
            }),
        )
        .mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS + 100,
        );
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      return rejeitarPrimeira;
    }

    it("a rejeição 'agora não' ATRASADA da 1ª não devolve a tentativa da 2ª", async () => {
      const rejeitarPrimeira = await ate2aTentativaEmCurso();
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(2);
      await act(async () => {
        rejeitarPrimeira(new AtualizacaoAdiada("sem rede (atrasada)"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(2);
      expect(tentativasDaOrigem("1.31.0-sha.origem")).toBe(2);
    });

    it("...nem solta a reserva da 2ª, nem tira a fase de 'instalando', e NENHUMA 3ª instalação começa", async () => {
      const rejeitarPrimeira = await ate2aTentativaEmCurso();
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeDefined();
      await act(async () => {
        rejeitarPrimeira(new AtualizacaoAdiada("sem rede (atrasada)"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeDefined();
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      await navegarPara("favorites");
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);
    });

    it("rejeição com erro COMUM atrasada da 1ª também é ignorada (não derruba a 2ª)", async () => {
      const rejeitarPrimeira = await ate2aTentativaEmCurso();
      await act(async () => {
        rejeitarPrimeira(new Error("falha tardia"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeDefined();
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
    });

    it("controle: a rejeição da execução VIVA continua valendo (devolve a tentativa e solta a reserva)", async () => {
      let rejeitar: (e: unknown) => void = () => {};
      instalar.mockImplementation(
        () =>
          new Promise<void>((_ok, r) => {
            rejeitar = r;
          }),
      );
      montar();
      await navegarPara("favorites");
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
      await act(async () => {
        rejeitar(new AtualizacaoAdiada("sem rede"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(0);
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });
  });

  // ─── a fase nunca fica presa em "instalando" ────────────────────────────────

  describe("fase nunca presa", () => {
    it("instalar que lança de forma SÍNCRONA: volta a 'aguardando' na hora", async () => {
      instalar.mockImplementation(() => {
        throw new Error("boom");
      });
      montar();
      await navegarPara("favorites");
      expect(instalar).toHaveBeenCalledTimes(1);
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });

    it("instalar que REJEITA: volta a 'aguardando'", async () => {
      instalar.mockImplementation(() => Promise.reject(new Error("falhou")));
      montar();
      await navegarPara("favorites");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });

    it("instalar que nunca responde e a página NÃO recarrega: o prazo de segurança solta a fase", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar({ prazoDeSegurancaMs: 5000 });
      await navegarPara("favorites", { prazoDeSegurancaMs: 5000 });
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });

    it("timers CONGELADOS em segundo plano (iOS): ao voltar à tela, a fase solta sem precisar do timer", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar({ prazoDeSegurancaMs: 5000 });
      await navegarPara("favorites", { prazoDeSegurancaMs: 5000 });
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      // o relógio andou, mas o timer não disparou (página congelada)
      vi.setSystemTime(Date.now() + 60_000);
      await act(async () => {
        definirVisibilidade("visible");
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });

    it("voltar à tela ANTES do prazo não derruba uma instalação em curso", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar({ prazoDeSegurancaMs: 5000 });
      await navegarPara("favorites", { prazoDeSegurancaMs: 5000 });
      await act(async () => {
        definirVisibilidade("visible");
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
    });

    it("o prazo PADRÃO é 15 s: sem recarregar, a fase solta, a tentativa JÁ contou e a próxima parada reavalia", async () => {
      expect(PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS).toBe(15_000);
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_900);
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
      // o gate reavalia no próximo ponto de parada
      await navegarPara("home");
      expect(instalar).toHaveBeenCalledTimes(2);
    });

    it("DUAS paradas coladas: instala UMA vez só (a instalação em curso bloqueia a segunda)", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar({ prazoDeSegurancaMs: 60_000 });
      montar({ view: "favorites", prazoDeSegurancaMs: 60_000 });
      montar({ view: "search", prazoDeSegurancaMs: 60_000 });
      await esperarJanela();
      await act(async () => {
        definirVisibilidade("hidden");
        await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
      });
      expect(instalar).toHaveBeenCalledTimes(1);
    });
  });

  // ─── modo "só recarregar" (o SW já assumiu; é a rede de segurança) ──────────

  describe("modo só-recarregar (o service worker já assumiu o controle)", () => {
    it("espera o ponto de parada e NÃO consulta abas nem gasta a trava", async () => {
      const outraOcupada = criarCoordenacaoEntreAbas({
        estaLivre: () => false,
        fabricaDeCanal: fabrica,
      });
      montar({ modo: "so-recarregar" });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled(); // tela parada
      await navegarPara("favorites", { modo: "so-recarregar" });
      // a outra aba é problema da outra aba (o SW já assumiu): esta recarrega
      expect(instalar).toHaveBeenCalledTimes(1);
      expect(local.get(CHAVE_DA_TRAVA_DE_ATUALIZACAO)).toBeUndefined();
      expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
      outraOcupada.fechar();
    });

    it("mesmo assim NUNCA recarrega no checkout, com venda suja ou com PIX pendente", async () => {
      montar({ modo: "so-recarregar" });
      await navegarPara("checkout", { modo: "so-recarregar" });
      await navegarPara("admin-pdv", {
        modo: "so-recarregar",
        adminDirty: true,
      });
      expect(instalar).not.toHaveBeenCalled();
      guardarPedidoPendenteDoCheckout("u1", UUID);
      await navegarPara("profile", { modo: "so-recarregar" });
      expect(instalar).not.toHaveBeenCalled();
    });
  });

  // ─── o veto de recarga: quem recarrega por conta própria pergunta AO VIVO ────

  describe("veto de recarga (o que o apply e a purga consultam no instante do reload)", () => {
    it("o instalador montado responde pela tela de AGORA: checkout vetado, tela segura liberada", async () => {
      montar({ view: "checkout" });
      expect(momentoSeguroAgora()).toBe(false);
      montar({ view: "home" });
      expect(momentoSeguroAgora()).toBe(true);
      montar({ view: "admin-pdv", adminDirty: true });
      expect(momentoSeguroAgora()).toBe(false);
    });

    it("ao desmontar, o instalador tira o avaliador dele (nada de tela velha respondendo)", async () => {
      montar({ view: "checkout" });
      expect(momentoSeguroAgora()).toBe(false);
      act(() => raiz.unmount());
      // sem instalador: só o que o módulo sabe sozinho (nada sensível aqui)
      expect(momentoSeguroAgora()).toBe(true);
      raiz = createRoot(host);
    });

    it("a operação sensível iniciada depois também veta, ao vivo", async () => {
      montar({ view: "home" });
      expect(momentoSeguroAgora()).toBe(true);
      const desmarcar = marcarOperacaoSensivel("upload-de-imagem");
      expect(momentoSeguroAgora()).toBe(false);
      desmarcar();
      expect(momentoSeguroAgora()).toBe(true);
    });

    it("apply VETADO no meio (o SW assumiu e a pessoa estava no checkout): o gate vira só-recarregar e recarrega no próximo ponto de parada, mesmo com a 1ª execução ainda 'instalando'", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      expect(instalar).toHaveBeenCalledTimes(1);
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      const gastas = tentativasFeitas("1.5.32-sha.novo");

      // a pessoa entrou no checkout e o veto adiou a recarga: modo só-recarregar
      await navegarPara("checkout", { modo: "so-recarregar" });
      expect(instalar).toHaveBeenCalledTimes(1);
      // sai do checkout bem antes dos 15 s do prazo da 1ª execução
      await navegarPara("home", { modo: "so-recarregar" });
      expect(instalar).toHaveBeenCalledTimes(2);
      // só recarregar não gasta tentativa nenhuma
      expect(tentativasFeitas("1.5.32-sha.novo")).toBe(gastas);
    });

    // O veto de ÚLTIMO INSTANTE (a pessoa entrou no carrinho durante a purga)
    // segurava a fase em "instalando" até os 15 s do prazo: a ilha dizia
    // "Atualizando o app…" em cima do checkout e escondia sino e busca.
    describe("veto de último instante solta a fase NA HORA", () => {
      async function ateOVetoDeUltimoInstante() {
        instalar.mockImplementation(() => new Promise<void>(() => {}));
        montar();
        await navegarPara("favorites");
        expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
        // a pessoa entra no carrinho durante a purga; o reload é vetado
        montar({ view: "cart" });
        const recarregar = vi.fn();
        let recarregou = true;
        act(() => {
          recarregou = recarregarSeSeguro(recarregar);
        });
        return { recarregar, recarregou };
      }

      it("a fase deixa de ser 'instalando' no MESMO tick (não em 15 s) e volta a 'aguardando' com a versão", async () => {
        const { recarregar, recarregou } = await ateOVetoDeUltimoInstante();
        expect(recarregou).toBe(false);
        expect(recarregar).not.toHaveBeenCalled();
        expect(obterEstadoDaAtualizacao()).toEqual({
          fase: "aguardando",
          versaoNova: "1.5.32",
        });
      });

      it("libera a reserva, sem devolver nem gastar tentativa extra, e NÃO reinstala sozinho (sem laço)", async () => {
        await ateOVetoDeUltimoInstante();
        expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
        expect(local.get(CHAVE_DA_RESERVA_DE_INSTALACAO)).toBeUndefined();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(
            PRAZO_DE_SEGURANCA_DA_INSTALACAO_MS * 3,
          );
        });
        expect(instalar).toHaveBeenCalledTimes(1);
        expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
        expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
      });

      it("ao chegar o próximo ponto de parada seguro, recarrega (modo só-recarregar, sem gastar tentativa)", async () => {
        await ateOVetoDeUltimoInstante();
        await navegarPara("home", { modo: "so-recarregar" });
        expect(instalar).toHaveBeenCalledTimes(2);
        expect(tentativasFeitas("1.5.32-sha.novo")).toBe(1);
      });

      it("controle: o veto de último instante sem execução em curso não mexe na fase", async () => {
        montar();
        await esperarJanela();
        expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
        montar({ view: "cart" });
        act(() => {
          recarregarSeSeguro(vi.fn());
        });
        expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      });
    });

    it("controle: no modo 'instalar' a 2ª execução NÃO começa por cima da primeira em curso", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar();
      await navegarPara("favorites");
      await navegarPara("home");
      await navegarPara("favorites");
      expect(instalar).toHaveBeenCalledTimes(1);
    });
  });

  // ─── atualização obrigatória no boot ────────────────────────────────────────

  describe("atualização obrigatória (ponto de parada inicial)", () => {
    it("a janela do boot é de ~8 s", () => {
      expect(JANELA_DO_BOOT_MS).toBe(8000);
    });

    it("detectada DEPOIS da janela do boot (a pessoa já estava usando o app): NÃO instala na hora, espera troca de tela", async () => {
      // cenário: o dono sobe min_app_version, o realtime entrega a quem está
      // numa tela livre. Antes: a purga rodava na hora, no meio da tela.
      montar({ ativo: false });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(JANELA_DO_BOOT_MS + 1000);
      });
      montar({ ativo: true, pontoDeParadaInicial: true });
      await esperarJanela();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
      expect(instalar).not.toHaveBeenCalled();
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");

      await navegarPara("favorites", {
        ativo: true,
        pontoDeParadaInicial: true,
      });
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("detectada DENTRO dos 8 s, mas depois de a pessoa ter trocado de tela: também espera o próximo ponto de parada", async () => {
      montar({ ativo: false });
      await navegarPara("favorites", { ativo: false });
      montar({ ativo: true, pontoDeParadaInicial: true, view: "favorites" });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
      await navegarPara("home", { ativo: true, pontoDeParadaInicial: true });
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("detectada no segundo plano (documento oculto), mesmo fora do boot: é ponto de parada de verdade e instala", async () => {
      montar({ ativo: false });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(JANELA_DO_BOOT_MS + 1000);
      });
      visibilidade = "hidden";
      montar({ ativo: true, pontoDeParadaInicial: true });
      await esperarJanela();
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("no boot, em tela segura: já vale como ponto de parada e instala sem gesto", async () => {
      montar({ pontoDeParadaInicial: true });
      await esperarJanela();
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("no boot DENTRO do checkout: segura, e instala quando a pessoa sai", async () => {
      montar({ pontoDeParadaInicial: true, view: "checkout" });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
      await navegarPara("home", { pontoDeParadaInicial: true });
      expect(instalar).toHaveBeenCalledTimes(1);
    });

    it("no boot com venda suja no PDV: segura (versão mínima NÃO corta venda)", async () => {
      montar({
        pontoDeParadaInicial: true,
        view: "admin-pdv",
        adminDirty: true,
      });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
    });

    it("no boot com PIX pendente: segura", async () => {
      guardarPedidoPendenteDoCheckout("u1", UUID);
      montar({ pontoDeParadaInicial: true, view: "profile" });
      await esperarJanela();
      expect(instalar).not.toHaveBeenCalled();
    });
  });

  // ─── limpeza ────────────────────────────────────────────────────────────────

  describe("limpeza no unmount", () => {
    it("desmontar no meio da consulta às outras abas: nada é instalado depois", async () => {
      montar();
      montar({ view: "favorites" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      act(() => raiz.unmount());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 5);
      });
      expect(instalar).not.toHaveBeenCalled();
      raiz = createRoot(host);
    });

    it("desmonta limpo: sem timers, ouvinte de visibilidade removido, canal fechado, fase solta", async () => {
      const remover = vi.spyOn(document, "removeEventListener");
      montar();
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      act(() => raiz.unmount());
      expect(
        remover.mock.calls.some(([tipo]) => tipo === "visibilitychange"),
      ).toBe(true);
      expect(CanalDeTeste.todos.every((c) => c.fechado)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
      raiz = createRoot(host);

      // depois de desmontado, um evento de visibilidade não faz nada
      definirVisibilidade("hidden");
      expect(instalar).not.toHaveBeenCalled();
    });

    it("desmontar durante a instalação não deixa o watchdog vivo", async () => {
      instalar.mockImplementation(() => new Promise<void>(() => {}));
      montar({ prazoDeSegurancaMs: 5000 });
      await navegarPara("favorites", { prazoDeSegurancaMs: 5000 });
      act(() => raiz.unmount());
      expect(vi.getTimerCount()).toBe(0);
      raiz = createRoot(host);
    });
  });
});
