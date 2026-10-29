import { Lightbulb, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { dismissTip, useOnboardingState } from './onboardingStore'
import { tourFeature } from './tourContent'

/**
 * Dismissible hint at the top of a page. Closed tips stay closed until restored from
 * Settings → Help, which is linked from the tip itself.
 */
export default function PageTip({ id, className }: { id: string; className?: string }) {
  const { dismissedTips } = useOnboardingState()
  const feature = tourFeature(id)
  if (!feature || dismissedTips.includes(id)) return null

  return (
    <div
      role="note"
      className={cn(
        'mb-5 flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm',
        className,
      )}
    >
      <span className="brand-icon-well h-7 w-7 shrink-0">
        <Lightbulb className="h-3.5 w-3.5 text-brand" />
      </span>
      <p className="min-w-0 flex-1 pt-1 text-muted-foreground">
        {feature.tip}{' '}
        <Link to="/settings?tab=help" className="whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline">
          More help
        </Link>
      </p>
      <button
        type="button"
        aria-label="Dismiss tip"
        title="Dismiss (find it again under Settings → Help)"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => dismissTip(id)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
