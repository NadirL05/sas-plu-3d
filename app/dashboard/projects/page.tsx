import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { FolderKanban, FolderOpen } from "lucide-react";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { projects } from "@/src/db/schema";
import { Button } from "@/components/ui/button";
import { ProjectsTable, type ProjectListRow } from "./_components/projects-table";

export const metadata = {
  title: "Mes projets - SAS PLU 3D",
  description: "Liste des projets enregistres avec zonage PLU et priorites.",
};

function getZoneLabel(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return "Non renseignee";
  }

  const zone = metadata.zone;
  if (!zone || typeof zone !== "object") {
    return "Non renseignee";
  }

  const zoneObject = zone as Record<string, unknown>;
  const libelle = zoneObject.libelle;
  if (typeof libelle === "string" && libelle.trim().length > 0) {
    return libelle;
  }

  const typezone = zoneObject.typezone;
  if (typeof typezone === "string" && typezone.trim().length > 0) {
    return typezone;
  }

  return "Non renseignee";
}

export default async function ProjectsPage() {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[projects.page] session fallback invite", error);
  }

  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="glass ultra-fine-border rounded-xl p-6">
          <h1 className="text-xl font-semibold">Connexion requise</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Vous devez etre connecte pour consulter vos projets.
          </p>
          <Button asChild className="mt-4">
            <Link href="/dashboard">Retour au dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="glass ultra-fine-border rounded-xl p-6">
          <h1 className="text-xl font-semibold">Mode invité actif</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La base de données n&apos;est pas configurée. Vous pouvez tester la recherche 3D sans
            sauvegarde de projets.
          </p>
          <Button asChild className="mt-4">
            <Link href="/dashboard">Retour au dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  const userProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      metadata: projects.metadata,
      isPriority: projects.isPriority,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.isPriority), desc(projects.createdAt));

  const rows: ProjectListRow[] = userProjects.map((project) => ({
    id: project.id,
    name: project.name,
    dateLabel: new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(project.createdAt),
    zoneLabel: getZoneLabel(project.metadata ?? null),
    isPriority: project.isPriority,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
              <FolderKanban className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Mes Projets</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Retrouvez vos analyses PLU et pilotez vos priorites.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">Lancer une nouvelle analyse</Link>
        </Button>
      </header>

      {rows.length === 0 ? (
        <div className="glass ultra-fine-border rounded-xl p-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <FolderOpen className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">Aucun projet enregistre</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Lancez une premiere analyse pour creer votre portefeuille de projets.
          </p>
          <Button asChild className="mt-5">
            <Link href="/dashboard">Lancer une nouvelle analyse</Link>
          </Button>
        </div>
      ) : (
        <div className="glass ultra-fine-border rounded-xl p-4">
          <ProjectsTable projects={rows} />
        </div>
      )}
    </div>
  );
}
