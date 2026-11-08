import { useAuth } from "@/hooks/useAuth";
import { cupomDoBanco } from "@/lib/cupom-do-banco";
import {
  ehRecusaPorLimiteDeUso,
  mensagemDeVagaPresa,
  minutosDaVagaPresa,
} from "@/lib/cupomPreso";
import { mensagemDeErroDoCupom } from "@/lib/erro-do-cupom";
import {
  PRAZO_DA_CONSULTA_DO_CHECKOUT_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { arredondarParaCentavos } from "@/lib/utils";
import type { ClienteDoCupom, Coupon } from "@/types";
import type { Database } from "@/types/database.types";
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const PRAZO_DA_GRAVACAO_DO_CUPOM_MS = 15_000;
const MENSAGEM_GRAVACAO_SEM_RESPOSTA =
  "Sem resposta da rede. Confira se a mudança no cupom apareceu antes de tentar de novo.";

function aguardarGravacaoDoCupom<T>(requisicao: PromiseLike<T>): Promise<T> {
  return aguardarComPrazo(
    Promise.resolve(requisicao),
    PRAZO_DA_GRAVACAO_DO_CUPOM_MS,
    () => erroDeConsultaSemResposta(MENSAGEM_GRAVACAO_SEM_RESPOSTA),
  );
}

/** Uma linha da busca de clientes do painel (sem CPF). */
export interface ClienteEncontradoParaCupom {
  readonly id: string;
  readonly full_name: string | null;
  readonly email: string | null;
}

/** A página que a busca devolve: `total` é o que o termo acha no banco inteiro. */
export interface PaginaDeClientesParaCupom {
  readonly clientes: readonly ClienteEncontradoParaCupom[];
  readonly total: number;
}

/**
 * Em quantos minutos volta a vaga do cupom presa num pedido cancelado do
 * cliente logado — ou `null` quando não há o que dizer. NUNCA lança e `null`
 * significa "mantém a frase de sempre": sem sessão (a RPC é só para
 * authenticated, nem se pergunta), RPC ausente (checkout novo + banco velho =
 * PGRST202), rede caída ou resposta fora do contrato são o mesmo caso.
 */
async function minutosDaVagaPresaDoCliente(
  code: string,
): Promise<number | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase.rpc("vaga_do_cupom_presa", {
      p_code: code,
    });
    if (error) return null;
    return minutosDaVagaPresa(data);
  } catch {
    return null;
  }
}

/**
 * O banco desta loja já tem a coluna `coupons.alcance` (migration
 * 20261208000000)? Lojas de teste recebem só o site, nunca a migration: site
 * novo + banco antigo é combinação PERMANENTE lá. A sonda lê só a coluna e
 * nenhuma linha (`limit(0)`): banco sem ela responde 42703.
 *
 * Só `true` quando a resposta veio limpa. Erro de rede, de permissão ou
 * cliente que nem consegue perguntar também dão `false` — esconder a opção é
 * de graça, oferecê-la num banco que a recusa quebra o salvar do cupom.
 */
async function bancoTemAlcanceDoCupom(): Promise<boolean> {
  try {
    const { error } = await supabase.from("coupons").select("alcance").limit(0);
    return !error;
  } catch {
    return false;
  }
}

/** O que o checkout recebe de uma tentativa de aplicar um cupom. */
interface ResultadoDaValidacaoDoCupom {
  valid: boolean;
  discount: number;
  message?: string;
  /** Laudo 31/08 (E1): true = a CONSULTA falhou (não é recusa do cupom) — quem revalida em segundo plano mantém o cupom como está. */
  networkError?: boolean;
}

/**
 * No cupom não existe botão "Tentar de novo", e "Aplicar" nem sempre serve: no
 * cartão da lista o toque é no próprio cartão, e com o campo vazio o botão
 * "Aplicar" está apagado. A frase serve aos dois caminhos e não aponta botão.
 */
const MENSAGEM_CUPOM_CONEXAO_LENTA =
  "A conexão está lenta. Tente aplicar o cupom de novo.";

/**
 * A consulta em si (sem prazo — quem chama é que limita a espera). LANÇA em
 * erro de rede/RPC; o chamador transforma em `networkError`.
 */
