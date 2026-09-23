import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type InlineRenameProps = {
  value: string
  /** Resolve to finish editing; reject (e.g. name taken) to keep the field open. */
  onRename: (next: string) => Promise<unknown>
  /** Text shown when renaming isn't allowed (e.g. names the app depends on). */
  lockedReason?: string
  className?: string
  inputClassName?: string
  label: string
}

/**
 * Click the name to edit it in place. Enter or blur saves, Escape cancels. Unchanged or
 * empty input just closes the editor.
 */
export default function InlineRename({
  value,
  onRename,
  lockedReason,
  className,
  inputClassName,
  label,
}: InlineRenameProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Escape unmounts the input, which can fire blur; don't let that blur save.
  const cancelled = useRef(false)

  if (lockedReason) {
    return (
      <span className={className} title={lockedReason}>
        {value}
      </span>
    )
  }

  if (draft === null) {
    return (
      <button
        type="button"
        className={cn(
          'cursor-text rounded-sm text-left decoration-dotted decoration-muted-foreground/60 underline-offset-4 hover:underline',
          className,
        )}
        title="Click to rename"
        aria-label={`Rename ${label} ${value}`}
        onClick={() => {
          cancelled.current = false
          setDraft(value)
        }}
      >
        {value}
      </button>
    )
  }

  const commit = async () => {
    if (cancelled.current) return
    const next = draft.trim()
    if (!next || next === value) {
      setDraft(null)
      return
    }
    setSaving(true)
    try {
      await onRename(next)
      setDraft(null)
    } catch {
      // Caller surfaces the error; keep the editor open so the name can be fixed.
    } finally {
      setSaving(false)
    }
  }

  return (
    <input
      autoFocus
      value={draft}
      disabled={saving}
      aria-label={`New name for ${label} ${value}`}
      size={Math.max(draft.length, 4)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          setDraft(null)
        }
      }}
      className={cn(
        'min-w-0 rounded-sm bg-card px-1 outline-none ring-2 ring-ring/40 focus:ring-ring',
        inputClassName,
        className,
      )}
    />
  )
}
