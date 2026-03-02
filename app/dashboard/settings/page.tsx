import { Settings } from "lucide-react";

export const metadata = {
  title: "Settings - SAS PLU 3D",
  description: "Paramètres du compte et des préférences.",
};

export default function SettingsPage() {
  return (
    <div className="glass ultra-fine-border rounded-xl p-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Cette section sera complétée avec les paramètres du compte.
      </p>
    </div>
  );
}

