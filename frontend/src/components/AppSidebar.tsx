import {
  LayoutDashboard,
  Landmark,
  Upload,
  PlusCircle,
  ArrowLeftRight,
  List,
  BarChart3,
  FileText,
  Repeat,
  Settings,
  Wallet,
  Plug,
  TrendingUp,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const mainItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Accounts", url: "/accounts", icon: Landmark },
  { title: "Import CSV", url: "/import", icon: Upload },
  { title: "Add Transaction", url: "/add-transaction", icon: PlusCircle },
  { title: "Transfers", url: "/transfer", icon: ArrowLeftRight },
  { title: "All Transactions", url: "/transactions", icon: List },
  { title: "Recurring charges", url: "/recurring", icon: Repeat },
  { title: "Budgets", url: "/budgets", icon: Wallet },
];

const syncItems = [
  { title: "Connections", url: "/connections", icon: Plug },
];

const analyticsItems = [
  { title: "Views", url: "/views", icon: BarChart3 },
  { title: "Investments", url: "/investments", icon: TrendingUp },
  { title: "Summaries", url: "/summaries", icon: FileText },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const renderItems = (items: typeof mainItems) =>
    items.map((item) => (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-black/15 hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="py-6">
        {/* Branding */}
        {!collapsed && (
          <div className="px-6 mb-8">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary shadow-md shadow-brand/40 ring-2 ring-white/15">
                <Wallet className="h-4 w-4 text-sidebar-primary-foreground drop-shadow-sm" />
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight text-sidebar-accent-foreground">
                  Keep
                </h1>
                <p className="text-[11px] text-sidebar-foreground/80 font-medium">Local budget tracker</p>
              </div>
            </div>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(mainItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!collapsed && (
          <div className="px-6 my-3">
            <div className="h-px bg-sidebar-border" />
          </div>
        )}

        <SidebarGroup>
          {!collapsed && (
            <p className="px-6 mb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
              Bank Sync
            </p>
          )}
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(syncItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!collapsed && (
          <div className="px-6 my-3">
            <div className="h-px bg-sidebar-border" />
          </div>
        )}

        <SidebarGroup>
          {!collapsed && (
            <p className="px-6 mb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
              Analytics
            </p>
          )}
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(analyticsItems)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Settings pinned to bottom — standard UX pattern */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/settings"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-black/15 hover:bg-sidebar-primary hover:text-sidebar-primary-foreground"
              >
                <Settings className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Settings</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
