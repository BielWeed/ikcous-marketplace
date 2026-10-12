import { SecaoRecolhivel } from "@/components/admin/primitivos/SecaoRecolhivel";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { lerSupabaseUrl } from "@/lib/env-valores";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { haptic } from "@/utils/haptic";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  PASSOS_DO_GUIA,
  RECADO_DE_SEGURANCA,
  montarPromptParaAgenteMp,
  urlDeNotificacoesDoWebhook,
} from "./mercado-pago-conteudo";

/**
 * Card "Mercado Pago" da tela de Ajustes — peça 20 (14/09/2026, pedido do
 * dono por voz): o LOJISTA cadastra as chaves do Mercado Pago dele, guiado
 * pelo passo a passo com prompt pronto para o agente de IA do app do MP, e
 * testa a conexão ali mesmo.
 *
 * SEGURANÇA (desenho desta peça, mais forte que o precedente das
 * transportadoras, que expõe o token):
 * - O Access Token NUNCA volta para a tela: o servidor só devolve MÁSCARA
 *   ("••••1234"). O campo de token nasce vazio; vazio ao salvar = mantém a
 *   chave já salva.
 * - O teste de conexão roda NO SERVIDOR (edge credenciais-mercado-pago) —
 *   a chave real nunca chega ao navegador, nem no teste.
 *
 * O PAGAMENTO PELO APP LIBERA SOZINHO (30/09/2026, pedido do dono: "a partir
 * do momento que ela cola lá, webhook dela, ela já libera... tem que ser assim
 * pra todo mundo"). O antigo interruptor "Receber PIX no app" (mp-4) morreu:
 * as três chaves salvas + o teste de conexão que passou LIGAM
 * `store_config.pagamento_online` (Pix e cartão pelo app) NO SERVIDOR, e o
 * lojista só PAUSA e RETOMA (ações `desligar_pix`/`ligar_pix` da mesma edge,
 * com os nomes antigos por compatibilidade). Regras de HONESTIDADE desta tela,
 * porque aqui se abre (ou se fecha) a porta do dinheiro:
 * - O estado mostrado é SEMPRE o que o servidor devolveu (`pix_ligado`,
 *   `pausado`, `faltando`) — nunca um palpite otimista do clique. Três
 *   leituras: "Recebendo pelo app", "Pausado por você" ou "Falta para receber
 *   pelo app:" com a lista em linguagem de leigo. Bloqueio mudo é a tela
 *   mentindo por omissão, então o que falta fica sempre à vista.
 * - A pausa vence o automático: salvar ou testar não religam quem pausou.
 * - Salvar credencial que mudou faz o servidor TESTAR na hora; a resposta traz
 *   o resultado do teste e o novo estado, e a tela mostra os dois. Credencial
 *   nova só fica ligada se o teste dela passou (senão o servidor desliga e a
 *   mensagem dele aparece — `aviso`).
 * - Chave de sandbox conecta igual à de produção: o aviso amarelo de
 *   ambiente "teste" vem PRONTO da edge e é mostrado como veio.
 * - (mp-9) O resultado de tudo isso sobe pelo `onPixAlternado` para quem
 *   hospeda a seção (a tela de Ajustes), porque o termômetro do PIX lê o
 *   retrato do BOOT da ficha e ficaria contando o estado antigo até um
 *   recarregamento completo.
 * - (H6, painel simples) Um status do PIX só: o termômetro no topo de
 *   Pagamentos. Esta seção não repete "Pix liberado" — fica com a AÇÃO
 *   (Pausar/Retomar) e com a lista do que falta, sempre à vista. O guia e as
 *   chaves moram em "Avançado: chaves do Mercado Pago" (`SecaoRecolhivel`
 *   montada; abre sozinha quando falta alguma coisa).
 *
 * Fluxo do dono, ditado por voz: a lojista cola as chaves, ELA SALVA e ELA
 * TESTA. Por isso "Testar conexão" fica bloqueado enquanto houver coisa
 * não salva — testar outra coisa diferente do que está na tela enganaria.
 */

/** O que a edge devolve no "ler"/"salvar" — segredo JAMAIS está aqui. */
type ConfiguracaoMp = {
  configurado: boolean;
  public_key: string | null;
  mascara_token: string | null;
  mascara_webhook: string | null;
  ultimo_teste: {
    quando: string;
    conectado: boolean;
    mensagem: string;
    ambiente: "producao" | "teste" | null;
    conta: string | null;
  } | null;
  atualizado_em: string | null;
  /** `store_config.pagamento_online` — o PIX está aceso para o cliente? */
  pix_ligado: boolean;
  /** A ficha da loja já carrega ESTA Public Key (e não outra, nem nenhuma). */
  public_key_na_loja: boolean;
  /**
   * O que ainda falta para receber pelo app (códigos da edge; vazio = tudo
   * pronto). `null` = a edge NÃO devolveu o campo: é uma edge ANTIGA (o front
   * sobe antes das functions), e "nada faltando" seria mentira — a tela cai no
   * modo "sistema sendo atualizado" em vez de afirmar o que não sabe.
   */
  faltando: string[] | null;
  /** O lojista pausou o pagamento pelo app (vence o automático). */
  pausado: boolean;
};

