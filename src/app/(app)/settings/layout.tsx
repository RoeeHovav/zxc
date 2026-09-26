import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui/misc";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      <PageHeader title="Settings" description="Business profile, costs, pricing policies, security and your data." />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
