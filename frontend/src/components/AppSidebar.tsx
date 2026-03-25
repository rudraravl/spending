import {
  LayoutDashboard,
  Landmark,
  Upload,
  PlusCircle,
  ArrowLeftRight,
  List,
  BarChart3,
  FileText,
  Link2,
  Repeat,
  Settings,
  Wallet,
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
  { title: "Transfer", url: "/transfer", icon: ArrowLeftRight },
  { title: "Review transfers", url: "/transfers/review", icon: Link2 },
  { title: "All Transactions", url: "/transactions", icon: List },
  { title: "Recurring charges", url: "/recurring", icon: Repeat },
];

const analyticsItems = [
  { title: "Views", url: "/views", icon: BarChart3 },
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
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
                <Wallet className="h-4 w-4 text-sidebar-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-sidebar-accent-foreground">Spending</h1>
                <p className="text-[11px] text-sidebar-foreground">Local Budget tracker</p>
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
            <p className="px-6 mb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
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
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
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
