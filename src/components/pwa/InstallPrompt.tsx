import { useState, useEffect } from 'react';
import { Share, PlusSquare, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Drawer,
    DrawerContent,
    DrawerHeader,
    DrawerTitle,
    DrawerDescription,
    DrawerFooter,
    DrawerClose,
} from "@/components/ui/drawer";

interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

export function InstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [open, setOpen] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        // Check if dismissed recently (24h)
        const dismissedAt = localStorage.getItem('pwa_install_dismissed');
        if (dismissedAt) {
            const dismissedTime = new Date(parseInt(dismissedAt)).getTime();
            const now = new Date().getTime();
            if (now - dismissedTime < 24 * 60 * 60 * 1000) {
                return;
            }
        }

        // iOS detection
        const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone;

        if (isIOSDevice && !isStandalone) {
            setIsIOS(true);
            // Delay showing slightly to not be annoying immediately
            const timer = setTimeout(() => setOpen(true), 3000);
            return () => clearTimeout(timer);
        }

        // Android/Desktop detection
        const handleBeforeInstallPrompt = (e: Event) => {
            console.log('Capturei beforeinstallprompt!');
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setOpen(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setDeferredPrompt(null);
            setOpen(false);
        }
    };

    const handleDismiss = () => {
        setOpen(false);
        localStorage.setItem('pwa_install_dismissed', Date.now().toString());
    };

    return (
        <Drawer open={open} onOpenChange={setOpen}>
            <DrawerContent>
                <div className="mx-auto w-full max-w-sm">
                    <DrawerHeader>
                        <DrawerTitle>Instalar App</DrawerTitle>
                        <DrawerDescription>
                            Instale nosso aplicativo para uma experiência melhor, acesso offline e promoções exclusivas!
                        </DrawerDescription>
                    </DrawerHeader>

                    <div className="p-4 pb-0">
                        <div className="flex items-center justify-center p-4 bg-muted/50 rounded-lg mb-4">
                            <Download className="h-12 w-12 text-primary animate-bounce" />
                        </div>

                        {isIOS ? (
                            <div className="space-y-3 text-sm text-muted-foreground bg-secondary/50 p-4 rounded-md">
                                <p className="flex items-center gap-2">
                                    1. Toque no botão de compartilhar <Share className="h-4 w-4" />
                                </p>
                                <p className="flex items-center gap-2">
                                    2. Selecione "Adicionar à Tela de Início" <PlusSquare className="h-4 w-4" />
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <p className="text-sm text-center text-muted-foreground mb-2">
                                    Adicione à sua tela inicial para acesso rápido.
                                </p>
                            </div>
                        )}
                    </div>

                    <DrawerFooter>
                        {!isIOS && (
                            <Button onClick={handleInstall} className="w-full bg-amber-400 text-zinc-950 hover:bg-amber-500 border-none shadow-2xl shadow-amber-200/50 font-black h-12 rounded-xl transition-all active:scale-95">
                                Instalar Agora
                            </Button>
                        )}
                        <DrawerClose asChild>
                            <Button variant="outline" onClick={handleDismiss}>Depois</Button>
                        </DrawerClose>
                    </DrawerFooter>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
