// @vitest-environment jsdom
//
// Promover a administrador, gancho que descobre se quem olha é o dono da loja
// (src/hooks/useDonoDaLoja.ts). A tabela dono_da_loja tem no máximo UMA linha e
// o banco só deixa ler o dono e os administradores atuais. Qualquer falha
// (tabela ausente, rede, linha vazia) vira "não sou o dono": a opção
// simplesmente não aparece, sem lançar e sem toast.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  uid: "dono-1" as string | null,
  leitura: vi.fn(),
  resposta: undefined as unknown,
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => h.from(...args),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { limparDonoDaLoja, useDonoDaLoja } from "@/hooks/useDonoDaLoja";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

let ultimo: ReturnType<typeof useDonoDaLoja> | null = null;
// Cada render que chegou ao DOM: com que usuário e o que o gancho disse.
let historico: Array<{ uid: string | null; souODono: boolean }> = [];
function Sonda() {
  const estado = useDonoDaLoja();
  useEffect(() => {
    ultimo = estado;
    historico.push({ uid: h.uid, souODono: estado.souODono });
  });
  return (
    <span data-testid="s">
      {String(estado.souODono)}|{String(estado.carregando)}
    </span>
  );
}

describe("useDonoDaLoja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.uid = "dono-1";
    ultimo = null;
    historico = [];
    limparDonoDaLoja();
    h.leitura.mockReset();
    h.resposta = undefined;
    h.from.mockReset();
    h.from.mockImplementation((tabela: string) => ({
      select: (colunas: string) => ({
        maybeSingle: () => {
          h.leitura(tabela, colunas);
          return Promise.resolve(h.resposta);
        },
      }),
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function responde(resposta: unknown) {
    h.resposta = resposta;
  }

  async function montar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await esperar(5);
    });
  }

  it("a linha da tabela é o meu id: souODono=true, carregando=false", async () => {
    responde({ data: { user_id: "dono-1" }, error: null });
    await montar();
    expect(ultimo).toMatchObject({ souODono: true, carregando: false });
    expect(h.leitura).toHaveBeenCalledWith("dono_da_loja", "user_id");
  });

  it("a linha é de outra pessoa: souODono=false", async () => {
    responde({ data: { user_id: "outro" }, error: null });
    await montar();
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });
  });

  it("linha vazia (loja sem dono cadastrado): souODono=false", async () => {
    responde({ data: null, error: null });
    await montar();
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });
  });

  it.each([
    ["PGRST205", { code: "PGRST205", message: "Could not find the table" }],
    ["42P01", { code: "42P01", message: "relation does not exist" }],
    ["404", { status: 404, message: "Not Found" }],
    ["42501", { code: "42501", message: "permission denied" }],
  ])(
    "tabela ausente/negada (%s): false, sem lançar e sem toast",
    async (_n, erro) => {
      responde({ data: null, error: erro });
      await montar();
      expect(ultimo).toMatchObject({ souODono: false, carregando: false });
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("a consulta LANÇA (rede): false, sem propagar e sem toast", async () => {
    h.from.mockImplementation(() => {
      throw new TypeError("Failed to fetch");
    });
    await montar();
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cliente de teste antigo sem maybeSingle (mock incompleto): false, sem quebrar", async () => {
    h.from.mockImplementation(() => ({ select: () => Promise.resolve({}) }));
    await montar();
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });
  });

  it("lê UMA vez por sessão: segunda montagem usa o cache", async () => {
    responde({ data: { user_id: "dono-1" }, error: null });
    await montar();
    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
    expect(ultimo).toMatchObject({ souODono: true, carregando: false });
    expect(h.from).toHaveBeenCalledTimes(1);
  });

  it("duas instâncias ao mesmo tempo dividem UMA consulta", async () => {
    responde({ data: { user_id: "dono-1" }, error: null });
    await act(async () => {
      raiz.render(
        <>
          <Sonda />
          <Sonda />
        </>,
      );
    });
    await act(async () => {
      await esperar(5);
    });
    expect(h.from).toHaveBeenCalledTimes(1);
  });

  it("falha passageira (rede) NÃO fica gravada: a próxima montagem tenta de novo", async () => {
    h.from.mockImplementationOnce(() => {
      throw new TypeError("Failed to fetch");
    });
    await montar();
    expect(ultimo?.souODono).toBe(false);
    await act(async () => raiz.unmount());
    responde({ data: { user_id: "dono-1" }, error: null });
    raiz = createRoot(hospedeiro);
    await montar();
    expect(ultimo?.souODono).toBe(true);
  });

  it("tabela ausente É definitivo: não consulta de novo", async () => {
    responde({ data: null, error: { code: "PGRST205", message: "x" } });
    await montar();
    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
    expect(h.from).toHaveBeenCalledTimes(1);
  });

  it("logout limpa: outra pessoa que entra depois não herda o dono da anterior", async () => {
    responde({ data: { user_id: "dono-1" }, error: null });
    await montar();
    expect(ultimo?.souODono).toBe(true);

    h.uid = null; // saiu
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(ultimo).toMatchObject({ souODono: false });

    h.uid = "cliente-9"; // entrou outra conta (RLS: não é admin, nada lê)
    responde({ data: null, error: null });
    await act(async () => {
      raiz.render(<Sonda key="outra" />);
    });
    await act(async () => {
      await esperar(5);
    });
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });
    expect(h.from).toHaveBeenCalledTimes(2);
  });

  it("leitura PENDENTE: carregando=true e souODono=false (carregando não é dono)", async () => {
    h.from.mockImplementation(() => ({
      select: () => ({ maybeSingle: () => new Promise(() => {}) }),
    }));
    await montar();
    expect(ultimo).toMatchObject({ souODono: false, carregando: true });
    expect(historico.every((r) => !r.souODono)).toBe(true);
  });

  it("troca DIRETA de conta (A dono -> B, sem logout): B nunca é dono, nem por um render", async () => {
    responde({ data: { user_id: "dono-1" }, error: null });
    await montar();
    expect(ultimo?.souODono).toBe(true);
    const aDoDono = historico.length;

    // B entra sem passar por logout; para B a leitura volta vazia (RLS).
    h.uid = "cliente-B";
    responde({ data: null, error: null });
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await esperar(5);
    });

    const deB = historico.slice(aDoDono).filter((r) => r.uid === "cliente-B");
    expect(deB.length).toBeGreaterThan(0);
    expect(deB.every((r) => !r.souODono)).toBe(true);
    // B foi lido de novo (a resposta de A não vale para B) e não herdou o dono de A.
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(ultimo).toMatchObject({
      souODono: false,
      carregando: false,
      donoId: null,
    });
  });

  it("sem usuário logado: false e nenhuma consulta", async () => {
    h.uid = null;
    await montar();
    expect(ultimo).toMatchObject({ souODono: false, carregando: false });
    expect(h.from).not.toHaveBeenCalled();
  });

  describe("rede que conecta e não responde (r63-b, achado 15)", () => {
    // O relógio falso entra ANTES de montar (o prazo nasce na montagem) e a
    // fila é drenada por ele mesmo: `esperar` usa setTimeout e travaria.
    async function montarComRelogioFalso() {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await act(async () => {
        raiz.render(<Sonda />);
        await vi.advanceTimersByTimeAsync(0);
      });
    }

    it("leitura pendurada: segue 'carregando' até ~12 s e então desiste, sem dono, sem toast e sem lançar", async () => {
      let tardia: (v: unknown) => void = () => {};
      h.from.mockImplementation(() => ({
        select: () => ({
          maybeSingle: () =>
            new Promise((r) => {
              tardia = r;
            }),
        }),
      }));
      await montarComRelogioFalso();
      expect(ultimo).toMatchObject({ souODono: false, carregando: true });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000);
      });
      expect(ultimo).toMatchObject({ souODono: false, carregando: true });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(ultimo).toMatchObject({
        souODono: false,
        carregando: false,
        donoId: null,
      });
      expect(toast.error).not.toHaveBeenCalled();

      // A resposta que chega TARDE (era o dono) é descartada: nem vira dono
      // nesta tela, nem fica gravada como leitura feita.
      await act(async () => {
        tardia({ data: { user_id: "dono-1" }, error: null });
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(ultimo).toMatchObject({ souODono: false, carregando: false });
      expect(historico.every((r) => !r.souODono)).toBe(true);
    });

    it("estourar o prazo NÃO é gravado: a próxima abertura lê de novo e acha o dono", async () => {
      h.from.mockImplementationOnce(() => ({
        select: () => ({ maybeSingle: () => new Promise(() => {}) }),
      }));
      await montarComRelogioFalso();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(13_000);
      });
      expect(ultimo).toMatchObject({ souODono: false, carregando: false });
      expect(h.from).toHaveBeenCalledTimes(1);

      // Abre a folha de novo (nova montagem), agora com a rede boa.
      await act(async () => raiz.unmount());
      vi.useRealTimers();
      responde({ data: { user_id: "dono-1" }, error: null });
      raiz = createRoot(hospedeiro);
      await montar();
      expect(h.from).toHaveBeenCalledTimes(2);
      expect(ultimo).toMatchObject({ souODono: true, carregando: false });
    });

    it("duas instâncias dividem a MESMA espera e as duas soltam no prazo", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      h.from.mockImplementation(() => ({
        select: () => ({ maybeSingle: () => new Promise(() => {}) }),
      }));
      await act(async () => {
        raiz.render(
          <>
            <Sonda />
            <Sonda />
          </>,
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(13_000);
      });
      expect(h.from).toHaveBeenCalledTimes(1);
      expect(ultimo).toMatchObject({ souODono: false, carregando: false });
    });

    it("resposta dentro do prazo segue igual: dono, e lê UMA vez", async () => {
      responde({ data: { user_id: "dono-1" }, error: null });
      await montar();
      expect(ultimo).toMatchObject({ souODono: true, carregando: false });
      expect(h.from).toHaveBeenCalledTimes(1);
    });
  });
});
