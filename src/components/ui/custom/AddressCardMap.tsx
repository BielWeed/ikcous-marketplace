import type { Address } from "@/types";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
// Estilos AUTÔNOMOS do mapa do cartão (não depende do address-layout.css
// da frente de cadastro, que ainda não está nesta branch).
import "@/components/ui/custom/address-card-map.css";

/**
 * Mapa limpo do cartão de endereço (Perfil) — vetor OpenFreeMap, estilo
 * "positron" (29/09/2026, decisão do dono: mapa visível em cada cartão,
 * visual limpo parecido com Google, sem POIs/controles, marcador correto,
 * crédito legal discreto, custo novo zero).
 *
 * DECISÕES (protótipo validado em .codex/previews/prototipo-mapa.tsx):
 * - Estilo "positron" NÃO tem camada de POI (55 camadas, nenhuma
 *   `source-layer: poi`) — e ainda filtramos qualquer camada de POI que
 *   um futuro estilo venha a trazer (defesa em profundidade).
 * - `attributionControl: false`: a atribuição exigida NÃO fica sobreposta
 *   ao mapa — vira UMA linha discreta ABAIXO da área cartográfica, com
 *   links (mínimo legal legível; diretriz OSMF aceita crédito na
 *   vizinhança da obra). Mapa interativo desligado: nada de zoom/satélite.
 * - maplibre-gl entra por IMPORT DINÂMICO: só é baixado quando um mapa
 *   realmente monta (chunk próprio; o bundle da cliente não cresce).
 * - Falha de rede/estilo/geocode/timeout → mensagem amigável; o cartão
 *   continua útil (endereço + link externo do AddressList).
 * - Privacidade: a consulta de geocode usa SÓ campos geográficos —
 *   destinatário, complemento, referência e apelido NUNCA saem (mesma
 *   regra do queryMapsDoEndereco).
 */

type Location = { lat: number; lng: number };

const ESTILO_POSITRON = "https://tiles.openfreemap.org/styles/positron";
const GEOCODE = "https://photon.komoot.io/api/";
const TIMEOUT_MS = 12_000;

/** Estilo compartilhado: 1 fetch por sessão, independentemente do nº de cartões.
 *
 * Endurecimento das revisões (29/09, rodadas 2–4): o fetch do estilo corre
 * contra o TIMEOUT DO PRÓPRIO CARTÃO (race com o AbortSignal do efeito) e
 * nada de ruim fica cacheado — rejeição ou pendência abandonada invalidam
 * a entrada PARA A PRÓXIMA MONTAGEM buscar de novo. O sinal NÃO aborta o
 * fetch compartilhado de propósito (o timeout de um cartão não mata o
 * pedido dos outros).
 *
 * Revisão 4 (corrida P2): a conclusão é estado DA PRÓPRIA PROMESSA (entrada
 * em closure com checagem de IDENTIDADE), nunca um flag global — uma P1
 * que resolve atrasada só marca a entrada DELA; não pode contaminar uma P2
 * pendente no cache (o flag global deixava P2 herdada para sempre). */
interface EntradaDeEstilo {
  readonly promessa: Promise<unknown>;
  concluiu: boolean;
}

let entradaDeEstilo: EntradaDeEstilo | undefined;

function buscarEstilo(): EntradaDeEstilo {
  const entrada: EntradaDeEstilo = {
    concluiu: false,
    promessa: fetch(ESTILO_POSITRON)
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`estilo HTTP ${resposta.status}`);
        return resposta.json();
      })
      .catch((erro: unknown) => {
        // Rejeição desta entrada não vira estado permanente — mas só derruba
        // o cache se ELE ainda é esta entrada (uma rejeição tardia de P1 não
        // pode limpar uma P2 válida no cache — mesma classe de corrida).
        if (entradaDeEstilo === entrada) entradaDeEstilo = undefined;
        throw erro;
      })
      .finally(() => {
        entrada.concluiu = true; // estado POR PROMESSA, nunca global
      }),
  };
  entradaDeEstilo = entrada;
  return entrada;
}

