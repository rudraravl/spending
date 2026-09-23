import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  DatabaseBackup,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Sun,
  Upload,
  Wallet,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Suspense, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { getAccounts } from '@/api/accounts'
import { forceBackupToday } from '@/api/backups'
import { listConnections } from '@/api/simplefin'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { syncResultSummary, useSimplefinSync } from '@/features/simplefin/useSimplefinSync'
import { formatRelativeTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/queryKeys'

type NavItem = { title: string; url: string }

const primaryNav: NavItem[] = [
  { title: 'Home', url: '/' },
  { title: 'Transactions', url: '/transactions' },
  { title: 'Budget', url: '/budgets' },
  { title: 'Accounts', url: '/accounts' },
  { title: 'Investments', url: '/investments' },
  { title: 'Recurring', url: '/recurring' },
]

const insightsNav: (NavItem & { description: string })[] = [
  { title: 'Reports', url: '/reports', description: 'Monthly spending and breakdowns' },
  { title: 'Views', url: '/views', description: 'Custom filters and saved views' },
  { title: 'Net worth', url: '/net-worth', description: 'Snapshots over time' },
]

const pillBase =
  'inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const pillIdle = 'text-muted-foreground hover:bg-secondary hover:text-foreground'
const pillActive = 'bg-primary text-primary-foreground shadow-md shadow-brand/25'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="Keep home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-md shadow-brand/40 ring-2 ring-brand/15">
        <Wallet className="h-4 w-4 text-primary-foreground drop-shadow-sm" />
      </span>
      <span className="font-playfair text-[1.9rem] font-bold leading-none tracking-tight">Keep</span>
    </Link>
  )
}

function ThemeMenuItems() {
  const { theme, setTheme } = useTheme()
  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
        <DropdownMenuRadioItem value="light">
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark">
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="system">
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  )
}

/** Bank-sync button with "last synced" hint; lives in the header so it's reachable from every page. */
function SyncButton() {
  const { data: connections = [] } = useQuery({
    queryKey: queryKeys.simplefinConnections(),
    queryFn: listConnections,
  })
  const { data: accounts } = useQuery({ queryKey: queryKeys.accounts(), queryFn: () => getAccounts() })
  const connection = connections[0] ?? null
  const sync = useSimplefinSync(connection?.id, {
    onSuccess: (result) => toast.success(syncResultSummary(result)),
    onError: (err) => toast.error(err.message),
  })

  const lastSynced = useMemo(() => {
    const stamps = (accounts ?? [])
      .filter((a) => a.is_linked && a.last_synced_at)
      .map((a) => a.last_synced_at as string)
      .sort()
    return stamps.length ? stamps[stamps.length - 1] : null
  }, [accounts])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 rounded-full px-3 text-muted-foreground"
            disabled={!connection || sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} />
            <span className="hidden xl:inline text-xs">
              {sync.isPending ? 'Syncing…' : lastSynced ? formatRelativeTime(lastSynced) : 'Sync'}
            </span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {!connection
          ? 'Add a SimpleFIN connection under Accounts → Bank Sync first.'
          : lastSynced
            ? `Sync banks · last synced ${formatRelativeTime(lastSynced)}`
            : 'Pull latest balances and transactions from SimpleFIN'}
      </TooltipContent>
    </Tooltip>
  )
}

function MobileNav() {
  const [open, setOpen] = useState(false)
  const all = [...primaryNav, ...insightsNav, { title: 'Import CSV', url: '/import' }, { title: 'Settings', url: '/settings' }]
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-5">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="mb-6">
          <Logo />
        </div>
        <nav className="flex flex-col gap-0.5">
          {all.map((item) => (
            <NavLink
              key={item.url}
              to={item.url}
              end={item.url === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )
              }
            >
              {item.title}
            </NavLink>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const [backupOpen, setBackupOpen] = useState(false)
  const insightsActive = insightsNav.some((i) => location.pathname.startsWith(i.url))

  const backup = useMutation({
    mutationFn: forceBackupToday,
    onSuccess: (result) => {
      toast.success(`DB backup ${result.overwritten ? 'overwritten' : 'created'}.`)
      setBackupOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <MobileNav />
          <Logo />

          <nav className="mx-auto hidden items-center gap-0.5 lg:flex" aria-label="Primary">
            {primaryNav.map((item) => (
              <NavLink
                key={item.url}
                to={item.url}
                end={item.url === '/'}
                className={({ isActive }) => cn(pillBase, isActive ? pillActive : pillIdle)}
              >
                {item.title}
              </NavLink>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(pillBase, insightsActive ? pillActive : pillIdle)}>
                Insights <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 rounded-xl p-1.5">
                {insightsNav.map((item) => (
                  <DropdownMenuItem
                    key={item.url}
                    asChild
                    className="flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left"
                  >
                    <Link to={item.url}>
                      <span className="text-sm font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <SyncButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground" aria-label="More actions">
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                <DropdownMenuItem asChild className="rounded-lg">
                  <Link to="/import">
                    <Upload className="mr-2 h-4 w-4" /> Import CSV
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="rounded-lg" onSelect={() => setBackupOpen(true)}>
                  <DatabaseBackup className="mr-2 h-4 w-4" /> Force DB backup
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <ThemeMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground" asChild>
              <NavLink
                to="/settings"
                aria-label="Settings"
                className={({ isActive }) => cn(isActive && 'bg-secondary text-foreground')}
              >
                <Settings className="h-5 w-5" />
              </NavLink>
            </Button>
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={backupOpen}
        title="Force DB backup"
        message="This will overwrite the most recent backup with the current DB state (today)."
        confirmLabel={backup.isPending ? 'Backing up…' : 'Confirm'}
        onCancel={() => setBackupOpen(false)}
        onConfirm={() => {
          if (!backup.isPending) backup.mutate()
        }}
      />

      <main className="flex-1">
        {/* Pages are lazy-loaded; keep the shell mounted while a page chunk loads. */}
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="py-6 text-center text-[11px] text-muted-foreground/70">Made by Rudra Raval</footer>
    </div>
  )
}
