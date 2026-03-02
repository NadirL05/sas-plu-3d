"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, ExternalLink, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteProjectAction, setProjectPriorityAction } from "@/app/actions/projects-actions";

export interface ProjectListRow {
  id: string;
  name: string;
  dateLabel: string;
  zoneLabel: string;
  isPriority: boolean;
}

interface ProjectsTableProps {
  projects: ProjectListRow[];
}

export function ProjectsTable({ projects }: ProjectsTableProps) {
  const [rows, setRows] = useState(projects);
  const [isPending, startTransition] = useTransition();

  const togglePriority = (projectId: string) => {
    startTransition(async () => {
      const previousRows = rows;
      const current = previousRows.find((item) => item.id === projectId);
      if (!current) return;

      const nextValue = !current.isPriority;
      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.id === projectId
            ? { ...currentRow, isPriority: nextValue }
            : currentRow
        )
      );

      const result = await setProjectPriorityAction(projectId, nextValue);
      if (!result.success) {
        setRows(previousRows);
        toast.error(result.error ?? "Impossible de mettre a jour la priorite.");
        return;
      }

      toast.success(
        nextValue ? "Projet marque comme prioritaire." : "Priorite retiree."
      );
    });
  };

  const deleteProject = (projectId: string, name: string) => {
    const confirmed = window.confirm(
      "Confirmer la suppression de ce projet ? Cette action est irreversible."
    );
    if (!confirmed) return;

    startTransition(async () => {
      const previousRows = rows;
      setRows((currentRows) =>
        currentRows.filter((currentRow) => currentRow.id !== projectId)
      );

      const result = await deleteProjectAction(projectId);
      if (!result.success) {
        setRows(previousRows);
        toast.error(result.error ?? "Suppression impossible.");
        return;
      }

      toast.success(`Projet "${name}" supprime.`);
    });
  };

  const columns: ColumnDef<ProjectListRow>[] = [
    {
      accessorKey: "name",
      header: "Nom du projet (adresse)",
      cell: ({ row }) => (
        <div className="font-medium text-foreground line-clamp-1">
          {row.original.name}
        </div>
      ),
    },
    {
      accessorKey: "dateLabel",
      header: "Date de creation",
    },
    {
      accessorKey: "zoneLabel",
      header: "Zone PLU",
      cell: ({ row }) => {
        const zone = row.original.zoneLabel;
        return <Badge variant="outline">{zone}</Badge>;
      },
    },
    {
      id: "priority",
      header: "Prioritaire",
      cell: ({ row }) =>
        row.original.isPriority ? (
          <Badge className="gap-1">
            <Star className="h-3 w-3 fill-current" />
            Prioritaire
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    {
      id: "actions",
      header: "Actions rapides",
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/dashboard?address=${encodeURIComponent(row.original.name)}`}
              className="gap-1.5"
            >
              Ouvrir
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() => togglePriority(row.original.id)}
            className="gap-1.5"
          >
            <ArrowUpDown className="h-4 w-4" />
            Changer priorite
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => deleteProject(row.original.id, row.original.name)}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyState="Aucun projet enregistre."
    />
  );
}
