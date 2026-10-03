import { deveMostrarGuiaIOS } from "@/lib/ios-install";
import { Share2, X } from "lucide-react";
import { useEffect, useState } from "react";

const CHAVE_DISPENSA = "ikcous_ios_install_guide_dismissed";

function foiDispensado(): boolean {
  try {
    return localStorage.getItem(CHAVE_DISPENSA) === "1";
  } catch {
    return false;
  }
}

function podeMostrar(): boolean {
  if (typeof window === "undefined" || foiDispensado()) return false;
  return deveMostrarGuiaIOS(
    window.navigator,
    window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true,
  );
}

export function IOSInstallGuide() {
  const [visivel, setVisivel] = useState(podeMostrar);

  useEffect(() => {
    const media = window.matchMedia?.("(display-mode: standalone)");
    if (!media?.addEventListener) return;
    const atualizar = () => setVisivel(podeMostrar());
    media.addEventListener("change", atualizar);
    return () => media.removeEventListener("change", atualizar);
  }, []);

  if (!visivel) return null;

  const dispensar = () => {
    setVisivel(false);
    try {
      localStorage.setItem(CHAVE_DISPENSA, "1");
    } catch {
      // A dispensa ainda vale até este componente ser desmontado.
    }
  };

  return (
    <section
      aria-labelledby="ios-install-title"
      className="m-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-zinc-900 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
          <Share2 aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="ios-install-title" className="text-sm font-bold">
            Instale esta loja no iPhone ou iPad
          </h2>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm leading-relaxed text-zinc-700">
            <li>
              Abra esta página no Safari e toque em Compartilhar. No iPhone,
              esse botão pode estar em Menu da Página.
            </li>
            <li>
              Escolha <strong>Adicionar à Tela de Início</strong>, ative{" "}
              <strong>Abrir como App da Web</strong> e toque em Adicionar.
            </li>
          </ol>
          <p className="mt-1 text-xs text-zinc-600">
            No iPad, toque em Ver Mais após Compartilhar. Se a opção não
            aparecer no iPhone, use Editar Ações.
          </p>
        </div>
        <button
          type="button"
          onClick={dispensar}
          aria-label="Não mostrar novamente o guia de instalação"
          className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-600 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <button
        type="button"
        onClick={dispensar}
        className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Não mostrar novamente
      </button>
    </section>
  );
}
