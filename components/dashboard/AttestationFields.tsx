"use client";
import { Checkbox } from "@/components/ui";

export type Attestation = { over18: boolean; ownsRights: boolean; consentOfSubjects: boolean };
export const EMPTY_ATTESTATION: Attestation = { over18: false, ownsRights: false, consentOfSubjects: false };
export const allAttested = (a: Attestation) => a.over18 && a.ownsRights && a.consentOfSubjects;

const COPY: Record<keyof Attestation, { label: string; description: string }> = {
  over18: { label: "Everyone in this content is 18 or older", description: "Anyone who appears in your files is an adult." },
  ownsRights: { label: "I own the rights to this content", description: "I created it or have permission to sell it." },
  consentOfSubjects: { label: "Everyone in it agreed to its sale", description: "People who appear have consented to it being sold." },
};

/** The three confirmations the backend requires on publish (`attestation.{over18,ownsRights,consentOfSubjects}`). */
export function AttestationFields({ value, onChange, idPrefix, error }: { value: Attestation; onChange: (a: Attestation) => void; idPrefix: string; error?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-text">Before you publish, please confirm</legend>
      {(Object.keys(COPY) as (keyof Attestation)[]).map((k) => (
        <Checkbox
          key={k}
          id={`${idPrefix}-${k}`}
          checked={value[k]}
          error={error && !value[k]}
          onChange={(e) => onChange({ ...value, [k]: e.target.checked })}
          label={COPY[k].label}
          description={COPY[k].description}
        />
      ))}
    </fieldset>
  );
}
