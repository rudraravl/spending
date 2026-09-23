import {
  ArrowLeftRight,
  Banknote,
  Car,
  CircleDollarSign,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Home,
  LineChart,
  type LucideIcon,
  Plane,
  Receipt,
  ShoppingBag,
  Tag,
  Ticket,
  Utensils,
} from 'lucide-react'

const SLOT_COUNT = 8

/**
 * Stable categorical color for a category. Keyed by id so a category keeps its color when
 * filters or ranking change; ids beyond the palette wrap (fine for this app's ~8 categories).
 */
export function categoryColor(categoryId: number | null | undefined): string {
  if (categoryId == null || categoryId <= 0) return 'hsl(var(--muted-foreground))'
  return `var(--cat-${((categoryId - 1) % SLOT_COUNT) + 1})`
}

const ICONS: [RegExp, LucideIcon][] = [
  [/income|paycheck|salary|deposit/i, CircleDollarSign],
  [/transfer/i, ArrowLeftRight],
  [/food|grocer|dining|restaurant|eat|coffee|drink/i, Utensils],
  [/travel|flight|hotel|trip/i, Plane],
  [/leisure|entertain|fun|movie|ticket/i, Ticket],
  [/bill|utilit|subscription|rent/i, Receipt],
  [/shop|cloth|amazon/i, ShoppingBag],
  [/invest|stock|crypto/i, LineChart],
  [/car|gas|auto|transport|uber|lyft/i, Car],
  [/health|medical|pharma/i, HeartPulse],
  [/gym|fitness|sport/i, Dumbbell],
  [/school|tuition|educat|book/i, GraduationCap],
  [/home|house|furnish/i, Home],
  [/cash|atm/i, Banknote],
]

/** Icon for a category (or subcategory) name; falls back to a generic tag. */
export function categoryIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Tag
  return ICONS.find(([re]) => re.test(name))?.[1] ?? Tag
}
