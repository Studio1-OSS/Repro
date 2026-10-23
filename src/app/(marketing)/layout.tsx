import { AnnouncementBar, SiteFooter, SiteHeader } from "@/components/site-chrome";
import { getSessionUser } from "@/server/auth";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  return (
    <>
      <AnnouncementBar />
      <SiteHeader user={user} />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
