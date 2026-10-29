import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { deleteConnection } from '@/api/simplefin'
import { queryKeys } from '@/queryKeys'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

const BRIDGE_URL = 'https://beta-bridge.simplefin.org/'

type Props = {
  open: boolean
  connectionId: number
  linkedCount: number
  onClose: () => void
}

/**
 * Removing a connection is two steps: revoke it on SimpleFIN, then forget it here.
 * The backend re-checks the Access URL and refuses while SimpleFIN still honors it,
 * so a live credential never ends up orphaned in a deleted row.
 */
export default function RemoveConnectionDialog({ open, connectionId, linkedCount, onClose }: Props) {
  const queryClient = useQueryClient()
  const [confirmed, setConfirmed] = useState(false)

  const remove = useMutation({
    mutationFn: () => deleteConnection(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinConnections() })
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinCachedAccounts() })
      queryClient.invalidateQueries({ queryKey: queryKeys.simplefinDailyBudgetAll() })
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      close()
    },
  })

  function close() {
    setConfirmed(false)
    remove.reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !remove.isPending && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove SimpleFIN connection</DialogTitle>
          <DialogDescription>
            Delete the connection on SimpleFIN first so Keep&apos;s access is revoked, then remove it here.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <Step n={1} />
            <div className="space-y-1.5">
              <p>
                Sign in to SimpleFIN Bridge and delete the app connection you created for Keep.
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href={BRIDGE_URL} target="_blank" rel="noreferrer">
                  Open SimpleFIN Bridge <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </li>
          <li className="flex gap-3">
            <Step n={2} />
            <p>
              Remove it from Keep.{' '}
              {linkedCount > 0
                ? `${linkedCount} linked account${linkedCount === 1 ? '' : 's'} will be unlinked. `
                : null}
              Your accounts and their transaction history stay.
            </p>
          </li>
        </ol>

        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
          <Checkbox
            id="sfin-revoked"
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="sfin-revoked" className="text-sm font-normal leading-snug">
            I&apos;ve deleted this connection on SimpleFIN Bridge
          </Label>
        </div>

        {remove.error ? <p className="text-sm text-destructive">{remove.error.message}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={!confirmed || remove.isPending}>
            {remove.isPending ? 'Checking with SimpleFIN…' : 'Remove from Keep'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">
      {n}
    </span>
  )
}
