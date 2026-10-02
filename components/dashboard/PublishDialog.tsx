"use client";
import { useState } from "react";
import { Alert, Button, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { AttestationFields, EMPTY_ATTESTATION, allAttested, type Attestation } from "./AttestationFields";
import type { VerificationStatus } from "./types";

export function publishErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "verification_required": return "A verified account status is required before you can publish. Your drop is saved as a draft.";
    case "no_files": return "Add at least one file before publishing.";
    case "attestation_required": return "Please confirm all three statements to publish.";
    case "flagged": return "This drop is under review and can’t be changed right now.";
    default: return fallback;
  }
}

/** Confirm + attest + POST /api/drops/:id/publish. */
export function PublishDialog({
  open, onClose, dropId, title, verification, onPublished,
}: {
  open: boolean; onClose: () => void; dropId: string; title: string; verification: VerificationStatus; onPublished: () => void;
}) {
  const [att, setAtt] = useState<Attestation>(EMPTY_ATTESTATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = verification !== "verified";

  async function go() {
    if (!allAttested(att)) return setError("Please confirm all three statements to publish.");
    setBusy(true);
    setError(null);
    const res = await api(`/api/drops/${dropId}/publish`, { method: "POST", json: { attestation: att } });
    setBusy(false);
    if (res.ok) {
      setAtt(EMPTY_ATTESTATION);
      onPublished();
    } else setError(res.network ? res.error : res.status === 429 ? "Too many requests — try again shortly." : publishErrorMessage(res.code, res.error));
  }

  return (
    <Modal
      open={open}
      onClose={() => { setError(null); onClose(); }}
      title={`Publish “${title}”`}
      description="Publishing turns on the payment link for this drop."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={go} loading={busy} disabled={blocked}>Publish</Button>
        </>
      }
    >
      {blocked && (
        <Alert tone="warning" title="Verification needed">
          Your verification status is <b>{verification.replace("_", " ")}</b>. You can’t publish until you’re verified — this drop stays a draft.
        </Alert>
      )}
      <AttestationFields value={att} onChange={setAtt} idPrefix={`pub-${dropId}`} error={!!error && !allAttested(att)} />
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
