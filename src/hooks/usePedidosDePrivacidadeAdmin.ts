import {
  COLUNAS_DO_PEDIDO_DE_PRIVACIDADE,
  type PedidoDePrivacidade,
  classificarFalhaDoPedido,
  lerPedidosDePrivacidade,
} from "@/lib/pedidos-de-privacidade";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Os pedidos de privacidade vistos PELA LOJA (Ajustes → "Pedidos de privacidade
 * dos clientes"): lê todos e marca como atendido ou recusado, com uma nota.
 *
 * Quem protege é a RLS (só o administrador de AGORA lê todos e decide) e o
 * gatilho do banco (carimba quem e quando decidiu; decisão é final). Este hook
 * NÃO tem como apagar: não existe `delete` aqui nem política que deixe — de
 * propósito (registro legal).
 */

/**
 * Quantos pedidos JÁ RESPONDIDOS a tela traz (os mais novos primeiro); passou
 * disso a tela diz que cortou (não finge ver tudo).
 */
const TETO_DE_RESPONDIDOS = 200;

/**
 * Os pedidos ABERTOS nunca são cortados por um limite pequeno: pedido aberto é
 * prazo legal correndo, e um pedido novo não pode sumir da tela só porque há
 * muitos respondidos. Este teto é o limite de linhas por consulta do servidor
 * (PostgREST); chegar nele é caso absurdo, mas a tela avisa em vez de fingir.
 */
const TETO_DE_ABERTOS = 1000;

/** Quantos ids de cliente vão por consulta de nomes (URL curta o bastante). */
const IDS_POR_CONSULTA_DE_NOMES = 100;

export type CargaDaLista = "carregando" | "pronta" | "erro";

export type FalhaDaDecisao = "ja_decidido" | "sem_rede" | "outra";

export type ResultadoDaDecisao =
  | { ok: true }
  | { ok: false; falha: FalhaDaDecisao };

export interface UsePedidosDePrivacidadeAdmin {
  readonly carga: CargaDaLista;
  readonly pedidos: readonly PedidoDePrivacidade[];
  /** Nome de quem pediu (de `profiles`); ausente = a tela diz "Cliente". */
  readonly nomes: ReadonlyMap<string, string>;
  /** `true` se havia mais pedidos RESPONDIDOS que o teto — a lista deles é parcial. */
  readonly cortou: boolean;
  /** `true` se os pedidos ABERTOS bateram no limite do servidor (caso absurdo, mas nunca silencioso). */
  readonly abertosCortou: boolean;
  /** O pedido que está sendo decidido agora (um por vez), ou `null`. */
  readonly decidindo: string | null;
  recarregar: () => Promise<void>;
  decidir: (
    id: string,
    situacao: "atendido" | "recusado",
    observacao: string,
  ) => Promise<ResultadoDaDecisao>;
}

export function usePedidosDePrivacidadeAdmin(): UsePedidosDePrivacidadeAdmin {
  const [carga, setCarga] = useState<CargaDaLista>("carregando");
  const [pedidos, setPedidos] = useState<PedidoDePrivacidade[]>([]);
  const [nomes, setNomes] = useState<ReadonlyMap<string, string>>(new Map());
  const [cortou, setCortou] = useState(false);
  const [abertosCortou, setAbertosCortou] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const ativoRef = useRef(true);
  const decidindoRef = useRef(false);
  const rodadaRef = useRef(0);

  const recarregar = useCallback(async () => {
    const rodada = ++rodadaRef.current;
    // Lista já na tela segue na tela enquanto relê (depois de decidir um pedido);
    // só a primeira leitura e a que vem depois de um erro mostram "carregando".
    setCarga((antes) => (antes === "pronta" ? antes : "carregando"));
    try {
      // DUAS consultas, e não uma lista só cortada: os ABERTOS vêm todos (do
      // mais antigo, o mais urgente, ao mais novo) e só os RESPONDIDOS têm
      // limite (do mais novo ao mais antigo). Com uma lista só, ordenada do
      // mais antigo e cortada, o pedido aberto NOVO era justamente o que sumia.
      const [rAbertos, rRespondidos] = await Promise.all([
        supabase
          .from("pedidos_de_privacidade")
          .select(COLUNAS_DO_PEDIDO_DE_PRIVACIDADE)
          .eq("situacao", "aberto")
          .order("criado_em", { ascending: true })
          .limit(TETO_DE_ABERTOS),
        supabase
          .from("pedidos_de_privacidade")
          .select(COLUNAS_DO_PEDIDO_DE_PRIVACIDADE)
          .neq("situacao", "aberto")
          .order("atendido_em", { ascending: false })
          .limit(TETO_DE_RESPONDIDOS + 1),
      ]);
      if (!ativoRef.current || rodada !== rodadaRef.current) return;
      if (rAbertos.error || rRespondidos.error) {
        // Releitura que falha com a lista já na tela: mantém a lista (o que se
        // viu é verdade), só uma primeira leitura vira o erro da tela.
        setCarga((antes) => (antes === "pronta" ? antes : "erro"));
        return;
      }
      const abertos = lerPedidosDePrivacidade(rAbertos.data);
      const respondidosLidos = lerPedidosDePrivacidade(rRespondidos.data);
      const passouDoTeto =
        (rRespondidos.data?.length ?? 0) > TETO_DE_RESPONDIDOS;
      const respondidos = passouDoTeto
        ? respondidosLidos.slice(0, TETO_DE_RESPONDIDOS)
        : respondidosLidos;
      const mostrados = [...abertos, ...respondidos];

      // O nome de quem pediu é conforto, não requisito: se a leitura cair, a
      // lista segue sem nome (a tela diz "Cliente") em vez de sumir. Em
      // pedaços, para a lista de ids não estourar o tamanho da URL.
      const mapa = new Map<string, string>();
      const ids = [...new Set(mostrados.map((p) => p.user_id))];
      for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA_DE_NOMES) {
        try {
          const { data: perfis } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", ids.slice(i, i + IDS_POR_CONSULTA_DE_NOMES));
          for (const perfil of (perfis ?? []) as Array<{
            id: string;
            full_name: string | null;
          }>) {
            const nome = (perfil.full_name ?? "").trim();
            if (nome) mapa.set(perfil.id, nome);
          }
        } catch {
          // sem os nomes deste pedaço nesta rodada
        }
      }
      if (!ativoRef.current || rodada !== rodadaRef.current) return;
      setPedidos(mostrados);
      setNomes(mapa);
      setCortou(passouDoTeto);
      setAbertosCortou((rAbertos.data?.length ?? 0) >= TETO_DE_ABERTOS);
      setCarga("pronta");
    } catch {
      if (!ativoRef.current || rodada !== rodadaRef.current) return;
      setCarga((antes) => (antes === "pronta" ? antes : "erro"));
    }
  }, []);

  useEffect(() => {
    ativoRef.current = true;
    void recarregar();
    return () => {
      ativoRef.current = false;
    };
  }, [recarregar]);

  const decidir = useCallback(
    async (
      id: string,
      situacao: "atendido" | "recusado",
      observacao: string,
    ): Promise<ResultadoDaDecisao> => {
      if (decidindoRef.current) return { ok: false, falha: "ja_decidido" };
      decidindoRef.current = true;
      setDecidindo(id);
      try {
        // `.eq("situacao", "aberto")` + `.select()`: devolve a linha SE e só se
        // este toque a decidiu. Zero linha = alguém decidiu antes, ou a pessoa
        // não é mais administradora (a RLS filtra em silêncio).
        const { data, error } = await supabase
          .from("pedidos_de_privacidade")
          .update({
            situacao,
            observacao: observacao.trim() === "" ? null : observacao.trim(),
          })
          .eq("id", id)
          .eq("situacao", "aberto")
          .select("id");
        if (error) {
          // 55000 = o gatilho do banco recusou: o pedido já tinha sido decidido.
          const falha = classificarFalhaDaDecisao(error);
          if (falha === "ja_decidido") await recarregar();
          return { ok: false, falha };
        }
        if (!data || data.length === 0) {
          await recarregar();
          return { ok: false, falha: "ja_decidido" };
        }
        await recarregar();
        return { ok: true };
      } catch (erro) {
        return { ok: false, falha: classificarFalhaDaDecisao(erro) };
      } finally {
        decidindoRef.current = false;
        if (ativoRef.current) setDecidindo(null);
      }
    },
    [recarregar],
  );

  return {
    carga,
    pedidos,
    nomes,
    cortou,
    abertosCortou,
    decidindo,
    recarregar,
    decidir,
  };
}

function classificarFalhaDaDecisao(erro: unknown): FalhaDaDecisao {
  const codigo =
    typeof erro === "object" && erro !== null && "code" in erro
      ? (erro as { code: unknown }).code
      : null;
  if (codigo === "55000" || codigo === "42501") return "ja_decidido";
  return classificarFalhaDoPedido(erro) === "sem_rede" ? "sem_rede" : "outra";
}
