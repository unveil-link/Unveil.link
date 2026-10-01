import { redirect } from "next/navigation";
import { getAdmin } from "@/server/admin/auth";
import AppShell from "../../components/AppShell";
import AdminLoginForm from "./AdminLoginForm";

export default async function Page() {
  if (await getAdmin()) redirect("/admin/sellers/flagged");
  return (
    <AppShell>
      <AdminLoginForm />
    </AppShell>
  );
}