function carregarEstilo(sinal: AbortSignal): Promise<unknown> {
  const entrada = entradaDeEstilo ?? buscarEstilo();
  return Promise.race([
    entrada.promessa,
    new Promise<never>((_, rejeitar) => {
      sinal.addEventListener(
        "abort",
        () => {
          // Pendência invalidada por IDENTIDADE + estado desta entrada: só
          // derruba o cache se ele ainda é ESTA entrada e ELA não concluiu.
          if (entradaDeEstilo === entrada && !entrada.concluiu)
            entradaDeEstilo = undefined;
          rejeitar(
            sinal.reason ??
              new DOMException("estilo: tempo esgotado", "AbortError"),
          );
        },
        { once: true },
      );
    }),
  ]);
}

/** Renderer compartilhado: 1 import dinâmico por sessão — todos os cartões
 * awaitam a MESMA promessa. Também corre contra o sinal do cartão (revisão
 * 3): um import lento demais perde para o timeout e o cartão degrada em
 * vez de construir um mapa depois do prazo, sem timer para cobri-lo. Uma
 * promessa de import que JÁ resolveu é boa para sempre — não se invalida. */
let rendererEmCache: Promise<typeof import("maplibre-gl")> | undefined;
function carregarRenderer(sinal: AbortSignal) {
  rendererEmCache ??= import("maplibre-gl");
  return Promise.race([
    rendererEmCache,
    new Promise<never>((_, rejeitar) => {
      sinal.addEventListener(
        "abort",
        () =>
          rejeitar(
            sinal.reason ??
              new DOMException("renderer: tempo esgotado", "AbortError"),
          ),
        { once: true },
      );
    }),
  ]);
}

/** Só dados geográficos; nunca destinatário, complemento, referência ou apelido. */
function queryGeografica(address: Address): string {
  return [
    address.street?.trim(),
    address.number?.trim(),
    address.neighborhood?.trim(),
    address.city?.trim(),
    address.state?.trim(),
    address.cep?.trim(),
    "Brasil",
  ]
    .filter(Boolean)
    .join(", ");
}

async function geocode(
  query: string,
  sinal: AbortSignal,
): Promise<Location | null> {
  const resposta = await fetch(
    `${GEOCODE}?${new URLSearchParams({ q: query, countrycode: "BR", limit: "1" })}`,
    { signal: sinal },
  );
  if (!resposta.ok) return null;
  const dados = await resposta.json();
  const coordenadas = dados?.features?.[0]?.geometry?.coordinates;
  const [lng, lat] = Array.isArray(coordenadas) ? coordenadas : [];
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return { lat, lng };
}

