import { headers } from "next/headers";
import { MapPin } from "lucide-react";
import { auth } from "@/src/lib/auth";
import { PLUDashboard } from "@/components/dashboard/plu-dashboard";

export const metadata = {
  title: "Analyse PLU – SAS PLU 3D",
  description:
    "Recherchez une adresse et consultez les informations de zonage du Plan Local d'Urbanisme.",
};

export default async function DashboardPage() {
  // Récupère la session côté serveur (better-auth)
  const session = await auth.api.getSession({ headers: await headers() });
  const isAuthenticated = !!session?.user;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
        {/* ── Header ── */}
        <header className="mb-8">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Analyse PLU
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Entrez une adresse pour identifier sa zone d'urbanisme (Plan Local
            d'Urbanisme) et enregistrer une analyse de projet.
          </p>

          {!isAuthenticated && (
            <p className="mt-3 text-xs text-muted-foreground bg-muted rounded-md px-3 py-2 inline-flex items-center gap-1.5">
              <span className="text-yellow-500">⚠</span>
              Vous n'êtes pas connecté — la sauvegarde des projets sera
              désactivée.
            </p>
          )}
        </header>

        {/* ── Main dashboard ── */}
        <PLUDashboard isAuthenticated={isAuthenticated} />
      </div>
    </div>
  );
}
