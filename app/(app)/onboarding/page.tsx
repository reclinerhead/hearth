import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icon";
import { AddressForm } from "./address-form-loader";

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("houses")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) > 0) redirect("/dashboard");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6 sm:py-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--color-accent)" }}>
            <Icon name="flame" size={16} />
          </span>
          <span className="eyebrow">Let&apos;s get started</span>
        </div>
        <h1 className="h1">What&apos;s your address?</h1>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", maxWidth: "44ch" }}
        >
          We&apos;ll set up your house and pull in what we can find about it —
          county records, hazards, the world around it.
        </p>
      </div>

      <div className="surface p-5 sm:p-6">
        <AddressForm />
      </div>

      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        You can change any of these details later from Home details.
      </p>
    </div>
  );
}
