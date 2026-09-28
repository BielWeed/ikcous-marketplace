import { CONTAINER_DO_COMPUTADOR } from "@/components/desktop/medidas";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import type { View } from "@/types";

export function RodapeDaLoja({
  onNavigate,
}: Readonly<{ onNavigate: (view: View) => void }>) {
  const { config } = useStore();
  const { user } = useAuth();
  const nome = nomeDaLoja(config);
  const local = [config.storeCity?.trim(), config.storeState?.trim()]
    .filter(Boolean)
    .join(", ");
  const horario = config.businessHours?.trim();
  const endereco = config.storeAddress?.trim();
  const temWhatsapp = lojaTemWhatsapp(config.whatsappNumber);
  let numero = (config.whatsappNumber || "").replace(/\D/g, "");
  if (numero.length === 10 || numero.length === 11) numero = `55${numero}`;
  const link = (rotulo: string, view: View) => (
    <button
      type="button"
      onClick={() => onNavigate(view)}
      className="block rounded text-left text-sm transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    >
      {rotulo}
    </button>
  );

  return (
    <footer className="hidden bg-zinc-950 text-zinc-400 lg:block">
      <div className={cn(CONTAINER_DO_COMPUTADOR, "lg:py-12")}>
        <div className="grid grid-cols-4 gap-10">
          <div className="space-y-4">
            {config.logoUrl ? (
              <img
                src={config.logoUrl}
                alt={nome}
                className="h-10 max-w-[200px] rounded bg-white object-contain p-1"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-black text-white"
              >
                {nome.charAt(0).toUpperCase()}
              </span>
            )}
            <p className="text-lg font-black tracking-tight text-white">
              {nome}
            </p>
            {local && <p className="text-sm">{local}</p>}
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-white">Navegue</h2>
            {link("Início", "home")}
            {link("Favoritos", "favorites")}
            {link("Carrinho", "cart")}
            {link("Meus pedidos", "orders")}
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-white">Sua conta</h2>
            {link(user ? "Minha conta" : "Entrar", user ? "profile" : "auth")}
            {link("Configurações", "account-settings")}
            {link("Sobre a loja", "about-store")}
          </div>
          {(temWhatsapp || horario || endereco) && (
            <div className="space-y-3 text-sm">
              <h2 className="font-bold text-white">Atendimento</h2>
              {temWhatsapp && (
                <a
                  href={`https://wa.me/${numero}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  WhatsApp
                </a>
              )}
              {horario && <p className="whitespace-pre-line">{horario}</p>}
              {endereco && <p>{endereco}</p>}
            </div>
          )}
        </div>
        <p className="mt-10 border-t border-white/10 pt-6 text-xs">
          © {new Date().getFullYear()} {nome}
        </p>
      </div>
    </footer>
  );
}
