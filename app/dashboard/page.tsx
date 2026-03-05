import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/src/lib/auth";
import { db } from "@/src/db";
import { feasibilityStudy } from "@/src/db/schema";
import { NewAnalysisCard } from "./_components/new-analysis-card";
import { RecentStudiesList } from "./_components/recent-studies-list";

export const metadata = { title: "Dashboard – SAS PLU 3D" };

export default async function DashboardPage() {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {
    // ignore, handled below
  }

  if (!db) {
    notFound();
  }

  const userId = session?.user?.id;
  if (!userId) {
    redirect("/sign-in?redirectTo=/dashboard");
  }

  const studies = await db
    .select({
      id: feasibilityStudy.id,
      address: feasibilityStudy.address,
      createdAt: feasibilityStudy.createdAt,
      zoning: feasibilityStudy.zoning,
      promoterBalance: feasibilityStudy.promoterBalance,
      status: feasibilityStudy.status,
    })
    .from(feasibilityStudy)
    .where(eq(feasibilityStudy.userId, userId))
    .orderBy(desc(feasibilityStudy.createdAt))
    .limit(20);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 md:py-8">
      <NewAnalysisCard />
      <RecentStudiesList studies={studies} />
    </div>
  );
}

