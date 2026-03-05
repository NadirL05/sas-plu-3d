"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, signUp } from "@/src/lib/auth-client";

type Mode = "signin" | "signup";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === "signin") {
        const result = await signIn.email({ email, password });
        if (result.error) {
          setError(result.error.message ?? "Identifiants incorrects.");
          setIsLoading(false);
          return;
        }
      } else {
        const result = await signUp.email({ name, email, password });
        if (result.error) {
          setError(result.error.message ?? "Erreur lors de la création du compte.");
          setIsLoading(false);
          return;
        }
      }
      router.push(redirectTo);
    } catch {
      setError("Erreur inattendue, veuillez réessayer.");
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / title */}
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            SAS PLU 3D
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {mode === "signin" ? "Connexion" : "Créer un compte"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Accédez à votre espace d'analyse foncière."
              : "Commencez votre analyse foncière gratuitement."}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <div className="space-y-1">
              <label htmlFor="name" className="text-xs font-medium text-foreground/80">
                Nom complet
              </label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Jean Dupont"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-medium text-foreground/80">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="vous@exemple.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-medium text-foreground/80">
              Mot de passe
            </label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
              minLength={8}
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === "signin" ? "Connexion…" : "Création…"}
              </>
            ) : mode === "signin" ? (
              "Se connecter"
            ) : (
              "Créer mon compte"
            )}
          </Button>
        </form>

        {/* Toggle mode */}
        <p className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              Pas encore de compte ?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                S&apos;inscrire
              </button>
            </>
          ) : (
            <>
              Déjà un compte ?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(null); }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Se connecter
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
