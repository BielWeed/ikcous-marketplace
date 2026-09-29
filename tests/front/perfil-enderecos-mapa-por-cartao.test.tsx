import {
  AddressList,
  queryMapsDoEndereco,
} from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
// @vitest-environment jsdom
//
// Mapa do cartão de endereço no Perfil (29/09/2026, entrega FINAL autorizada
// pelo dono em voz): VETOR OpenFreeMap "positron" via maplibre-gl — a única
// via sem custo novo que GARANTE zero POI (o estilo não tem camada de POI e
// ainda filtramos `source-layer: poi` em runtime, defesa em profundidade).
// O chunk do maplibre tem orçamento PRÓPRIO no portão ("opcional", 250 kB —
// allowlist `CHUNKS_OPCIONAIS` em scripts/portaoDividido.ts): não entra na
// conta de cliente. SEM iframe, SEM controles, pin no ponto do geocode e
// atribuição mínima comprovada — "© OpenMapTiles · dados © OpenStreetMap
// contributors", SEM o nome opcional "OpenFreeMap" — em linha ABAIXO da
// área cartográfica, exibida SÓ quando o mapa existe. Dados privados
// (destinatário, complemento, referência, apelido) NUNCA saem na consulta.
// Este arquivo cobre:
//   - ramo compacto e uso compartilhado (checkout selectable) NUNCA montam mapa;
//   - expandido: mapa por cartão, zero iframes, créditos abaixo do canvas;
//   - FALHA de rede e OFFLINE: degradação graciosa, sem baixar o maplibre;
//   - carregamento SOB DEMANDA: maplibre só é importado quando um mapa monta;
//   - a camada de POI NÃO chega ao mapa (filtro do estilo);
//   - editar/excluir seguem funcionando com o mapa montado.
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

// ── Mock do maplibre-gl: conta imports (prova de sob demanda) e captura o
//    estilo recebido (prova da defesa contra camadas de POI), o centro do
//    mapa, a interatividade e a atribuição desligada. Prefixo "mock" porque
//    a factory do vi.mock é içada (hoisting). ──
interface CamadaDeEstilo {
  "source-layer"?: string;
}
interface EstiloDoMapa {
  layers?: CamadaDeEstilo[];
}
interface OpcoesDoMapa {
  style?: EstiloDoMapa;
  center?: [number, number];
  attributionControl?: boolean;
  interactive?: boolean;
}
const mockMapas: { opcoes: OpcoesDoMapa }[] = [];
const mockMarcadores: { lngLat: [number, number] }[] = [];
/** Instâncias de Map criadas — provam o `map.remove()` da desmontagem
 * (risco 1) e deixam o teste DISPARAR os eventos assíncronos do MapLibre
 * (`load`/`error`) para o risco 3. */
const mockInstancias: {
  removido: boolean;
  emitir(evento: string): void;
}[] = [];
let mockImportacoesDoMaplibre = 0;
vi.mock("maplibre-gl", () => {
  mockImportacoesDoMaplibre += 1;
  return {
    Map: class {
      readonly ouvintes = new Map<string, () => void>();
      removido = false;
      constructor(opcoes: OpcoesDoMapa) {
        mockMapas.push({ opcoes });
        mockInstancias.push(this);
      }
      on(evento: string, retorno: () => void) {
        this.ouvintes.set(evento, retorno);
        return this;
      }
      emitir(evento: string) {
        this.ouvintes.get(evento)?.();
      }
      remove() {
        this.removido = true;
      }
    },
    Marker: class {
      setLngLat(lngLat: [number, number]) {
        mockMarcadores.push({ lngLat });
        return this;
      }
      addTo() {
        return this;
      }
    },
  };
});

/** Estilo com uma camada de POI DE PROPÓSITO: o teste prova que o filtro do
 * componente a remove antes de construir o mapa (defesa em profundidade — o
 * positron real já nasce sem camada de POI). */
const ESTILO = {
  version: 8,
  layers: [
    { id: "fundo" },
    { id: "rua", "source-layer": "transportation_name" },
    { id: "poi-espiao", "source-layer": "poi" },
  ],
};

function respostaOk(corpo: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(corpo),
  });
}

function respostaGeocode() {
  return respostaOk({
    features: [
      {
        properties: { countrycode: "BR" },
        geometry: { type: "Point", coordinates: [-46.6559, -23.5614] },
      },
    ],
  });
}

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

