// @vitest-environment jsdom
//
// Redesenho da tela de Perfil (23/10/2026, aprovado pelo dono em mockup).
// Só visual e hierarquia: título de seção legível, e-mail legível, "Cliente
// desde", cartão admin compacto, "Meus dados" (nome, WhatsApp, e-mail) com o
// MESMO dado que a conta já tem no contexto, pedidos em andamento em cartão,
// endereços em lista limpa com os 4 estados (carregando, erro, vazio, lista),
// alvos de toque de 44 px e texto nunca abaixo de 12 px.
//
// RENDER DE VERDADE da ProfileView, do AddressList e da linha do tempo; só os
// hooks de dados são dublês. Dados inventados (nada de cliente real).
import type { Address, Order, View } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Alvo de toque de 44 px (Tailwind: 11 = 2,75 rem) em altura mínima, altura ou lado.
const ALVO_44 = /(^|\s)(min-h-11|h-11|size-11)(\s|$)/;

const estado = {
  isAdmin: false,
  userCriadoEm: "2026-10-15T12:00:00Z" as string | undefined,
  profile: {
    full_name: "Maria Teste Silva",
    avatar_url: null,
    cover_url: null,
    whatsapp: "34988887777",
  } as Record<string, unknown> | null,
  addresses: [] as Address[],
  loading: false,
  erroAoCarregar: false,
  orders: [] as Order[],
};
const logout = vi.fn();
const fetchAddresses = vi.fn(async () => {});
const deleteAddress = vi.fn(async () => true);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "maria.teste@exemplo.test",
      user_metadata: {},
      created_at: estado.userCriadoEm,
    },
    profile: estado.profile,
    logout,
    isAdmin: estado.isAdmin,
    loading: false,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.addresses,
    fetchAddresses,
    deleteAddress,
    loading: estado.loading,
    erroAoCarregar: estado.erroAoCarregar,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: estado.orders,
    fetchUserOrders: async () => estado.orders,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja Teste", whatsappNumber: "34999999999" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

function endereco(parcial: Partial<Address>): Address {
  return {
    id: "end-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Maria Teste",
    cep: "38400-000",
    street: "Rua Teste",
    number: "10",
    complement: null,
    neighborhood: "Centro",
    city: "Cidade Teste",
    state: "MG",
    reference: null,
    is_default: false,
    ...parcial,
  };
}

