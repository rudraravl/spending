import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronRight, Landmark } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getAccounts } from '../api/accounts'
import { queryKeys } from '../queryKeys'
import { ACCOUNT_TYPES, accountTypeLabel } from '../features/accounts/accountViewKind'
import type { Account } from '../api/accounts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

function linkLabel(isLinked: boolean | undefined) {
  if (isLinked) return 'Linked'
  return 'Manual only'
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

const TYPE_ORDER = new Map(ACCOUNT_TYPES.map((t, i) => [t, i]))

function groupAccountsByType(accounts: Account[]): { type: string; items: Account[] }[] {
  const byType = new Map<string, Account[]>()
  for (const a of accounts) {
    const list = byType.get(a.type) ?? []
    list.push(a)
    byType.set(a.type, list)
  }
  for (const list of byType.values()) {
    list.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }))
  }
  const types = Array.from(byType.keys())
  types.sort((a, b) => {
    const ia = TYPE_ORDER.get(a as (typeof ACCOUNT_TYPES)[number])
    const ib = TYPE_ORDER.get(b as (typeof ACCOUNT_TYPES)[number])
    const da = ia === undefined ? 999 : ia
    const db = ib === undefined ? 999 : ib
    if (da !== db) return da - db
    return a.localeCompare(b)
  })
  return types.map((type) => ({ type, items: byType.get(type)! }))
}

export default function AccountsPage() {
  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => getAccounts(),
  })

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      </div>
    )
  }

  const sections = groupAccountsByType(accounts)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Open an account to see balance and activity. Linked accounts will show sync status here later.
        </p>
      </motion.div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No accounts yet. Create one in{' '}
            <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
              Settings
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {sections.map(({ type, items }, sectionIdx) => {
            const cardOffset = sections.slice(0, sectionIdx).reduce((n, s) => n + s.items.length, 0)
            return (
            <section key={type}>
              <h2 className="text-sm font-semibold text-foreground tracking-tight mb-4">
                {accountTypeLabel(type)}
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {items.map((a, j) => (
                    <motion.li
                      key={a.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (cardOffset + j) * 0.04 }}
                    >
                      <Link to={`/accounts/${a.id}`} className="block group">
                        <Card className="h-full transition-colors hover:bg-accent/40 hover:border-border">
                          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <Landmark className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium leading-tight truncate group-hover:text-primary transition-colors">
                                  {a.name}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">{a.currency}</p>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </CardHeader>
                          <CardContent className="pt-0 space-y-2">
                            <p className="text-lg font-semibold tabular-nums tracking-tight">
                              {formatMoney(a.balance, a.currency)}
                            </p>
                            <Badge variant={a.is_linked ? 'default' : 'secondary'} className="text-[10px]">
                              {linkLabel(a.is_linked)}
                            </Badge>
                            {a.institution_name ? (
                              <p className="text-xs text-muted-foreground truncate">{a.institution_name}</p>
                            ) : null}
                          </CardContent>
                        </Card>
                      </Link>
                    </motion.li>
                ))}
              </ul>
            </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
