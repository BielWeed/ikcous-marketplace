import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { mensagemDeErroDoPainel } from "@/lib/erro-do-painel";
import { RefreshCw, Save } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MensagemDeCompartilhar } from "./MensagemDeCompartilhar";
import { WhatsAppDaLoja } from "./WhatsAppDaLoja";
import { numeroComPais, numeroParaOCampo, whatsappParaGravar } from "./contato";

// Bloco "Contato" de Minha loja (painel simples, D9): o WhatsApp da loja e a
// mensagem de compartilhar, que antes moravam na tela "Atendimento". Tem
// Salvar PRÓPRIO (como a marca e o horário): grava SÓ `whatsappNumber` e
// `shareText`. O horário NUNCA entra neste pacote — regravar o que a tela
// carregou na abertura apagava o que a lojista salvou depois (A1, 09/10/2026);
// o editor único do horário é o BusinessHoursSection. O endereço e a
// descrição têm o Salvar do cabeçalho de Minha loja.

interface ContatoDaLojaProps {
  /** Avisa a tela quando há alteração não salva (guarda de navegação). */
  readonly onDirtyChange?: (pendente: boolean) => void;
  /** Voltar do aparelho com a folha de modelos aberta: fecha só a folha. */
  readonly onSetBackOverride?: (fn: (() => void) | null) => void;
}

export const ContatoDaLoja = memo(function ContatoDaLoja({
  onDirtyChange,
  onSetBackOverride,
}: ContatoDaLojaProps) {
  const { config, isLoaded, updateConfig } = useStore();
  const offline = useOnlineStatus();

  // O que está salvo (a "base") e o que a lojista tem na tela.
  const baseWhatsapp = numeroParaOCampo(config.whatsappNumber);
  const baseTexto = config.shareText || "";
  const [whatsapp, setWhatsapp] = useState(baseWhatsapp);
  const [texto, setTexto] = useState(baseTexto);
  const [carga, setCarga] = useState({ texto: baseTexto, id: 0 });
  const [salvando, setSalvando] = useState(false);

  // Config que chega depois (carga assíncrona, salvamento): o campo adota o
  // valor novo SÓ se a lojista não mexeu nele desde a base anterior — o que
  // ela digitou nunca é sobrescrito.
  const baseAnterior = useRef({ whatsapp: baseWhatsapp, texto: baseTexto });
  useEffect(() => {
    const anterior = baseAnterior.current;
    if (anterior.whatsapp === baseWhatsapp && anterior.texto === baseTexto) {
      return;
    }
    baseAnterior.current = { whatsapp: baseWhatsapp, texto: baseTexto };
    if (numeroComPais(whatsapp) === numeroComPais(anterior.whatsapp)) {
      setWhatsapp(baseWhatsapp);
    }
    if (texto === anterior.texto) {
      setTexto(baseTexto);
      setCarga((atual) => ({ texto: baseTexto, id: atual.id + 1 }));
    }
  }, [baseWhatsapp, baseTexto, whatsapp, texto]);

  const alterado =
    numeroComPais(whatsapp) !== numeroComPais(baseWhatsapp) ||
    texto !== baseTexto;

  // O sinal que liga a guarda do App: com alteração não salva (ou salvando) o
  // App sabe que há trabalho em aberto antes de a lojista sair da tela. Nada
  // aqui desmonta ao navegar — este sinal é a guarda.
  const pendente = alterado || salvando;
  useEffect(() => {
    onDirtyChange?.(pendente);
  }, [pendente, onDirtyChange]);
  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  async function salvar() {
    if (offline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar o contato.",
      });
      return;
    }
    if (salvando) return;

    // Vazio grava NULL (decisão do Gabriel, 30/08: WhatsApp é configuração DA
    // lojista); preenchido, 10-11 dígitos (DDD + número) ganham o 55.
    const paraGravar = whatsappParaGravar(whatsapp);
    if (!paraGravar.valido) {
      toast.error("WhatsApp inválido");
      return;
    }

    setSalvando(true);
    try {
      // O toast de erro sai de dentro do `updateConfig`; aqui só não se segue
      // em frente. Sem isto, o admin via "salvo" sobre uma gravação que
      // falhou — e o WhatsApp é o único canal de fechamento de pedido da loja
      // (ADMIN-010, #94).
      const salvou = await updateConfig({
        whatsappNumber: paraGravar.valor,
        shareText: texto,
      });
      if (!salvou) return;
      toast.success("Contato salvo");
    } catch (erro) {
      toast.error(mensagemDeErroDoPainel(erro, "salvar"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <WhatsAppDaLoja
        valor={whatsapp}
        onMudar={setWhatsapp}
        desabilitado={offline}
      />

      <div className="border-t border-white/5 pt-6">
        <MensagemDeCompartilhar
          texto={texto}
          carga={carga}
          onMudar={setTexto}
          desabilitado={offline}
          onSetBackOverride={onSetBackOverride}
        />
      </div>

      <div className="flex justify-end border-t border-white/5 pt-4">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={!isLoaded || offline || salvando || !alterado}
          title="Salva o WhatsApp e a mensagem de compartilhamento"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-admin-gold px-5 text-xs font-black uppercase tracking-[0.12em] text-zinc-950 shadow-[0_6px_20px_rgba(212,175,55,0.22)] transition-all hover:bg-admin-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-admin-bg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:w-auto"
        >
          {salvando ? (
            <>
              <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
              <span>Salvando...</span>
            </>
          ) : (
            <>
              <Save aria-hidden="true" className="size-4" />
              <span>Salvar contato</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
});
