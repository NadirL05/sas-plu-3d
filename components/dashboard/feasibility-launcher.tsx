"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function FeasibilityLauncher() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = address.trim();

    if (trimmed.length < 3) {
      setError("Veuillez saisir une adresse plus précise (au moins 3 caractères).");
      return;
    }

    setError(null);
    setIsQuotaError(false);
    setIsLoading(true);

    try {
      const response = await fetch("/api/feasibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmed }),
      });

      const data = (await response.json().catch(() => null)) as
        | { id?: string; error?: string; message?: string; plan?: string; limit?: number }
        | null;

      if (response.status === 402 && data?.error === "QUOTA_EXCEEDED") {
        setIsQuotaError(true);
        setError(
          data.message ??
            "Vous avez atteint la limite d’études pour ce mois. Passez au plan Pro pour débloquer plus d’analyses.",
        );
        setIsLoading(false);
        return;
      }

      if (!response.ok || !data) {
        const message =
          data?.message ??
          (response.status === 500
            ? "Étude impossible pour le moment. Merci de réessayer plus tard."
            : "Une erreur inattendue est survenue.");
        setError(message);
        setIsLoading(false);
        return;
      }

      if (!data.id) {
        setError("Réponse du serveur incomplète : identifiant d'étude manquant.");
        setIsLoading(false);
        return;
      }

      router.push(`/dashboard/study/${data.id}`);
    } catch (err) {
      console.error("[FeasibilityLauncher] submit error", err);
      setError("Connexion au service impossible. Vérifiez votre réseau et réessayez.");
      setIsLoading(false);
    }
  };

  return (
    <Card className="mb-6 border-border/70 bg-slate-950/60 text-slate-50 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <MapPin className="h-4 w-4" />
          </span>
          Nouvelle étude de faisabilité
        </CardTitle>
        <CardDescription className="text-xs text-slate-400">
          Saisissez une adresse pour lancer une étude PLU, marché et risques en un clic.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Ex : 10 Rue de la Paix, 75002 Paris"
            className="h-10 bg-slate-900/70 text-sm text-slate-100 placeholder:text-slate-500 md:flex-1"
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={isLoading}
            className="mt-1 h-10 gap-2 bg-emerald-500 text-emerald-950 hover:bg-emerald-400 md:mt-0"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyse en cours...
              </>
            ) : (
              "Lancer l'analyse"
            )}
          </Button>
        </form>
        {error ? (
          <div className="mt-2 space-y-1 text-xs text-amber-300">
            <p>{error}</p>
            {isQuotaError && (
              <p className="text-xs">
                <a
                  href="/dashboard/billing"
                  className="font-semibold text-emerald-400 underline-offset-2 hover:underline"
                >
                  Passer au plan Pro
                </a>
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

