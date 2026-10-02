import { ButtonLink, EmptyState } from "@/components/ui";
import { SearchOffIcon } from "@/components/dashboard/SearchOffIcon";

export default function NotFound() {
  return (
    <EmptyState
      className="mt-6"
      icon={<SearchOffIcon />}
      title="We couldn’t find that drop"
      description="It may have been removed, or the link is mistyped."
      action={<ButtonLink href="/dashboard/drops" variant="secondary">Back to your drops</ButtonLink>}
    />
  );
}
