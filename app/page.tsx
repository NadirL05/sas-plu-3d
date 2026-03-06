import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SplineHero } from "@/components/landing/SplineHero"

const features = [
  {
    title: "Extraction PLU automatique",
    description:
      "Récupérez instantanément les règles d'urbanisme applicables à votre parcelle sans recherche manuelle.",
  },
  {
    title: "Visualisation 3D avec cadastre réel",
    description:
      "Projetez votre potentiel constructible dans un environnement fidèle aux données cadastrales.",
  },
  {
    title: "Exports PDF professionnels",
    description:
      "Générez des rapports clairs et partageables pour vos clients, partenaires ou dossiers d'investissement.",
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-20 md:flex-row md:items-center md:py-28">
        {/* Left: copy */}
        <div className="flex-1 space-y-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            SaaS d&apos;analyse foncière
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-balance md:text-5xl">
            Analysez le potentiel 3D de vos terrains en 1 clic
          </h1>
          <p className="text-lg text-muted-foreground">
            Accélérez vos études foncières avec une lecture réglementaire automatique,
            une modélisation 3D précise et des livrables prêts à l&apos;emploi.
          </p>
          <Button
            asChild
            size="lg"
            className="h-12 rounded-md px-10 text-base font-semibold shadow-lg shadow-primary/20"
          >
            <Link href="/dashboard">Démarrer l&apos;analyse gratuite</Link>
          </Button>
        </div>

        {/* Right: Spline 3D scene */}
        <div className="relative h-[420px] w-full flex-1 md:h-[520px]">
          <SplineHero />
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="border-border/70">
              <CardHeader>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  )
}
