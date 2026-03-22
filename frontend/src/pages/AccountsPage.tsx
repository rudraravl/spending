import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronRight, Landmark } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getAccounts } from '../api/accounts'
import { queryKeys } from '../queryKeys'
import { accountTypeLabel } from '../features/accounts/accountViewKind'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

function linkLabel(isLinked: boolean | undefined) {
  if (isLinked) return 'Linked'
  return 'Manual only'
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
        <ul className="grid gap-4 sm:grid-cols-2">
          {accounts.map((a, i) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
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
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {accountTypeLabel(a.type)} · {a.currency}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Badge variant={a.is_linked ? 'default' : 'secondary'} className="text-[10px]">
                      {linkLabel(a.is_linked)}
                    </Badge>
                    {a.institution_name ? (
                      <p className="text-xs text-muted-foreground mt-2 truncate">{a.institution_name}</p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  )
}
