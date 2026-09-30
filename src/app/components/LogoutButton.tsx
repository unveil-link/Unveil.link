"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}
