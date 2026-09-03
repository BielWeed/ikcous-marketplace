import {
  CabecaDeSecao,
  Chave,
  Linha,
  PontoEstado,
} from "@/components/admin/shipping/primitivas-direcao-d";
import { AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import { memo } from "react";

/**
 * Seção "Fora da cidade" da tela de Frete v2 — direção D aprovada pelo
 * dono (03/09): linhas finas, sem caixa/card. Verdade desta frente: a
 * cotação de fora é SÓ de transportadora real (Melhor Envio/Frenet) — o
 * card "Taxa de entrega fixa" MORRE e não volta (o campo `shippingFee`
 * fica órfão no banco de propósito; esta seção nem o exibe nem o salva).
 *
 * A CHAVE "Cotação na hora" é EXIBIÇÃO DE ESTADO, não interruptor: o que
 * ela mostra é a credencial SALVA da transportadora (mesma tabela que a
 * seção de Transportadoras em Ajustes grava) — e esta tela NUNCA grava
 * credencial nem `shippingProvider` (divisão de território). Chave
 * clicável aqui seria decorativa: "desligar" não gravaria nada. Por isso
 * ela renderiza um span (Chave sem onToggle) e, quando desconectado, o
 * comando de verdade é o CTA que leva a Ajustes.
 *
 * Estado da conexão chega PRONTO da view:
 * - "conectado": credencial com token para o provedor salvo;
 * - "desconectado": provedor de cotação salvo sem credencial, ou taxa fixa
 *   remanescente de loja antiga — em ambos, a loja de fora NÃO é atendida;
 * - "indeterminado": a leitura das credenciais falhou — a tela não sabe, e
 *   não finge saber (estados honestos são a lei deste repo).
 */
export type EstadoConexaoNacional =
  | "conectado"
  | "desconectado"
  | "indeterminado";

const formatCEP = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5, 8)}`;
};

export const FreteNacionalBloco = memo(function FreteNacionalBloco({
  originCep,
  onOriginCep,
  conexao,
  onAbrirAjustes,
  onTentarDeNovo,
  desabilitado,
}: {
  readonly originCep: string;
  readonly onOriginCep: (cep: string) => void;
  readonly conexao: {
    readonly estado: EstadoConexaoNacional;
    /**
     * Nome do provedor salvo ("Melhor Envio", "Frenet") — ou NULL quando o
     * config não nomeia transportadora (flat_fee remanescente de loja antiga
     * ou ausente). REVISÃO A5: o nulo define o ARTIGO da frase do aviso —
     * "conecte o Melhor Envio" x "conecte uma transportadora"; jamais
     * "conecte o uma transportadora". No estado `conectado` o nome nunca é
     * nulo (a view só conecta provedor nomeado + credencial).
     */
    readonly provedorNome: string | null;
  };
  readonly onAbrirAjustes?: () => void;
  readonly onTentarDeNovo?: () => void;
  readonly desabilitado?: boolean;
}) {
  const { estado, provedorNome } = conexao;

  return (
    <section
      id="bloco-frete-nacional"
      aria-label="Fora da cidade"
      className="scroll-mt-24"
    >
      <CabecaDeSecao
        titulo="Fora da cidade"
        estado={
          estado === "conectado" ? (
            <>
              <PontoEstado tom="positivo" />
              <span>
                <b className="font-semibold text-zinc-200">conectado</b> ·{" "}
                {provedorNome}
              </span>
            </>
          ) : estado === "indeterminado" ? (
            <>
              <PontoEstado tom="neutro" />
              <span>conexão a confirmar</span>
            </>
          ) : (
            <>
              <PontoEstado tom="atencao" />
              <span className="text-amber-300">desconectado</span>
            </>
          )
        }
      />

      <Linha
        nome="Cotação na hora"
        dica={
          estado === "conectado" ? (
            <>
              Conectado ao {provedorNome} — PAC e SEDEX com preço real, na
              hora.
            </>
          ) : estado === "indeterminado" ? (
            <>
              Não foi possível confirmar a conexão com a transportadora. Sem
              confirmar, não dá para garantir entrega fora da cidade.
            </>
          ) : (
            <>
              Nenhuma transportadora conectada — sua loja só entrega na sua
              cidade.
            </>
          )
        }
      >
        {/* Chave de EXIBIÇÃO (sem onToggle → span, não é botão): o estado
            dela é a credencial salva, que aqui só se lê. */}
        <Chave rotulo="Cotação na hora" ligada={estado === "conectado"} />
        {estado === "desconectado" && onAbrirAjustes && (
          <button
            type="button"
            onClick={onAbrirAjustes}
            className="flex shrink-0 items-center rounded-lg bg-admin-accent px-4 py-2 text-[12px] font-extrabold text-zinc-950 transition-all hover:opacity-90 active:scale-95"
          >
            Conectar transportadora
          </button>
        )}
        {estado === "indeterminado" && onTentarDeNovo && (
          <button
            type="button"
            onClick={onTentarDeNovo}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-4 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
          >
            <RefreshCw className="size-3.5" />
            Tentar de novo
          </button>
        )}
      </Linha>

      {estado === "desconectado" && (
        <p className="-mt-2 pb-4 text-[12.5px] leading-snug text-zinc-500">
          {/* REVISÃO A5 (frete v2, 03/09): o artigo acompanha o nome que o
              config salvou. Provedor nomeado leva "o" ("conecte o Melhor
              Envio"); sem nome (flat_fee remanescente ou ausente) a frase é
              "conecte uma transportadora" — nunca "conecte o uma
              transportadora". */}
          Para vender para todo o Brasil,{" "}
          {provedorNome
            ? `conecte o ${provedorNome} em Ajustes`
            : "conecte uma transportadora em Ajustes"}
          . Quem compra de fora não consegue fechar o pedido até lá.
        </p>
      )}

      {/* CEP da loja — a única tela onde ele se define. Campo abre VAZIO
          quando a loja não configurou (nada de CEP inventado parecendo
          configuração pronta — trava herdada da auditoria 26/08). */}
      <Linha nome="CEP de origem" dica="De onde as entregas saem">
        <input
          id="origin-cep"
          type="text"
          maxLength={9}
          value={originCep}
          onChange={(e) => onOriginCep(formatCEP(e.target.value))}
          placeholder="00000-000"
          disabled={desabilitado}
          className="h-10 w-full rounded-xl border border-white/10 bg-zinc-900/60 px-3.5 text-center font-mono text-[13px] font-semibold text-zinc-100 placeholder-zinc-600 transition-colors focus:border-admin-accent focus:outline-none disabled:opacity-50 md:w-40"
        />
      </Linha>

      {!originCep && (
        <p className="-mt-2 flex items-start gap-2 pb-4 text-[12px] font-bold leading-snug text-amber-300 duration-200 animate-in fade-in">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          SEM ISSO A LOJA NÃO VENDE: sem o CEP da loja nenhum frete é
          calculado e o botão "Finalizar Pedido" fica bloqueado para todo
          cliente. Preencha e salve para abrir as vendas.
        </p>
      )}

      <Linha
        nome="Transportadoras e serviços"
        dica="A chave de acesso, o teste de conexão, os serviços habilitados (Sedex, PAC, Jadlog) e o histórico de cotações ficam em Ajustes."
      >
        {onAbrirAjustes && (
          <button
            type="button"
            onClick={onAbrirAjustes}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3.5 py-2 text-[12px] font-bold text-zinc-300 transition-colors hover:border-white/25 hover:text-white active:scale-95"
          >
            <ExternalLink className="size-3.5 text-admin-accent" />
            Abrir Ajustes
          </button>
        )}
      </Linha>
    </section>
  );
});