async function consultarCupom(
  code: string,
  subtotal: number,
): Promise<ResultadoDaValidacaoDoCupom> {
  // SecOps: validate_coupon_secure_v2 es SECURITY DEFINER
  const { data, error } = await supabase.rpc(
    "validate_coupon_secure_v2" as any,
    {
      p_code: code,
      p_subtotal: arredondarParaCentavos(subtotal),
    } as any,
  );

  if (error) throw error;

  const result = data as any;
  if (!result)
    return {
      valid: false,
      discount: 0,
      message: "Erro ao validar cupom",
    };

  // Cupom preso (#210/#116): recusa por LIMITE + sessão → pergunta se a
  // vaga está presa num pedido cancelado do próprio cliente. Só a
  // resposta confirmada troca a frase; cupom válido nunca pergunta.
  if (!result.is_valid && ehRecusaPorLimiteDeUso(result.error_message)) {
    const minutos = await minutosDaVagaPresaDoCliente(code);
    if (minutos !== null) {
      return {
        valid: false,
        discount: Number(result.discount_value),
        message: mensagemDeVagaPresa(code, minutos),
      };
    }
  }

  return {
    valid: result.is_valid,
    discount: Number(result.discount_value),
    message: result.error_message,
  };
}

/**
 * @param autoFetch carrega a lista de cupons ao montar (telas do painel).
 * @param sondarAlcance só o formulário do cupom precisa saber se o banco já
 *   tem o "quem pode usar"; as outras telas não pagam a consulta extra.
 */
