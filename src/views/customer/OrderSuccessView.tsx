import { Button } from "@/components/ui/button";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import type { View } from "@/types";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Home, Package } from "lucide-react";

interface OrderSuccessViewProps {
  onNavigate: (view: View) => void;
}

export function OrderSuccessView({ onNavigate }: OrderSuccessViewProps) {
  const { user } = useAuth();
  const { config } = useStore();
  // Laudo 31/08 (C2): a frase do convidado mandava falar pelo WhatsApp —
  // mas a tela não tem botão nenhum e a loja pode não ter número (decisão
  // de 30/08: WhatsApp é opcional). A promessa só menciona o canal que
  // EXISTE. Mesma régua de dígitos do ProductView/OrderDetails/Profile.
  const lojaTemWhatsappAgora = lojaTemWhatsapp(config.whatsappNumber);

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-white px-6 py-12 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 15 }}
        className="mb-8 flex size-24 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
      >
        <CheckCircle2 className="size-12" />
      </motion.div>

      <h1 className="mb-4 text-3xl font-black tracking-tighter text-zinc-900">
        Pedido Realizado!
      </h1>
      {/* Item 11 do laudo de 29/08: a promessa tinha que virar verdade — a
          trigger tr_pedido_avisa_o_cliente (20261026000000) insere um aviso no
          sino a cada mudança de status. Como o convidado não tem conta (logo
          não tem sino), a promessa é POR VERDADE: logado lê o aviso no app.
          Laudo caça-bugs 30/08 (achado 3): a frase antiga do convidado
          prometia autoatendimento que não existe — a busca de pedido exige
          e-mail, que o convidado não informou. Agora o convidado lê o que é
          real: guardar o código e falar com a loja pelo WhatsApp. */}
      <p className="mb-12 max-w-xs leading-relaxed text-zinc-500">
        Seu pedido foi recebido com sucesso e já está sendo processado.{" "}
        {user
          ? "A cada atualização — preparo, envio, entrega — você recebe um aviso aqui no app."
          : lojaTemWhatsappAgora
            ? "Guarde o código do comprovante: é por ele que a loja localiza o seu pedido. Para acompanhar, fale com a loja pelo WhatsApp."
            : "Guarde o código do comprovante: é por ele que a loja localiza o seu pedido. Guarde também o contato da loja — é por lá que você acompanha."}
      </p>

      <div className="grid w-full max-w-xs gap-4">
        <Button
          onClick={() => onNavigate("orders")}
          className="h-14 gap-3 rounded-2xl bg-zinc-900 text-base font-bold text-white hover:bg-black"
        >
          <Package className="size-5" />
          Meus Pedidos
        </Button>
        <Button
          variant="ghost"
          onClick={() => onNavigate("home")}
          className="h-14 gap-3 rounded-2xl font-bold text-zinc-500"
        >
          <Home className="size-5" />
          Voltar para Início
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
