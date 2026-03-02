"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CheckoutButton() {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      onClick={async () => {
        try {
          setLoading(true);
          const response = await fetch("/api/stripe/checkout", { method: "POST" });
          const payload = (await response.json()) as { url?: string; error?: string };

          if (!response.ok || !payload.url) {
            throw new Error(payload.error ?? "Impossible de démarrer le paiement.");
          }

          window.location.href = payload.url;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Erreur inattendue pendant le checkout.";
          toast.error(message);
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
      className="gap-2"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      Upgrade
    </Button>
  );
}
