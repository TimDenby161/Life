import { formatMoney } from '@/lib/money'

/** Wedding amounts are in pounds, shown without pence. */
export const money = (v: number) => formatMoney(v, 'GBP', { hidePence: true })
