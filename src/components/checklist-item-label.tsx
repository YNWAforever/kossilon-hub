import { checklistItemChineseName } from "@/lib/checklist-item-label";
import { cn } from "@/lib/utils";

/** A checklist document's name: Chinese first, the stored English beside it. */
export function ChecklistItemLabel({ label, className }: { label: string; className?: string }) {
  const chinese = checklistItemChineseName(label);
  if (!chinese) return <span className={className}>{label}</span>;
  return (
    <span className={cn("min-w-0", className)}>
      {chinese}
      <span lang="en" className="ml-1.5 text-xs font-normal text-muted-foreground">
        {label.trim()}
      </span>
    </span>
  );
}
