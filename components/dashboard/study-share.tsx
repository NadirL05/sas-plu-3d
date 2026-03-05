"use client";

import { useState } from "react";
import { Loader2, LinkIcon, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface StudyShareProps {
  studyId: string;
  initialEnabled: boolean;
  initialPublicShareId: string | null;
}

export function StudyShare({ studyId, initialEnabled, initialPublicShareId }: StudyShareProps) {
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);
  const [publicShareId, setPublicShareId] = useState<string | null>(initialPublicShareId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicUrl =
    typeof window !== "undefined" && publicShareId
      ? `${window.location.origin}/p/${publicShareId}`
      : publicShareId
        ? `/p/${publicShareId}`
        : "";

  const updateShare = async (payload: { enabled?: boolean; regenerate?: boolean }) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/feasibility/${studyId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            publicShareId?: string | null;
            publicShareEnabled?: boolean;
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok || !data || data.error) {
        const message =
          data?.message ??
          "Impossible de mettre à jour les paramètres de partage. Merci de réessayer plus tard.";
        setError(message);
        setIsSaving(false);
        return;
      }

      setEnabled(Boolean(data.publicShareEnabled));
      setPublicShareId(data.publicShareId ?? null);
      setIsSaving(false);
    } catch (err) {
      console.error("[StudyShare] update error", err);
      setError("Connexion au service impossible. Vérifiez votre réseau et réessayez.");
      setIsSaving(false);
    }
  };

  const handleToggle = (nextValue: boolean) => {
    setEnabled(nextValue);
    void updateShare({ enabled: nextValue });
  };

  const handleRegenerate = () => {
    void updateShare({ regenerate: true });
  };

  const handleCopy = () => {
    if (!publicUrl || typeof window === "undefined" || typeof navigator === "undefined") return;
    navigator.clipboard
      .writeText(publicUrl)
      .catch(() => {
        setError("Impossible de copier le lien dans le presse-papier.");
      });
  };

  return (
    <Card className="border-border/70 bg-slate-950/80 text-slate-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <LinkIcon className="h-3.5 w-3.5" />
          </span>
          Partager cette étude
        </CardTitle>
        <CardDescription className="text-xs text-slate-400">
          Activez un lien public en lecture seule pour partager cette étude avec vos partenaires
          (promoteurs, investisseurs, collectivités).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-slate-100">Lien public</p>
            <p className="text-[11px] text-slate-400">
              Lorsque le lien est activé, toute personne disposant de l&apos;URL peut consulter
              l&apos;étude en lecture seule.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => handleToggle(event.target.checked)}
              disabled={isSaving}
              className="h-4 w-4 rounded border border-slate-500 bg-slate-900 text-emerald-500"
            />
            <span>{enabled ? "Lien public activé" : "Lien public désactivé"}</span>
          </label>
        </div>

        {enabled && (
          <div className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/70 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Input
                value={publicUrl}
                readOnly
                className="h-9 bg-slate-950/80 text-xs text-slate-100"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={!publicShareId || isSaving}
                  className="h-9 text-xs"
                >
                  Copier
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={isSaving}
                  className="h-9 gap-1.5 text-xs text-slate-300 hover:text-slate-50"
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Régénérer
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              La régénération invalide l&apos;ancien lien. Idéal pour couper l&apos;accès partagé
              à d&apos;anciens interlocuteurs.
            </p>
          </div>
        )}

        {error ? <p className="text-xs text-amber-300">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

