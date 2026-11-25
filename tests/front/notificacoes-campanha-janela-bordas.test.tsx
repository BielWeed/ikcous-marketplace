// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026): as bordas da campanha "para todos" no sino da
// cliente (src/contexts/NotificationContext.tsx: `campanhaValeParaACliente` e
// `lerEstadoLocalDaCampanha`). O teste vizinho
// (`sino-da-cliente-leitura-traduz-o-que-o-banco-grava`) prende "mesmo
// instante da conta"; aqui se prende o que ficava solto:
//   - a janela de 30 dias (vale no último milissegundo, some no seguinte);
//   - data da campanha ilegível some em vez de entrar na lista;
//   - conta sem data de criação, ou com data ilegível, NÃO esconde campanha;
//   - o estado guardado no aparelho (lidas/dispensadas) é lido por conta, e
//     um texto estragado ou de formato errado não derruba o sino.
//
// Mutantes equivalentes (sem teste possível, anotados de propósito):
//   - tirar o `contaCriadaEm ? ... : NaN` e ler `new Date(contaCriadaEm)`
//     direto: `new Date(undefined)` e `new Date("")` já dão data inválida
//     (NaN), o mesmo que o ramo trocado;
//   - tirar o `bruto ? JSON.parse(bruto) : null`: `JSON.parse(null)` é `null`;
//   - os `catch {}` que engolem a falha do localStorage só mudam o que acontece
//     com o aparelho sem armazenamento, coberto em outros testes.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { useNotificationCenter } from "@/contexts/NotificationContextCore";
import type { Notification } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date("2026-11-18T12:00:00.000Z").getTime();
const JANELA = 30 * DIA;
const em = (ms: number) => new Date(ms).toISOString();

const usuario: {
  user: { id: string; created_at?: string } | null;
  loading?: boolean;
} = { user: null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => usuario }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

type Linha = Record<string, unknown>;
let fila: Linha[][] = [];

function builder(linhas: Linha[]) {
  const b = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(async () => ({ data: linhas, error: null })),
  };
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => builder(fila.shift() ?? []),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const campanha = (id: string, criadaEm: unknown): Linha => ({
  id,
  usuario_id: null,
  titulo: `campanha ${id}`,
  mensagem: "texto",
  tipo: "aviso",
  lida: false,
  created_at: criadaEm,
});

