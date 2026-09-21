import {
  AddressList,
  queryMapsDoEndereco,
} from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
// @vitest-environment jsdom
//
// Mapa por cartão de endereço no Perfil (pedido do dono, 21/09/2026): ao
// expandir "Ver mais detalhes", cada cartão ganha o embed do Google com a
// query de LOCAL — rua+número, bairro, cidade, UF, CEP e Brasil. Dados
// privados (destinatário, complemento, referência, apelido) NUNCA vão na
// query; o ramo compacto NUNCA monta iframe; o checkout (selectable, uso
// compartilhado) não passa showMaps e não muda nada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

const CASA: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria de Lourdes",
  cep: "38600-123",
  street: "Rua das Acácias",
  number: "120",
  complement: "Apto 301",
  neighborhood: "Jardim Primavera",
  city: "Paracatu",
  state: "MG",
  reference: "Perto do mercado municipal",
  is_default: true,
};

const TRABALHO: Address = {
  id: "addr-2",
  user_id: "user-1",
  name: "Trabalho",
  recipient_name: "Maria de Lourdes",
  cep: "01311-200",
  street: "Avenida Paulista",
  number: "1578",
  complement: null,
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  reference: null,
  is_default: false,
};

function iframes(hospedeiro: HTMLElement) {
  return [...hospedeiro.querySelectorAll("iframe")];
}