async function avancaMicrotarefas() {
  // A cadeia por cartão tem várias esperas encadeadas (estilo em cache
  // compartilhado + geocode + import dinâmico + setFase + rAF de ~16 ms no
  // jsdom com pretendToBeVisual) — e roda em PARALELO para N cartões.
  // Drenagem comprovada suficiente no diagnóstico de 29/09: 6 microtasks
  // + uma macrotarefa de 60 ms cobrem 2 cartões.
  await act(async () => {
    for (let indice = 0; indice < 6; indice += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

describe("AddressList — mapa do cartão (vetor positron, sem iframe)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockMapas.length = 0;
    mockMarcadores.length = 0;
    mockInstancias.length = 0;
    mockImportacoesDoMaplibre = 0;
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function renderizar(props: Record<string, unknown>) {
    return act(async () => {
      raiz.render(<AddressList addresses={[CASA, TRABALHO]} {...props} />);
    });
  }

  it("ramo compacto NUNCA monta mapa — nem com showMaps ligado", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderizar({ compact: true, showMaps: true });
    expect(hospedeiro.querySelectorAll(".address-card-map")).toHaveLength(0);
    expect(hospedeiro.textContent).toContain("Rua das Acácias");
    expect(mockImportacoesDoMaplibre).toBe(0);
  });

  it("uso compartilhado (checkout selectable) sem mapa — MESMO com showMaps", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await renderizar({
      selectable: true,
      selectedId: "addr-1",
      showMaps: true,
    });
    expect(hospedeiro.querySelectorAll(".address-card-map")).toHaveLength(0);
    expect(mockImportacoesDoMaplibre).toBe(0);
  });

  it("OFFLINE: sem rede — mensagem amigável, zero fetch, zero maplibre, SEM crédito (não há mapa)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await renderizar({ showMaps: true });
    await avancaMicrotarefas();
    const estados = [...hospedeiro.querySelectorAll(".address-card-map")].map(
      (no) => no.getAttribute("data-fase"),
    );
    expect(estados).toEqual(["indisponivel", "indisponivel"]);
    expect(
      [...hospedeiro.querySelectorAll(".address-card-map__status")].map(
        (no) => no.textContent,
      ),
    ).toEqual([
      "Mapa indisponível. O endereço acima continua válido.",
      "Mapa indisponível. O endereço acima continua válido.",
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockImportacoesDoMaplibre).toBe(0);
    // Sem mapa não há obra a creditar: a linha de atribuição também sai.
    expect(
      hospedeiro.querySelectorAll('[data-testid="creditos-mapa"]'),
    ).toHaveLength(0);
    // O cartão segue útil: endereço e link externo permanecem.
    expect(hospedeiro.textContent).toContain("Rua das Acácias");
    expect(
      hospedeiro.querySelector(
        "a[aria-label='Abrir no Google Maps — endereço Casa']",
      ),
    ).not.toBeNull();
  });

  it("FALHA de rede no geocode: degradação graciosa e o maplibre NEM é baixado", async () => {
    // O estilo responde OK de propósito: o cache do estilo é em NÍVEL DE
    // MÓDULO no componente — uma promessa REJEITADA aqui envenenaria o
    // teste "expandido" seguinte (mesma promessa rejeitada reutilizada).
    // A falha coberta é a do GEOCODE; a do estilo cai no mesmo catch.
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    await renderizar({ showMaps: true });
    await avancaMicrotarefas();
    const estados = [...hospedeiro.querySelectorAll(".address-card-map")].map(
      (no) => no.getAttribute("data-fase"),
    );
    expect(estados).toEqual(["indisponivel", "indisponivel"]);
    expect(mockImportacoesDoMaplibre).toBe(0);
    expect(hospedeiro.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("expandido com rede OK: um mapa por cartão, sob demanda, sem iframe, sem POI no estilo", async () => {
    const fetchEspiao = vi.fn((entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      if (url.includes("photon")) return respostaGeocode();
      return Promise.reject(new Error("url inesperada no teste"));
    });
    vi.stubGlobal("fetch", fetchEspiao);
    expect(mockImportacoesDoMaplibre).toBe(0); // nada importado antes de montar
    await renderizar({ showMaps: true });
    await avancaMicrotarefas(); // drena estilo+geocode → rAF → import dinâmico
    expect(mockImportacoesDoMaplibre).toBeGreaterThanOrEqual(1); // sob demanda
    const mapas = hospedeiro.querySelectorAll(".address-card-map");
    expect(mapas).toHaveLength(2);

    // Zero iframes: o embed do Google saiu dos cartões.
    expect(hospedeiro.querySelectorAll("iframe")).toHaveLength(0);

    // Créditos: linha PRÓPRIA, ABAIXO do canvas — nunca dentro dele.
    // Atribuição mínima da via VETORA: "© OpenMapTiles" (schema) + dados
    // "© OpenStreetMap contributors" (ODbL) — SEM o nome opcional
    // "OpenFreeMap" (comprovado em fonte primária em 29/09/2026).
    for (const mapa of mapas) {
      const canvas = mapa.querySelector(".address-card-map__canvas");
      const creditos = mapa.querySelector('[data-testid="creditos-mapa"]');
      expect(creditos).not.toBeNull();
      expect(canvas?.contains(creditos as Node)).toBe(false);
      const links = [...(creditos?.querySelectorAll("a") ?? [])].map((a) =>
        a.getAttribute("href"),
      );
      expect(links).toEqual([
        "https://openmaptiles.org/",
        "https://www.openstreetmap.org/copyright",
      ]);
      expect(creditos?.textContent).not.toContain("OpenFreeMap");
    }

    // Defesa em profundidade: a camada de POI do estilo NÃO chega ao mapa —
    // o positron real já não tem, mas se um estilo futuro trouxer, sai.
    expect(mockMapas.length).toBeGreaterThanOrEqual(1);
    for (const { opcoes } of mockMapas) {
      const sourceLayers = (opcoes.style?.layers ?? []).map(
        (camada: CamadaDeEstilo) => camada["source-layer"],
      );
      expect(sourceLayers).not.toContain("poi");
      expect(sourceLayers).toContain("transportation_name");
      // Pin centralizado por construção + interatividade e atribuição OFF
      // (o crédito cumpre-se na linha própria abaixo da área cartográfica).
      expect(opcoes.center).toEqual([-46.6559, -23.5614]);
      expect(opcoes.attributionControl).toBe(false);
      expect(opcoes.interactive).toBe(false);
    }
    expect(mockMarcadores.map((m) => m.lngLat)).toContainEqual([
      -46.6559, -23.5614,
    ]);

    // Link externo do Google preservado, com apelido no nome acessível.
    const link = hospedeiro.querySelector<HTMLAnchorElement>(
      "a[aria-label='Abrir no Google Maps — endereço Casa']",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("href")).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        "Rua das Acácias, 120, Jardim Primavera, Paracatu, MG, Brasil",
      )}`,
    );

    // Privacidade: nada pessoal na consulta de geocode.
    const consultas = fetchEspiao.mock.calls.map((chamada) =>
      String(chamada[0]),
    );
    for (const consulta of consultas) {
      expect(consulta).not.toContain("Maria");
      expect(consulta).not.toContain("Apto");
      expect(consulta).not.toContain("mercado");
    }
  });

  it("editar e excluir continuam funcionando com o mapa montado", async () => {
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return respostaGeocode();
    });
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
    await avancaMicrotarefas();
    expect(hospedeiro.querySelectorAll(".address-card-map")).toHaveLength(1);
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

  it("desmontar o cartão DESTRÓI o mapa (map.remove) — não vaza WebGL/worker/listener", async () => {
    // Risco 1 da revisão de 29/09: sem dispose, cada montagem acumulava um
    // contexto WebGL e listeners; fechar/reabrir cartões consumia memória.
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return respostaGeocode();
    });
    await renderizar({ showMaps: true });
    await avancaMicrotarefas();
    expect(mockInstancias.length).toBe(2); // um mapa por cartão montado
    expect(mockInstancias.every((i) => !i.removido)).toBe(true);
    act(() => {
      raiz.unmount();
    });
    expect(mockInstancias.every((i) => i.removido)).toBe(true);
  });

  it("estilo pendente NÃO segura 'Carregando…' para sempre: o timeout do cartão decide", async () => {
    // Risco 2 da revisão de 29/09: o fetch do estilo não recebia sinal — o
    // abort de 12 s só alcançava o geocode e o cartão ficava preso em
    // "consultando". Agora o estilo corre contra o MESMO timeout (race).
    // resetModules: o cache do estilo é em NÍVEL DE MÓDULO e testes
    // anteriores desta arquivo já o resolveram — este teste precisa do
    // cache VAZIO para pendurar o fetch.
    vi.resetModules();
    const { AddressList: AddressListFresca } = await import(
      "@/components/ui/custom/AddressList"
    );
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("openfreemap")) return new Promise<Response>(() => {}); // nunca resolve (estilo pendente)
        if (url.includes("photon")) return respostaGeocode();
        return Promise.reject(new Error("url inesperada no teste"));
      });
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      // Antes do timeout: ainda carregando (e o maplibre nem foi baixado).
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("consultando");
      expect(mockImportacoesDoMaplibre).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_500);
      });
      // O abort do cartão rejeita a race do estilo → degradação graciosa.
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(
        hospedeiro.querySelector(".address-card-map__status")?.textContent,
      ).toBe("Mapa indisponível. O endereço acima continua válido.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falha do estilo NÃO fica cacheada: reconectar e remontar RECUPERA o mapa", async () => {
    // Risco 2 (metade 2) da revisão: a rejeição do fetch compartilhado ficava
    // gravada na sessão inteira — reconexão não recuperava. Agora o catch
    // limpa o cache e a próxima montagem tenta de novo. resetModules pelo
    // mesmo motivo do teste anterior: cache de módulo limpo no início.
    vi.resetModules();
    const { AddressList: AddressListFresca } = await import(
      "@/components/ui/custom/AddressList"
    );
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap"))
        return Promise.reject(new TypeError("Failed to fetch")); // "sem rede"
      return respostaGeocode();
    });
    await act(async () => {
      raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
    });
    await avancaMicrotarefas();
    expect(
      hospedeiro.querySelector(".address-card-map")?.getAttribute("data-fase"),
    ).toBe("indisponivel");

    // "Rede voltou": novo stub com estilo OK e REMONTAGEM limpa do componente
    // (MESMA instância de módulo — a que gravou a rejeição; sem o cache-clear
    // o mapa não voltaria).
    act(() => {
      raiz.unmount();
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return respostaGeocode();
    });
    await act(async () => {
      raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
    });
    await avancaMicrotarefas();
    expect(
      hospedeiro.querySelector(".address-card-map")?.getAttribute("data-fase"),
    ).toBe("mapa"); // sem o cache-clear isso seria "indisponivel" para sempre
  });

  it("erro ASSÍNCRONO do MapLibre antes da 1ª carga degrada e destrói SÓ o cartão afetado", async () => {
    // Risco 3 da revisão: sem listener no evento `error`, o endpoint de tiles
    // caindo depois do estilo deixava canvas vazio travado em fase "mapa".
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return respostaGeocode();
    });
    await renderizar({ showMaps: true });
    await avancaMicrotarefas();
    expect(
      [...hospedeiro.querySelectorAll(".address-card-map")].map((n) =>
        n.getAttribute("data-fase"),
      ),
    ).toEqual(["mapa", "mapa"]);
    // O mapa do 1º cartão erroa (tiles caíram) sem nunca ter carregado:
    mockInstancias[0].emitir("error");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      [...hospedeiro.querySelectorAll(".address-card-map")].map((n) =>
        n.getAttribute("data-fase"),
      ),
    ).toEqual(["indisponivel", "mapa"]); // só o afetado degrada
    expect(mockInstancias[0].removido).toBe(true); // e é destruído
    expect(mockInstancias[1].removido).toBe(false);
  });

  it("erro DEPOIS da 1ª carga é transitório: o mapa já pintado permanece", async () => {
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return respostaGeocode();
    });
    await renderizar({ showMaps: true });
    await avancaMicrotarefas();
    // Ambos os mapas concluíram a 1ª renderização (evento `load`):
    mockInstancias.forEach((instancia) => instancia.emitir("load"));
    // Falha pontual de tile depois disso NÃO derruba o mapa:
    mockInstancias[0].emitir("error");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      [...hospedeiro.querySelectorAll(".address-card-map")].map((n) =>
        n.getAttribute("data-fase"),
      ),
    ).toEqual(["mapa", "mapa"]);
    expect(mockInstancias.every((i) => !i.removido)).toBe(true);
  });

  it("tiles que NUNCA chegam: o timeout do cartão degrada o canvas vazio (sem 'load')", async () => {
    // Risco 3 (metade 2): estilo carrega, mapa constrói, mas o endpoint de
    // tiles morre — nenhum `load`, canvas em branco. O abort de 12 s agora
    // alcança esse estado e degrada em vez de deixar "mapa" para sempre.
    vi.resetModules();
    const { AddressList: AddressListFresca } = await import(
      "@/components/ui/custom/AddressList"
    );
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("openfreemap")) return respostaOk(ESTILO);
        return respostaGeocode();
      });
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      // Drena estilo+geocode → import → rAF → construção (NENHUM load emitido).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(mockInstancias.length).toBe(1);
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("mapa");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_500);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(mockInstancias[0].removido).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PENDÊNCIA do estilo: timeout invalida o cache e a REMONTAGEM busca de novo (recupera)", async () => {
    // Revisão 3, defeito A: fetch do estilo pendente para sempre + timeout do
    // cartão — a pendência não pode ser reusada. Após "reconectar" e
    // remontar, um FETCH NOVO tem que acontecer e o mapa tem que aparecer.
    vi.resetModules();
    const { AddressList: AddressListFresca } = await import(
      "@/components/ui/custom/AddressList"
    );
    vi.useFakeTimers();
    try {
      let buscasDeEstilo = 0;
      vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("openfreemap")) {
          buscasDeEstilo += 1;
          if (buscasDeEstilo === 1) return new Promise<Response>(() => {}); // 1ª busca: pendente p/ sempre
          return respostaOk(ESTILO); // buscas seguintes: rede voltou
        }
        return respostaGeocode();
      });
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_500);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(buscasDeEstilo).toBe(1);

      // Remontagem NA MESMA instância de módulo: sem a invalidação, a
      // pendência seria reusada e expiraria de novo.
      act(() => {
        raiz.unmount();
      });
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(buscasDeEstilo).toBe(2); // fetch NOVO — a pendência morreu com o timeout
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("mapa");
    } finally {
      vi.useRealTimers();
    }
  });

  it("import do renderer LENTO demais: perde o prazo, degrada e NUNCA constrói mapa órfão", async () => {
    // Revisão 3, defeito B: o timer de 12 s podia vencer DURANTE o
    // `await carregarRenderer()` e os checkpoints só olhavam `ativo` — o
    // mapa era construído depois do prazo, sem timer para cobri-lo. Agora o
    // renderer também corre contra o sinal e os checkpoints pós-await
    // testam `signal.aborted`. O import lento é simulado com `vi.doMock` +
    // barreira: a factory do mock só resolve quando o teste libera (a
    // factory do `vi.mock` global é cacheada no registro de mocks e não
    // roda de novo — por isso o doMock aqui).
    let liberarImport: (() => void) | undefined;
    vi.doMock("maplibre-gl", async () => {
      await new Promise<void>((resolve) => {
        liberarImport = resolve;
      });
      return {
        Map: class {
          readonly ouvintes = new Map<string, () => void>();
          removido = false;
          constructor(opcoes: OpcoesDoMapa) {
            mockMapas.push({ opcoes });
            mockInstancias.push(this);
          }
          on(evento: string, retorno: () => void) {
            this.ouvintes.set(evento, retorno);
            return this;
          }
          emitir(evento: string) {
            this.ouvintes.get(evento)?.();
          }
          remove() {
            this.removido = true;
          }
        },
        Marker: class {
          setLngLat(lngLat: [number, number]) {
            mockMarcadores.push({ lngLat });
            return this;
          }
          addTo() {
            return this;
          }
        },
      };
    });
    vi.resetModules();
    const { AddressList: AddressListFresca } = await import(
      "@/components/ui/custom/AddressList"
    );
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("openfreemap")) return respostaOk(ESTILO);
        return respostaGeocode();
      });
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      // Estilo + geocode OK; o import segue pendente (barreira fechada).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("consultando");
      // O prazo do cartão vence com o import pendente → race rejeita →
      // degradação graciosa, SEM construir mapa.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_500);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(mockInstancias.length).toBe(0); // nenhum mapa órfão
      // O import enfim chega (tarde demais): nada muda — o efeito já saiu.
      liberarImport?.();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(mockInstancias.length).toBe(0);
    } finally {
      liberarImport?.(); // nunca deixar a factory pendurada para os próximos testes
      vi.useRealTimers();
    }
  });

  it("P1 TARDIA não contamina P2: concluiu é por promessa e a 3ª busca acontece (4ª revisão)", async () => {
    // Corrida da 4ª revisão: com flag GLOBAL de conclusão, P1 expirava e
    // saía do cache; remontagem criava P2 pendente; a .finally DA P1
    // (resolvendo atrasada) marcava o flag global true; P2 expirava e o
    // listener via "concluiu" — não invalidava P2 — e toda montagem
    // seguinte herdava P2 para sempre. Agora a conclusão vive NA PRÓPRIA
    // entrada: P1 tardia só marca P1; P2 pendente é invalidada; a 3ª busca
    // acontece e o mapa aparece.
    vi.resetModules();
    const { AddressList: AddressListFresca } = await import(
      "@/components/ui/custom/AddressList"
    );
    vi.useFakeTimers();
    try {
      let buscasDeEstilo = 0;
      let resolverP1: ((valor: unknown) => void) | undefined;
      vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("openfreemap")) {
          buscasDeEstilo += 1;
          if (buscasDeEstilo === 1)
            // P1: eu decido QUANDO resolve (tarde, fora do cache já)
            return new Promise((resolve) => {
              resolverP1 = resolve;
            });
          if (buscasDeEstilo === 2) return new Promise<Response>(() => {}); // P2: pendente p/ sempre
          return respostaOk(ESTILO); // P3 em diante: rede boa
        }
        return respostaGeocode();
      });

      // Montagem 1: P1 pendente → timeout → inválida.
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_500);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(buscasDeEstilo).toBe(1);

      // Montagem 2: cria P2 (busca 2, pendente) — P1 AINDA não resolveu.
      act(() => {
        raiz.unmount();
      });
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      // A ordem É o teste: P2 já existe pendente quando a P1 — órfã,
      // fora do cache — resolve atrasada. No código antigo, a .finally DA
      // P1 marcava o flag GLOBAL "concluiu" true e o listener do timeout
      // de P2 não a invalidava — montagens seguintes herdavam P2 para
      // sempre. Na versão nova, a conclusão vive na entrada DA PRÓPRIA
      // promessa: P1 tardia só marca P1.
      resolverP1?.({
        ok: true,
        json: () => Promise.resolve(ESTILO),
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // P2 (busca 2) expira: precisa ser invalidada MESMO com P1 tendo
      // concluído depois dela nascer.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_500);
      });
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("indisponivel");
      expect(buscasDeEstilo).toBe(2);

      // Montagem 3: P2 pendente foi invalidada (conclusão por promessa) →
      // busca 3 resolve → o MAPA APARECE. No código antigo: P2 herdada,
      // expirava de novo — mapa nunca mais.
      act(() => {
        raiz.unmount();
      });
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
      await act(async () => {
        raiz.render(<AddressListFresca addresses={[CASA]} showMaps />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(buscasDeEstilo).toBe(3);
      expect(
        hospedeiro
          .querySelector(".address-card-map")
          ?.getAttribute("data-fase"),
      ).toBe("mapa");
    } finally {
      vi.useRealTimers();
    }
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

  it("sem rua e sem CEP não há mapa: devolve null (nada de mapa vazio)", () => {
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
// desmonta (o chunk do maplibre só é baixado quando um mapa monta).
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
  useOrders: () => ({ orders: [], fetchUserOrders: async () => [] }),
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
    mockMapas.length = 0;
    mockMarcadores.length = 0;
    mockImportacoesDoMaplibre = 0;
    vi.stubGlobal("fetch", (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("openfreemap")) return respostaOk(ESTILO);
      return respostaGeocode();
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("abre compacto sem mapa e sem importar maplibre; expandir monta um mapa por cartão; recolher desmonta", async () => {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Compacto: nenhum mapa montado, maplibre nunca baixado.
    expect(hospedeiro.querySelectorAll(".address-card-map")).toHaveLength(0);
    expect(mockImportacoesDoMaplibre).toBe(0);

    const botaoExpandir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver mais detalhes"),
    );
    expect(botaoExpandir).toBeTruthy();
    await act(async () => {
      botaoExpandir!.click();
    });
    await avancaMicrotarefas();

    // Expandido: um mapa por cartão, na ordem dos endereços; zero iframes.
    const mapas = hospedeiro.querySelectorAll(".address-card-map");
    expect(mapas).toHaveLength(2);
    expect(hospedeiro.querySelectorAll("iframe")).toHaveLength(0);

    const botaoRecolher = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver menos detalhes"),
    );
    await act(async () => {
      botaoRecolher!.click();
    });
    expect(hospedeiro.querySelectorAll(".address-card-map")).toHaveLength(0);
  });
});
