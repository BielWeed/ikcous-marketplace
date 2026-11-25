// @vitest-environment jsdom
//
// Buracos de prova da caixa de Notificações da cliente achados por MUTAÇÃO
// (plantar um defeito de uma linha em `NotificationsView.tsx` e ver se algum
// teste cai). Cada teste abaixo derruba defeitos que sobreviviam a todos os
// vizinhos (o `navegarPorUrl`, que é de outra frente, NÃO está aqui):
// - a aba "Avisos" reúne os SETE tipos que o banco grava (system, aviso,
//   sucesso, info, success, warning, pagamento) e deixa de fora os de pedido
//   ("order"/"delivery");
// - "Ontem" na virada de MÊS e de ANO (o dia civil é medido em UTC com o mês
//   certo: 28/02 -> 01/03 é 1 dia, não 4);
// - a tela acompanha a virada do dia quando a cliente volta ao app
//   (`visibilitychange`), sem esperar o relógio de 60 s;
// - aviso com pedido E com endereço: o pedido ganha (uma navegação só);
// - tocar num aviso já lido não pede "marcar como lida" de novo;
// - o texto de leitor de tela da ação ("Acompanhar Pedido" / "Ver Detalhes")
//   segue o tipo e só existe quando há para onde ir;
// - o ponto de "não lida" só aparece nas não lidas;
// - as abas dizem qual está escolhida (`aria-pressed`) e a caixa vazia fala a
//   língua certa para o visitante ("Entrar") e para quem tem conta ("Explorar
//   Ofertas");
// - o "x" de excluir só exclui (não navega, não marca como lida);
// - o recado "Mostrando a última lista" só aparece com lista na tela: com a
//   lista vazia e erro, vale só a tela de erro.
// Mutantes EQUIVALENTES (não dá para derrubar): `if (marcandoTodas) return;`
// (o `disabled` do botão e o estado de render são os mesmos) e o
// `&& filteredNotifications.length === 0` do ramo de erro (o ramo anterior já
// pegou toda lista não vazia). Também equivalentes: o `e.stopPropagation()` do
// "x" de excluir (o botão é IRMÃO da linha clicável, não filho: o clique dele
// nunca chega a ela) e o `catch` de `formatNotificationTime` que devolve ""
// (nada ali lança: `new Date` e `toLocaleString` não lançam nem com data
// inválida, que aparece na tela como o texto "Invalid Date" — só observação).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Notification } from "@/types";

const estado = vi.hoisted(() => ({
  lista: [] as unknown[],
  erro: null as string | null,
  semConta: false,
}));

const markAsRead = vi.fn<(id: string) => Promise<void>>();
const markAllAsRead = vi.fn<() => Promise<void>>();
const deleteNotification = vi.fn<(id: string) => Promise<void>>();
const onNavigate = vi.fn<(view: unknown, id?: string) => void>();

// O cartão de avisos do aparelho lê o hook de push (que puxa o supabase real,
// sem variáveis de ambiente aqui); esta tela é a caixa de avisos.
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    permission: "default",
    subscription: null,
    semConta: true,
    sondado: true,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({
    notifications: estado.lista,
    loading: false,
    erro: estado.erro,
    semConta: estado.semConta,
    refresh: vi.fn(),
    markAllAsRead,
    deleteNotification,
    markAsRead,
  }),
}));