describe("AddressList — o mapa é opt-in e só existe no ramo expandido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function renderizar(props: Record<string, unknown>) {
    return act(async () => {
      raiz.render(<AddressList addresses={[CASA, TRABALHO]} {...props} />);
    });
  }

  it("ramo compacto NUNCA monta iframe — nem com showMaps ligado", async () => {
    await renderizar({ compact: true, showMaps: true });
    expect(iframes(hospedeiro)).toHaveLength(0);
    expect(hospedeiro.textContent).toContain("Rua das Acácias");
  });

  it("uso compartilhado (checkout selectable) sem iframe — MESMO com showMaps passado", async () => {
    await renderizar({
      selectable: true,
      selectedId: "addr-1",
      showMaps: true,
    });
    expect(iframes(hospedeiro)).toHaveLength(0);
  });

  it("expandido com showMaps: query de local correta, sem dado privado, iframe credentialless e lazy", async () => {
    await renderizar({ showMaps: true });

    const mapas = iframes(hospedeiro);
    expect(mapas).toHaveLength(2);

    // Rua+cidade+UF completos: o CEP SAI da query — bairro+CEP juntos
    // podem virar busca ambígua no embed clássico (POIs da região, sem pin).
    const esperado = `https://maps.google.com/maps?q=${encodeURIComponent(
      "Rua das Acácias, 120, Jardim Primavera, Paracatu, MG, Brasil",
    )}&z=15&output=embed`;
    expect(mapas[0]!.getAttribute("src")).toBe(esperado);
    expect(mapas[0]!.getAttribute("src")).not.toContain("38600");

    // Privacidade: destinatário, complemento, referência e apelido ficam fora.
    expect(mapas[0]!.getAttribute("src")).not.toContain("Maria");
    expect(mapas[0]!.getAttribute("src")).not.toContain("Apto");
    expect(mapas[0]!.getAttribute("src")).not.toContain("mercado");
    expect(mapas[0]!.getAttribute("src")).not.toContain(
      encodeURIComponent("Casa"),
    );

    expect(mapas[0]!.hasAttribute("credentialless")).toBe(true);
    expect(mapas[0]!.getAttribute("loading")).toBe("lazy");
    expect(mapas[0]!.getAttribute("title")).toBe("Mapa do endereço Casa");
    expect(mapas[1]!.getAttribute("title")).toBe("Mapa do endereço Trabalho");

    // O iframe é decorativo: sem captura de foco invisível.
    expect(mapas[0]!.getAttribute("tabindex")).toBe("-1");

    // Link VISÍVEL sob o mapa, com o apelido no nome acessível.
    const link = hospedeiro.querySelector<HTMLAnchorElement>(
      "a[aria-label='Abrir no Google Maps — endereço Casa']",
    );
    expect(link!.textContent).toContain("Abrir no Google Maps");
    expect(link!.getAttribute("aria-label")).toBe(
      "Abrir no Google Maps — endereço Casa",
    );
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link!.getAttribute("href")).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        "Rua das Acácias, 120, Jardim Primavera, Paracatu, MG, Brasil",
      )}`,
    );
  });

  it("editar e excluir continuam funcionando com o mapa montado", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    await act(async () => {
      raiz.render(
        <AddressList
          addresses={[CASA]}
          showMaps
          onEdit={onEdit}
          onDelete={onDelete}
        />,
      );
    });

    expect(iframes(hospedeiro)).toHaveLength(1);
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>("button[aria-label='Editar']")!
        .click();
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>("button[aria-label='Excluir']")!
        .click();
    });
    expect(onEdit).toHaveBeenCalledWith(CASA);
    expect(onDelete).toHaveBeenCalledWith("addr-1");
  });
});

describe("queryMapsDoEndereco — a query nasce limpa ou não nasce", () => {
  it("rua+cidade+UF completos: o CEP sai da query (bairro+CEP juntos podem virar busca ambígua)", () => {
    expect(queryMapsDoEndereco(CASA)).toBe(
      encodeURIComponent(
        "Rua das Acácias, 120, Jardim Primavera, Paracatu, MG, Brasil",
      ),
    );
  });

  it("número ausente não deixa vírgula órfã", () => {
    expect(queryMapsDoEndereco({ ...CASA, number: "" })).toBe(
      encodeURIComponent(
        "Rua das Acácias, Jardim Primavera, Paracatu, MG, Brasil",
      ),
    );
  });

  it("sem UF (cidade incompleta sem estado), o CEP VOLTA como desambiguação", () => {
    expect(queryMapsDoEndereco({ ...CASA, state: "" })).toBe(
      encodeURIComponent(
        "Rua das Acácias, 120, Jardim Primavera, Paracatu, 38600-123, Brasil",
      ),
    );
  });

  it("sem cidade, o CEP permanece como fallback", () => {
    expect(queryMapsDoEndereco({ ...CASA, city: "", state: "" })).toBe(
      encodeURIComponent(
        "Rua das Acácias, 120, Jardim Primavera, 38600-123, Brasil",
      ),
    );
  });

  it("rua vazia com número presente: o número ÓRFÃO não entra na query", () => {
    expect(queryMapsDoEndereco({ ...CASA, street: "" })).toBe(
      encodeURIComponent("Jardim Primavera, Paracatu, MG, 38600-123, Brasil"),
    );
  });

  it("sem rua e sem CEP não há mapa: devolve null (nada de iframe vazio)", () => {
    expect(
      queryMapsDoEndereco({ ...CASA, street: "", number: "120", cep: "" }),
    ).toBeNull();
  });

  it("CEP sozinho já aponta o mapa (cai na rua do CEP)", () => {
    expect(queryMapsDoEndereco({ ...CASA, street: "", number: "" })).toBe(
      encodeURIComponent("Jardim Primavera, Paracatu, MG, 38600-123, Brasil"),
    );
  });
});

// Integração com a ProfileView real: expandir monta os mapas, recolher
// desmonta. Mesmos mocks de perfil-botao-sobre-a-loja-todos-os-usuarios
// (a tela de menu não é o assunto — os endereços são).
let enderecosDoPerfil: Address[] = [];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "gabriel@ikcous.com", user_metadata: {} },
    profile: { full_name: "João Gabriel", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: enderecosDoPerfil,
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [] }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "IKCOUS - imports",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));

vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => <div data-testid="order-timeline-stub" />,
}));

describe("ProfileView — expandir monta os mapas, recolher desmonta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    enderecosDoPerfil = [CASA, TRABALHO];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("abre compacto sem iframe; expandir mostra um mapa por cartão; recolher desmonta", async () => {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Compacto: nenhum iframe montado.
    expect(iframes(hospedeiro)).toHaveLength(0);

    const botaoExpandir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver mais detalhes"),
    );
    expect(botaoExpandir).toBeTruthy();
    await act(async () => {
      botaoExpandir!.click();
    });

    // Expandido: um mapa por cartão, na ordem dos endereços.
    const mapas = iframes(hospedeiro);
    expect(mapas).toHaveLength(2);
    expect(mapas[0]!.getAttribute("src")).toContain(
      encodeURIComponent("Paracatu"),
    );
    expect(mapas[1]!.getAttribute("src")).toContain(
      encodeURIComponent("São Paulo"),
    );

    const botaoRecolher = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver menos detalhes"),
    );
    await act(async () => {
      botaoRecolher!.click();
    });
    expect(iframes(hospedeiro)).toHaveLength(0);
  });
});
