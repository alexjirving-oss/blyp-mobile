import type { Metadata } from "next";
import { TeamsClient } from "@/components/TeamsClient";

export const metadata: Metadata = {
  title: "Teams — Agency desk & apply to run a team",
  description:
    "For agencies and team leaders: clear 50/50 gift split, 10–15% from Blyp’s half, web Teams operator desk. Apply to run a team on Blyp.",
};

export default function TeamsPage() {
  return <TeamsClient />;
}
