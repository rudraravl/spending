import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Outlet, useLocation } from "react-router-dom";

const pageMeta: Record<string, { title: string; description: string }> = {
  "/": { title: "Dashboard", description: "Your spending overview at a glance" },
  "/accounts": { title: "Accounts", description: "Linked and manual accounts" },
  "/import": { title: "Import CSV", description: "Upload bank statements" },
  "/add-transaction": { title: "Add Transaction", description: "Record a new expense or income" },
  "/transfer": { title: "Transfer", description: "Move money between accounts" },
  "/transfers/review": { title: "Review transfers", description: "Link card payments across accounts" },
  "/transactions": { title: "All Transactions", description: "Review your transaction history" },
  "/recurring": { title: "Recurring charges", description: "Confirm or ignore detected recurring charges" },
  "/views": { title: "Views", description: "Custom filtered analytics" },
  "/summaries": { title: "Summaries", description: "Period rollup reports" },
  "/settings": { title: "Settings", description: "Manage accounts, categories & rules" },
};

export default function AppLayout() {
  const location = useLocation();
  const meta =
    pageMeta[location.pathname] ??
    (location.pathname.startsWith("/accounts/")
      ? { title: "Account", description: "Balance and activity" }
      : { title: "", description: "" });

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b bg-card px-4 shrink-0 gap-3">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">{meta.title}</h2>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {meta.description}
              </span>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
