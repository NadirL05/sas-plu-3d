import { headers } from "next/headers";
import { auth } from "@/src/lib/auth";
import { PLUDashboard } from "@/components/dashboard/plu-dashboard";

export const metadata = {
  title: "Analyse PLU – SAS PLU 3D",
  description:
    "Recherchez une adresse et consultez les informations de zonage du Plan Local d'Urbanisme.",
};

export default async function DashboardPage() {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    console.warn("[dashboard.page] session fallback invite", error);
  }
  const isAuthenticated = !!session?.user;

  return <PLUDashboard isAuthenticated={isAuthenticated} />;
}
