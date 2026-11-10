import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { ufBrasileiraValida } from "@/lib/uf-brasileira";
import type { Address } from "@/types";
import { PrazoEsgotado, comPrazo } from "@/utils/com-prazo";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const LISTA_VAZIA: Address[] = [];

// PRAZO DAS CHAMADAS DE ENDEREÇO. Rede "pendurada" conecta e não responde: sem
// prazo o "Salvar" travava o formulário inteiro e o "Editar endereço" abria em
// "Carregando…" sem Voltar. É um prazo da ESPERA da tela: o servidor pode
// concluir a escrita depois dele (ver `aoChegarDepois` em addAddress).
export const PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS = 15_000;

// Escrita que estourou: o servidor PODE ter gravado. A frase manda conferir a
// lista antes de repetir -- repetir às cegas duplica o endereço.
const MENSAGEM_ENDERECO_SEM_RESPOSTA =
  "A conexão está lenta e não sabemos se o endereço foi salvo. Confira a lista de endereços antes de tentar de novo, para não repetir.";
const MENSAGEM_EDICAO_SEM_RESPOSTA =
  "A conexão está lenta e não sabemos se a alteração foi salva. Confira o endereço na lista antes de tentar de novo.";
const MENSAGEM_EXCLUSAO_SEM_RESPOSTA =
  "Sem resposta da rede. Confira se o endereço foi excluído antes de tentar de novo.";
const MENSAGEM_PROMOCAO_SEM_RESPOSTA =
  "Sem resposta da rede. Confira qual endereço ficou como principal antes de tentar de novo.";
const MENSAGEM_LEITURA_SEM_RESPOSTA =
  "A conexão está lenta e não conseguimos carregar seus endereços.";
// Frase longa: fica na tela mais que os 4 s padrão do toast.
const DURACAO_DO_AVISO_LONGO_MS = 8_000;

// UMA LISTA POR CONTA, VÁRIAS TELAS: cada tela que usa este hook tem o
// próprio estado — e o carrinho continua montado atrás do checkout. Sem
// aviso entre elas, o endereço criado ou editado no checkout (ou na tela de
// endereço) não existia para o carrinho, que seguia cotando o frete do
// principal. Toda lista gravada (busca, inclusão, edição, remoção) é
// publicada aqui; as outras instâncias DA MESMA CONTA adotam.
interface PublicacaoDaLista {
  dono: string;
  itens: Address[];
  origem: symbol;
  leituraConfirmada: boolean;
}
type OuvinteDaLista = (publicacao: PublicacaoDaLista) => void;
const ouvintesDaLista = new Set<OuvinteDaLista>();

function publicarLista(publicacao: PublicacaoDaLista) {
  for (const ouvir of ouvintesDaLista) ouvir(publicacao);
}

interface EstadoDaLista {
  /** Conta dueña de `itens`. A lista só é exposta para ELA. */
  dono: string | null;
  itens: Address[];
}