// Sem a animação de saída: o aviso que sai da aba ficaria na tela até o fim da
// animação e o teste mediria a lista antes de ela esvaziar.
vi.mock("framer-motion", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("framer-motion")>();
  return {
    ...real,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function aviso(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): Notification {
  return {
    id,
    title: `Aviso ${id}`,
    message: "texto",
    type,
    read: false,
    created_at: "2026-11-18T12:00:00Z",
    ...extra,
  } as unknown as Notification;
}

describe("NotificationsView — abas, virada de mês, prioridade do toque e excluir", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/NotificationsView");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    markAsRead.mockResolvedValue(undefined);
    markAllAsRead.mockResolvedValue(undefined);
    deleteNotification.mockResolvedValue(undefined);
    estado.lista = [];
    estado.erro = null;
    estado.semConta = false;
    vi.useFakeTimers({
      now: new Date("2026-11-18T15:00:00Z").getTime(),
      toFake: ["Date"],
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function renderizar() {
    const { NotificationsView } = await import(
      "@/views/customer/NotificationsView"
    );
    await act(async () => {
      raiz.render(<NotificationsView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const aba = (nome: string) =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith(nome),
    ) as HTMLButtonElement;
  const linhas = () => [
    ...host.querySelectorAll<HTMLElement>('[role="listitem"]'),
  ];
  const titulos = () => linhas().map((l) => l.querySelector("h4")?.textContent);
  const linhaDoAviso = (id: string) =>
    linhas().find((l) => l.querySelector("h4")?.textContent === `Aviso ${id}`)!;
  const abrirAba = async (nome: string) => {
    await act(async () => {
      aba(nome).click();
    });
  };

  describe("a aba Avisos", () => {
    it.each([
      "system",
      "aviso",
      "sucesso",
      "info",
      "success",
      "warning",
      "pagamento",
    ])("o tipo '%s' aparece na aba Avisos", async (tipo) => {
      estado.lista = [aviso("a", tipo), aviso("outro", "order")];
      await renderizar();
      await abrirAba("Avisos");
      expect(titulos()).toEqual(["Aviso a"]);
    });

    it.each(["order", "delivery"])(
      "o tipo '%s' (pedido) fica só na aba Todas",
      async (tipo) => {
        estado.lista = [aviso("a", tipo)];
        await renderizar();
        expect(titulos()).toEqual(["Aviso a"]);
        await abrirAba("Avisos");
        expect(titulos()).toEqual([]);
        expect(host.textContent).toContain("Sem avisos ou comunicados");
      },
    );
  });

  describe("Hoje e Ontem", () => {
    it("virada de MÊS: criada em 28/02 às 15h, vista em 01/03: é ONTEM (1 dia, não 4)", async () => {
      vi.setSystemTime(new Date("2026-03-01T15:00:00Z").getTime());
      estado.lista = [
        aviso("a", "aviso", { created_at: "2026-02-28T18:00:00Z" }),
      ];
      await renderizar();
      expect(host.textContent).toContain("Ontem às 15:00");
    });

    it("a hora mostrada é a de Brasília mesmo com o aparelho em outro fuso (UTC)", async () => {
      const fusoDeAntes = process.env.TZ;
      process.env.TZ = "UTC";
      try {
        estado.lista = [
          aviso("a", "aviso", { created_at: "2026-11-18T12:00:00Z" }),
        ];
        await renderizar();
        expect(host.textContent).toContain("Hoje às 09:00");
        expect(host.textContent).not.toContain("12:00");
      } finally {
        if (fusoDeAntes === undefined)
          Reflect.deleteProperty(process.env, "TZ");
        else process.env.TZ = fusoDeAntes;
      }
    });

    it("virada de ANO: criada em 31/12 às 15h, vista em 01/01: é ONTEM", async () => {
      vi.setSystemTime(new Date("2027-01-01T15:00:00Z").getTime());
      estado.lista = [
        aviso("a", "aviso", { created_at: "2026-12-31T18:00:00Z" }),
      ];
      await renderizar();
      expect(host.textContent).toContain("Ontem às 15:00");
    });

    it("mesmo mês, 30 dias antes: formato completo (não 'Hoje' nem 'Ontem')", async () => {
      vi.setSystemTime(new Date("2026-03-31T15:00:00Z").getTime());
      estado.lista = [
        aviso("a", "aviso", { created_at: "2026-03-01T15:00:00Z" }),
      ];
      await renderizar();
      expect(host.textContent).not.toContain("Ontem às");
      expect(host.textContent).not.toContain("Hoje às");
      expect(host.textContent).toContain("01 de mar., 12:00");
    });

    it("a cliente volta ao app depois da meia-noite: 'Hoje' vira 'Ontem' ao voltar, sem esperar o relógio", async () => {
      vi.setSystemTime(new Date("2026-11-18T02:59:30Z").getTime());
      estado.lista = [
        aviso("a", "aviso", { created_at: "2026-11-18T01:30:00Z" }),
      ];
      await renderizar();
      expect(host.textContent).toContain("Hoje às 22:30");

      // A aba ficou suspensa e o relógio de 60 s não rodou; o dia virou.
      vi.setSystemTime(new Date("2026-11-18T03:00:30Z").getTime());
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(host.textContent).toContain("Ontem às 22:30");
      expect(host.textContent).not.toContain("Hoje às");
    });
  });

  describe("o toque na linha do aviso", () => {
    it("aviso com pedido E com endereço: navega UMA vez, para o pedido", async () => {
      estado.lista = [
        aviso("a", "info", {
          order_id: "ped-1",
          action_url: "/?category=Vestidos",
        }),
      ];
      await renderizar();
      await act(async () => {
        linhaDoAviso("a")
          .querySelector<HTMLElement>('[role="button"]')
          ?.click();
      });
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("order-details", "ped-1");
    });

    it("aviso NÃO lido: marca como lido (uma vez, com o id); aviso JÁ lido: não pede de novo", async () => {
      estado.lista = [
        aviso("nao-lido", "aviso", { action_url: "/favorites" }),
        aviso("lido", "aviso", { action_url: "/favorites", read: true }),
      ];
      await renderizar();
      await act(async () => {
        linhaDoAviso("lido")
          .querySelector<HTMLElement>('[role="button"]')
          ?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("favorites", undefined);
      expect(markAsRead).not.toHaveBeenCalled();

      await act(async () => {
        linhaDoAviso("nao-lido")
          .querySelector<HTMLElement>('[role="button"]')
          ?.click();
      });
      expect(markAsRead).toHaveBeenCalledTimes(1);
      expect(markAsRead).toHaveBeenCalledWith("nao-lido");
    });

    it("excluir: só exclui. Não navega e não marca como lida", async () => {
      estado.lista = [aviso("a", "aviso", { action_url: "/favorites" })];
      await renderizar();
      await act(async () => {
        host
          .querySelector<HTMLButtonElement>(
            'button[title="Excluir notificação"]',
          )
          ?.click();
      });
      expect(deleteNotification).toHaveBeenCalledTimes(1);
      expect(deleteNotification).toHaveBeenCalledWith("a");
      expect(onNavigate).not.toHaveBeenCalled();
      expect(markAsRead).not.toHaveBeenCalled();
    });
  });

  describe("o que a linha diz", () => {
    const textoDeLeitorDaAcao = (id: string) =>
      linhaDoAviso(id).querySelector("span.sr-only")?.textContent ?? null;

    it("pedido: 'Acompanhar Pedido'; sucesso/pagamento/aviso: 'Ver Detalhes'; sem destino: nada", async () => {
      estado.lista = [
        aviso("pedido-info", "info", { order_id: "ped-1" }),
        aviso("info-com-endereco", "info", { action_url: "/orders" }),
        aviso("pedido-order", "order", { order_id: "ped-2" }),
        aviso("sucesso", "success", { action_url: "/orders" }),
        aviso("pago", "pagamento", { order_id: "ped-3" }),
        aviso("comum", "aviso", { action_url: "/home" }),
        aviso("sem-destino", "aviso"),
      ];
      await renderizar();
      expect(textoDeLeitorDaAcao("pedido-info")).toBe("Acompanhar Pedido");
      expect(textoDeLeitorDaAcao("pedido-order")).toBe("Acompanhar Pedido");
      expect(textoDeLeitorDaAcao("info-com-endereco")).toBe("Ver Detalhes");
      expect(textoDeLeitorDaAcao("sucesso")).toBe("Ver Detalhes");
      expect(textoDeLeitorDaAcao("pago")).toBe("Ver Detalhes");
      expect(textoDeLeitorDaAcao("comum")).toBe("Ver Detalhes");
      expect(textoDeLeitorDaAcao("sem-destino")).toBeNull();
    });

    it("tipo de promoção (legado): 'Aproveitar Cupom' e o ícone de porcentagem", async () => {
      estado.lista = [aviso("promo", "promotion", { action_url: "/home" })];
      await renderizar();
      expect(textoDeLeitorDaAcao("promo")).toBe("Aproveitar Cupom");
      const glifo = linhaDoAviso("promo").querySelector(
        '[data-testid="notif-glifo"]',
      );
      expect(glifo?.getAttribute("class")).toContain("lucide-percent");
    });

    it("o ícone segue o tipo: caminhão para pedido, estrela para sucesso, sino para o resto", async () => {
      estado.lista = [
        aviso("pedido", "info", { order_id: "ped-1" }),
        aviso("sucesso", "sucesso"),
        aviso("comum", "aviso"),
      ];
      await renderizar();
      const icone = (id: string) =>
        linhaDoAviso(id)
          .querySelector('[data-testid="notif-glifo"]')
          ?.getAttribute("class") ?? "";
      expect(icone("pedido")).toContain("lucide-truck");
      expect(icone("sucesso")).toContain("lucide-sparkles");
      expect(icone("comum")).toContain("lucide-bell");
    });

    it("o ponto de 'não lida' só aparece no aviso não lido", async () => {
      estado.lista = [
        aviso("novo", "aviso"),
        aviso("velho", "aviso", { read: true }),
      ];
      await renderizar();
      expect(
        linhaDoAviso("novo").querySelector(
          '[data-testid="notif-ponto-nao-lida"]',
        ),
      ).not.toBeNull();
      expect(
        linhaDoAviso("velho").querySelector(
          '[data-testid="notif-ponto-nao-lida"]',
        ),
      ).toBeNull();
    });
  });

  describe("abas e caixa vazia", () => {
    it("a aba escolhida diz que está escolhida (aria-pressed) e a outra não", async () => {
      estado.lista = [aviso("a", "aviso")];
      await renderizar();
      expect(aba("Todas").getAttribute("aria-pressed")).toBe("true");
      expect(aba("Avisos").getAttribute("aria-pressed")).toBe("false");
      await abrirAba("Avisos");
      expect(aba("Todas").getAttribute("aria-pressed")).toBe("false");
      expect(aba("Avisos").getAttribute("aria-pressed")).toBe("true");
    });

    it("caixa vazia de quem tem conta: 'Sua caixa está limpa!' e o botão leva ao início", async () => {
      await renderizar();
      expect(host.textContent).toContain("Sua caixa está limpa!");
      expect(host.textContent).not.toContain("Avisos dos seus pedidos");
      await act(async () => {
        aba("Explorar Ofertas").click();
      });
      expect(onNavigate).toHaveBeenCalledWith("home");
    });

    it("caixa vazia do VISITANTE: promete só o que existe e o botão leva a entrar", async () => {
      estado.semConta = true;
      await renderizar();
      expect(host.textContent).toContain("Avisos dos seus pedidos");
      expect(host.textContent).toContain(
        "Entre na sua conta para receber os avisos dos seus pedidos.",
      );
      expect(host.textContent).not.toContain("Sua caixa está limpa!");
      expect(host.textContent).not.toContain("Tudo em ordem");
      await act(async () => {
        aba("Entrar").click();
      });
      expect(onNavigate).toHaveBeenCalledWith("auth");
    });

    it("visitante na aba Avisos vazia: continua a frase do visitante, não a de comunicados", async () => {
      estado.semConta = true;
      await renderizar();
      await abrirAba("Avisos");
      expect(host.textContent).toContain("Avisos dos seus pedidos");
      expect(host.textContent).not.toContain("Sem avisos ou comunicados");
    });
  });

  describe("erro de carregamento", () => {
    it("lista vazia e erro: só a tela de erro (sem o recado de 'última lista')", async () => {
      estado.erro = "Sem conexão.";
      await renderizar();
      expect(host.textContent).toContain("Não conseguimos carregar");
      expect(host.textContent).toContain(
        "Sem conexão. Verifique sua conexão e tente de novo.",
      );
      expect(host.textContent).not.toContain("Mostrando a última lista");
      expect(host.querySelector('[role="status"]')).toBeNull();
    });

    it("erro com lista na tela: o recado aparece e a lista continua", async () => {
      estado.erro = "Sem conexão.";
      estado.lista = [aviso("a", "aviso")];
      await renderizar();
      expect(host.textContent).toContain("Mostrando a última lista");
      expect(titulos()).toEqual(["Aviso a"]);
      expect(host.textContent).not.toContain("Não conseguimos carregar");
    });

    it("erro e a aba Avisos sem nenhum aviso (só há de pedido): sem recado, e a tela diz que não há avisos", async () => {
      estado.erro = "Sem conexão.";
      estado.lista = [aviso("p", "order")];
      await renderizar();
      await abrirAba("Avisos");
      expect(host.textContent).not.toContain("Mostrando a última lista");
      expect(host.textContent).toContain("Não conseguimos carregar");
    });
  });
});
