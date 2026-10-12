import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Label } from "@/components/ui/label";
import { MessageCircle } from "lucide-react";

// Bloco "WhatsApp da loja" de Minha loja › Contato (painel simples, D9):
// extraído do bloco 1 da antiga tela "Atendimento", com o mesmo
// comportamento. O número é a porta de fechamento de pedido da loja, por isso
// nasce à vista e diz, em português de gente, o que acontece se ficar vazio.
//
// O componente é CONTROLADO e não grava nada: quem salva é o `ContatoDaLoja`
// (um Salvar para o WhatsApp e a mensagem de compartilhar).

interface WhatsAppDaLojaProps {
  /** Só os dígitos, sem o +55 (ver `numeroParaOCampo`). */
  readonly valor: string;
  readonly onMudar: (digitos: string) => void;
  readonly desabilitado?: boolean;
}

// Fora do componente: o `LocalBufferedInput` re-valida quando a função muda.
function validarWhatsapp(digitado: string): string | null {
  // Campo OPCIONAL (decisão do Gabriel, 30/08): vazio é estado legítimo — o
  // botão de WhatsApp some da loja. Erro só quando digitar errado.
  if (!digitado) return null;
  const digitos = digitado.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 11) {
    return "Informe DDD + número (10 ou 11 dígitos)";
  }
  return null;
}

export function WhatsAppDaLoja({
  valor,
  onMudar,
  desabilitado = false,
}: WhatsAppDaLojaProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-black text-white">WhatsApp da loja</h3>
      <p className="text-sm leading-snug text-zinc-400">
        Número que recebe as mensagens dos clientes. É por ele que a loja fecha
        pedidos e tira dúvidas.
      </p>
      <Label
        htmlFor="settings-whatsapp"
        className="block pt-1 text-sm font-bold text-white"
      >
        Número do WhatsApp
      </Label>
      <p className="text-sm leading-snug text-zinc-500">
        Pode deixar vazio — aí o botão de WhatsApp some da loja. Se preencher,
        use DDD + número: o +55 do Brasil entra sozinho.
      </p>
      <div className="relative">
        {/* Âncora no centro do campo (h-11): o bloco cresce para baixo quando
            a validação acusa erro, e o meio dele empurraria o ícone e o +55
            para fora da linha do campo. */}
        <div className="pointer-events-none absolute left-3.5 top-[22px] flex h-5 -translate-y-1/2 items-center gap-1.5 border-r border-white/10 pr-2.5">
          <MessageCircle aria-hidden="true" className="size-4 text-[#25d366]" />
          <span className="text-xs font-black leading-none text-zinc-500">
            +55
          </span>
        </div>
        <LocalBufferedInput
          id="settings-whatsapp"
          name="whatsapp"
          type="tel"
          useShadcn
          mask="phone"
          delay={350}
          value={valor}
          onFlush={onMudar}
          placeholder="(00) 00000-0000"
          className="h-11 rounded-xl border-white/10 bg-black/40 pl-[4.5rem] text-sm font-bold text-white transition-all placeholder:text-zinc-500 focus:bg-black/60 focus:ring-admin-gold/50"
          autoComplete="tel"
          disabled={desabilitado}
          validate={validarWhatsapp}
        />
      </div>
    </div>
  );
}
