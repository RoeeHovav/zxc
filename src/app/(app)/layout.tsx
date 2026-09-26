import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/services/settings";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { FlaskConical } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();
  return (
    <div className="min-h-dvh">
      <Sidebar businessName={settings.businessName} />
      <div className="lg:ps-60">
        {settings.isDemo && (
          <div role="status" className="no-print flex items-center justify-center gap-2 bg-warning px-3 py-1.5 text-center text-xs font-semibold text-white dark:text-background">
            <FlaskConical className="size-3.5" aria-hidden /> DEMO ENVIRONMENT — sample data only. Do not enter real customer information.
          </div>
        )}
        <Topbar user={{ name: user.name, email: user.email }} businessName={settings.businessName} />
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
