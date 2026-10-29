import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deleteZbbCategory,
  getZbbMonth,
  patchZbbAssign,
  patchZbbCategory,
  patchZbbSettings,
  postZbbCategory,
  postZbbMoveMoney,
  postZbbQuickAssign,
} from '@/api/budgets'
import { queryKeys } from '@/queryKeys'
import type {
  BudgetCategoryIn,
  ZbbMonthOut,
  ZbbMoveMoneyIn,
  ZbbQuickAssignStrategy,
  ZbbRolloverMode,
} from '@/types'
import type { YearMonth } from './budgetUtils'

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

/** The month's budget plus every mutation the page needs. Mutations update this month in place. */
export function useBudgetMonth(ym: YearMonth) {
  const qc = useQueryClient()
  const key = queryKeys.zbbMonth(ym.year, ym.month)

  const monthQ = useQuery({
    queryKey: key,
    queryFn: () => getZbbMonth(ym),
    placeholderData: (prev) => prev,
  })

  // Assignments roll forward into later months (and Ready to Assign is budget-wide), so after
  // writing this month's fresh numbers, every other cached month is refetched.
  const applyMonth = async (data: ZbbMonthOut) => {
    qc.setQueryData(key, data)
    await qc.invalidateQueries({
      queryKey: queryKeys.zbbMonths(),
      predicate: (q) => q.queryKey[2] !== ym.year || q.queryKey[3] !== ym.month,
    })
  }
  const refreshAll = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.zbbMonths() }),
      qc.invalidateQueries({ queryKey: queryKeys.zbbCategories() }),
    ])

  const assign = useMutation({
    mutationFn: (p: { category_id: number; assigned: number }) => patchZbbAssign({ ...ym, body: p }),
    onSuccess: applyMonth,
    onError: (e) => toast.error(errorMessage(e, 'Could not update assigned amount')),
  })

  const move = useMutation({
    mutationFn: (body: ZbbMoveMoneyIn) => postZbbMoveMoney({ ...ym, body }),
    onSuccess: applyMonth,
    onError: (e) => toast.error(errorMessage(e, 'Could not move money')),
  })

  const quickAssign = useMutation({
    mutationFn: (p: { strategy: ZbbQuickAssignStrategy; category_ids?: number[] }) =>
      postZbbQuickAssign({ ...ym, body: p }),
    onSuccess: applyMonth,
    onError: (e) => toast.error(errorMessage(e, 'Could not assign money')),
  })

  const settings = useMutation({
    mutationFn: (body: { rollover_mode?: ZbbRolloverMode; budget_start_year?: number; budget_start_month?: number }) =>
      patchZbbSettings(body),
    onSuccess: refreshAll,
    onError: (e) => toast.error(errorMessage(e, 'Could not save settings')),
  })

  const createEnvelope = useMutation({
    mutationFn: (body: BudgetCategoryIn & { name: string }) => postZbbCategory(body),
    onSuccess: refreshAll,
  })

  const updateEnvelope = useMutation({
    mutationFn: (p: { id: number; body: BudgetCategoryIn }) => patchZbbCategory(p.id, p.body),
    onSuccess: refreshAll,
  })

  const deleteEnvelope = useMutation({
    mutationFn: (id: number) => deleteZbbCategory(id),
    onSuccess: refreshAll,
    onError: (e) => toast.error(errorMessage(e, 'Could not delete envelope')),
  })

  return { monthQ, assign, move, quickAssign, settings, createEnvelope, updateEnvelope, deleteEnvelope }
}

export type BudgetMonthApi = ReturnType<typeof useBudgetMonth>
