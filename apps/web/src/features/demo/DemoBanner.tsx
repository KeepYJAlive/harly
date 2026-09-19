import { isDemoMode } from "@harly/config";

/**
 * Thin, quiet banner shown across the whole dashboard when DEMO_MODE=true, so
 * a visitor always knows this is a shared, resetting sandbox. Renders nothing
 * on normal Harly installs.
 */
export function DemoBanner() {
  if (!isDemoMode()) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-hairline bg-sage-wash px-4 py-1.5 text-center text-[12px] font-medium text-sage-ink">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-chartreuse-signal"
      />
      Live demo — shared workspace, resets about every 2 hours. Don&apos;t
      enter real candidate data.
    </div>
  );
}
