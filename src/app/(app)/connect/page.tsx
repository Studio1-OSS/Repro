import type { Metadata } from "next";
import { ConnectExtension } from "@/components/connect-extension";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "Connect the extension" };

export default async function ConnectPage() {
  const user = await requireUser("/connect");
  return (
    <div className="container-page max-w-2xl py-14">
      <p className="eyebrow">Extension</p>
      <h1 className="mt-1 text-heading font-semibold">Connect this browser</h1>
      <p className="mt-3 text-ink-2">
        Pairing lets the extension upload recordings to <b className="font-semibold text-ink">{user.email}</b> and run Reproduce in this browser. The token is stored only in the extension; you can pair again any time.
      </p>
      <ConnectExtension />
    </div>
  );
}
