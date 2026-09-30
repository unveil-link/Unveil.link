import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ContainerProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  size?: "narrow" | "default" | "wide";
};

const widths = { narrow: "max-w-2xl", default: "max-w-6xl", wide: "max-w-7xl" } as const;

export function Container({ as: Tag = "div", size = "default", className, ...rest }: ContainerProps) {
  return <Tag className={cn("mx-auto w-full px-5 sm:px-6 lg:px-8", widths[size], className)} {...rest} />;
}

type SectionProps = HTMLAttributes<HTMLElement> & {
  tone?: "default" | "surface" | "ink";
};

const tones = {
  default: "",
  surface: "bg-surface border-y border-border",
  ink: "bg-ink text-white",
} as const;

export function Section({ tone = "default", className, ...rest }: SectionProps) {
  return <section className={cn("py-14 sm:py-20", tones[tone], className)} {...rest} />;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  id,
  invert = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  id?: string;
  invert?: boolean;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && (
        <p className={cn("text-sm font-semibold uppercase tracking-wider", invert ? "text-accent" : "text-primary")}>
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {description && <p className={cn("mt-3 text-lg", invert ? "text-white/75" : "text-muted")}>{description}</p>}
    </div>
  );
}
