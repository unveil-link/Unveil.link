"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export default function AdminLogout() {
  const router = useRouter();
  return (
    <Button type="button" variant="secondary" data-testid="admin-logout" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); router.replace("/admin/login"); router.refresh(); }}>
      Sign out
    </Button>
  );
}
