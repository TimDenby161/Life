import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Gem,
  HeartPulse,
  Home,
  Languages,
  Plane,
  ListRestart,
  type LucideIcon,
  MessagesSquare,
  Settings,
  ShoppingBag,
  Sparkles,
  Sunrise,
  Target,
  TrendingUp,
  Trophy,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'
import { lazy, type LazyExoticComponent, type ComponentType } from 'react'

/**
 * Every top-level feature is registered here. Navigation (sidebar, bottom
 * bar, "More" menu) and routing are derived from this list, so adding a
 * module means adding one entry and a folder under src/modules.
 *
 * The "More" menu (and the sidebar) puts the things you're interested in at
 * the top and the running-the-app pages (tasks, calendar, stats, AI, settings)
 * together at the bottom.
 */
export type AppModule = {
  id: string
  label: string
  path: string
  icon: LucideIcon
  /** Position in the phone bottom bar (1-4; the 5th slot is "More"). */
  mobilePrimary?: number
  /** Where it sits in "More" and the sidebar: an interest at the top, or with the app's own pages at the bottom. */
  group: 'main' | 'interest' | 'app'
  /** Still has its page, but isn't in any menu. */
  hidden?: boolean
  component: LazyExoticComponent<ComponentType>
}

export const modules: AppModule[] = [
  { id: 'home', label: 'Home', path: '/', icon: Home, mobilePrimary: 1, group: 'main', component: lazy(() => import('./dashboard/DashboardPage')) },
  { id: 'meals', label: 'Meals', path: '/meals', icon: UtensilsCrossed, mobilePrimary: 2, group: 'main', component: lazy(() => import('./meals/MealsPage')) },
  { id: 'finances', label: 'Finances', path: '/finances', icon: Wallet, mobilePrimary: 3, group: 'main', component: lazy(() => import('./finances/pages/FinancesPage')) },
  { id: 'wedding', label: 'Wedding', path: '/wedding', icon: Gem, mobilePrimary: 4, group: 'main', component: lazy(() => import('./wedding/WeddingPage')) },
  { id: 'holidays', label: 'Holidays', path: '/holidays', icon: Plane, group: 'interest', component: lazy(() => import('./holidays/HolidaysPage')) },
  { id: 'shopping', label: 'Shopping', path: '/shopping', icon: ShoppingBag, group: 'interest', component: lazy(() => import('./shopping/ShoppingPage')) },
  { id: 'investments', label: 'Investments', path: '/investments', icon: TrendingUp, group: 'interest', component: lazy(() => import('./investments/InvestmentsPage')) },
  { id: 'health', label: 'Health', path: '/health', icon: HeartPulse, group: 'interest', component: lazy(() => import('./health/HealthPage')) },
  { id: 'languages', label: 'Languages', path: '/languages', icon: Languages, group: 'interest', component: lazy(() => import('./languages/LanguagesPage')) },
  { id: 'people', label: 'People', path: '/people', icon: Users, group: 'interest', component: lazy(() => import('./people/PeoplePage')) },
  { id: 'table-tennis', label: 'Table tennis', path: '/table-tennis', icon: Trophy, group: 'interest', component: lazy(() => import('./tabletennis/TableTennisPage')) },
  { id: 'hustles', label: 'Side hustles', path: '/hustles', icon: Briefcase, group: 'interest', component: lazy(() => import('./hustles/HustlesPage')) },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: CheckCircle2, group: 'app', component: lazy(() => import('./tasks/pages/TasksPage')) },
  { id: 'jobs', label: 'Jobs', path: '/jobs', icon: ListRestart, group: 'app', component: lazy(() => import('./tasks/pages/JobsPage')) },
  { id: 'calendar', label: 'Calendar', path: '/calendar', icon: CalendarDays, group: 'app', component: lazy(() => import('./calendar/CalendarPage')) },
  { id: 'stats', label: 'Statistics', path: '/stats', icon: BarChart3, group: 'app', component: lazy(() => import('./stats/StatsPage')) },
  { id: 'goals', label: 'Goals', path: '/goals', icon: Target, group: 'app', component: lazy(() => import('./goals/GoalsPage')) },
  { id: 'morning', label: 'This morning', path: '/morning', icon: Sunrise, group: 'app', component: lazy(() => import('./agents/MorningPage')) },
  { id: 'ai', label: 'AI Hub', path: '/ai', icon: Sparkles, group: 'app', component: lazy(() => import('./agents/AiHubPage')) },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings, group: 'app', component: lazy(() => import('./settings/SettingsPage')) },
  // Off the menus (Tim, 11 Nov); Home's Message button and venue ideas still post here.
  { id: 'feed', label: 'Feed', path: '/feed', icon: MessagesSquare, group: 'app', hidden: true, component: lazy(() => import('./feed/FeedPage')) },
]

/** Modules shown in menus, in menu order. */
export const menuModules = modules.filter((m) => !m.hidden)
