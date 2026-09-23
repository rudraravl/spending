import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned controls (buttons, range pickers). */
  actions?: ReactNode
  className?: string
}

/** Title row at the top of every page: large title, one-line description, optional actions. */
export default function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
