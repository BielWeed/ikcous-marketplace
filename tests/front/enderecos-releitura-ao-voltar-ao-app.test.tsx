// @vitest-environment jsdom
//
// ENDEREÇOS AO VOLTAR AO APP, COM DOIS APARELHOS.
//
// A mesma conta fica aberta no tablet (B) com Carrinho e Perfil montados no
// fundo. No celular (A) a cliente corrige o CEP de "Casa", apaga um endereço e
// cadastra outro. Pedidos, favoritos e avisos já recarregavam ao voltar ao
// app; endereços eram a única exceção: o tablet seguia cotando o frete e
// mostrando a lista antiga até alguém reabrir o app. Agora a tela ATIVA relê
// ao voltar (aba que volta a ser a visível, app que volta do segundo plano
// com guarda de 30 s), no máximo uma consulta por volta e sem aviso de erro.
//
// O "outro aparelho" mexe no dublê do banco DIRETAMENTE: é o que o tablet não
// sabe. A tela da sonda faz o que Carrinho e Perfil fazem: lê ao montar e
// chama o hook de releitura.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";
import {
  INTERVALO_MIN_RELEITURA_ENDERECOS_MS,
  useReleituraDosEnderecosAoVoltar,
} from "@/hooks/useReleituraDosEnderecosAoVoltar";

