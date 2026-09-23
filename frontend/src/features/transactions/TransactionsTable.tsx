import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Filter,
  Loader2,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountOut, CategoryOut, SubcategoryOut, TagOut } from '../../types'
import type { TransactionRow } from './types'
import type { TransactionsPagination } from './useTransactions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { DataTableColumnHeader } from '@/components/data-table-column-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Most recently used first; never-used tags last, alphabetically. */
function sortTagsByRecentUse(tags: TagOut[]): TagOut[] {
  return [...tags].sort((a, b) => {
    const aUsed = a.last_used_at ? Date.parse(a.last_used_at) : null
    const bUsed = b.last_used_at ? Date.parse(b.last_used_at) : null
    if (aUsed != null && bUsed != null && aUsed !== bUsed) return bUsed - aUsed
    if (aUsed != null && bUsed == null) return -1
    if (aUsed == null && bUsed != null) return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function parseTagNames(s: string): string[] {
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []
}

function EditableCell({
  row,
  columnId,
  processRowUpdate,
  inputClassName,
}: {
  row: TransactionRow
  columnId: keyof TransactionRow
  processRowUpdate: (r: TransactionRow) => TransactionRow
  inputClassName?: string
}) {
  const value = row[columnId]
  const strVal =
    columnId === 'Amount'
      ? value == null || value === ''
        ? ''
        : Number(value).toFixed(2)
      : value == null
        ? ''
        : String(value)

  const commit = (raw: string) => {
    let next: string | number = raw
    if (columnId === 'Amount') {
      const n = parseFloat(raw)
      if (Number.isNaN(n)) return
      next = n
    }
    if (next === value || (columnId !== 'Amount' && String(next) === String(value))) return
    processRowUpdate({ ...row, [columnId]: next } as TransactionRow)
  }

  return (
    <Input
      className={`h-8 rounded-md border-0 bg-transparent px-1.5 text-[13px] font-mono shadow-none hover:bg-muted/70 focus-visible:bg-card focus-visible:ring-1 ${columnId === 'Amount' ? 'text-right' : ''} ${inputClassName ?? ''}`}
      defaultValue={strVal}
      key={`${row.id}-${columnId}-${strVal}`}
      type={columnId === 'Amount' ? 'number' : 'text'}
      step={columnId === 'Amount' ? '0.01' : undefined}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

type FlatSubOption = {
  subId: number
  subName: string
  categoryId: number
  categoryName: string
  label: string
  searchValue: string
}

function CategoryComboboxCell({
  row,
  categories,
  subcategoriesByCategory,
  processRowUpdate,
}: {
  row: TransactionRow
  categories: CategoryOut[]
  subcategoriesByCategory: Record<number, SubcategoryOut[]>
  processRowUpdate: (r: TransactionRow) => TransactionRow
}) {
  const [open, setOpen] = useState(false)

  const commit = (cat: CategoryOut) => {
    const subs = subcategoriesByCategory[cat.id] ?? []
    const subName = subs[0]?.name ?? ''
    processRowUpdate({ ...row, Category: cat.name, Subcategory: subName })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full min-w-[96px] justify-between font-mono text-xs px-1 font-normal"
        >
          <span className="truncate">{row.Category || '—'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search category…" />
          <CommandList>
            <CommandEmpty>No category found.</CommandEmpty>
            <CommandGroup>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.id}`}
                  onSelect={() => commit(c)}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', row.Category === c.name ? 'opacity-100' : 'opacity-0')}
                  />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SubcategoryComboboxCell({
  row,
  flatSubOptions,
  processRowUpdate,
}: {
  row: TransactionRow
  flatSubOptions: FlatSubOption[]
  processRowUpdate: (r: TransactionRow) => TransactionRow
}) {
  const [open, setOpen] = useState(false)

  const commit = (opt: FlatSubOption) => {
    processRowUpdate({
      ...row,
      Category: opt.categoryName,
      Subcategory: opt.subName,
    })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full min-w-[96px] justify-between font-mono text-xs px-1 font-normal"
        >
          <span className="truncate">{row.Subcategory || '—'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search subcategory…" />
          <CommandList>
            <CommandEmpty>No subcategory found.</CommandEmpty>
            <CommandGroup heading="Pick subcategory (sets category too)">
              {flatSubOptions.map((opt) => (
                <CommandItem
                  key={opt.subId}
                  value={opt.searchValue}
                  onSelect={() => commit(opt)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      row.Subcategory === opt.subName && row.Category === opt.categoryName
                        ? 'opacity-100'
                        : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AccountComboboxCell({
  row,
  accounts,
  processRowUpdate,
}: {
  row: TransactionRow
  accounts: AccountOut[]
  processRowUpdate: (r: TransactionRow) => TransactionRow
}) {
  const [open, setOpen] = useState(false)

  const accountOptions = useMemo(() => {
    const nameCount = new Map<string, number>()
    for (const a of accounts) {
      nameCount.set(a.name, (nameCount.get(a.name) ?? 0) + 1)
    }
    return accounts.map((a) => ({
      account: a,
      label: (nameCount.get(a.name) ?? 0) > 1 ? `${a.name} (${a.type})` : a.name,
      searchValue: `${a.name} ${a.type} ${a.id} ${a.currency ?? ''}`,
    }))
  }, [accounts])

  const commit = (a: AccountOut) => {
    processRowUpdate({ ...row, Acct: a.name })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full min-w-[96px] justify-between font-mono text-xs px-1 font-normal"
        >
          <span className="truncate">{row.Acct || '—'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search account…" />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {accountOptions.map(({ account: a, label, searchValue }) => (
                <CommandItem key={a.id} value={searchValue} onSelect={() => commit(a)}>
                  <Check
                    className={cn('mr-2 h-4 w-4', row.Acct === a.name ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function TagsPickerCell({
  row,
  tags,
  processRowUpdate,
}: {
  row: TransactionRow
  tags: TagOut[]
  processRowUpdate: (r: TransactionRow) => TransactionRow
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = useMemo(() => new Set(parseTagNames(row.Tags)), [row.Tags])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQ('')
  }

  // One cell per row: only sort/filter while this cell's picker is open.
  const filtered = useMemo(() => {
    if (!open) return []
    const needle = q.toLowerCase()
    return sortTagsByRecentUse(tags).filter((t) => t.name.toLowerCase().includes(needle))
  }, [open, tags, q])

  const toggle = (name: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(name)
    else next.delete(name)
    const ordered = tags.map((t) => t.name).filter((n) => next.has(n))
    const rest = Array.from(next).filter((n) => !ordered.includes(n))
    processRowUpdate({ ...row, Tags: [...ordered, ...rest].join(', ') })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto min-h-8 w-full min-w-[100px] justify-start font-normal px-1 py-1 text-left"
        >
          {row.Tags?.trim() ? (
            <div className="flex flex-wrap gap-0.5">
              {parseTagNames(row.Tags).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Tags</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-2" align="start">
        <Input
          placeholder="Filter tags…"
          className="h-8 mb-2 text-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No tags match.</p>
          ) : (
            filtered.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted"
              >
                <Checkbox
                  checked={selected.has(t.name)}
                  onCheckedChange={(c) => toggle(t.name, c === true)}
                />
                <span>{t.name}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export type TransactionsTableProps = {
  categories: CategoryOut[]
  tags: TagOut[]
  accounts: AccountOut[]
  subcategoriesByCategory: Record<number, SubcategoryOut[]>
  merchantSearch: string
  onMerchantSearchChange: (v: string) => void
  fCategory: string
  onFCategoryChange: (v: string) => void
  fTag: string
  onFTagChange: (v: string) => void
  fAccountId: number | null
  onFAccountChange: (id: number | null) => void
  showOnlyRecent: boolean
  onShowOnlyRecentChange: (v: boolean) => void
  gridRows: TransactionRow[]
  rowSelection: RowSelectionState
  setRowSelection: OnChangeFn<RowSelectionState>
  onProcessRowUpdate: (newRow: TransactionRow) => TransactionRow
  onSaveEdits: () => void
  onDeleteSelected: () => void
  onLinkCardPayment: () => void
  onUnlinkTransfer: () => void
  getSelectedIds: () => number[]
  metaReady: boolean
  savePending: boolean
  deletePending: boolean
  linkCardPaymentPending: boolean
  unlinkTransferPending: boolean
  unsavedCount: number
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  pagination: TransactionsPagination
}

const numberFormat = new Intl.NumberFormat()

export default function TransactionsTable({
  categories,
  tags,
  accounts,
  subcategoriesByCategory,
  merchantSearch,
  onMerchantSearchChange,
  fCategory,
  onFCategoryChange,
  fTag,
  onFTagChange,
  fAccountId,
  onFAccountChange,
  showOnlyRecent,
  onShowOnlyRecentChange,
  gridRows,
  rowSelection,
  setRowSelection,
  onProcessRowUpdate,
  onSaveEdits,
  onDeleteSelected,
  onLinkCardPayment,
  onUnlinkTransfer,
  getSelectedIds,
  metaReady,
  savePending,
  deletePending,
  linkCardPaymentPending,
  unlinkTransferPending,
  unsavedCount,
  sorting,
  onSortingChange,
  pagination,
}: TransactionsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Start each page (or new result set) at the top of the scroll area.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [pagination.pageToken])

  const accountSelectOptions = useMemo(() => {
    const nameCount = new Map<string, number>()
    for (const a of accounts) {
      nameCount.set(a.name, (nameCount.get(a.name) ?? 0) + 1)
    }
    return accounts.map((a) => ({
      account: a,
      label: (nameCount.get(a.name) ?? 0) > 1 ? `${a.name} (${a.type})` : a.name,
    }))
  }, [accounts])

  const flatSubOptions = useMemo(() => {
    const nameCount = new Map<string, number>()
    for (const c of categories) {
      for (const s of subcategoriesByCategory[c.id] ?? []) {
        nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1)
      }
    }
    const list: FlatSubOption[] = []
    for (const c of categories) {
      for (const s of subcategoriesByCategory[c.id] ?? []) {
        const dup = (nameCount.get(s.name) ?? 0) > 1
        const label = dup ? `${s.name} (${c.name})` : s.name
        list.push({
          subId: s.id,
          subName: s.name,
          categoryId: c.id,
          categoryName: c.name,
          label,
          searchValue: `${label} ${c.name} ${s.name} ${s.id}`,
        })
      }
    }
    return list
  }, [categories, subcategoriesByCategory])

  const columns = useMemo<ColumnDef<TransactionRow>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Select all"
            className="translate-y-0.5"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label="Select row"
            className="translate-y-0.5"
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        accessorKey: 'Date',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => (
          <EditableCell row={row.original} columnId="Date" processRowUpdate={onProcessRowUpdate} />
        ),
      },
      {
        accessorKey: 'Merchant',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Merchant" />,
        cell: ({ row }) => (
          <EditableCell row={row.original} columnId="Merchant" processRowUpdate={onProcessRowUpdate} />
        ),
      },
      {
        accessorKey: 'Amount',
        header: ({ column }) => (
          <div className="flex w-full justify-end">
            <DataTableColumnHeader column={column} title="Amount" className="justify-end" />
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right">
            <EditableCell
              row={row.original}
              columnId="Amount"
              processRowUpdate={onProcessRowUpdate}
              inputClassName={
                row.original.Amount > 0 ? 'text-income' : row.original.Amount < 0 ? 'text-expense' : ''
              }
            />
          </div>
        ),
      },
      {
        accessorKey: 'Category',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        cell: ({ row }) => (
          <CategoryComboboxCell
            row={row.original}
            categories={categories}
            subcategoriesByCategory={subcategoriesByCategory}
            processRowUpdate={onProcessRowUpdate}
          />
        ),
      },
      {
        accessorKey: 'Subcategory',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Subcategory" />,
        cell: ({ row }) => (
          <SubcategoryComboboxCell
            row={row.original}
            flatSubOptions={flatSubOptions}
            processRowUpdate={onProcessRowUpdate}
          />
        ),
      },
      {
        accessorKey: 'Acct',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Account" />,
        cell: ({ row }) => (
          <AccountComboboxCell
            row={row.original}
            accounts={accounts}
            processRowUpdate={onProcessRowUpdate}
          />
        ),
      },
      {
        accessorKey: 'Tags',
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tags" />,
        cell: ({ row }) => (
          <TagsPickerCell row={row.original} tags={tags} processRowUpdate={onProcessRowUpdate} />
        ),
      },
      {
        accessorKey: 'Notes',
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notes" />,
        cell: ({ row }) => (
          <EditableCell row={row.original} columnId="Notes" processRowUpdate={onProcessRowUpdate} />
        ),
      },
      {
        accessorKey: 'Split',
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Split" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.Split}</span>,
      },
    ],
    [categories, subcategoriesByCategory, flatSubOptions, tags, accounts, onProcessRowUpdate],
  )

  const table = useReactTable({
    data: gridRows,
    columns,
    getRowId: (row) => String(row.id),
    state: { rowSelection, sorting },
    onRowSelectionChange: setRowSelection,
    // Sorted by the server so the order spans every page, not just this one.
    manualSorting: true,
    onSortingChange,
    enableSortingRemoval: false,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const selectedCount = getSelectedIds().length
  const activeFilterCount =
    (fCategory !== 'All' ? 1 : 0) + (fTag !== 'All' ? 1 : 0) + (fAccountId !== null ? 1 : 0) + (showOnlyRecent ? 1 : 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search merchants or notes..."
            className="pl-9"
            value={merchantSearch}
            onChange={(e) => onMerchantSearchChange(e.target.value)}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Filter className="h-4 w-4 mr-1.5" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-4" align="start">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={fCategory} onValueChange={onFCategoryChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tag</Label>
              <Select value={fTag} onValueChange={onFTagChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account</Label>
              <Select
                value={fAccountId === null ? 'All' : String(fAccountId)}
                onValueChange={(v) => onFAccountChange(v === 'All' ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All accounts</SelectItem>
                  {accountSelectOptions.map(({ account: a, label }) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="recent-90" className="text-sm font-normal cursor-pointer">
                Limit to last 90 days
              </Label>
              <Switch id="recent-90" checked={showOnlyRecent} onCheckedChange={onShowOnlyRecentChange} />
            </div>
          </PopoverContent>
        </Popover>
        {activeFilterCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-muted-foreground"
            onClick={() => {
              onFCategoryChange('All')
              onFTagChange('All')
              onFAccountChange(null)
              onShowOnlyRecentChange(false)
            }}
          >
            Clear
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {selectedCount > 0 ? (
            <>
              <span className="text-xs text-muted-foreground tabular-nums">
                {selectedCount} selected{selectedCount === 1 ? ' · splits editor below' : ''}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={onLinkCardPayment}
                title="Select exactly two rows"
                disabled={selectedCount !== 2 || linkCardPaymentPending || unlinkTransferPending || deletePending || !metaReady}
              >
                Link as transfer
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onUnlinkTransfer}
                title="Select exactly two rows"
                disabled={selectedCount !== 2 || unlinkTransferPending || linkCardPaymentPending || deletePending || !metaReady}
              >
                Unlink
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onDeleteSelected}
                disabled={deletePending || linkCardPaymentPending || unlinkTransferPending || !metaReady}
              >
                Delete
              </Button>
            </>
          ) : (
            <span className="hidden text-xs text-muted-foreground md:inline">Select rows to link, split, or delete</span>
          )}
          <Button
            size="sm"
            variant={unsavedCount > 0 ? 'default' : 'outline'}
            onClick={onSaveEdits}
            disabled={savePending || !metaReady || unsavedCount === 0}
          >
            {unsavedCount > 0 ? `Save ${unsavedCount} edit${unsavedCount === 1 ? '' : 's'}` : 'Saved'}
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        aria-busy={pagination.loading}
        className={cn(
          'surface overflow-hidden max-h-[max(28rem,calc(100svh-20rem))] overflow-y-auto transition-opacity',
          pagination.loading && 'opacity-60',
        )}
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className={h.column.id === 'Amount' ? 'text-right' : ''}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground text-sm">
                  {pagination.initialLoading ? 'Loading transactions…' : 'No transactions match your filters.'}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => {
                    const isAmount = cell.column.id === 'Amount'
                    return (
                      <TableCell
                        key={cell.id}
                        className={`p-1 align-middle ${isAmount ? 'text-right' : ''}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePaginationFooter pagination={pagination} />
    </div>
  )
}


function TablePaginationFooter({ pagination }: { pagination: TransactionsPagination }) {
  const {
    pageIndex,
    pageCount,
    total,
    rangeStart,
    rangeEnd,
    canPrevPage,
    canNextPage,
    goToPage,
    loading,
    pageSize,
    setPageSize,
    pageSizeOptions,
  } = pagination

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 mt-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {total === 0 ? (
          'No transactions'
        ) : (
          <>
            <span className="font-medium text-foreground">
              {numberFormat.format(rangeStart)}–{numberFormat.format(rangeEnd)}
            </span>
            {total != null ? <> of {numberFormat.format(total)}</> : null}
          </>
        )}
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading" /> : null}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[76px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          Page <span className="font-medium text-foreground">{pageIndex + 1}</span>
          {pageCount != null ? <> of {pageCount}</> : null}
        </span>
        <div className="flex items-center gap-1">
          <PageButton label="First page" onClick={() => goToPage(0)} disabled={!canPrevPage}>
            <ChevronsLeft className="h-4 w-4" />
          </PageButton>
          <PageButton label="Previous page" onClick={() => goToPage(pageIndex - 1)} disabled={!canPrevPage}>
            <ChevronLeft className="h-4 w-4" />
          </PageButton>
          <PageButton label="Next page" onClick={() => goToPage(pageIndex + 1)} disabled={!canNextPage}>
            <ChevronRight className="h-4 w-4" />
          </PageButton>
          <PageButton
            label="Last page"
            onClick={() => pageCount != null && goToPage(pageCount - 1)}
            disabled={!canNextPage || pageCount == null}
          >
            <ChevronsRight className="h-4 w-4" />
          </PageButton>
        </div>
      </div>
    </div>
  )
}

function PageButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <Button variant="outline" size="icon" className="h-8 w-8" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      {children}
    </Button>
  )
}