async function montar(): Promise<Notification[]> {
  let capturado: Notification[] | null = null;
  function Sonda() {
    const { notifications } = useNotificationCenter();
    useEffect(() => {
      capturado = notifications;
    }, [notifications]);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <NotificationProvider>
        <Sonda />
      </NotificationProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const resultado = capturado as Notification[] | null;
  act(() => root.unmount());
  container.remove();
  if (!resultado) throw new Error("a sonda não leu nada");
  return resultado;
}

const chaveDoEstado = (uid: string) => `notificacoes-campanha-estado:${uid}`;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(AGORA);
  usuario.user = { id: "cliente-1", created_at: em(AGORA - 365 * DIA) };
  usuario.loading = false;
  localStorage.clear();
});
afterEach(() => {
  fila = [];
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("campanha para todos — janela de 30 dias", () => {
  it("vale no último milissegundo da janela e some no seguinte", async () => {
    fila = [
      [],
      [
        campanha("no-limite", em(AGORA - JANELA)),
        campanha("um-ms-alem", em(AGORA - JANELA - 1)),
        campanha("recente", em(AGORA - DIA)),
      ],
    ];
    const lista = await montar();
    expect(lista.map((n) => n.id).sort()).toEqual(["no-limite", "recente"]);
  });

  it("campanha de 60 dias atrás não aparece, mesmo para conta antiga", async () => {
    fila = [[], [campanha("velha", em(AGORA - 60 * DIA))]];
    expect(await montar()).toEqual([]);
  });

  it("campanha com data ilegível ou vazia não entra", async () => {
    fila = [
      [],
      [
        campanha("lixo", "isto-nao-e-data"),
        campanha("vazia", ""),
        campanha("boa", em(AGORA - DIA)),
      ],
    ];
    const lista = await montar();
    expect(lista.map((n) => n.id)).toEqual(["boa"]);
  });

  it("campanha com data ilegível não entra nem quando a conta também não tem data (o único caso em que a data da conta não a barra)", async () => {
    usuario.user = { id: "cliente-1" };
    fila = [
      [],
      [campanha("lixo", "isto-nao-e-data"), campanha("boa", em(AGORA - DIA))],
    ];
    const lista = await montar();
    expect(lista.map((n) => n.id)).toEqual(["boa"]);
  });

  it("campanha de ANTES de a conta existir não aparece, mesmo dentro dos 30 dias", async () => {
    usuario.user = { id: "cliente-1", created_at: em(AGORA - 3 * DIA) };
    fila = [
      [],
      [
        campanha("antes-da-conta", em(AGORA - 5 * DIA)),
        campanha("depois-da-conta", em(AGORA - 2 * DIA)),
      ],
    ];
    const lista = await montar();
    expect(lista.map((n) => n.id)).toEqual(["depois-da-conta"]);
  });

  it("conta SEM data de criação não esconde campanha (só vale a janela)", async () => {
    usuario.user = { id: "cliente-1" };
    fila = [
      [],
      [
        campanha("recente", em(AGORA - 2 * DIA)),
        campanha("velha", em(AGORA - 31 * DIA)),
      ],
    ];
    const lista = await montar();
    expect(lista.map((n) => n.id)).toEqual(["recente"]);
  });

  it("conta com data de criação ilegível também não esconde campanha", async () => {
    usuario.user = { id: "cliente-1", created_at: "sem-data" };
    fila = [[], [campanha("recente", em(AGORA - 2 * DIA))]];
    const lista = await montar();
    expect(lista.map((n) => n.id)).toEqual(["recente"]);
  });
});

describe("campanha para todos — estado guardado no aparelho", () => {
  it("lida e dispensada valem só para a conta que as guardou", async () => {
    localStorage.setItem(
      chaveDoEstado("outra-conta"),
      JSON.stringify({ lidas: ["c1"], ocultas: ["c2"] }),
    );
    localStorage.setItem(
      chaveDoEstado("cliente-1"),
      JSON.stringify({ lidas: ["c3"], ocultas: ["c4"] }),
    );
    fila = [
      [],
      [
        campanha("c1", em(AGORA - DIA)),
        campanha("c2", em(AGORA - 2 * DIA)),
        campanha("c3", em(AGORA - 3 * DIA)),
        campanha("c4", em(AGORA - 4 * DIA)),
      ],
    ];
    const lista = await montar();
    // c4 foi dispensada por ESTA conta; c3 está lida por ela. As marcas da
    // outra conta (c1 lida, c2 dispensada) não valem aqui.
    expect(lista.map((n) => [n.id, n.read])).toEqual([
      ["c1", false],
      ["c2", false],
      ["c3", true],
    ]);
  });

  it("texto estragado no aparelho não derruba o sino: tudo aparece, nada lido", async () => {
    localStorage.setItem(chaveDoEstado("cliente-1"), "{isto não é json");
    fila = [[], [campanha("c1", em(AGORA - DIA))]];
    const lista = await montar();
    expect(lista.map((n) => [n.id, n.read])).toEqual([["c1", false]]);
  });

  it("formato errado (lidas/ocultas que não são lista) é ignorado, não espalhado em letras", async () => {
    // Uma string seria espalhada em letras por `new Set("ab")`: o id "a"
    // viraria "lido" e o "b" sumiria como "dispensado". Só lista vale.
    localStorage.setItem(
      chaveDoEstado("cliente-1"),
      JSON.stringify({ lidas: "a", ocultas: "b" }),
    );
    fila = [
      [],
      [campanha("a", em(AGORA - DIA)), campanha("b", em(AGORA - 2 * DIA))],
    ];
    const lista = await montar();
    expect(lista.map((n) => [n.id, n.read])).toEqual([
      ["a", false],
      ["b", false],
    ]);
  });

  it("formato errado de outro tipo (número, objeto) também é ignorado sem lançar", async () => {
    localStorage.setItem(
      chaveDoEstado("cliente-1"),
      JSON.stringify({ lidas: 7, ocultas: { a: 1 } }),
    );
    fila = [[], [campanha("a", em(AGORA - DIA))]];
    const lista = await montar();
    expect(lista.map((n) => [n.id, n.read])).toEqual([["a", false]]);
  });

  it("estado vazio ({}), nulo e lista vazia não escondem nem marcam nada", async () => {
    for (const guardado of ["{}", "null", '{"lidas":[],"ocultas":[]}']) {
      localStorage.setItem(chaveDoEstado("cliente-1"), guardado);
      fila = [[], [campanha("c1", em(AGORA - DIA))]];
      const lista = await montar();
      expect(lista.map((n) => [n.id, n.read])).toEqual([["c1", false]]);
    }
  });
});
