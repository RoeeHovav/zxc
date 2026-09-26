import { BarChart3, Boxes, ClipboardList, FileText, Home, Layers, PenTool, Printer, Settings, Users, Wallet } from "lucide-react";
import { dictionary } from "@/lib/i18n";

const t = dictionary.nav;

export const NAV_GROUPS = [
  {
    label: null,
    items: [{ href: "/dashboard", label: t.dashboard, icon: Home }],
  },
  {
    label: "Sales",
    items: [
      { href: "/orders", label: t.orders, icon: ClipboardList },
      { href: "/quotes", label: t.quotes, icon: FileText },
      { href: "/customers", label: t.customers, icon: Users },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/production", label: t.production, icon: Layers },
      { href: "/designs", label: t.designs, icon: PenTool },
      { href: "/materials", label: t.materials, icon: Boxes },
      { href: "/printers", label: t.printers, icon: Printer },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/finance", label: t.finance, icon: Wallet },
      { href: "/reports", label: t.reports, icon: BarChart3 },
    ],
  },
  {
    label: null,
    items: [{ href: "/settings", label: t.settings, icon: Settings }],
  },
];