function pedido(parcial: Partial<Order>): Order {
  return {
    id: "pedido-de-teste-0001",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      {
        productId: "p1",
        name: "Camiseta Teste",
        price: 50,
        quantity: 1,
        image: "",
      },
      {
        productId: "p2",
        name: "Boné Teste",
        price: 30,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 80,
    shipping: 0,
    discount: 0,
    total: 80,
    paymentMethod: "online",
    status: "pending",
    paymentStatus: "pago",
    createdAt: "2026-10-04T15:00:00Z",
    updatedAt: "2026-10-04T15:00:00Z",
    cancelledAfterShipping: false,
    ...parcial,
  };
}

describe("ProfileView — redesenho aprovado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    estado.isAdmin = false;
    estado.userCriadoEm = "2026-10-15T12:00:00Z";
    estado.profile = {
      full_name: "Maria Teste Silva",
      avatar_url: null,
      cover_url: null,
      whatsapp: "34988887777",
    };
    estado.addresses = [];
    estado.loading = false;
    estado.erroAoCarregar = false;
    estado.orders = [];
    onNavigate.mockClear();
    logout.mockClear();
    fetchAddresses.mockClear();
    deleteAddress.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar() {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={onNavigate} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const botoes = () => [...hospedeiro.querySelectorAll("button")];
  const botaoComTexto = (texto: string) =>
    botoes().find((b) => b.textContent?.trim() === texto);
  const botaoQueContem = (texto: string) =>
    botoes().find((b) => b.textContent?.includes(texto));
  const clicar = async (el: Element | undefined) => {
    expect(el).toBeDefined();
    await act(async () => {
      (el as HTMLElement).click();
    });
  };
  const textos = () => hospedeiro.textContent ?? "";

  describe("cabeçalho", () => {
    it("e-mail legível: texto normal, sem caixa alta nem espaçamento largo", async () => {
      await renderizar();
      const email = [...hospedeiro.querySelectorAll("p")].find(
        (p) => p.textContent === "maria.teste@exemplo.test",
      );
      expect(email).toBeDefined();
      expect(email!.className).not.toMatch(/uppercase|tracking-\[/);
    });

    it("mostra 'Cliente desde mês/ano' quando a conta já traz a data", async () => {
      await renderizar();
      expect(textos()).toContain("Cliente desde out/2026");
    });

    it("sem data de criação no contexto: omite o selo (não inventa)", async () => {
      estado.userCriadoEm = undefined;
      await renderizar();
      expect(textos()).not.toContain("Cliente desde");
    });

    it("data inválida também omite o selo", async () => {
      estado.userCriadoEm = "isto-nao-e-data";
      await renderizar();
      expect(textos()).not.toContain("Cliente desde");
    });

    it("sem foto, o avatar mostra a inicial do nome e o botão de trocar foto fica sempre visível", async () => {
      await renderizar();
      const avatar = hospedeiro.querySelector<HTMLElement>(
        '[role="button"][aria-label="Trocar foto de perfil"]',
      );
      expect(avatar).not.toBeNull();
      expect(avatar!.textContent).toContain("M");
      // o emblema de câmera não depende de hover (no celular não existe hover)
      expect(avatar!.querySelector("svg")).not.toBeNull();
      expect(avatar!.innerHTML).not.toContain("group-hover/avatar:opacity-100");
    });

    it("câmera da capa vira chip 'Alterar capa' e continua abrindo o seletor", async () => {
      await renderizar();
      const capa = hospedeiro.querySelector<HTMLButtonElement>(
        'button[title="Alterar capa de fundo"]',
      );
      expect(capa).not.toBeNull();
      expect(capa!.textContent).toContain("Alterar capa");
      await clicar(capa!);
      expect(document.body.textContent).toContain("Capa de Fundo");
    });

    it("tocar no avatar abre a escolha de foto", async () => {
      await renderizar();
      await clicar(
        hospedeiro.querySelector(
          '[role="button"][aria-label="Trocar foto de perfil"]',
        )!,
      );
      expect(document.body.textContent).toContain("Escolher Avatar ou Foto");
    });
  });

  describe("cartão do modo admin", () => {
    it("some para cliente comum", async () => {
      await renderizar();
      expect(textos()).not.toContain("Modo admin");
      expect(botaoQueContem("Acessar painel")).toBeUndefined();
    });

    it("admin vê o cartão compacto e 'Acessar painel' leva ao mesmo destino de antes", async () => {
      estado.isAdmin = true;
      await renderizar();
      expect(textos()).toContain("Modo admin");
      expect(textos()).toContain("Painel de controle ativo");
      const botao = botaoComTexto("Acessar painel");
      expect(botao!.className).toMatch(/\bh-11\b|min-h-11/);
      await clicar(botao);
      expect(onNavigate).toHaveBeenCalledWith("admin-dashboard");
    });
  });

  describe("Meus dados", () => {
    it("mostra nome, WhatsApp formatado e e-mail, e Editar leva a Segurança e conta", async () => {
      await renderizar();
      const t = textos();
      expect(t).toContain("Meus dados");
      expect(t).toContain("Nome completo");
      expect(t).toContain("Maria Teste Silva");
      expect(t).toContain("(34) 98888-7777");
      expect(t).toContain("E-mail");
      await clicar(botaoComTexto("Editar"));
      expect(onNavigate).toHaveBeenCalledWith("account-settings");
    });

    it("WhatsApp ainda não cadastrado vira o convite 'Adicionar WhatsApp' (não deixa linha vazia)", async () => {
      estado.profile = {
        full_name: "Maria Teste Silva",
        avatar_url: null,
        cover_url: null,
        whatsapp: null,
      };
      await renderizar();
      const botao = botaoQueContem("Adicionar WhatsApp");
      expect(botao).toBeDefined();
      await clicar(botao);
      expect(onNavigate).toHaveBeenCalledWith("account-settings");
    });

    it("perfil ainda não chegou: não afirma que falta WhatsApp", async () => {
      estado.profile = null;
      await renderizar();
      expect(textos()).not.toContain("Adicionar WhatsApp");
    });
  });

  describe("pedidos em andamento", () => {
    it("cartão com título legível, contagem, selo de pagamento e atalhos de sempre", async () => {
      estado.orders = [pedido({})];
      await renderizar();
      const t = textos();
      expect(t).toContain("Pedidos em andamento");
      expect(t).toContain("Camiseta Teste");
      expect(t).toContain("+1 outro item");
      expect(t).toContain("04/10/2026");
      expect(
        hospedeiro.querySelector('[data-testid="customer-payment-badge"]')
          ?.textContent,
      ).toBe("Pagamento confirmado");
      expect(
        hospedeiro.querySelector('[data-testid="contagem-em-andamento"]')
          ?.textContent,
      ).toBe("1");
      await clicar(botaoQueContem("Ver detalhes"));
      expect(onNavigate).toHaveBeenCalledWith(
        "order-details",
        "pedido-de-teste-0001",
      );
      expect(botaoQueContem("WhatsApp")).toBeDefined();
    });

    it("Tinta (24/10/2026): o pedido em andamento vem ANTES de Meus dados, e a ordem segue até Conta", async () => {
      estado.orders = [pedido({})];
      await renderizar();
      const titulos = [...hospedeiro.querySelectorAll("h2")].map(
        (h) => h.textContent,
      );
      expect(titulos).toEqual([
        "Pedidos em andamento",
        "Meus dados",
        "Endereços de entrega",
        "Conta",
      ]);
    });

    it("não aparece sem pedido em andamento (nada novo é adicionado)", async () => {
      estado.orders = [pedido({ status: "delivered" })];
      await renderizar();
      expect(textos()).not.toContain("Pedidos em andamento");
    });

    it("vários pedidos: 'Ver mais (N outros)' expande e recolhe", async () => {
      estado.orders = [
        pedido({ id: "ped-a-0001" }),
        pedido({ id: "ped-b-0002" }),
        pedido({ id: "ped-c-0003" }),
      ];
      await renderizar();
      expect(
        hospedeiro.querySelector('[data-testid="contagem-em-andamento"]')
          ?.textContent,
      ).toBe("3");
      const ver = botaoQueContem("Ver mais (2 outros)");
      expect(ver).toBeDefined();
      await clicar(ver);
      expect(botaoQueContem("Ver menos")).toBeDefined();
    });

    it("linha do tempo em barras mantém a lista nomeada e a etapa atual falada", async () => {
      estado.orders = [pedido({ status: "processing" })];
      await renderizar();
      const lista = hospedeiro.querySelector(
        'ol[aria-label="Andamento do pedido"]',
      );
      expect(lista).not.toBeNull();
      expect(lista!.querySelectorAll("li")).toHaveLength(4);
      expect(
        lista!.querySelector('li[aria-current="step"]')?.textContent,
      ).toContain("Preparando");
    });

    // Medido em navegador a 320 px (jsdom não calcula layout; aqui só se trava
    // a CLASSE que o navegador mediu): colunas iguais faziam "Preparando"
    // invadir o vizinho, e a linha "Ver detalhes" + "WhatsApp" vazava do cartão.
    it("linha do tempo: colunas pelo tamanho do rótulo (sem grade de 4 iguais) e folga menor em tela estreita", async () => {
      estado.orders = [pedido({ status: "processing" })];
      await renderizar();
      const lista = hospedeiro.querySelector(
        'ol[aria-label="Andamento do pedido"]',
      )!;
      expect(lista.className).toContain("flex");
      expect(lista.className).not.toContain("grid-cols-4");
      expect(lista.className).toContain("max-[359px]:gap-1");
      for (const li of lista.querySelectorAll("li")) {
        expect(li.className).toContain("flex-auto");
        // sem min-w-0: a coluna nunca encolhe abaixo da maior palavra
        expect(li.className).not.toContain("min-w-0");
      }
    });

    it("'Ver detalhes' e 'WhatsApp' quebram de linha em tela estreita em vez de vazar do cartão", async () => {
      estado.orders = [pedido({})];
      await renderizar();
      const linha = botaoQueContem("Ver detalhes")!.parentElement!;
      expect(linha.className).toContain("flex-wrap");
      for (const nome of ["Ver detalhes", "WhatsApp"])
        expect(botaoQueContem(nome)!.className).toMatch(/(^|\s)h-12(\s|$)/);
    });
  });

  describe("endereços", () => {
    const cartaoEnderecos = () =>
      [...hospedeiro.querySelectorAll("section")].find((s) =>
        s.textContent?.includes("Endereços de entrega"),
      )!;

    it("título legível e '+ Novo' com alvo de toque de 44 px leva ao formulário", async () => {
      await renderizar();
      const titulo = [...hospedeiro.querySelectorAll("h2")].find(
        (h) => h.textContent === "Endereços de entrega",
      );
      expect(titulo).toBeDefined();
      // Tinta (24/10/2026): rótulo mono de seção do desenho aprovado; o texto
      // continua legível (a caixa alta é só CSS) e o espaçamento é o do rótulo.
      expect(titulo!.className).toContain("font-mono");
      expect(titulo!.className).toContain("tracking-[0.12em]");
      const novo = botaoComTexto("Novo");
      expect(novo!.className).toMatch(ALVO_44);
      await clicar(novo);
      expect(onNavigate).toHaveBeenCalledWith("address-form");
    });

    it("carregando: esqueleto anunciado, sem dizer que não há endereço", async () => {
      estado.loading = true;
      await renderizar();
      const esqueleto = cartaoEnderecos().querySelector('[aria-busy="true"]');
      expect(esqueleto).not.toBeNull();
      expect(esqueleto!.textContent).toContain("Carregando endereços");
      expect(textos()).not.toContain("Nenhum endereço cadastrado");
    });

    it("erro de leitura sem cache: avisa, oferece 'Tentar de novo' e NÃO finge cadastro vazio", async () => {
      estado.erroAoCarregar = true;
      await renderizar();
      const alerta = cartaoEnderecos().querySelector('[role="alert"]');
      expect(alerta?.textContent).toContain(
        "Não conseguimos carregar seus endereços agora.",
      );
      expect(textos()).not.toContain("Nenhum endereço cadastrado");
      const antes = fetchAddresses.mock.calls.length;
      const tentar = botaoComTexto("Tentar de novo");
      expect(tentar!.className).toMatch(ALVO_44);
      // o botão tem borda: sem border-solid o reset do index.css a apaga
      expect(tentar!.className).toContain("border-solid");
      await clicar(tentar);
      expect(fetchAddresses.mock.calls.length).toBe(antes + 1);
    });

    it("vazio legítimo: 'Nenhum endereço cadastrado' com botão '+ Adicionar endereço'", async () => {
      await renderizar();
      expect(textos()).toContain("Nenhum endereço cadastrado");
      const adicionar = botaoQueContem("Adicionar endereço");
      expect(adicionar).toBeDefined();
      expect(adicionar!.className).toMatch(ALVO_44);
      await clicar(adicionar);
      expect(onNavigate).toHaveBeenCalledWith("address-form");
    });

    it("lista limpa: nome, selo Principal só no principal, rua e bairro", async () => {
      estado.addresses = [
        endereco({ id: "end-1", name: "Casa", is_default: true }),
        endereco({
          id: "end-2",
          name: "Trabalho",
          street: "Av. Exemplo",
          number: "1200",
          neighborhood: "Bairro Novo",
        }),
      ];
      await renderizar();
      const cartao = cartaoEnderecos();
      expect(cartao.textContent).toContain("Casa");
      expect(cartao.textContent).toContain("Trabalho");
      expect(cartao.textContent).toContain("Rua Teste, 10 · Centro");
      expect(cartao.textContent).toContain("Av. Exemplo, 1200 · Bairro Novo");
      const selos = [...cartao.querySelectorAll("span")].filter(
        (s) => s.textContent === "Principal",
      );
      expect(selos).toHaveLength(1);
      expect(selos[0]!.className).toContain("text-emerald-700");
      expect(selos[0]!.className).not.toMatch(/uppercase|text-\[/);
      expect(cartao.textContent).not.toContain("Nenhum endereço cadastrado");
    });

    it("editar e apagar: 44x44 px, nome do endereço no aria-label, e apagar ainda pede confirmação", async () => {
      estado.addresses = [
        endereco({ id: "end-1", name: "Casa", is_default: true }),
        endereco({ id: "end-2", name: "Trabalho" }),
      ];
      await renderizar();
      const cartao = cartaoEnderecos();
      const editar = cartao.querySelector<HTMLButtonElement>(
        'button[aria-label="Editar endereço Trabalho"]',
      );
      const apagar = cartao.querySelector<HTMLButtonElement>(
        'button[aria-label="Excluir endereço Trabalho"]',
      );
      expect(editar).not.toBeNull();
      expect(apagar).not.toBeNull();
      for (const b of [editar!, apagar!]) {
        expect(b.className).toMatch(/\bsize-11\b/);
      }
      // um rótulo por endereço (leitor de tela não ouve "Editar, Editar")
      expect(
        cartao.querySelectorAll('button[aria-label^="Editar endereço"]'),
      ).toHaveLength(2);

      await clicar(editar!);
      expect(onNavigate).toHaveBeenCalledWith("address-form", "end-2");

      await clicar(apagar!);
      expect(deleteAddress).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Apagar este endereço?");
      const confirmar = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent === "Apagar",
      );
      await clicar(confirmar);
      expect(deleteAddress).toHaveBeenCalledWith("end-2");
    });

    it("'Ver detalhes dos endereços' expande para o cartão completo e recolhe de volta", async () => {
      estado.addresses = [endereco({ id: "end-1", name: "Casa" })];
      await renderizar();
      const ver = botaoQueContem("Ver detalhes dos endereços");
      expect(ver).toBeDefined();
      await clicar(ver);
      expect(textos()).toContain("CEP: 38400-000");
      // no modo completo editar/apagar continuam com alvo de 44 px e nome próprio
      const cartao = cartaoEnderecos();
      expect(
        cartao.querySelector('button[aria-label="Editar endereço Casa"]')
          ?.className,
      ).toMatch(/\bsize-11\b/);
      await clicar(botaoQueContem("Ver menos detalhes"));
      expect(textos()).not.toContain("CEP: 38400-000");
    });
  });

  describe("atalhos e sair", () => {
    it("Segurança e conta e Sobre a loja levam aos mesmos destinos de antes", async () => {
      await renderizar();
      await clicar(botaoQueContem("Segurança e conta"));
      expect(onNavigate).toHaveBeenLastCalledWith("account-settings");
      await clicar(botaoQueContem("Sobre a loja"));
      expect(onNavigate).toHaveBeenLastCalledWith("about-store");
    });

    it("Encerrar sessão é botão de contorno vermelho e continua saindo da conta", async () => {
      await renderizar();
      const sair = botaoQueContem("Encerrar sessão");
      expect(sair).toBeDefined();
      expect(sair!.outerHTML).toMatch(/text-red-(600|700)/);
      expect(sair!.textContent).toContain("Sair da sua conta");
      await clicar(sair);
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });

  describe("regras de produto da tela inteira", () => {
    it("nenhum texto abaixo de 12 px (carregando, erro, vazio, lista, pedidos, admin)", async () => {
      estado.isAdmin = true;
      estado.orders = [pedido({}), pedido({ id: "ped-2-0002" })];
      estado.addresses = [endereco({ is_default: true })];
      await renderizar();
      await clicar(botaoQueContem("Ver detalhes dos endereços"));
      const pequenas = [...hospedeiro.querySelectorAll("*")]
        .flatMap((el) => [...el.classList])
        .filter((c) => {
          const m = /^text-\[(\d+)px\]$/.exec(c);
          return m ? Number(m[1]) < 12 : false;
        });
      // Exceção do desenho Tinta: o rótulo mono de seção é 11 px. Só vale com a
      // receita completa (font-mono + uppercase + tracking-[0.12em]).
      const rotulosMono = [...hospedeiro.querySelectorAll("*")].filter(
        (el) =>
          el.classList.contains("text-[11px]") &&
          !(
            el.classList.contains("font-mono") &&
            el.classList.contains("uppercase") &&
            el.classList.contains("tracking-[0.12em]")
          ),
      );
      expect(rotulosMono).toEqual([]);
      expect([...new Set(pequenas)].filter((c) => c !== "text-[11px]")).toEqual(
        [],
      );
    });

    it("nenhum dourado e nenhuma caixa alta com espaçamento largo na tela", async () => {
      estado.isAdmin = true;
      estado.orders = [pedido({})];
      estado.addresses = [endereco({ is_default: true })];
      await renderizar();
      const html = hospedeiro.innerHTML;
      expect(html).not.toMatch(/amber-|yellow-|gold|admin-gold/);
      expect(html).not.toMatch(/tracking-\[0\.[23]em\]|tracking-widest/);
    });
  });
});
