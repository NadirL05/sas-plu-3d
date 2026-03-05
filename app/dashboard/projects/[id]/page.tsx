import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { feasibilityStudy, projects } from "@/src/db/schema";
import type { ZoneUrba, PromoterBalance } from "@/src/lib/plu-engine";
import { ProjectPipelineTable } from "@/components/dashboard/project-pipeline-table";

type ProjectPageProps = {
  params: { id: string };
};

export const metadata = {
  title: "Pipeline projet – SAS PLU 3D",
};

export default async function ProjectPipelinePage({ params }: ProjectPageProps) {
  const projectId = params.id;

  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[project.pipeline.page] session fallback invite", error);
  }

  const userId = session?.user?.id;
  if (!userId) {
    notFound();
  }

  const [projectRow] = await db
    .select({
      id: projects.id,
      name: projects.name,
      userId: projects.userId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!projectRow || projectRow.userId !== userId) {
    notFound();
  }

  const studies = await db
    .select({
      id: feasibilityStudy.id,
      address: feasibilityStudy.address,
      createdAt: feasibilityStudy.createdAt,
      zoning: feasibilityStudy.zoning,
      promoterBalance: feasibilityStudy.promoterBalance,
      status: feasibilityStudy.status,
      note: feasibilityStudy.note,
    })
    .from(feasibilityStudy)
    .where(eq(feasibilityStudy.projectId, projectRow.id))
    .orderBy(desc(feasibilityStudy.createdAt));

  const formattedStudies = studies.map((row) => ({
    id: row.id,
    address: row.address,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    zoning: row.zoning as ZoneUrba | null,
    promoterBalance: row.promoterBalance as PromoterBalance | null,
    status: (row.status ?? "PENDING") as "PENDING" | "GO" | "NO_GO",
    note: row.note,
  }));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 md:py-8">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Pipeline projet
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">
          {projectRow.name}
        </h1>
      </header>

      <ProjectPipelineTable projectName={projectRow.name} studies={formattedStudies} />
    </main>
  );
}

