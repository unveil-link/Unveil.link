import type { Metadata } from "next";
import { ComingSoon, comingSoonRobots } from "@/components/landing/ComingSoon";

export const metadata: Metadata = { title: "DMCA", robots: comingSoonRobots };

export default function Page() {
  return <ComingSoon title="DMCA" />;
}
