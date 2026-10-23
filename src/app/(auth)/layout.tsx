import { Logo } from "@/components/logo";
import { site } from "@/config/site";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="hidden bg-media p-12 text-white lg:flex lg:flex-col lg:justify-end">
        <p className="text-caption text-[#fa8c16]">Record · Report · Reproduce</p>
        <p className="mt-4 max-w-md text-display-xl font-semibold">Record the bug once.</p>
        <p className="mt-4 max-w-sm text-white/70">{site.model.name} writes the report and reproduces it in your own signed-in browser.</p>
      </div>
    </div>
  );
}