const { banco, conta, avisos } = vi.hoisted(() => ({
  banco: {
    linhas: [] as Array<Record<string, unknown>>,
    falharLeitura: false,
    leituras: 0,
    // Leituras seguradas no ar: o teste decide quando (e como) respondem.
    segurar: false,
    seguradas: [] as Array<(r: unknown) => void>,
  },
  // Objeto ESTÁVEL: o `user` do auth não troca de identidade a cada render.
  conta: { usuario: { id: "conta-a" } as { id: string } | null },
  avisos: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario }),
}));
vi.mock("sonner", () => ({ toast: avisos }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia: any = {
        select: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          banco.leituras++;
          if (banco.segurar) {
            return new Promise((resolver) =>
              banco.seguradas.push(resolver),
            ).then(ok, ko);
          }
          const resposta = banco.falharLeitura
            ? { data: null, error: { message: "rede caiu" } }
            : {
                data: [...banco.linhas].sort((a, b) => {
                  if (a.is_default !== b.is_default)
                    return a.is_default ? -1 : 1;
                  return (b.created_at as number) - (a.created_at as number);
                }),
                error: null,
              };
          return Promise.resolve(resposta).then(ok, ko);
        },
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const base = {
  user_id: "conta-a",
  recipient_name: "Ana",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
};
let contador = 0;
function linha(name: string, cep: string, is_default: boolean) {
  return {
    ...base,
    id: `end-${name}`,
    name,
    cep,
    street: `Rua ${name}`,
    number: "1",
    is_default,
    created_at: ++contador,
  };
}

let estadoDaVisibilidade: "visible" | "hidden" = "visible";
function mudarVisibilidade(estado: "visible" | "hidden") {
  estadoDaVisibilidade = estado;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("endereços — releitura ao voltar ao app (dois aparelhos)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const hooks = new Map<string, Hook>();

  function Tela({ id, ativa }: { id: string; ativa: boolean }) {
    const h = useAddresses();
    hooks.set(id, h);
    const { fetchAddresses } = h;
    // Como Carrinho e Perfil: leitura ao montar (não é parte da volta).
    useEffect(() => {
      void fetchAddresses();
    }, [fetchAddresses]);
    useReleituraDosEnderecosAoVoltar(conta.usuario?.id, ativa, fetchAddresses);
    return null;
  }

  async function montar(telas: Array<{ id: string; ativa: boolean }>) {
    await act(async () => {
      raiz.render(
        telas.map((t) => <Tela key={t.id} id={t.id} ativa={t.ativa} />),
      );
    });
  }

  beforeEach(() => {
    contador = 0;
    banco.linhas = [
      linha("Casa", "38500-001", true),
      linha("Trabalho", "38500-002", false),
    ];
    banco.falharLeitura = false;
    banco.leituras = 0;
    banco.segurar = false;
    banco.seguradas.length = 0;
    conta.usuario = { id: "conta-a" };
    avisos.error.mockClear();
    hooks.clear();
    estadoDaVisibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => estadoDaVisibilidade,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const nomes = (id: string) => hooks.get(id)?.addresses.map((a) => a.name);
  const ceps = (id: string) => hooks.get(id)?.addresses.map((a) => a.cep);

  // O que o celular (A) fez enquanto o tablet estava em segundo plano.
  function celularMexeNaConta() {
    // Corrigiu o CEP de Casa, apagou Trabalho e cadastrou Sítio.
    const casa = banco.linhas.find((l) => l.name === "Casa");
    if (casa) casa.cep = "38500-999";
    banco.linhas = banco.linhas.filter((l) => l.name !== "Trabalho");
    banco.linhas.push(linha("Sítio", "38400-000", false));
  }

  async function voltarAoApp(depoisDeMs: number) {
    await act(async () => {
      mudarVisibilidade("hidden");
    });
    await act(async () => {
      vi.setSystemTime(Date.now() + depoisDeMs);
      mudarVisibilidade("visible");
    });
  }

  it("o app volta do segundo plano depois de 30 s: o tablet mostra a conta como o celular deixou, com UMA consulta", async () => {
    await montar([{ id: "carrinho", ativa: true }]);
    expect(nomes("carrinho")).toEqual(["Casa", "Trabalho"]);
    banco.leituras = 0;

    celularMexeNaConta();
    await voltarAoApp(INTERVALO_MIN_RELEITURA_ENDERECOS_MS + 1_000);

    expect(banco.leituras).toBe(1);
    expect(nomes("carrinho")).toEqual(["Casa", "Sítio"]);
    expect(ceps("carrinho")).toEqual(["38500-999", "38400-000"]);
  });

  it("voltar antes de 30 s não consulta de novo (guarda de tempo)", async () => {
    await montar([{ id: "carrinho", ativa: true }]);
    banco.leituras = 0;

    celularMexeNaConta();
    await voltarAoApp(10_000);

    expect(banco.leituras).toBe(0);
    expect(nomes("carrinho")).toEqual(["Casa", "Trabalho"]);
  });

  it("o evento de ESCONDER o app não consulta; só o de voltar", async () => {
    await montar([{ id: "carrinho", ativa: true }]);
    banco.leituras = 0;

    vi.setSystemTime(Date.now() + 60_000);
    await act(async () => {
      mudarVisibilidade("hidden");
    });

    expect(banco.leituras).toBe(0);
  });

  it("duas voltas seguidas dentro da guarda: só a primeira consulta", async () => {
    await montar([{ id: "carrinho", ativa: true }]);
    banco.leituras = 0;

    await voltarAoApp(40_000);
    await voltarAoApp(5_000);

    expect(banco.leituras).toBe(1);
  });

  it("Carrinho ativo e Perfil escondido, os dois montados: uma consulta por volta, não duas", async () => {
    await montar([
      { id: "carrinho", ativa: true },
      { id: "perfil", ativa: false },
    ]);
    banco.leituras = 0;

    celularMexeNaConta();
    await voltarAoApp(40_000);

    expect(banco.leituras).toBe(1);
    // A lista é compartilhada entre as telas da conta: a escondida também
    // já amanhece certa quando for aberta.
    expect(nomes("perfil")).toEqual(["Casa", "Sítio"]);
  });

  it("a aba escondida volta a ser a visível: relê UMA vez e mostra a conta como está", async () => {
    await montar([{ id: "perfil", ativa: false }]);
    banco.leituras = 0;

    celularMexeNaConta();
    await montar([{ id: "perfil", ativa: true }]);

    expect(banco.leituras).toBe(1);
    expect(nomes("perfil")).toEqual(["Casa", "Sítio"]);

    // Re-renderizar a aba que JÁ é a visível não relê.
    await montar([{ id: "perfil", ativa: true }]);
    expect(banco.leituras).toBe(1);
  });

  it("sem rede ao voltar: a lista que a tela tinha fica, sem aviso de erro e sem banner", async () => {
    await montar([{ id: "carrinho", ativa: true }]);
    banco.leituras = 0;

    banco.falharLeitura = true;
    await voltarAoApp(40_000);

    expect(banco.leituras).toBe(1);
    expect(nomes("carrinho")).toEqual(["Casa", "Trabalho"]);
    expect(avisos.error).not.toHaveBeenCalled();
    expect(hooks.get("carrinho")?.erroAoCarregar).toBe(false);
  });

  it("aparelho novo, sem lista lida: a releitura de fundo que invalida a de abertura NÃO engole o aviso de erro", async () => {
    // Sem cache e com a leitura de abertura ainda no ar (rede lenta).
    banco.segurar = true;
    await montar([{ id: "perfil", ativa: true }]);
    expect(banco.seguradas).toHaveLength(1);

    // O app volta do segundo plano: a releitura silenciosa nasce e a
    // consulta de abertura deixa de valer (a mais nova vence).
    await voltarAoApp(INTERVALO_MIN_RELEITURA_ENDERECOS_MS + 1_000);
    expect(banco.seguradas).toHaveLength(2);

    // A rede cai: as duas leituras voltam com erro.
    await act(async () => {
      for (const responder of banco.seguradas) {
        responder({ data: null, error: { message: "rede caiu" } });
      }
    });

    // Sem lista nenhuma para continuar mostrando, o erro TEM de aparecer:
    // calar faria o Perfil dizer "nenhum endereço" a quem tem.
    expect(hooks.get("perfil")?.erroAoCarregar).toBe(true);
    expect(avisos.error).toHaveBeenCalledWith("Erro ao carregar endereços");
  });

  it("CONTROLE: a leitura que falha ao ABRIR a tela continua avisando (a silenciosa é só a de fundo)", async () => {
    banco.falharLeitura = true;
    await montar([{ id: "carrinho", ativa: true }]);

    expect(avisos.error).toHaveBeenCalledWith("Erro ao carregar endereços");
    expect(hooks.get("carrinho")?.erroAoCarregar).toBe(true);
  });

  it("sem conta (convidado) não há o que reler", async () => {
    conta.usuario = null;
    await montar([{ id: "carrinho", ativa: true }]);
    banco.leituras = 0;

    await voltarAoApp(60_000);

    expect(banco.leituras).toBe(0);
  });

  it("a tela some: o listener sai junto (voltar ao app depois não consulta)", async () => {
    await montar([{ id: "carrinho", ativa: true }]);
    await act(async () => {
      raiz.render(null);
    });
    banco.leituras = 0;

    await voltarAoApp(60_000);

    expect(banco.leituras).toBe(0);
  });
});
