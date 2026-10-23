import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { site } from "@/config/site";
import "./globals.css";

const openSans = Open_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-open-sans" });

export const metadata: Metadata = {
  title: { default: `${site.name}: ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={openSans.variable}>
      <body className="min-h-dvh">
        {children}
        <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 9999, fontFamily: "var(--font-sans)" } }} />
      </body>
    </html>
  );
}
