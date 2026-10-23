"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** Only allow same-site relative redirects. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

const inputClass = "h-11 w-full border border-card-border bg-canvas px-3 text-body outline-none transition-colors focus:border-primary";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const { error } =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: String(form.get("name") ?? "").trim(), email, password })
        : await authClient.signIn.email({ email, password });
    if (error) {
      setPending(false);
      setError(error.message ?? "Something went wrong");
      return;
    }
    router.push(next);
    router.refresh();
  }

  const other = mode === "sign-in" ? "/sign-up" : "/sign-in";
  return (
    <div>
      <p className="eyebrow">{mode === "sign-in" ? "Welcome back" : "Free and open source"}</p>
      <h1 className="mt-2 text-heading font-semibold">{mode === "sign-in" ? "Sign in to Repro" : "Create your account"}</h1>
      <form onSubmit={onSubmit} className="mt-8 grid gap-4">
        {mode === "sign-up" && (
          <label className="grid gap-1.5 text-ui text-ink-2">
            Name
            <input name="name" required maxLength={60} autoComplete="name" className={inputClass} />
          </label>
        )}
        <label className="grid gap-1.5 text-ui text-ink-2">
          Email
          <input name="email" type="email" required autoComplete="email" className={inputClass} />
        </label>
        <label className="grid gap-1.5 text-ui text-ink-2">
          Password{mode === "sign-up" && <span className="text-caption text-ink-3">At least 8 characters</span>}
          <input name="password" type="password" required minLength={8} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className={inputClass} />
        </label>
        {error && <p className="bg-[#fff1f0] px-3 py-2 text-ui text-error">{error}</p>}
        <Button type="submit" size="lg" loading={pending} className="mt-2">
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-ui text-ink-2">
        {mode === "sign-in" ? "New here? " : "Already have an account? "}
        <Link href={params.get("next") ? `${other}?next=${encodeURIComponent(next)}` : other} className="text-primary hover:underline">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </div>
  );
}