/** O que a edge devolve em salvar/testar/ligar/desligar — só o estado. */
type EstadoDevolvido = {
  pix_ligado?: boolean;
  pausado?: boolean;
  faltando?: unknown;
  testou?: boolean;
  public_key_na_loja?: boolean;
  aviso?: string;
};

const VAZIA: ConfiguracaoMp = {
  configurado: false,
  public_key: null,
  mascara_token: null,
  mascara_webhook: null,
  ultimo_teste: null,
  atualizado_em: null,
  pix_ligado: false,
  public_key_na_loja: false,
  faltando: [],
  pausado: false,
};

/**
 * A resposta da edge vira estado com os campos da FICHA e da PAUSA coercidos:
 * instalação com a edge antiga (que ainda não devolve `pix_ligado` /
 * `public_key_na_loja` / `faltando` / `pausado`) tem que virar "desligado",
 * "chave não publicada" e "não pausado" — e `faltando` AUSENTE vira `null`
 * ("servidor desatualizado"), nunca `[]`: "nada faltando" numa edge antiga
 * faria a tela dizer "Tudo preenchido" sobre uma loja que não liga sozinha.
 * `undefined` no estado o tornaria indefinido — e a tela passaria a inventar
 * sozinha o estado do dinheiro, que é justamente o que esta peça veio proibir.
 */
function comoConfig(data: unknown): ConfiguracaoMp {
  const lida = (data ?? {}) as ConfiguracaoMp;
  return {
    ...lida,
    pix_ligado: lida.pix_ligado === true,
    public_key_na_loja: lida.public_key_na_loja === true,
    faltando: Array.isArray(lida.faltando)
      ? comoListaDeFaltas(lida.faltando)
      : null,
    pausado: lida.pausado === true,
  };
}

function comoListaDeFaltas(valor: unknown): string[] {
  return Array.isArray(valor)
    ? valor.filter((falta): falta is string => typeof falta === "string")
    : [];
}

/**
 * O que falta, em linguagem de leigo (os códigos da edge nunca vão para a
 * tela). Código que esta tela não conhece cai numa frase genérica em vez de
 * vazar o nome interno.
 */
const TEXTO_DA_FALTA: ReadonlyMap<string, string> = new Map([
  ["public_key", "colar a chave pública"],
  ["access_token", "colar a chave secreta"],
  ["chave_notificacoes", "colar a senha dos avisos"],
  ["teste", "testar a conexão com o Mercado Pago"],
]);

function textoDaFalta(falta: string): string {
  return TEXTO_DA_FALTA.get(falta) ?? "completar as chaves";
}

/**
 * Recado amigável do erro de invoke: o corpo `{ erro }` vem da NOSSA edge
 * (frases escritas aqui do lado de cá do negócio, sem jargão e sem segredo)
 * e por isso pode ir direto para a tela. Todo o resto passa pelo tradutor
 * da casa, que só conhece causas fixas do SDK.
 *
 * A frase de serviço inativo existe porque a seção MENTIU uma vez: com a
 * edge ainda não publicada no projeto, o dono viu "Verifique sua internet"
 * com a internet perfeita (14/09/2026, 404 da função nova medido no
 * gateway). Serviço ausente e rede caída são conselhos diferentes.
 */
const SERVICO_DE_CHAVES_INATIVO =
  "O serviço de chaves do Mercado Pago ainda não está ativado nesta instalação. Fale com o suporte para ativá-lo no servidor.";

async function erroAmigavel(error: unknown, generico: string): Promise<string> {
  try {
    const detalhes = error as { name?: unknown; context?: unknown };
    if (
      detalhes?.name === "FunctionsHttpError" &&
      detalhes.context instanceof Response
    ) {
      const corpo = (await detalhes.context
        .clone()
        .json()
        .catch(() => null)) as { erro?: unknown } | null;
      if (corpo && typeof corpo.erro === "string" && corpo.erro) {
        return corpo.erro;
      }
    }
  } catch {
    // cai no tradutor da casa
  }
  return mensagemAmigavelErroEdgeFunction(error, {
    mensagemGenerica: generico,
    mensagemServicoInativo: SERVICO_DE_CHAVES_INATIVO,
  });
}

/**
 * Expansor de SEGUNDA camada (pedido do dono, 14/09 à noite vendo a tela:
 * o grupo "Mercado Pago" aberto despejava guia + formulário de uma vez e
 * poluía a tela). Nasce FECHADO, como o grupo que o abriga (decisão do dono
 * de 02/09); abrir/fechar é um clique no cabeçalho. O conteúdo DESMONTA
 * quando fecha — mesma semântica do SecaoColapsavel da view — mas o estado
 * do formulário mora no componente pai: fechar e reabrir não perde o que
 * foi digitado (e a trava "Salve antes de fechar" do grupo segue de pé
 * enquanto houver pendência).
 */
function Expansor({
  titulo,
  subtitulo,
  icone: Icone,
  aberto,
  onAlternar,
  children,
}: {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly icone: React.ElementType;
  readonly aberto: boolean;
  readonly onAlternar: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/60">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="group flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-admin-gold/10 text-admin-gold ring-1 ring-admin-gold/20">
            <Icone className="size-3.5" strokeWidth={2.25} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-black uppercase tracking-[0.2em] text-white">
              {titulo}
            </span>
            <span className="block truncate text-[11px] normal-case tracking-normal text-zinc-500">
              {subtitulo}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300",
            aberto && "rotate-180",
          )}
        />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-white/5 p-3.5 duration-200 animate-in fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

