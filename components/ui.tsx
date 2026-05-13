import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./icon";

/* ---------------------------------------------------------------
 * Section header
 * ------------------------------------------------------------- */

export function SectionHeader({
  eyebrow,
  title,
  trailing,
}: {
  eyebrow?: string;
  title: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <div className="h2">{title}</div>
      </div>
      {trailing ? <div className="flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------
 * MetricCard
 * ------------------------------------------------------------- */

export function MetricCard({
  eyebrow,
  value,
  meta,
  icon,
}: {
  eyebrow: string;
  value: ReactNode;
  meta?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="surface p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{eyebrow}</div>
        {icon ? (
          <span style={{ color: "var(--color-text-tertiary)" }}>
            <Icon name={icon} size={14} />
          </span>
        ) : null}
      </div>
      <div
        className="mt-1"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 22,
          fontWeight: 500,
          lineHeight: 1.2,
          color: "var(--color-text-primary)",
        }}
      >
        {value}
      </div>
      {meta ? (
        <div
          className="mt-1 text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {meta}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------
 * EntityRow — used in Appliances list and dashboard quadrant
 * ------------------------------------------------------------- */

export function EntityRow({
  icon,
  name,
  type,
  meta,
  href,
}: {
  icon: IconName;
  name: string;
  type: string;
  meta?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-[var(--radius-md)] p-3 transition-colors"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          color: "var(--color-text-secondary)",
        }}
      >
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {name}
          </span>
          <span
            className="text-small truncate"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {type}
          </span>
        </div>
        {meta ? (
          <div
            className="text-small truncate"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      <span
        aria-hidden
        style={{ color: "var(--color-text-tertiary)" }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Icon name="chevron-right" size={16} />
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------
 * EmergencyTile — large tappable tile
 * ------------------------------------------------------------- */

export function EmergencyTile({
  icon,
  label,
  hint,
  variant = "default",
}: {
  icon: IconName;
  label: string;
  hint?: string;
  variant?: "default" | "add";
}) {
  const isAdd = variant === "add";
  return (
    <button
      type="button"
      className="flex flex-col items-start gap-2 rounded-[var(--radius-lg)] p-4 text-left transition-colors"
      style={{
        minHeight: 110,
        backgroundColor: isAdd
          ? "transparent"
          : "var(--color-bg-surface-raised)",
        border: isAdd
          ? "1px dashed var(--color-border-emphasis)"
          : "1px solid var(--color-border-subtle)",
        color: isAdd
          ? "var(--color-text-tertiary)"
          : "var(--color-text-primary)",
      }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-md"
        style={{
          backgroundColor: isAdd
            ? "transparent"
            : "color-mix(in oklab, var(--color-danger) 14%, transparent)",
          color: isAdd ? "var(--color-text-tertiary)" : "var(--color-danger)",
        }}
      >
        <Icon name={icon} size={20} />
      </span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {hint ? (
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {hint}
          </div>
        ) : null}
      </div>
    </button>
  );
}

/* ---------------------------------------------------------------
 * TimelineItem — used by maintenance & history
 * ------------------------------------------------------------- */

export function TimelineItem({
  icon,
  title,
  meta,
  detail,
  state = "done",
}: {
  icon?: IconName;
  title: string;
  meta?: string;
  detail?: string;
  state?: "done" | "upcoming" | "due";
}) {
  const stateColor =
    state === "upcoming"
      ? "var(--color-info)"
      : state === "due"
        ? "var(--color-warning)"
        : "var(--color-success)";
  return (
    <li className="relative pl-8 pb-5 last:pb-0">
      <span
        aria-hidden
        className="absolute left-2 top-2 bottom-0 w-px"
        style={{ backgroundColor: "var(--color-border-subtle)" }}
      />
      <span
        aria-hidden
        className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full"
        style={{
          backgroundColor: "var(--color-bg-base)",
          border: `2px solid ${stateColor}`,
          color: stateColor,
        }}
      >
        {icon ? <Icon name={icon} size={11} strokeWidth={2.25} /> : null}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
        {meta ? (
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {meta}
          </span>
        ) : null}
      </div>
      {detail ? (
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {detail}
        </div>
      ) : null}
    </li>
  );
}

/* ---------------------------------------------------------------
 * AskAboutStrip — "Ask about this [entity/document]" affordance
 * ------------------------------------------------------------- */

export function AskAboutStrip({
  scopeLabel,
  placeholder,
}: {
  scopeLabel: string;
  placeholder: string;
}) {
  return (
    <div
      className="surface-ai flex items-center gap-3 p-3 sm:p-4"
      style={{ borderRadius: "var(--radius-lg)" }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: "color-mix(in oklab, var(--color-accent) 16%, transparent)",
          color: "var(--color-accent)",
        }}
      >
        <Icon name="message-circle" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow">Ask</span>
          <span className="chip chip-ai">{scopeLabel}</span>
        </div>
        <div
          className="text-small truncate"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {placeholder}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Ask"
      >
        <Icon name="arrow-right" size={16} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
 * AICard — wraps any card with the AI-content treatment
 * ------------------------------------------------------------- */

export function AICard({
  title,
  eyebrow = "AI summary",
  children,
  className,
}: {
  title?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface-ai p-4 sm:p-5 ${className ?? ""}`}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: "var(--color-accent)" }}>
          <Icon name="sparkles" size={14} />
        </span>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      {title ? <div className="h3 mb-1">{title}</div> : null}
      <div
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {children}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
 * Breadcrumb
 * ------------------------------------------------------------- */

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol
        className="flex flex-wrap items-center gap-1 text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  style={{ color: "var(--color-text-secondary)" }}
                  className="hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  style={{
                    color: last
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                  }}
                >
                  {item.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden style={{ opacity: 0.6 }}>
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------
 * PlaceholderImage — graceful stand-in for photo uploads
 * ------------------------------------------------------------- */

export function PlaceholderImage({
  ratio = "1 / 1",
  label,
  icon = "photo",
}: {
  ratio?: string;
  label?: string;
  icon?: IconName;
}) {
  return (
    <div
      className="surface-raised relative overflow-hidden flex items-center justify-center"
      style={{ aspectRatio: ratio }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 55%), radial-gradient(circle at 70% 75%, color-mix(in oklab, var(--color-info) 10%, transparent), transparent 60%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-2 text-center px-4">
        <span style={{ color: "var(--color-text-tertiary)" }}>
          <Icon name={icon} size={26} />
        </span>
        {label ? (
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
