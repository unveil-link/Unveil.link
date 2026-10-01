import { redirect } from "next/navigation";
import { getAdmin } from "@/server/admin/auth";

export const dynamic = "force-dynamic";
export default async function AdminIndex() {
  redirect((await getAdmin()) ? "/admin/sellers/flagged" : "/admin/login");
}