export const MercadoPagoSection = memo(function MercadoPagoSection({
  onDirtyMudou,
  onPixAlternado,
  abrirChavesGatilho = 0,
}: {
  /** Mesma trava das demais seções: avisa o pai para BLOQUEAR o fecho da
   * seção colapsável enquanto houver chave digitada e não salva. */
  readonly onDirtyMudou?: (dirty: boolean) => void;
  /** Eco do estado do PIX que o SERVIDOR devolveu (mp-9), para a tela que
   * hospeda esta seção não seguir mostrando o retrato do boot. Dispara em
   * liga/desliga, no salvar que a edge usou para desligar o PIX, e no `ler`
   * do mount (mp-10).
   *
   * O segundo argumento (`chaveNaLoja`) só vem preenchido no eco do `ler`:
   * é a ÚNICA das quatro chamadas em que "ligado" não garante Public Key
   * publicada — `ligar_pix`/`salvar` só devolvem `pix_ligado: true` quando a
   * edge PUBLICOU a chave junto (mp-8), mas `ler` devolve o retrato cru da
   * ficha (`pagamento_online`), que pode estar `true` com a Public Key
   * ausente (o mesmo estado do teste X6 deste arquivo). Sem este segundo
   * argumento, quem hospeda a seção teria de adivinhar "ligado = chave OK",
   * o que é falso justamente para o `ler` — e o painel de Ajustes acenderia
   * "Funcionando" com o PIX quebrado (achado da revisão de mp-10). */
  readonly onPixAlternado?: (ligado: boolean, chaveNaLoja?: boolean) => void;
  /** Contador que só CRESCE (H6): o atalho "Configurar credenciais" de
   * "Formas de pagamento" pede para cair direto nos campos das chaves —
   * abre "Avançado" e "Suas chaves" de uma vez. 0 = ninguém pediu. */
  readonly abrirChavesGatilho?: number;
}) {
  const isOffline = useOnlineStatus();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfiguracaoMp>(VAZIA);

  // Formulário: segredos nascem VAZIOS de propósito (mostrar o salvo
  // seria exibi-lo); a Public Key não é segredo e volta preenchida.
  const [publicKey, setPublicKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Pausar/retomar: `alternandoPix` segura o clique duplo; `avisoPix` é o
  // recado AMARELO que a edge devolve (chave de sandbox, "desliguei porque o
  // teste não passou"...) e `ecoDaVitrine` só aparece depois de uma mudança
  // de estado que deu certo — é a frase que explica por que a loja ainda
  // mostra o estado antigo.
  const [alternandoPix, setAlternandoPix] = useState(false);
  const [avisoPix, setAvisoPix] = useState<string | null>(null);
  const [ecoDaVitrine, setEcoDaVitrine] = useState(false);

  // Segunda camada (pedido do dono, 14/09 à noite): guia e chaves em
  // expandidores próprios, ambos FECHADOS por padrão — o grupo abre
  // mostrando só o resumo do status.
  const [guiaAberto, setGuiaAberto] = useState(false);
  // (H6) "Suas chaves" também abre sozinha quando há pendência (efeito mais
  // abaixo) ou quando o atalho "Configurar credenciais" pediu os campos.
  const [chavesAberto, setChavesAberto] = useState(
    () => abrirChavesGatilho > 0,
  );
  useEffect(() => {
    if (abrirChavesGatilho > 0) setChavesAberto(true);
  }, [abrirChavesGatilho]);

  const copiadoTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiadoTimer.current !== null) {
        window.clearTimeout(copiadoTimer.current);
      }
    },
    [],
  );

  // Ref para o callback mais recente (mesmo padrão de useRealtimeUpdate /
  // useDataVault): `ler` só PRECISA rodar uma vez no mount — colocar
  // `onPixAlternado` nas deps do useCallback abaixo faria a identidade de
  // `ler` mudar a cada render do pai (o prop chega como arrow function
  // inline em AdminSettingsView), e o `useEffect(() => ler(), [ler])`
  // re-executaria a leitura inteira a cada render alheio. O ref sempre
  // aponta para o callback mais atual sem participar da identidade de `ler`.
  const onPixAlternadoRef = useRef(onPixAlternado);
  useEffect(() => {
    onPixAlternadoRef.current = onPixAlternado;
  }, [onPixAlternado]);

  const ler = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: "ler" } },
      );
      if (error) throw error;
      const lida = comoConfig(data);
      setConfig(lida);
      setPublicKey(lida.public_key ?? "");
      // Eco do `ler` (mp-10): sem isto, o painel que hospeda esta seção
      // (AdminSettingsView) ficava preso no retrato do BOOT até o lojista
      // ligar/desligar ou salvar por aqui — a mesma tela contando dois
      // estados do dinheiro quando o boot já estava desatualizado (ex.:
      // alguém mudou a ficha por fora entre o boot e abrir esta seção).
      //
      // O SEGUNDO argumento (`lida.public_key_na_loja`) vai JUNTO: `ler`
      // não garante chave publicada como `ligar_pix`/`salvar` garantem — sem
      // ele, quem recebe o eco teria de inferir "ligado = chave OK", que é
      // falso bem aqui (achado BLOQUEIA da revisão de mp-10; ver o
      // comentário do prop `onPixAlternado`, acima).
      onPixAlternadoRef.current?.(lida.pix_ligado, lida.public_key_na_loja);
    } catch (err) {
      setErroCarga(
        await erroAmigavel(
          err,
          "Não consegui ler as chaves salvas agora. Tente de novo em instantes.",
        ),
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  // Sujo = algo na tela que ainda não é verdade no servidor. Public Key
  // diferente da salva OU qualquer segredo digitado.
  const dirty =
    publicKey !== (config.public_key ?? "") ||
    accessToken.length > 0 ||
    webhookSecret.length > 0;

  useEffect(() => {
    onDirtyMudou?.(dirty);
  }, [dirty, onDirtyMudou]);

  const salvar = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar.",
      });
      return;
    }
    // Não salva no meio de um pausar/retomar (as duas gravações correm juntas).
    if (salvando || alternandoPix) return;
    if (!publicKey.trim()) {
      toast.error("Cole a chave pública do Mercado Pago.");
      return;
    }
    if (!config.configurado && !accessToken.trim()) {
      toast.error(
        "Cole também a chave secreta — é ela que processa os pagamentos.",
      );
      return;
    }

    setSalvando(true);
    haptic.medium();
    try {
      // Segredo vazio NÃO vai na carga: servidor interpreta ausência como
      // "mantém a salva" — o campo vazio nunca apaga chave de verdade.
      const corpo: Record<string, unknown> = {
        acao: "salvar",
        public_key: publicKey.trim(),
      };
      if (accessToken.trim()) corpo.access_token = accessToken.trim();
      if (webhookSecret.trim()) corpo.webhook_secret = webhookSecret.trim();

      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: corpo },
      );
      if (error) throw error;

      const salva = comoConfig(data);
      const ligadoAntes = config.pix_ligado;
      setConfig(salva);
      setPublicKey(salva.public_key ?? "");
      setAccessToken("");
      setWebhookSecret("");

      // O servidor TESTOU a conexão dentro do salvar (se a credencial mudou)
      // e decidiu sozinho se o pagamento pelo app fica ligado: o resultado
      // do teste vem em `ultimo_teste` (já no `setConfig` acima) e a
      // mensagem do que ele fez — "Desliguei...", "não ligou...", chave de
      // TESTE — vem PRONTA em `aviso`. Calar isso é o lojista descobrindo
      // pelo cliente. O estado sobe SEMPRE para o painel da tela de Ajustes.
      const devolvido = (data ?? {}) as EstadoDevolvido;
      setAvisoPix(devolvido.aviso ?? null);
      setEcoDaVitrine(salva.pix_ligado !== ligadoAntes);
      onPixAlternado?.(salva.pix_ligado, salva.public_key_na_loja);
      haptic.success();
      // Só fala do TESTE quando ele rodou (`testou`): re-salvar sem mudar
      // nada não chama o Mercado Pago, e dizer "o teste passou" seria mentira.
      // Edge antiga (sem `faltando`/`testou`) não afirma nada além do salvo.
      toast.success("Chaves do Mercado Pago salvas!", {
        description: salva.pix_ligado
          ? devolvido.testou === true
            ? "O teste de conexão passou e o pagamento pelo app foi liberado."
            : "As chaves foram salvas."
          : salva.pausado
            ? "As chaves foram salvas; o pagamento pelo app segue pausado até você retomar."
            : salva.faltando === null
              ? "As chaves foram salvas."
              : "Veja abaixo o que ainda falta para receber pelo app.",
      });
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(
          err,
          "Não consegui salvar as chaves agora. Tente de novo.",
        ),
      );
    } finally {
      setSalvando(false);
    }
  };

  /**
   * Aplica o estado que o SERVIDOR devolveu (salvar/testar/pausar/retomar) —
   * nada de acender a tela no clique e descobrir depois que a ficha recusou.
   * Mostra o aviso que veio pronto, conta o atraso da vitrine quando o estado
   * MUDOU e ecoa para o painel da tela de Ajustes. A Public Key na ficha só
   * sobe quando a edge a informou (o painel infere "ligado = chave OK" só na
   * falta dela).
   */
  const aplicarEstadoDoServidor = (resposta: EstadoDevolvido) => {
    const ligado = resposta.pix_ligado === true;
    const chaveNaLoja =
      typeof resposta.public_key_na_loja === "boolean"
        ? resposta.public_key_na_loja
        : undefined;
    const mudou = ligado !== config.pix_ligado;
    setConfig((antes) => ({
      ...antes,
      pix_ligado: ligado,
      pausado:
        typeof resposta.pausado === "boolean"
          ? resposta.pausado
          : antes.pausado,
      faltando: Array.isArray(resposta.faltando)
        ? comoListaDeFaltas(resposta.faltando)
        : antes.faltando,
      ...(chaveNaLoja === undefined ? {} : { public_key_na_loja: chaveNaLoja }),
    }));
    setAvisoPix(resposta.aviso ?? null);
    setEcoDaVitrine(mudou);
    if (chaveNaLoja === undefined) onPixAlternado?.(ligado);
    else onPixAlternado?.(ligado, chaveNaLoja);
  };

  const testarConexao = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    if (testando || alternandoPix || dirty || !config.configurado) return;

    setTestando(true);
    haptic.light();
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: "testar" } },
      );
      if (error) throw error;
      const resultado = (data ?? {}) as EstadoDevolvido & {
        conectado: boolean;
        mensagem: string;
        ambiente?: "producao" | "teste" | null;
        conta?: string | null;
      };
      setConfig((antes) => ({
        ...antes,
        ultimo_teste: {
          quando: new Date().toISOString(),
          conectado: resultado.conectado,
          mensagem: resultado.mensagem,
          // Ambiente e conta VÊM da resposta do teste (a edge devolve os
          // dois): zerá-los aqui apagava da tela o que o servidor acabou de
          // apurar — e é o ambiente que explica o aviso de chave de sandbox.
          ambiente: resultado.ambiente ?? null,
          conta: resultado.conta ?? null,
        },
      }));
      // O servidor também RECONCILIOU o pagamento pelo app com o resultado
      // (liga se passou e não está pausado, desliga se falhou): mostra o que
      // ele fez. Edge antiga (sem `pix_ligado` na resposta) não mexe no estado.
      if (typeof resultado.pix_ligado === "boolean") {
        aplicarEstadoDoServidor(resultado);
      }
      if (resultado.conectado) haptic.success();
      else haptic.error();
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(
          err,
          "Não consegui testar a conexão agora. Tente de novo.",
        ),
      );
    } finally {
      setTestando(false);
    }
  };

  /**
   * PAUSAR (`desligar_pix`) e RETOMAR (`ligar_pix`): os nomes das ações
   * ficaram por compatibilidade. Pausar é o lado seguro e nunca é bloqueado;
   * retomar o servidor recusa (409, com o recado do que falta) se a loja não
   * estiver inteira — o recado dele vai para a tela como veio.
   */
  const pausarOuRetomar = async (retomar: boolean) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para mudar o pagamento pelo app.",
      });
      return;
    }
    // Nunca pausa/retoma no meio de um teste ou de um salvar: as gravações
    // do servidor correm juntas, e a pausa perderia a corrida.
    if (alternandoPix || carregando || testando || salvando) return;

    setAlternandoPix(true);
    setAvisoPix(null);
    setEcoDaVitrine(false);
    haptic.medium();
    try {
      const { data, error } = await supabase.functions.invoke(
        "credenciais-mercado-pago",
        { body: { acao: retomar ? "ligar_pix" : "desligar_pix" } },
      );
      if (error) throw error;
      aplicarEstadoDoServidor((data ?? {}) as EstadoDevolvido);
      haptic.success();
    } catch (err) {
      haptic.error();
      toast.error(
        await erroAmigavel(
          err,
          retomar
            ? "Não consegui retomar o pagamento pelo app agora. Tente de novo."
            : "Não consegui pausar o pagamento pelo app agora. Tente de novo.",
        ),
      );
    } finally {
      setAlternandoPix(false);
    }
  };

  // O prompt leva o endereço de notificações DESTA loja (peça 28): é o que
  // o lojista cola no painel do MP para o painel gerar a "Assinatura
  // secreta". Sem URL conhecida, o prompt pede o endereço em vez de inventar.
  const promptDoAgente = montarPromptParaAgenteMp({
    urlDeNotificacoes: urlDeNotificacoesDoWebhook(lerSupabaseUrl()),
  });

  const copiarPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptDoAgente);
      setCopiado(true);
      haptic.light();
      if (copiadoTimer.current !== null)
        window.clearTimeout(copiadoTimer.current);
      copiadoTimer.current = window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(
        "Não consegui copiar agora. Toque no texto e copie manualmente.",
      );
    }
  };

  const teste = config.ultimo_teste;

  // O ESTADO do recebimento pelo app, lido do que o SERVIDOR devolveu:
  // ligado na ficha manda (é o que o cliente vê); depois a pausa; depois o que
  // falta. "Pronto" é tudo preenchido, mas desligado e sem pausa (loja que
  // já existia, ou a ficha recusou a última tentativa): um teste reconcilia.
  // EDGE ANTIGA (`faltando` ausente): o front sobe antes das functions, e a
  // edge antiga não liga sozinha nem conhece pausa. A tela não afirma "tudo
  // preenchido" nem oferece Pausar/Retomar (que não existem lá): mostra o
  // estado REAL (`pix_ligado`), diz que o sistema está sendo atualizado e
  // mantém só o Ligar/Desligar de antes (a edge antiga valida tudo).
  const servidorDesatualizado = config.faltando === null;
  const faltando = config.faltando ?? [];
  const estadoDoRecebimento:
    | "desatualizado"
    | "recebendo"
    | "pausado"
    | "faltando"
    | "pronto" = servidorDesatualizado
    ? "desatualizado"
    : config.pix_ligado
      ? "recebendo"
      : config.pausado
        ? "pausado"
        : faltando.length > 0
          ? "faltando"
          : "pronto";
  const listaDoQueFalta = faltando.map(textoDaFalta);
  const faltaTestar = faltando.includes("teste");
  // Pendência que abre "Avançado: chaves do Mercado Pago" sozinho (H6): nada
  // salvo ainda, alguma falta (chave ou teste) ou tudo preenchido mas
  // desligado sem pausa (o conserto é Testar conexão, que mora lá dentro).
  // Só depois da leitura: durante o `ler` não há o que afirmar.
  const pendenciaNasChaves =
    !carregando &&
    !erroCarga &&
    (!config.configurado ||
      faltando.length > 0 ||
      estadoDoRecebimento === "pronto");
  // Com pendência, a camada "Suas chaves" abre junto: o "Testar conexão"
  // que o bloco do recebimento manda tocar mora nela — abrir só o Avançado
  // deixaria o conserto a um clique a mais.
  useEffect(() => {
    if (pendenciaNasChaves) setChavesAberto(true);
  }, [pendenciaNasChaves]);

  // Mesma trava do fluxo do dono nos DOIS botões de testar (o do formulário
  // e o do aviso âmbar): testar coisa diferente do que está salvo enganaria.
  const testeBloqueado =
    testando ||
    carregando ||
    isOffline ||
    alternandoPix ||
    dirty ||
    !config.configurado;

  return (
    <div className="space-y-4">
      {/* ── Resumo curto: status da conexão + máscaras à vista, sem abrir
          nada (pedido do dono, 14/09: o grupo abre ENXUTO) ─────────────── */}
      {carregando ? (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="size-3.5 animate-spin" /> Lendo as chaves salvas…
        </p>
      ) : erroCarga ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" /> {erroCarga}
          </span>
          <button
            type="button"
            onClick={ler}
            className="min-h-11 shrink-0 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-2.5 py-1 font-bold text-admin-gold hover:bg-admin-gold/20"
          >
            Tentar de novo
          </button>
        </div>
      ) : teste ? (
        <div
          className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
            teste.conectado
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {teste.conectado ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          <span>{teste.mensagem}</span>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          {config.configurado ? (
            <>
              <ShieldCheck className="size-4 shrink-0 text-admin-gold" /> Chaves
              salvas. Falta testar a conexão.
            </>
          ) : (
            "Nenhuma chave do Mercado Pago salva ainda."
          )}
        </p>
      )}

      {/* As máscaras (só o finalzinho da chave) fazem parte do resumo:
          o lojista reconhece o que tem salvo sem abrir camada nenhuma. */}
      {config.configurado &&
        (config.mascara_token || config.mascara_webhook) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
            {config.mascara_token && (
              <span>Chave secreta {config.mascara_token}</span>
            )}
            {config.mascara_webhook && (
              <span>Senha dos avisos {config.mascara_webhook}</span>
            )}
          </p>
        )}

      {/* ── Avançado (H6, painel simples): o guia e as chaves — o lado
          técnico, feito uma vez — numa seção recolhível MONTADA (fechar só
          esconde; o formulário e o estado dele moram aqui no componente).
          Abre sozinha quando falta alguma coisa para receber pelo app: aí
          a lojista precisa mesmo das chaves e do teste — e também quando há
          chave digitada e não salva (`dirty`). O atalho "Configurar
          credenciais" remonta a seção já aberta (`key` pelo gatilho; nada se
          perde: o formulário mora neste componente). ───────────────── */}
      <SecaoRecolhivel
        key={`avancado-${abrirChavesGatilho}`}
        titulo="Avançado: chaves do Mercado Pago"
        resumo="O passo a passo, as chaves e o teste de conexão"
        abertaInicial={abrirChavesGatilho > 0}
        temErro={pendenciaNasChaves || dirty}
      >
        {/* ── Camada 2a: o guia, escondido até pedido (expande o passo a
          passo e o botão de copiar o prompt) ──────────────────────────── */}
        <Expansor
          titulo="Como pegar suas chaves"
          subtitulo="O passo a passo com o prompt pronto para o agente do app"
          icone={KeyRound}
          aberto={guiaAberto}
          onAlternar={() => setGuiaAberto((antes) => !antes)}
        >
          <ol className="space-y-3">
            {PASSOS_DO_GUIA.map((passo, indice) => (
              <li key={passo.titulo} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-admin-gold/15 text-[11px] font-black text-admin-gold ring-1 ring-admin-gold/30">
                  {indice + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-white">
                    {passo.titulo}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
                    {passo.descricao}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          {/* O prompt pronto: o texto vive no arquivo de conteúdo; aqui só a
            caixa e o botão de copiar, com o feedback "Copiado!". */}
          <div className="space-y-2">
            <span className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Pedido pronto para colar no agente
            </span>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
              {promptDoAgente}
            </pre>
            <button
              type="button"
              onClick={copiarPrompt}
              className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                copiado
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-admin-gold/30 bg-admin-gold/10 text-admin-gold hover:bg-admin-gold/20"
              }`}
            >
              {copiado ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              <span>{copiado ? "Copiado!" : "Copiar prompt"}</span>
            </button>
          </div>
        </Expansor>

        {/* ── Camada 2b: as chaves em si — campos, salvar e testar ──────── */}
        <Expansor
          titulo="Suas chaves"
          subtitulo="Cole as chaves, salve e teste a conexão"
          icone={Lock}
          aberto={chavesAberto}
          onAlternar={() => setChavesAberto((antes) => !antes)}
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                htmlFor="mp-public-key"
                className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
              >
                Chave pública (Public Key)
              </label>
              <input
                id="mp-public-key"
                type="text"
                disabled={carregando}
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="APP_USR-…"
                autoComplete="off"
                spellCheck={false}
                className="h-11 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="mp-access-token"
                className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
              >
                <span>Chave secreta (Access Token)</span>
                {config.mascara_token && (
                  <span className="font-mono normal-case tracking-normal text-zinc-400">
                    salva: {config.mascara_token}
                  </span>
                )}
              </label>
              <input
                id="mp-access-token"
                type="password"
                disabled={carregando}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={
                  config.mascara_token
                    ? "Deixe vazio para manter a chave salva"
                    : "Cole aqui a chave secreta de produção…"
                }
                autoComplete="new-password"
                className="h-11 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="mp-webhook-secret"
                className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500"
              >
                <span>
                  Senha dos avisos (Chave de notificações) — obrigatória para
                  receber pelo app
                </span>
                {config.mascara_webhook && (
                  <span className="font-mono normal-case tracking-normal text-zinc-400">
                    salva: {config.mascara_webhook}
                  </span>
                )}
              </label>
              <input
                id="mp-webhook-secret"
                type="password"
                disabled={carregando}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={
                  config.mascara_webhook
                    ? "Deixe vazio para manter a salva"
                    : "Cole aqui a senha dos avisos da sua loja"
                }
                autoComplete="new-password"
                className="h-11 w-full rounded-lg border border-white/5 bg-zinc-950 px-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-admin-gold focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />
              {!config.mascara_webhook && (
                <p className="text-[11px] leading-relaxed text-amber-300">
                  Sem a senha dos avisos da sua loja, o pagamento pelo app não é
                  liberado. Testar conexão não confere os avisos; a chave global
                  do app não substitui a sua.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={salvando || carregando || isOffline || alternandoPix}
                onClick={salvar}
                className="flex min-h-11 items-center gap-1.5 rounded-lg bg-admin-gold px-4 py-2 text-xs font-black text-zinc-950 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
              >
                {salvando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                <span>Salvar chaves</span>
              </button>

              <button
                type="button"
                disabled={testeBloqueado}
                onClick={testarConexao}
                title={
                  dirty
                    ? "Salve as chaves primeiro — o teste fala com o Mercado Pago usando o que está salvo."
                    : undefined
                }
                className="flex min-h-11 items-center gap-1.5 rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-3 py-2 text-xs font-bold text-admin-gold hover:bg-admin-gold/20 active:scale-95 disabled:opacity-40"
              >
                {testando ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                <span>Testar conexão</span>
              </button>

              {dirty && (
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Salve para testar
                </span>
              )}
            </div>

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500">
              <Lock className="mt-0.5 size-3 shrink-0" /> {RECADO_DE_SEGURANCA}
            </p>
          </div>
        </Expansor>
      </SecaoRecolhivel>

      {/* ── Receber pelo app: o que o lojista FAZ — Pausar/Retomar e o
              que falta. Antes era um interruptor (mp-4). Agora o servidor
              liga sozinho quando as três chaves estão salvas e o teste
              passou, e a tela só mostra o que ele decidiu. Desde H6 (painel
              simples) este bloco não repete o estado ("Pix liberado"): o
              status do PIX é só o termômetro no topo de Pagamentos, que
              recebe o eco por `onPixAlternado`. Fica FORA do Avançado: a
              pausa e o que falta ficam sempre à vista. ─────────────── */}
      {!carregando && !erroCarga && (
        <div
          data-estado-recebimento={estadoDoRecebimento}
          className="space-y-2 rounded-xl border border-white/5 bg-zinc-900/60 p-3"
        >
          <span className="block text-xs font-bold text-white">
            Receber PIX no app
          </span>
          {!servidorDesatualizado && (
            <span className="block text-[11px] leading-relaxed text-zinc-400">
              O Pix pelo app liga sozinho quando as três chaves estão salvas e o
              teste de conexão passa.
            </span>
          )}

          {estadoDoRecebimento === "desatualizado" && (
            <div className="space-y-2">
              {/* Sem "Pix liberado"/"desligado" aqui (H6): o estado REAL
                      que a edge antiga devolveu sobe pelo `onPixAlternado`
                      para o termômetro de Pagamentos; o botão diz a ação. */}
              {(config.pix_ligado || teste?.conectado) && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={
                      alternandoPix || isOffline || testando || salvando
                    }
                    onClick={() => pausarOuRetomar(!config.pix_ligado)}
                    className="min-h-11 shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold text-zinc-200 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
                  >
                    {config.pix_ligado
                      ? "Desligar o pagamento pelo app"
                      : "Ligar o pagamento pelo app"}
                  </button>
                </div>
              )}
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  O sistema de pagamentos desta loja ainda não foi atualizado.
                  Enquanto isso, o Pix segue como está; fale com o suporte para
                  atualizar.
                </span>
              </p>
            </div>
          )}

          {estadoDoRecebimento === "recebendo" && (
            <div className="flex items-center justify-between gap-3">
              {/* Só o que é verdade: `pagamento_online` liberou o PIX, mas o
                      CARTÃO tem interruptor próprio (`config_pagamento_cartao`,
                      no card Formas de pagamento) e nasce desligado — o
                      `criar-pagamento` recusa cartão enquanto ele estiver
                      assim. Esta seção não lê essa config (não há prop nem
                      contexto, e o card vizinho a muda sem avisar aqui), então
                      o texto não afirma cartão nem o nega. E não repete
                      "Pix liberado" (H6): o estado é o termômetro de
                      Pagamentos; aqui fica só a ação. */}
              <div className="space-y-0.5">
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Para parar de receber pelo app por um tempo, toque em Pausar.
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Cartão pelo app: ligue ou desligue em Formas de pagamento.
                </p>
              </div>
              <button
                type="button"
                disabled={alternandoPix || isOffline || testando || salvando}
                onClick={() => pausarOuRetomar(false)}
                className="min-h-11 shrink-0 rounded-lg border border-white/10 bg-zinc-800 px-3 py-1.5 text-[11px] font-bold text-zinc-200 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
              >
                Pausar
              </button>
            </div>
          )}

          {estadoDoRecebimento === "pausado" && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
              <div className="flex items-center justify-between gap-3">
                <p
                  role="status"
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-300"
                >
                  <AlertCircle className="size-4 shrink-0" />
                  Pausado por você
                </p>
                <button
                  type="button"
                  disabled={alternandoPix || isOffline || testando || salvando}
                  onClick={() => pausarOuRetomar(true)}
                  className="min-h-11 shrink-0 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25 active:scale-95 disabled:opacity-40"
                >
                  Retomar
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200/90">
                Nenhum cliente consegue pagar pelo app enquanto estiver pausado.
                Salvar ou testar as chaves não religa: toque em Retomar.
              </p>
              {listaDoQueFalta.length > 0 && (
                <p className="text-[11px] leading-relaxed text-amber-200/90">
                  Para receber quando retomar, ainda falta:{" "}
                  {listaDoQueFalta.join(", ")}.
                </p>
              )}
            </div>
          )}

          {estadoDoRecebimento === "faltando" && (
            <div className="space-y-1.5">
              <p
                role="status"
                className="flex items-center gap-1.5 text-xs font-bold text-amber-300"
              >
                <AlertCircle className="size-4 shrink-0" />
                Falta para receber pelo app:
              </p>
              <ul className="list-disc space-y-0.5 pl-9 text-[11px] leading-relaxed text-zinc-300">
                {listaDoQueFalta.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            </div>
          )}

          {estadoDoRecebimento === "pronto" && (
            <div className="space-y-1">
              <p
                role="status"
                className="flex items-center gap-1.5 text-xs font-bold text-amber-300"
              >
                <AlertCircle className="size-4 shrink-0" />
                Tudo preenchido.
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-400">
                Toque em Testar conexão (em Avançado) para liberar o pagamento
                pelo app.
              </p>
            </div>
          )}

          {/* LIGADO COM FALTA (loja que já existia): a loja estaria
                  cobrando com uma chave que nunca passou por tudo isto. O
                  conserto — testar — fica no próprio aviso: mandar o lojista
                  procurar o botão lá em cima era contar o problema e
                  esconder a saída. */}
          {estadoDoRecebimento === "recebendo" &&
            listaDoQueFalta.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    O pagamento pelo app está ligado, mas ainda falta:{" "}
                    {listaDoQueFalta.join(", ")}. Complete para o cliente não
                    travar no fim da compra.
                  </span>
                </p>
                {faltaTestar && (
                  <button
                    type="button"
                    disabled={testeBloqueado}
                    onClick={testarConexao}
                    className="flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25 active:scale-95 disabled:opacity-40"
                  >
                    {testando ? (
                      <RefreshCw className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    <span>Testar conexão</span>
                  </button>
                )}
              </div>
            )}

          {/* O que o servidor fez e quer contar (chave de sandbox,
                  "desliguei porque o teste não passou"...) vem PRONTO da edge
                  e aparece como veio. */}
          {avisoPix && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{avisoPix}</span>
            </p>
          )}

          {/* Por que "até 1 minuto": a vitrine lê a ficha da loja pelo
                  porteiro, que guarda a ficha fresca por CACHE_FRESCO_MS =
                  60_000 (src/hospedagem/porteiro.ts). Prometer "na hora"
                  faria o lojista abrir a loja, não ver mudança e achar que
                  falhou. */}
          {ecoDaVitrine && (
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Pronto. A vitrine passa a refletir em até 1 minuto.
            </p>
          )}

          {/* Ligado sem a Public Key publicada na ficha é exatamente o
                  caso em que o cliente NÃO vê PIX — a tela conta em vez de
                  deixar o lojista descobrir na venda perdida. */}
          {config.pix_ligado && !config.public_key_na_loja && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                A ficha da loja ainda não carrega esta chave pública — salve as
                chaves de novo para o cliente conseguir pagar.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
});
