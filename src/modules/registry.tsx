import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Gem,
  HeartPulse,
  Home,
  type LucideIcon,
  MessagesSquare,
  Settings,
  Wallet,
} from 'lucide-react'
import { lazy, type LazyExoticComponent, type ComponentType } from 'react'

/**
 * Every top-level feature is registered here. Navigation (sidebar, bottom
 * bar, "More" menu) and routing are derived from this list, so adding a
 * module means adding one entry and a folder under src/modules.
 */
export type AppModule = {
  id: string
  label: string
  path: string
  icon: LucideIcon
  /** Shown in the phone bottom bar (max 4; the 5th slot is "More"). */
  mobilePrimary?: boolean
  component: LazyExoticComponent<ComponentType>
}

export const modules: AppModule[] = [
  { id: 'home', label: 'Home', path: '/', icon: Home, mobilePrimary: true, component: lazy(() => import('./dashboard/DashboardPage')) },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: CheckCircle2, mobilePrimary: true, component: lazy(() => import('./tasks/pages/TasksPage')) },
  { id: 'finances', label: 'Finances', path: '/finances', icon: Wallet, component: lazy(() => import('./finances/pages/FinancesPage')) },
  { id: 'wedding', label: 'Wedding', path: '/wedding', icon: Gem, component: lazy(() => import('./wedding/WeddingPage')) },
  { id: 'calendar', label: 'Calendar', path: '/calendar', icon: CalendarDays, mobilePrimary: true, component: lazy(() => import('./calendar/CalendarPage')) },
  { id: 'feed', label: 'Feed', path: '/feed', icon: MessagesSquare, mobilePrimary: true, component: lazy(() => import('./feed/FeedPage')) },
  { id: 'health', label: 'Health', path: '/health', icon: HeartPulse, component: lazy(() => import('./health/HealthPage')) },
  { id: 'stats', label: 'Statistics', path: '/stats', icon: BarChart3, component: lazy(() => import('./stats/StatsPage')) },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings, component: lazy(() => import('./settings/SettingsPage')) },
]
