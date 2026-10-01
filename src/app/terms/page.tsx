import type { Metadata } from "next";
import { ComingSoon, comingSoonRobots } from "@/components/landing/ComingSoon";

export const metadata: Metadata = { title: "Terms", robots: comingSoonRobots };

export default function Page() {
  return <ComingSoon title="Terms" />;
}
