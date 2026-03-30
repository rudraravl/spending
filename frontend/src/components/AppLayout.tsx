import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";

const pageMeta: Record<string, { title: string; description: string }> = {
  "/": { title: "Dashboard", description: "Your spending overview at a glance" },
  "/accounts": { title: "Accounts", description: "Linked and manual accounts" },
  "/import": { title: "Import CSV", description: "Upload bank statements" },
  "/add-transaction": { title: "Transactions", description: "Record and review activity" },
  "/transfer": { title: "Transactions", description: "Record and review activity" },
  "/transfers/review": { title: "Transactions", description: "Record and review activity" },
  "/transactions": { title: "Transactions", description: "Record and review activity" },
  "/recurring": { title: "Recurring charges", description: "Confirm or ignore detected recurring charges" },
  "/budgets": { title: "Budgets", description: "Set monthly limits and track progress" },
  "/views": { title: "Views", description: "Custom filters, charts, and saved views" },
  "/investments": { title: "Investments", description: "Portfolio allocation and account performance" },
  "/net-worth": { title: "Net worth", description: "Net worth snapshots over time" },
  "/reports": { title: "Reports", description: "Monthly spending, income, and breakdowns" },
  "/summaries": { title: "Reports", description: "Monthly spending, income, and breakdowns" },
  "/connections": { title: "Connections", description: "Manage SimpleFIN bank connections" },
  "/settings": { title: "Settings", description: "Categories, tags, and auto-categorization rules" },
};

export default function AppLayout() {
  const location = useLocation();
  const meta =
    pageMeta[location.pathname] ??
    (location.pathname.startsWith("/accounts/")
      ? { title: "Account", description: "Balance and activity" }
      : { title: "", description: "" });

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <div className="flex min-h-0 w-full flex-1">
        <AppSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="app-shell-header sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4">
            <div className="relative z-10 flex w-full items-center gap-3 min-h-14">
              <SidebarTrigger className="text-white hover:bg-white/20 hover:text-white rounded-lg transition-colors size-9 shrink-0 [&_svg]:size-5" />
              <div className="h-6 w-px shrink-0 bg-white/35" aria-hidden />
              <div className="flex items-center gap-2.5 min-w-0 flex-1 text-white">
                <h2 className="text-sm font-semibold tracking-tight truncate">{meta.title}</h2>
                <span className="text-sm hidden sm:inline truncate max-w-[min(28rem,50vw)]">
                  {meta.description}
                </span>
              </div>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto bg-background">
            <Outlet />
          </main>
          <footer className="shrink-0 border-t border-border/70 bg-muted/25 px-4 py-2.5 text-center text-[11px] text-muted-foreground">
            Made by Rudra Raval
          </footer>
        </div>
      </div>
    </SidebarProvider>
  );
}
