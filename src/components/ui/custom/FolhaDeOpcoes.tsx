import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ComponentProps } from "react";

// A mesma folha do card e da página: portal, foco, Escape e área rolável do Radix.
export function FolhaDeOpcoes({
  aberta,
  onMudar,
  ...props
}: ComponentProps<typeof SheetContent> & {
  aberta: boolean;
  onMudar: (aberta: boolean) => void;
}) {
  return (
    <Sheet open={aberta} onOpenChange={onMudar}>
      <SheetContent side="bottom" showCloseButton={false} {...props} />
    </Sheet>
  );
}
