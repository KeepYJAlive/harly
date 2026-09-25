/**
 * Shared types for the career page feature , templates, builder, and public
 * render all import from here instead of redeclaring locally.
 */

export type Job = {
  id: string;
  slug: string;
  title: string;
  department: string | null;
  location: string | null;
  opportunityType: "employment" | "volunteer";
  employmentType: string | null;
  workplaceType: string;
  minimumHours: number | null;
  commitmentPeriod: "week" | "month" | null;
};
