import { SiteHeader } from "@/components/site-chrome";
import { requireUser } from "@/server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <SiteHeader user={user} />
      <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
    </>
  );
}