function carregarCacheDoDisco(id: string | null | undefined): Address[] {
  if (!id || typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(`ikcous_addresses_cache_${id}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Error loading cached addresses:", e);
  }
  return [];
}

// O banco devolve "principal primeiro, depois o mais novo". Um endereço
// recém-criado (e não principal) é o mais novo: entra logo depois do
// principal, para a lista local e a recarregada terem a MESMA ordem — é dela
// que o carrinho tira o endereço de entrega quando nada foi escolhido.
function inserirDepoisDoPrincipal(itens: Address[], novo: Address): Address[] {
  const posicao = itens.findIndex((a) => !a.is_default);
  if (posicao === -1) return [...itens, novo];
  return [...itens.slice(0, posicao), novo, ...itens.slice(posicao)];
}

// Lê do servidor a lista de endereços da conta: principal primeiro, depois o
// mais novo. Estoura (erro, prazo ou resposta sem dados) em vez de devolver
// lista vazia: lista vazia não prova "a conta não tem endereço".
async function lerEnderecosDoServidor(idDaConta: string): Promise<Address[]> {
  // `then` do builder do supabase não é Promise: `Promise.resolve` primeiro.
  const { data, error } = await comPrazo(
    Promise.resolve(
      supabase
        .from("user_addresses")
        .select("*")
        .eq("user_id", idDaConta)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false }),
    ),
    PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS,
  );
  if (error) throw error;
  if (!data) throw new Error("consulta de endereços voltou sem dados");
  return data.map((a) => ({
    id: a.id,
    user_id: a.user_id,
    name: a.name,
    recipient_name: a.recipient_name,
    cep: a.cep,
    street: a.street,
    number: a.number,
    complement: a.complement,
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    reference: a.reference,
    is_default: a.is_default || false,
  }));
}

// Lista do servidor com o endereço promovido (se houve) na frente, marcado.
function comPromovidoNaFrente(
  lista: Address[],
  promovidoId: string | null,
): Address[] {
  const promovido = lista.find((a) => a.id === promovidoId);
  if (!promovido) return lista;
  return [
    { ...promovido, is_default: true },
    ...lista.filter((a) => a.id !== promovido.id),
  ];
}

export function useAddresses() {
  const { user } = useAuth();
  const usuarioId = user?.id;
  // Identidade da conta: resposta em voo da conta ANTERIOR (troca/logout)
  // não grava estado nem cache.
  const usuarioAtualRef = useRef(user?.id);
  // A lista nasce vinculada à conta corrente e só é exposta para ela — nem
  // no primeiro render após a troca a lista da conta anterior aparece.
  const [estado, setEstado] = useState<EstadoDaLista>(() => ({
    dono: user?.id ?? null,
    itens: carregarCacheDoDisco(user?.id),
  }));
  const [loading, setLoading] = useState(false);
  const [contaComErro, setContaComErro] = useState<string | null>(null);
  // Espelho síncrono do estado: as mutações calculam a lista nova a partir
  // DELE (e não num updater funcional), para gravar disco, estado e aviso às
  // outras telas com o MESMO valor.
  const estadoRef = useRef(estado);
  const [identidade] = useState(() => Symbol("useAddresses"));
  const consultaRef = useRef(0);
  // Conta cuja lista JÁ foi lida COM SUCESSO do servidor (nesta tela ou em
  // outra, via publicação). Lista vazia em memória não prova "a conta não tem
  // endereço": também é o que sobra quando a leitura falhou ou ainda não veio.
  const leituraConfirmadaDeRef = useRef<string | null>(null);

  const gravarLista = useCallback(
    (dono: string, itens: Address[], leituraConfirmada = false) => {
      // Uma gravação confirmada invalida buscas iniciadas antes dela.
      consultaRef.current++;
      setLoading(false);
      if (leituraConfirmada) leituraConfirmadaDeRef.current = dono;
      const novo = { dono, itens };
      estadoRef.current = novo;
      setEstado(novo);
      try {
        localStorage.setItem(
          `ikcous_addresses_cache_${dono}`,
          JSON.stringify(itens),
        );
      } catch {
        // cota/modo privado: a lista em memória continua valendo
      }
      publicarLista({ dono, itens, origem: identidade, leituraConfirmada });
    },
    [identidade],
  );

  useEffect(() => {
    const ouvir: OuvinteDaLista = ({
      dono,
      itens,
      origem,
      leituraConfirmada,
    }) => {
      if (origem === identidade) return;
      // Lista de OUTRA conta nunca entra (troca de conta em voo).
      if (dono !== usuarioAtualRef.current) return;
      consultaRef.current++;
      setLoading(false);
      const novo = { dono, itens };
      estadoRef.current = novo;
      setEstado(novo);
      // Mutação sobre o cache não confirma que a lista inteira foi lida.
      if (leituraConfirmada) {
        leituraConfirmadaDeRef.current = dono;
        setContaComErro(null);
      }
    };
    ouvintesDaLista.add(ouvir);
    return () => {
      ouvintesDaLista.delete(ouvir);
    };
  }, [identidade]);

  const addresses =
    estado.dono === (user?.id ?? null) ? estado.itens : LISTA_VAZIA;

  useEffect(() => {
    usuarioAtualRef.current = user?.id;
    consultaRef.current++;
    leituraConfirmadaDeRef.current = null;
    setLoading(false);
    setContaComErro(null);
  }, [user?.id]);

  // Troca de conta: recarrega o cache DA CONTA CORRENTE.
  useEffect(() => {
    const id = user?.id ?? null;
    const novo = { dono: id, itens: carregarCacheDoDisco(id) };
    estadoRef.current = novo;
    setEstado(novo);
  }, [user?.id]);

  // `silencioso`: releitura de fundo (a cliente voltou ao app). Falhar nela não
  // vira aviso nem banner de erro: a lista que a tela já tem continua valendo.
  const fetchAddresses = useCallback(
    async (opcoes?: { silencioso?: boolean }) => {
      // Depende do ID, não do objeto `user`: um `user` novo a cada render (o
      // contexto troca de identidade sem trocar de conta) recriaria esta função
      // e faria as telas, cujo efeito relê quando ela muda, lerem sem parar.
      if (!usuarioId) return;
      const idDaBusca = usuarioId;
      const consulta = ++consultaRef.current;
      const atual = () =>
        usuarioAtualRef.current === idDaBusca &&
        consulta === consultaRef.current;
      const cacheKey = `ikcous_addresses_cache_${idDaBusca}`;
      let hasCache = false;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          hasCache = true;
        }
      } catch {
        // ignore localStorage issues
      }

      if (!hasCache) {
        setLoading(true);
      }
      try {
        const mapped = await lerEnderecosDoServidor(idDaBusca);
        if (!atual()) return;
        gravarLista(idDaBusca, mapped, true);
        setContaComErro(null);
      } catch (error) {
        if (!atual()) return;
        console.error("Error fetching addresses:", error);
        // Só se cala quando a tela JÁ tem uma lista lida do servidor para
        // continuar mostrando. Sem ela (aparelho novo, leitura de abertura em
        // voo que esta releitura acabou de invalidar), calar apagaria o único
        // aviso de erro e o Perfil diria "nenhum endereço" a quem tem.
        if (
          opcoes?.silencioso === true &&
          leituraConfirmadaDeRef.current === idDaBusca
        ) {
          return;
        }
        setContaComErro(idDaBusca);
        toast.error(
          error instanceof PrazoEsgotado
            ? MENSAGEM_LEITURA_SEM_RESPOSTA
            : "Erro ao carregar endereços",
        );
      } finally {
        if (atual()) {
          setLoading(false);
        }
      }
    },
    [usuarioId, gravarLista],
  );

  // A escrita estourou o prazo e o servidor respondeu DEPOIS: a lista da tela
  // não sabe do que ele gravou. Relê do servidor (fonte da verdade) -- e só se
  // a conta ainda é a mesma: `fetchAddresses` liga o `loading` antes de
  // conferir a conta, e soltá-lo para a conta nova não é com ela.
  const reconciliarDepoisDoPrazo = (
    idDaConta: string,
    resposta: { data: unknown; error: unknown },
  ) => {
    if (resposta.error || !resposta.data) return;
    if (usuarioAtualRef.current !== idDaConta) return;
    void fetchAddresses();
  };

  // Sem principal o carrinho cai no primeiro da lista e a escolha muda sozinha
  // ao recarregar. O gatilho do banco só age quando a linha NOVA é principal,
  // então quem apaga ou desliga o principal promove o próximo aqui. Falhar não
  // desfaz o que a cliente fez: segue sem principal, como antes.
  const promoverNoBanco = async (
    idDaConta: string,
    id: string,
    aoEsgotarPrazo: () => void,
  ) => {
    try {
      const { error } = await comPrazo(
        Promise.resolve(
          supabase
            .from("user_addresses")
            .update({ is_default: true })
            .eq("id", id)
            .eq("user_id", idDaConta),
        ),
        PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS,
        undefined,
        (resposta) => {
          if (!resposta.error && usuarioAtualRef.current === idDaConta) {
            void fetchAddresses();
          }
        },
      );
      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error promoting address:", error);
      if (
        error instanceof PrazoEsgotado &&
        usuarioAtualRef.current === idDaConta
      ) {
        toast.error(MENSAGEM_PROMOCAO_SEM_RESPOSTA, {
          duration: DURACAO_DO_AVISO_LONGO_MS,
        });
        aoEsgotarPrazo();
      }
      return false;
    }
  };

  const addAddress = async (address: Omit<Address, "id" | "user_id">) => {
    if (!user) return null;
    if (!ufBrasileiraValida(address.state)) {
      toast.error("Estado inválido");
      return null;
    }
    const idDaConta = user.id;
    try {
      // O primeiro endereço da conta vira o principal sozinho -- mas só quando
      // a lista foi LIDA com sucesso e está vazia. Lista vazia por leitura que
      // falhou (ou que ainda não veio) faria o endereço novo tomar a marca de
      // um principal que já existe (o gatilho do banco desmarca os outros).
      const isFirst =
        addresses.length === 0 && leituraConfirmadaDeRef.current === idDaConta;
      const newAddress = {
        ...address,
        user_id: user.id,
        is_default: isFirst ? true : address.is_default,
      };

      const { data, error } = await comPrazo(
        Promise.resolve(
          supabase.from("user_addresses").insert(newAddress).select().single(),
        ),
        PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS,
        undefined,
        (resposta) => reconciliarDepoisDoPrazo(idDaConta, resposta),
      );

      if (error) throw error;
      // Resposta da conta anterior não grava nada, nem avisa sucesso.
      if (usuarioAtualRef.current !== idDaConta) return null;

      const formattedAddress: Address = {
        id: data.id,
        user_id: data.user_id,
        name: data.name,
        recipient_name: data.recipient_name,
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        reference: data.reference,
        is_default: data.is_default || false,
      };

      const prev = estadoRef.current;
      // Estado trocou de dono em voo: não escreve.
      if (prev.dono === idDaConta) {
        // If new address is default, update others
        const updated: Address[] = formattedAddress.is_default
          ? [
              formattedAddress,
              ...prev.itens.map((a) => ({ ...a, is_default: false })),
            ]
          : inserirDepoisDoPrincipal(prev.itens, formattedAddress);
        gravarLista(idDaConta, updated);
      }

      toast.success("Endereço adicionado com sucesso");
      return formattedAddress;
    } catch (error) {
      if (usuarioAtualRef.current !== idDaConta) return null;
      console.error("Error adding address:", error);
      if (error instanceof PrazoEsgotado) {
        toast.error(MENSAGEM_ENDERECO_SEM_RESPOSTA, {
          duration: DURACAO_DO_AVISO_LONGO_MS,
        });
      } else {
        toast.error("Erro ao adicionar endereço");
      }
      return null;
    }
  };

  const updateAddress = async (id: string, updates: Partial<Address>) => {
    if (!user) return false;
    if (updates.state !== undefined && !ufBrasileiraValida(updates.state)) {
      toast.error("Estado inválido");
      return false;
    }
    const idDaConta = user.id;
    try {
      const { data, error } = await comPrazo(
        Promise.resolve(
          supabase
            .from("user_addresses")
            .update(updates)
            .eq("id", id)
            .eq("user_id", user.id)
            .select()
            .single(),
        ),
        PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS,
        undefined,
        (resposta) => reconciliarDepoisDoPrazo(idDaConta, resposta),
      );

      if (error) throw error;
      // Resposta da conta anterior não grava nada, nem avisa sucesso.
      if (usuarioAtualRef.current !== idDaConta) return false;

      // Edição que manda `is_default: false` (o formulário real sempre manda
      // `is_default`): se sobrar outro endereço e a conta ficar sem principal,
      // o mais recente assume --
      // mas QUEM ESTÁ SEM PRINCIPAL se decide pela lista do SERVIDOR, não pela
      // do aparelho: outro aparelho pode ter marcado outro principal (promover
      // o "próximo" da lista velha tiraria a marca dele) ou ter feito deste o
      // principal sem este aparelho saber. Se a releitura falhar, vale a lista
      // guardada, como antes: o que a cliente fez não se desfaz.
      let promovidoId: string | null = null;
      let promocaoSemResposta = false;
      let principalMudouEmOutroAparelho = false;
      let listaFresca: Address[] | null = null;
      if (updates.is_default === false) {
        listaFresca = await lerEnderecosDoServidor(idDaConta).catch(() => null);
        if (usuarioAtualRef.current !== idDaConta) return false;
        if (listaFresca) {
          const proximo = listaFresca.find((a) => a.id !== id);
          if (proximo && !listaFresca.some((a) => a.is_default)) {
            if (
              await promoverNoBanco(idDaConta, proximo.id, () => {
                promocaoSemResposta = true;
              })
            ) {
              promovidoId = proximo.id;
            }
            if (usuarioAtualRef.current !== idDaConta) return false;
          }
        } else {
          const antes = estadoRef.current;
          const eraPrincipal =
            antes.dono === idDaConta &&
            antes.itens.some((a) => a.id === id && a.is_default);
          const proximo = antes.itens.find((a) => a.id !== id && !a.is_default);
          if (eraPrincipal && proximo) {
            if (
              await promoverNoBanco(idDaConta, proximo.id, () => {
                promocaoSemResposta = true;
              })
            ) {
              promovidoId = proximo.id;
            }
            if (usuarioAtualRef.current !== idDaConta) return false;
          }
        }
      }

      const formattedAddress: Address = {
        id: data.id,
        user_id: data.user_id,
        name: data.name,
        recipient_name: data.recipient_name,
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        reference: data.reference,
        is_default: data.is_default || false,
      };

      const prev = estadoRef.current;
      // Estado trocou de dono em voo: não escreve.
      if (prev.dono === idDaConta && listaFresca) {
        gravarLista(
          idDaConta,
          comPromovidoNaFrente(listaFresca, promovidoId),
          true,
        );
      } else if (prev.dono === idDaConta) {
        // Edição que NÃO fala de principal (o formulário só manda `is_default`
        // quando a cliente mexeu nele): a linha devolvida traz a marca que o
        // servidor tem AGORA. Se ela difere da que este aparelho achava, outro
        // aparelho mudou o principal desde a última leitura e a lista daqui
        // ficaria sem principal (ou com dois) -- relê depois de publicar.
        const antes = prev.itens.find((a) => a.id === id);
        if (
          updates.is_default === undefined &&
          antes &&
          !!antes.is_default !== !!formattedAddress.is_default
        ) {
          principalMudouEmOutroAparelho = true;
        }
        const promovido = prev.itens.find((a) => a.id === promovidoId);
        const updated: Address[] = promovido
          ? [
              { ...promovido, is_default: true },
              ...prev.itens
                .filter((a) => a.id !== promovido.id)
                .map((a) => (a.id === id ? formattedAddress : a)),
            ]
          : updates.is_default
            ? prev.itens
                .map((a) =>
                  a.id === id ? formattedAddress : { ...a, is_default: false },
                )
                .sort((a, b) =>
                  a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1,
                )
            : prev.itens.map((a) => (a.id === id ? formattedAddress : a));
        gravarLista(idDaConta, updated);
      }

      // Só depois da publicação local: ela invalida consultas anteriores.
      if (promocaoSemResposta) void fetchAddresses();
      else if (principalMudouEmOutroAparelho)
        void fetchAddresses({ silencioso: true });
      toast.success("Endereço atualizado");
      return true;
    } catch (error) {
      if (usuarioAtualRef.current !== idDaConta) return false;
      console.error("Error updating address:", error);
      if (error instanceof PrazoEsgotado) {
        toast.error(MENSAGEM_EDICAO_SEM_RESPOSTA, {
          duration: DURACAO_DO_AVISO_LONGO_MS,
        });
      } else {
        toast.error("Erro ao atualizar endereço");
      }
      return false;
    }
  };

  const deleteAddress = async (id: string) => {
    if (!user) return false;
    const idDaConta = user.id;
    try {
      const { error } = await comPrazo(
        Promise.resolve(
          supabase
            .from("user_addresses")
            .delete()
            .eq("id", id)
            .eq("user_id", user.id),
        ),
        PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS,
        undefined,
        (resposta) => {
          // DELETE sem select devolve data nulo mesmo quando foi confirmado.
          if (!resposta.error && usuarioAtualRef.current === idDaConta) {
            void fetchAddresses();
          }
        },
      );

      if (error) throw error;
      // Resposta da conta anterior não grava nada, nem avisa sucesso.
      if (usuarioAtualRef.current !== idDaConta) return false;

      // Sobrou endereço e a conta ficou sem principal: o mais recente assume.
      // Quem decide é a lista do SERVIDOR, não a do aparelho: outro aparelho
      // pode ter marcado outro principal (a promoção da lista velha tiraria a
      // marca dele) ou ter feito deste o principal sem este aparelho saber
      // (ninguém seria promovido). Se a releitura falhar, vale a lista
      // guardada, como antes: o que a cliente fez não se desfaz.
      const listaFresca = await lerEnderecosDoServidor(idDaConta).catch(
        () => null,
      );
      if (usuarioAtualRef.current !== idDaConta) return false;
      let promovidoId: string | null = null;
      let promocaoSemResposta = false;
      if (listaFresca) {
        if (listaFresca.length > 0 && !listaFresca.some((a) => a.is_default)) {
          const proximo = listaFresca[0];
          if (
            await promoverNoBanco(idDaConta, proximo.id, () => {
              promocaoSemResposta = true;
            })
          ) {
            promovidoId = proximo.id;
          }
          if (usuarioAtualRef.current !== idDaConta) return false;
        }
      } else {
        const antes = estadoRef.current;
        const restantes =
          antes.dono === idDaConta
            ? antes.itens.filter((a) => a.id !== id)
            : [];
        const apagouPrincipal =
          antes.dono === idDaConta &&
          antes.itens.some((a) => a.id === id && a.is_default);
        if (apagouPrincipal && restantes.length > 0) {
          const proximo = restantes[0];
          if (
            await promoverNoBanco(idDaConta, proximo.id, () => {
              promocaoSemResposta = true;
            })
          ) {
            promovidoId = proximo.id;
          }
          if (usuarioAtualRef.current !== idDaConta) return false;
        }
      }

      const prev = estadoRef.current;
      // Estado trocou de dono em voo: não escreve.
      if (prev.dono === idDaConta && listaFresca) {
        gravarLista(
          idDaConta,
          comPromovidoNaFrente(listaFresca, promovidoId),
          true,
        );
      } else if (prev.dono === idDaConta) {
        gravarLista(
          idDaConta,
          prev.itens
            .filter((a) => a.id !== id)
            .map((a) =>
              a.id === promovidoId ? { ...a, is_default: true } : a,
            ),
        );
      }
      if (promocaoSemResposta) void fetchAddresses();
      toast.success("Endereço removido");
      return true;
    } catch (error) {
      if (usuarioAtualRef.current !== idDaConta) return false;
      console.error("Error deleting address:", error);
      if (error instanceof PrazoEsgotado) {
        toast.error(MENSAGEM_EXCLUSAO_SEM_RESPOSTA, {
          duration: DURACAO_DO_AVISO_LONGO_MS,
        });
        void fetchAddresses();
      } else {
        toast.error("Erro ao remover endereço");
      }
      return false;
    }
  };

  return {
    addresses,
    loading,
    erroAoCarregar: contaComErro !== null && contaComErro === user?.id,
    fetchAddresses,
    addAddress,
    updateAddress,
    deleteAddress,
  };
}