export function useCoupons(autoFetch = false, sondarAlcance = false) {
  const { isAdmin } = useAuth();
  const [alcanceSuportado, setAlcanceSuportado] = useState(false);
  /** A sonda ja respondeu (sim ou nao): antes disso `false` e so 'ainda nao sei'. */
  const [alcanceSondado, setAlcanceSondado] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>(
    () => cachedCouponsData || [],
  );
  const [loading, setLoading] = useState(() => autoFetch && !cachedCouponsData); // Skip initial loader if cache is available
  const [erroDaListagem, setErroDaListagem] = useState<string | null>(null);
  const rodadaRef = useRef(0);

  // `silencioso`: a releitura DEPOIS de salvar/apagar não liga o `loading`,
  // que esmaece e trava a lista inteira (o 2º toque em seguida se perdia).
  const fetchCoupons = useCallback(
    async (silencioso = false, avisarErro = true) => {
      const rodada = ++rodadaRef.current;
      try {
        if (silencioso !== true) setLoading(true);

        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase
              .from("coupons")
              .select("*")
              .order("created_at", { ascending: false }),
          ),
          PRAZO_DA_CONSULTA_DO_CHECKOUT_MS,
          () => erroDeConsultaSemResposta(),
        );

        if (rodada !== rodadaRef.current) return;

        if (error) throw error;

        // PAINEL-12 + frente B: o mapeador único do cupom (usage_count só, `?? 0`;
        // alcance: banco sem a coluna = secreto).
        const formattedCoupons: Coupon[] =
          data?.map((c) => cupomDoBanco(c)) || [];

        setCachedCouponsData(formattedCoupons);
        setCoupons(formattedCoupons);
        setErroDaListagem(null);
      } catch (error) {
        if (rodada !== rodadaRef.current) return;
        console.error("Error fetching coupons:", error);
        setErroDaListagem(
          "Não conseguimos carregar os cupons agora. Seus cupons não sumiram.",
        );
        if (avisarErro) toast.error("Não foi possível carregar os cupons.");
      } finally {
        if (rodada === rodadaRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (autoFetch) {
      fetchCoupons();
    }
  }, [fetchCoupons, autoFetch]);

  useEffect(() => {
    if (!sondarAlcance) return;
    let vivo = true;
    bancoTemAlcanceDoCupom().then((sim) => {
      if (vivo) {
        setAlcanceSuportado(sim);
        setAlcanceSondado(true);
      }
    });
    return () => {
      vivo = false;
    };
  }, [sondarAlcance]);

  const validateCoupon = useCallback(
    async (
      code: string,
      subtotal: number,
    ): Promise<ResultadoDaValidacaoDoCupom> => {
      try {
        // Prazo na CADEIA inteira (validação + pergunta da vaga presa): rede
        // pendurada não pode deixar "Aplicando…" travando a tela do cupom.
        return await aguardarComPrazo(
          consultarCupom(code, subtotal),
          PRAZO_DA_CONSULTA_DO_CHECKOUT_MS,
          () => erroDeConsultaSemResposta(MENSAGEM_CUPOM_CONEXAO_LENTA),
        );
      } catch (error) {
        console.error("Error validating coupon:", error);
        return {
          valid: false,
          discount: 0,
          message: ehConsultaSemResposta(error)
            ? MENSAGEM_CUPOM_CONEXAO_LENTA
            : "Erro na conexão com servidor",
          networkError: true,
        };
      }
    },
    [],
  );

  const addCoupon = async (coupon: Omit<Coupon, "id" | "usageCount">) => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return null;
    }
    try {
      const { data, error } = await aguardarGravacaoDoCupom(
        supabase
          .from("coupons")
          .insert([
            {
              code: coupon.code,
              type: coupon.type,
              value: coupon.value,
              min_purchase: coupon.minPurchase,
              usage_limit: coupon.usageLimit,
              valid_until: coupon.validUntil,
              active: coupon.active ?? true,
              usage_count: 0,
              // Frente B: só vai quando NÃO é o padrão — criar cupom secreto
              // continua funcionando com o banco de antes da 20261208000000.
              ...(coupon.alcance && coupon.alcance !== "codigo"
                ? { alcance: coupon.alcance }
                : {}),
            },
          ])
          .select()
          .single(),
      );

      if (error) throw error;

      toast.success("Cupom criado com sucesso");
      if (autoFetch) fetchCoupons();
      return data;
    } catch (error) {
      console.error("Error adding coupon:", error);
      // Laudo 0109 (A4): a recusa mais comum — código repetido — chegava
      // como aviso genérico; o lojista não tinha como saber o motivo real.
      if (ehConsultaSemResposta(error)) {
        toast.error(MENSAGEM_GRAVACAO_SEM_RESPOSTA);
        void fetchCoupons(true, false);
      } else {
        toast.error(mensagemDeErroDoCupom(error, "Erro ao criar cupom"));
      }
      throw error;
    }
  };

  const updateCoupon = async (
    id: string,
    updates: Partial<Coupon>,
    clientes?: readonly string[],
  ) => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return;
    }

    // O estado mostrado só muda depois da confirmação do banco, inclusive
    // quando o formulário grava as regras e os clientes em duas chamadas.
    const anterior = coupons.find((c) => c.id === id);

    /*
      O UPDATE é montado por PRESENÇA DE CHAVE, não por valor (ADMIN-050, #96).

      Antes daqui saía um objeto com as sete chaves sempre presentes. Quem
      segurava os patches parciais de pé era um acidente: o `JSON.stringify` do
      supabase-js descarta chave `undefined` antes de virar SQL. O mesmo
      descarte causava o defeito — apagar a Validade mandava `undefined`, a
      coluna não ia no UPDATE, a data antiga sobrevivia, e a tela dizia "Cupom
      atualizado". Depois do vencimento o cupom parava de funcionar no checkout
      sem explicação.

      Trocar `undefined` por `null` no objeto fixo consertaria isso e quebraria
      coisa pior: `AdminCouponsView.tsx:564` liga/desliga cupom com
      `updateCoupon(id, { active })` — um patch de uma chave só. Com `null`
      forçado, cada clique no interruptor apagaria código, valor e validade.

      Com `in`, as duas intenções param de ser a mesma coisa:
        chave ausente  -> não mexe nesta coluna
        chave presente -> grava, e vazio vira NULL de verdade
    */
    type CouponUpdate = Database["public"]["Tables"]["coupons"]["Update"];
    const dbUpdates: CouponUpdate = {};
    if ("code" in updates) dbUpdates.code = updates.code;
    if ("type" in updates) dbUpdates.type = updates.type;
    if ("value" in updates) dbUpdates.value = updates.value;
    if ("minPurchase" in updates)
      dbUpdates.min_purchase = updates.minPurchase ?? null;
    if ("usageLimit" in updates)
      dbUpdates.usage_limit = updates.usageLimit ?? null;
    if ("validUntil" in updates)
      dbUpdates.valid_until = updates.validUntil ?? null;
    if ("active" in updates) dbUpdates.active = updates.active;
    // Frente B: o alcance só vai quando MUDOU em relação ao que a tela tinha
    // — salvar um cupom secreto continua funcionando com o banco de antes da
    // 20261208000000 (sem a coluna). Voltar de "exclusivo/vitrine" para
    // "codigo" é mudança e VAI. Cupom que não está na lista carregada tem
    // anterior desconhecido: o pedido vai como veio (nunca engolir a troca).
    if ("alcance" in updates && updates.alcance) {
      const mudou =
        !anterior || (anterior.alcance ?? "codigo") !== updates.alcance;
      if (mudou) dbUpdates.alcance = updates.alcance;
    }

    // As regras (primeiro passo) já chegaram ao banco? Se a lista (segundo
    // passo) falhar DEPOIS disso, o cupom está salvo e a lista não: o aviso
    // tem de dizer isso, senão "não foi possível salvar" mente — o cupom pode
    // ter virado "Clientes escolhidos" com a lista de antes (ou vazia).
    let regrasJaGravadas = false;
    try {
      // Remendo vazio (só a lista de clientes mudou, ou o alcance escolhido já é
      // o do banco): o UPDATE sem coluna não altera linha nenhuma e viraria
      // "Nenhum cupom foi alterado" para uma tela que já está como ela quer.
      if (Object.keys(dbUpdates).length > 0) {
        // `.select("id")`: o banco responde sucesso com 0 linhas quando a
        // política de acesso barra o UPDATE (ou o cupom não existe mais).
        const { data: gravadas, error } = await aguardarGravacaoDoCupom(
          supabase.from("coupons").update(dbUpdates).eq("id", id).select("id"),
        );

        if (error) throw error;
        if (!gravadas?.length) throw new Error("Nenhum cupom foi alterado.");
        regrasJaGravadas = true;
      }

      if (clientes !== undefined) {
        await definirClientesDoCupom(id, clientes);
      }
      setCoupons((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      );

      toast.success("Cupom atualizado");
      if (autoFetch) fetchCoupons(true);
    } catch (error) {
      console.error("Error updating coupon:", error);
      // Mesma régua do addCoupon (laudo 0109, A4): trocar o código por um
      // que já existe é recusa de constraint, não "revise as regras".
      if (regrasJaGravadas && clientes !== undefined) {
        // Falha parcial: cupom salvo, lista não. A tela não recarrega os
        // cupons por cima (o que ela escolheu fica para a nova tentativa) e
        // quem chamou mantém o formulário aberto.
        const semResposta = ehConsultaSemResposta(error);
        toast.error(
          semResposta
            ? "Sem resposta da rede. O cupom foi salvo, mas não sabemos se a lista de clientes também foi."
            : "O cupom foi salvo, mas a lista de clientes NÃO.",
          {
            description:
              (error as { code?: string } | null)?.code === "42501"
                ? 'Por enquanto vale a lista que estava salva antes (um cupom que acabou de virar "Clientes escolhidos" não vale para ninguém). Sua conta não tem mais permissão de administrador: entre de novo e salve o cupom outra vez.'
                : 'Por enquanto vale a lista que estava salva antes (um cupom que acabou de virar "Clientes escolhidos" não vale para ninguém). O que você escolheu continua na tela: toque em Salvar Cupom de novo para gravar a lista.',
            duration: 10000,
          },
        );
      } else if (ehConsultaSemResposta(error)) {
        toast.error(MENSAGEM_GRAVACAO_SEM_RESPOSTA);
        // Não espera a releitura para liberar quem está salvando. A escrita
        // pode ter chegado: nunca restaurar uma foto antiga por conta do prazo.
        void fetchCoupons(true, false);
      } else {
        toast.error(
          mensagemDeErroDoCupom(
            error,
            clientes !== undefined
              ? "Não foi possível salvar o cupom. Confira e tente de novo."
              : "Erro ao atualizar cupom",
          ),
        );
      }
      throw error;
    }
  };

  const deleteCoupon = async (id: string) => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return;
    }
    try {
      // `.select("id")`: 0 linhas apagadas também vem como sucesso.
      const { data: apagadas, error } = await aguardarGravacaoDoCupom(
        supabase.from("coupons").delete().eq("id", id).select("id"),
      );

      if (error) throw error;
      if (!apagadas?.length) throw new Error("Nenhum cupom foi apagado.");

      toast.success("Cupom removido");
      if (autoFetch) fetchCoupons(true);
    } catch (error) {
      console.error("Error deleting coupon:", error);
      // Laudo #2 (L-7): cupom com pedido no histórico é recusado pela FK
      // (23503) — apagar é impossível de verdade, e o erro genérico escondia
      // a saída que existe: DESATIVAR o cupom.
      const codigo = (error as { code?: string })?.code ?? "";
      const mensagem = String((error as { message?: string })?.message ?? "");
      if (ehConsultaSemResposta(error)) {
        toast.error(MENSAGEM_GRAVACAO_SEM_RESPOSTA);
        void fetchCoupons(true, false);
      } else if (
        codigo === "23503" ||
        mensagem.includes("foreign key") ||
        mensagem.includes("23503")
      ) {
        toast.error("Este cupom não pode ser apagado", {
          description:
            "Ele já está ligado a pedidos do histórico. Para que ninguém mais o use, DESATIVE-o na lista de cupons.",
          duration: 8000,
        });
      } else {
        toast.error("Erro ao remover cupom");
      }
      throw error;
    }
  };

  /** Contas que podem usar um cupom exclusivo (RPC do painel, sem CPF). */
  const listarClientesDoCupom = useCallback(
    async (couponId: string): Promise<ClienteDoCupom[]> => {
      const { data, error } = await supabase.rpc("admin_cupom_clientes", {
        p_coupon_id: couponId,
      });
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.user_id,
        nome: l.nome,
        email: l.email,
      }));
    },
    [],
  );

  /** Troca a lista inteira (atômica no servidor; só administradora ATUAL). */
  const definirClientesDoCupom = useCallback(
    async (couponId: string, clientes: readonly string[]): Promise<void> => {
      const { error } = await aguardarGravacaoDoCupom(
        supabase.rpc("admin_cupom_definir_clientes", {
          p_coupon_id: couponId,
          p_clientes: [...clientes],
        }),
      );
      if (error) throw error;
    },
    [],
  );

  /** Busca de contas para a lista do exclusivo (mesma RPC da tela de
   * Clientes e do balcão; a porta de admin é no servidor; sem CPF). */
  const buscarClientesParaCupom = useCallback(
    async (termo: string): Promise<PaginaDeClientesParaCupom> => {
      const { data, error } = await supabase.rpc("get_admin_customers_paged", {
        p_search: termo,
        p_sort_field: "created_at",
        p_sort_direction: "desc",
        p_page: 0,
        p_page_size: 8,
      });
      if (error) throw error;
      const resposta = data as {
        data?: unknown[];
        total_count?: unknown;
      } | null;
      const linhas = (resposta?.data ?? []) as Array<Record<string, unknown>>;
      const clientes = linhas.map((l) => ({
        id: String(l.id),
        full_name: typeof l.full_name === "string" ? l.full_name : null,
        email: typeof l.email === "string" ? l.email : null,
      }));
      // `total_count` é quantas contas o termo acha no banco inteiro, não só
      // nas 8 desta página — é o que deixa a tela avisar que há mais.
      const total = Number(resposta?.total_count);
      return {
        clientes,
        total: Number.isFinite(total) ? total : clientes.length,
      };
    },
    [],
  );

  const getCouponStats = useCallback(async () => {
    if (!isAdmin) {
      toast.error("Permissão negada");
      return null;
    }
    try {
      const { data, error } = await (supabase.rpc as any)("get_coupon_stats");
      if (error) throw error;
      return (data as any)?.[0] || null;
    } catch (error) {
      console.error("Error getting coupon stats:", error);
      return null;
    }
  }, [isAdmin]);

  return {
    coupons,
    loading,
    erroDaListagem,
    validateCoupon,
    refreshCoupons: fetchCoupons,
    addCoupon,
    updateCoupon,
    deleteCoupon,
    getCouponStats,
    /** `true` só depois da sonda confirmar a coluna `alcance` no banco. */
    alcanceSuportado,
    alcanceSondado,
    listarClientesDoCupom,
    definirClientesDoCupom,
    buscarClientesParaCupom,
  };
}
