"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ReanalyzeButton({ studyId }: { studyId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleReanalyze() {
    setLoading(true);
    try {
      const response = await fetch(`/api/feasibility/${studyId}/reanalyze`, { method: "POST" });
      let payload: { message?: string; zoning?: unknown } | null = null;

      try {
        payload = (await response.json()) as { message?: string; zoning?: unknown };
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(payload?.message || "Ré-analyse PLU impossible pour le moment.");
      }

      if (!payload?.zoning) {
        toast.warning("Aucune zone PLU trouvée pour cette adresse.");
      } else {
        toast.success("Zonage PLU mis à jour.");
      }

      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Échec de la ré-analyse PLU.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-3 h-7 gap-1.5 border-slate-700 text-xs text-slate-400 hover:text-slate-100"
      onClick={handleReanalyze}
      disabled={loading}
    >
      <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Analyse en cours…" : "Ré-analyser le PLU"}
    </Button>
  );
}