export function AddressCardMap({ address }: { address: Address }) {
  const [fase, setFase] = useState<"consultando" | "mapa" | "indisponivel">(
    "consultando",
  );
  const hospedeiro = useRef<HTMLDivElement>(null);

  // Fase 1 — dados (estilo + geocode). Qualquer falha aqui é degradação
  // graciosa: o cartão segue útil, e o maplibre-gl NEM é baixado.
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setFase("indisponivel");
      return;
    }
    const controller = new AbortController();
    let ativo = true;
    // Destruição do mapa na DESMONTAGEM (risco 1 da revisão de 29/09): sem
    // `map.remove()`, fechar/reabrir cartões acumula contexto WebGL, worker
    // e listeners do MapLibre a cada montagem.
    let dispose: (() => void) | undefined;
    // Risco 3 da revisão: erros ASSÍNCRONOS do MapLibre (evento `error` da
    // API oficial) e tiles que nunca chegam. Política: erro antes da 1ª
    // renderização completa (evento `load`) degrada e destrói o mapa; erro
    // DEPOIS de carregado é transitório e tolerado (mapa já pintado); e o
    // próprio timeout de 12 s do cartão alcança o canvas em branco.
    let mapaCarregou = false;
    let degrade: (() => void) | undefined;
    const timer = setTimeout(() => {
      controller.abort();
      degrade?.(); // tiles pendentes até aqui = canvas vazio: não fica "mapa"
    }, TIMEOUT_MS);
    (async () => {
      try {
        const [estilo, ponto] = await Promise.all([
          carregarEstilo(controller.signal),
          geocode(queryGeografica(address), controller.signal),
        ]);
        if (!ativo) return;
        if (!ponto) {
          setFase("indisponivel");
          return;
        }
        // Fase 2 — mapa (import dinâmico: sob demanda de verdade). A fase
        // muda para "mapa" ANTES de construir: o canvas não pode estar
        // `hidden` na construção (contêiner display:none = tamanho zero e
        // projeção errada do marcador — medido: −120 px). O import TAMBÉM
        // corre contra o sinal do cartão (revisão 3): import lento demais
        // perde o prazo e degrada — nunca constrói mapa órfão sem timer.
        const maplibregl = await carregarRenderer(controller.signal);
        if (!ativo) return;
        if (controller.signal.aborted) {
          setFase("indisponivel");
          return;
        }
        setFase("mapa");
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(null)),
        );
        if (!ativo) return;
        if (controller.signal.aborted) {
          setFase("indisponivel");
          return;
        }
        if (!hospedeiro.current) return;
        const camadasSemPoi =
          (estilo as { layers?: unknown[] }).layers?.filter(
            (camada) =>
              (camada as { "source-layer"?: string })["source-layer"] !== "poi",
          ) ?? [];
        // O estilo é JSON dinâmico vindouro da rede; o cast usa o tipo
        // exportado pelo próprio MapLibre (sem inventar especificação).
        const mapa = new maplibregl.Map({
          container: hospedeiro.current,
          style: {
            ...(estilo as object),
            layers: camadasSemPoi,
          } as import("maplibre-gl").StyleSpecification,
          center: [ponto.lng, ponto.lat],
          zoom: 16,
          interactive: false,
          // A atribuição não sobrepõe o mapa: linha própria abaixo (créditos).
          attributionControl: false,
        });
        const pino = document.createElement("span");
        pino.className = "address-map__pin";
        pino.style.display = "block";
        pino.style.width = "32px";
        pino.style.height = "42px";
        new maplibregl.Marker({ element: pino, anchor: "bottom" })
          .setLngLat([ponto.lng, ponto.lat])
          .addTo(mapa);
        dispose = () => mapa.remove();
        // 1ª renderização completa (style + tiles iniciais): a partir daqui
        // o mapa é utilizável e falhas pontuais de tile são transitórias.
        mapa.on("load", () => {
          mapaCarregou = true;
        });
        // Erro assíncrono ANTES da 1ª carga (tiles/style caíram): o canvas
        // ficaria vazio em fase "mapa" — degrada e destrói em vez disso.
        mapa.on("error", () => {
          degrade?.();
        });
        degrade = () => {
          if (mapaCarregou || !ativo) return;
          dispose?.();
          dispose = undefined;
          degrade = undefined; // idempotente
          setFase("indisponivel");
        };
        setFase("mapa");
      } catch {
        if (ativo) setFase("indisponivel");
      }
    })();
    return () => {
      ativo = false;
      clearTimeout(timer);
      controller.abort();
      dispose?.();
    };
    // Reconsulta só quando o ENDEREÇO muda (não a referência do objeto).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryGeografica(address)]);

  return (
    <div className="address-card-map" data-fase={fase}>
      <div
        ref={hospedeiro}
        aria-label="Localização aproximada no mapa"
        className="address-card-map__canvas"
        hidden={fase !== "mapa"}
      />
      {fase !== "mapa" && (
        <p role="status" className="address-card-map__status">
          {fase === "consultando"
            ? "Carregando mapa…"
            : "Mapa indisponível. O endereço acima continua válido."}
        </p>
      )}
      {/* Atribuição mínima COMPROVADA em fonte primária (29/09/2026) para a
          via VETORA: LICENSE.md do OpenMapTiles exige creditizar
          "OpenMapTiles" quando o mapa deriva do schema deles, e os dados são
          ODbL ("© OpenStreetMap contributors", diretrizes OSMF). O nome
          "OpenFreeMap" é OPCIONAL (openfreemap.org) e saiu. Linha única,
          discreta por tamanho e legível por contraste, ABAIXO da área
          cartográfica, com links, SEM overlay/toggle/opacidade — e exibida
          SÓ quando o mapa existe (sem mapa não há obra a creditar). */}
      {fase === "mapa" && (
        <p className="address-card-map__creditos" data-testid="creditos-mapa">
          <a
            href="https://openmaptiles.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            © OpenMapTiles
          </a>{" "}
          · dados{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            © OpenStreetMap contributors
          </a>
        </p>
      )}
    </div>
  );
}
