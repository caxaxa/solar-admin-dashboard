'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import {
  Loader2,
  DollarSign,
  Users,
  CreditCard,
  TrendingUp,
  FileText,
  Map,
  Layers,
  Package,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownRight,
  Gift,
  ShieldCheck,
  Receipt,
  AlertCircle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { buildApiUrl, apiFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface UserProfile {
  userId: string;
  email: string;
  emailVerified: boolean;
  cognitoStatus: string;
  enabled: boolean;
  cognitoCreatedAt: number;
  currentPlan: string;
  subscriptionStatus: string;
  billingCurrency: string;
  billingLocale: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialStartedAt: number;
  trialEndsAt: number;
  lastInvoiceStatus: string;
  lastInvoiceAmountPaid: number;
  lastInvoiceAmountDue: number;
  lastInvoiceCurrency: string;
  lastInvoiceId: string;
  oneTimeGrants: Record<string, number>;
  oneTimeUsed: Record<string, number>;
  monthlyUsagePeriod: string;
  monthlyUsage: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  environment: string;
}

interface UnlockEvent {
  projectId: string;
  projectName: string;
  projectType: string;
  userId: string;
  assetType: string;
  source: string;
  charged: boolean;
  amountMinor: number;
  currency: string;
  stripeInvoiceItemId: string;
  unlockedAt: number;
  panelCount: number;
  environment: string;
}

interface BillingData {
  users: UserProfile[];
  unlockEvents: UnlockEvent[];
  stripeEvents: unknown[];
  userEmailMap: Record<string, { email: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PLAN_COLORS: Record<string, string> = {
  basic: '#3B82F6',
  advanced: '#8B5CF6',
  pro: '#F59E0B',
  none: '#9CA3AF',
};

const PLAN_PRICES: Record<string, number> = {
  basic: 19900,
  advanced: 59900,
  pro: 199900,
};

const ASSET_LABELS: Record<string, string> = {
  report_fullres: 'Full-Res Report',
  orthophoto_tif: 'Orthophoto TIF',
  dxf: 'DXF (CAD)',
  service_package: 'Service Package',
};

const ASSET_ICONS: Record<string, typeof FileText> = {
  report_fullres: FileText,
  orthophoto_tif: Map,
  dxf: Layers,
  service_package: Package,
};

const SOURCE_LABELS: Record<string, string> = {
  invoice_item: 'Invoice',
  one_time_grant: 'Free Credit',
  plan_credit: 'Plan Credit',
  admin_bypass: 'Admin Bypass',
};

const SOURCE_COLORS: Record<string, string> = {
  invoice_item: '#F59E0B',
  one_time_grant: '#10B981',
  plan_credit: '#3B82F6',
  admin_bypass: '#6B7280',
};

function formatCurrency(amountMinor: number, currency: string = 'BRL'): string {
  const amount = amountMinor / 100;
  if (currency.toUpperCase() === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  }
  return `R$${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(ts: number): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(ts: number): string {
  if (!ts) return '';
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(ts);
}

function trialStatus(user: UserProfile): { label: string; color: string } {
  const now = Date.now() / 1000;
  if (!user.trialStartedAt) return { label: 'No trial', color: 'text-gray-400' };
  if (now < user.trialEndsAt) {
    const daysLeft = Math.ceil((user.trialEndsAt - now) / 86400);
    return { label: `${daysLeft}d left`, color: 'text-green-600' };
  }
  return { label: 'Expired', color: 'text-red-500' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendLabel,
  color = 'blue',
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: typeof DollarSign;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
  color?: string;
}) {
  const colorMap: Record<string, { bg: string; icon: string; ring: string }> = {
    blue: { bg: 'bg-blue-50 dark:bg-blue-950/40', icon: 'text-blue-600 dark:text-blue-400', ring: 'ring-blue-200 dark:ring-blue-800' },
    green: { bg: 'bg-green-50 dark:bg-green-950/40', icon: 'text-green-600 dark:text-green-400', ring: 'ring-green-200 dark:ring-green-800' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-950/40', icon: 'text-amber-600 dark:text-amber-400', ring: 'ring-amber-200 dark:ring-amber-800' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-950/40', icon: 'text-purple-600 dark:text-purple-400', ring: 'ring-purple-200 dark:ring-purple-800' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{title}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-50">{value}</p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className={`flex-shrink-0 p-2.5 rounded-lg ${c.bg} ring-1 ${c.ring}`}>
          <Icon className={`h-5 w-5 ${c.icon}`} />
        </div>
      </div>
      {trendLabel && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {trend === 'up' && <ArrowUpRight className="h-3.5 w-3.5 text-green-500" />}
          {trend === 'down' && <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />}
          <span className={trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}>
            {trendLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const config: Record<string, { bg: string; text: string; ring: string }> = {
    basic: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', ring: 'ring-blue-300/50' },
    advanced: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-300/50' },
    pro: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-300/50' },
    none: { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', ring: 'ring-gray-300/50' },
  };
  const c = config[plan.toLowerCase()] || config.none;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ring-1 ${c.bg} ${c.text} ${c.ring}`}>
      {plan === 'none' ? 'Free' : plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  );
}

function SubscriptionBadge({ status }: { status: string }) {
  const isActive = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
        isActive
          ? 'bg-green-50 text-green-700 ring-1 ring-green-300/50 dark:bg-green-950/40 dark:text-green-300'
          : 'bg-gray-50 text-gray-500 ring-1 ring-gray-300/50 dark:bg-gray-800 dark:text-gray-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { bg: string; text: string; icon: typeof Receipt }> = {
    invoice_item: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', icon: Receipt },
    one_time_grant: { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-300', icon: Gift },
    plan_credit: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', icon: CreditCard },
    admin_bypass: { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', icon: ShieldCheck },
  };
  const c = config[source] || config.admin_bypass;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${c.bg} ${c.text}`}>
      <Icon className="h-3 w-3" />
      {SOURCE_LABELS[source] || source}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip for charts
// ---------------------------------------------------------------------------
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{entry.name}:</span>
          <span className="font-semibold">{typeof entry.value === 'number' && entry.value > 100 ? formatCurrency(entry.value * 100) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function BillingDashboard() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState<string>('prod');

  const fetchBilling = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch(buildApiUrl(`/billing?env=${envFilter}`));
      if (!response.ok) throw new Error(`Failed to fetch billing data (${response.status})`);
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, [envFilter]);

  useEffect(() => {
    fetchBilling();
  }, [fetchBilling]);

  // ---- Derived data ----
  const stats = useMemo(() => {
    if (!data) return null;

    const totalUsers = data.users.length;
    const activeSubscribers = data.users.filter((u) => u.subscriptionStatus === 'active').length;
    const trialUsers = data.users.filter((u) => {
      const now = Date.now() / 1000;
      return u.trialEndsAt > now && u.subscriptionStatus !== 'active';
    }).length;

    const chargedEvents = data.unlockEvents.filter((e) => e.charged);
    const totalRevenue = chargedEvents.reduce((sum, e) => sum + e.amountMinor, 0);
    const subscriptionRevenue = data.users
      .filter((u) => u.lastInvoiceAmountPaid > 0)
      .reduce((sum, u) => sum + u.lastInvoiceAmountPaid, 0);

    const totalAssetUnlocks = data.unlockEvents.length;
    const paidAssetUnlocks = chargedEvents.length;
    const freeAssetUnlocks = data.unlockEvents.filter((e) => !e.charged).length;

    // MRR (Monthly Recurring Revenue)
    const mrr = data.users
      .filter((u) => u.subscriptionStatus === 'active')
      .reduce((sum, u) => sum + (PLAN_PRICES[u.currentPlan.toLowerCase()] || 0), 0);

    return {
      totalUsers,
      activeSubscribers,
      trialUsers,
      totalRevenue,
      subscriptionRevenue,
      totalAssetUnlocks,
      paidAssetUnlocks,
      freeAssetUnlocks,
      mrr,
    };
  }, [data]);

  // Revenue timeline (by month)
  const revenueTimeline = useMemo(() => {
    if (!data) return [];
    const months: Record<string, { subscriptions: number; assets: number }> = {};

    // Subscription revenue from users
    for (const user of data.users) {
      if (user.lastInvoiceAmountPaid > 0 && user.updatedAt) {
        const d = new Date(user.updatedAt * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!months[key]) months[key] = { subscriptions: 0, assets: 0 };
        months[key].subscriptions += user.lastInvoiceAmountPaid / 100;
      }
    }

    // Asset revenue from unlock events
    for (const event of data.unlockEvents) {
      if (event.charged && event.amountMinor > 0) {
        const d = new Date(event.unlockedAt * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!months[key]) months[key] = { subscriptions: 0, assets: 0 };
        months[key].assets += event.amountMinor / 100;
      }
    }

    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        subscriptions: values.subscriptions,
        assets: values.assets,
        total: values.subscriptions + values.assets,
      }));
  }, [data]);

  // Plan distribution for pie chart
  const planDistribution = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    for (const user of data.users) {
      const plan = user.currentPlan.toLowerCase() || 'none';
      counts[plan] = (counts[plan] || 0) + 1;
    }
    return Object.entries(counts).map(([plan, count]) => ({
      name: plan === 'none' ? 'Free' : plan.charAt(0).toUpperCase() + plan.slice(1),
      value: count,
      color: PLAN_COLORS[plan] || '#9CA3AF',
    }));
  }, [data]);

  // Asset type breakdown
  const assetBreakdown = useMemo(() => {
    if (!data) return [];
    const byType: Record<string, { paid: number; free: number; revenue: number }> = {};
    for (const event of data.unlockEvents) {
      if (!byType[event.assetType]) byType[event.assetType] = { paid: 0, free: 0, revenue: 0 };
      if (event.charged) {
        byType[event.assetType].paid++;
        byType[event.assetType].revenue += event.amountMinor;
      } else {
        byType[event.assetType].free++;
      }
    }
    return Object.entries(byType).map(([type, val]) => ({
      name: ASSET_LABELS[type] || type,
      type,
      paid: val.paid,
      free: val.free,
      revenue: val.revenue,
    }));
  }, [data]);

  // Unlock source breakdown for pie chart
  const sourceBreakdown = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    for (const event of data.unlockEvents) {
      counts[event.source] = (counts[event.source] || 0) + 1;
    }
    return Object.entries(counts).map(([source, count]) => ({
      name: SOURCE_LABELS[source] || source,
      value: count,
      color: SOURCE_COLORS[source] || '#9CA3AF',
    }));
  }, [data]);

  // Email lookup helper
  const emailForUser = useCallback(
    (userId: string) => {
      if (!data) return userId.slice(0, 8) + '...';
      const user = data.users.find((u) => u.userId === userId);
      if (user?.email) return user.email;
      const cognito = data.userEmailMap?.[userId];
      if (cognito?.email) return cognito.email;
      return userId.slice(0, 12) + '...';
    },
    [data]
  );

  // ---- Render ----
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading billing data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-6 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-red-800 dark:text-red-300">Failed to load billing data</p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error}</p>
          <button
            onClick={fetchBilling}
            className="mt-3 px-3 py-1.5 text-sm font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-800/60 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || !stats) return null;

  return (
    <div className="space-y-6">
      {/* Environment toggle */}
      <div className="flex items-center gap-2">
        {['prod', 'dev'].map((env) => (
          <button
            key={env}
            onClick={() => setEnvFilter(env)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              envFilter === env
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
            }`}
          >
            {env.toUpperCase()}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-2">
          Last updated: {new Date().toLocaleTimeString()}
        </span>
      </div>

      {/* ---- KPI Cards ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Monthly Recurring Revenue"
          value={formatCurrency(stats.mrr)}
          subtitle={`${stats.activeSubscribers} active subscriber${stats.activeSubscribers !== 1 ? 's' : ''}`}
          icon={TrendingUp}
          color="green"
          trendLabel={stats.activeSubscribers > 0 ? `${stats.activeSubscribers} paying` : 'No subscribers yet'}
          trend={stats.activeSubscribers > 0 ? 'up' : 'neutral'}
        />
        <StatCard
          title="Total Asset Revenue"
          value={formatCurrency(stats.totalRevenue)}
          subtitle={`${stats.paidAssetUnlocks} paid unlock${stats.paidAssetUnlocks !== 1 ? 's' : ''}`}
          icon={DollarSign}
          color="amber"
          trendLabel={`${stats.freeAssetUnlocks} free credits used`}
          trend={stats.totalRevenue > 0 ? 'up' : 'neutral'}
        />
        <StatCard
          title="Total Users"
          value={String(stats.totalUsers)}
          subtitle={`${stats.trialUsers} on trial`}
          icon={Users}
          color="blue"
          trendLabel={`${stats.activeSubscribers} converted to paid`}
          trend={stats.activeSubscribers > 0 ? 'up' : 'neutral'}
        />
        <StatCard
          title="Asset Unlocks"
          value={String(stats.totalAssetUnlocks)}
          subtitle={`${stats.paidAssetUnlocks} paid / ${stats.freeAssetUnlocks} free`}
          icon={CreditCard}
          color="purple"
          trendLabel={stats.totalAssetUnlocks > 0 ? `${((stats.paidAssetUnlocks / stats.totalAssetUnlocks) * 100).toFixed(0)}% conversion` : 'No unlocks yet'}
          trend={stats.paidAssetUnlocks > 0 ? 'up' : 'neutral'}
        />
      </div>

      {/* ---- Charts Row ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue Timeline */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Revenue Over Time</h3>
          {revenueTimeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={revenueTimeline} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSubs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradAssets" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" tickFormatter={(v: number) => `R$${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="subscriptions"
                  name="Subscriptions"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  fill="url(#gradSubs)"
                />
                <Area
                  type="monotone"
                  dataKey="assets"
                  name="Asset Charges"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  fill="url(#gradAssets)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-gray-400">
              No revenue data yet
            </div>
          )}
        </div>

        {/* Plan Distribution */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Plan Distribution</h3>
          {planDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={planDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {planDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { name: string; value: number };
                    return (
                      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 text-sm">
                        <span className="font-medium">{d.name}</span>: {d.value} user{d.value !== 1 ? 's' : ''}
                      </div>
                    );
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-gray-400">
              No users yet
            </div>
          )}
        </div>
      </div>

      {/* ---- Asset Breakdown + Unlock Source ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Asset type bar chart */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Asset Unlocks by Type</h3>
          {assetBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={assetBreakdown} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="paid" name="Paid" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="free" name="Free" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">
              No asset unlocks yet
            </div>
          )}
        </div>

        {/* Unlock source pie */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Unlock Sources</h3>
          {sourceBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={sourceBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {sourceBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { name: string; value: number };
                    return (
                      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-2 text-sm">
                        <span className="font-medium">{d.name}</span>: {d.value}
                      </div>
                    );
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">
              No unlock data yet
            </div>
          )}
        </div>
      </div>

      {/* ---- Users Table ---- */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Users & Subscriptions</h3>
          <p className="text-xs text-gray-400 mt-0.5">{data.users.length} billing profile{data.users.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">User</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Plan</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Trial</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Last Invoice</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Free Credits Used</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Joined</th>
                <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.users.map((user) => {
                const trial = trialStatus(user);
                const isExpanded = expandedUser === user.userId;
                const userUnlocks = data.unlockEvents.filter((e) => e.userId === user.userId);
                const totalFreeUsed = Object.values(user.oneTimeUsed || {}).reduce(
                  (sum, v) => sum + (typeof v === 'number' ? v : 0),
                  0
                );
                const totalFreeGrants = Object.values(user.oneTimeGrants || {}).reduce(
                  (sum, v) => sum + (typeof v === 'number' ? v : 0),
                  0
                );

                return (
                  <Fragment key={user.userId}>
                    <tr
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer transition-colors"
                      onClick={() => setExpandedUser(isExpanded ? null : user.userId)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[200px]">
                            {user.email || user.userId.slice(0, 12) + '...'}
                          </span>
                          {user.stripeCustomerId && (
                            <span className="text-xs text-gray-400 font-mono">{user.stripeCustomerId}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3"><PlanBadge plan={user.currentPlan} /></td>
                      <td className="px-4 py-3"><SubscriptionBadge status={user.subscriptionStatus} /></td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${trial.color}`}>{trial.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {user.lastInvoiceAmountPaid > 0 ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {formatCurrency(user.lastInvoiceAmountPaid, user.lastInvoiceCurrency)}
                            </span>
                            <span className={`text-xs ${user.lastInvoiceStatus === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>
                              {user.lastInvoiceStatus}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-600 dark:text-gray-300">
                          {totalFreeUsed}/{totalFreeGrants}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-500">{formatDate(user.cognitoCreatedAt || user.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-gray-50/50 dark:bg-gray-800/20 px-4 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* User details */}
                            <div className="space-y-3">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Account Details</h4>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-gray-400">User ID</span>
                                  <p className="font-mono text-gray-700 dark:text-gray-300 break-all">{user.userId}</p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Currency</span>
                                  <p className="text-gray-700 dark:text-gray-300">{user.billingCurrency} ({user.billingLocale})</p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Trial Period</span>
                                  <p className="text-gray-700 dark:text-gray-300">
                                    {formatDate(user.trialStartedAt)} &rarr; {formatDate(user.trialEndsAt)}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-gray-400">Stripe Subscription</span>
                                  <p className="font-mono text-gray-700 dark:text-gray-300 truncate">
                                    {user.stripeSubscriptionId || '-'}
                                  </p>
                                </div>
                              </div>

                              {/* Free credits breakdown */}
                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-2">Free Credits</h4>
                              <div className="flex gap-3 flex-wrap">
                                {Object.keys(ASSET_LABELS).map((at) => {
                                  const granted = (user.oneTimeGrants as Record<string, number>)?.[at] || 0;
                                  const used = (user.oneTimeUsed as Record<string, number>)?.[at] || 0;
                                  const Icon = ASSET_ICONS[at] || FileText;
                                  return (
                                    <div key={at} className="flex items-center gap-1.5 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5">
                                      <Icon className="h-3.5 w-3.5 text-gray-400" />
                                      <span className="text-xs text-gray-600 dark:text-gray-300">{ASSET_LABELS[at]}</span>
                                      <span className={`text-xs font-semibold ${used >= granted ? 'text-red-500' : 'text-green-600'}`}>
                                        {used}/{granted}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* User's unlock history */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                Asset Unlock History ({userUnlocks.length})
                              </h4>
                              {userUnlocks.length > 0 ? (
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                  {userUnlocks.map((unlock, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        {(() => {
                                          const Icon = ASSET_ICONS[unlock.assetType] || FileText;
                                          return <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />;
                                        })()}
                                        <div className="min-w-0">
                                          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                                            {unlock.projectName || unlock.projectId.slice(0, 10)}
                                          </p>
                                          <p className="text-[10px] text-gray-400">
                                            {ASSET_LABELS[unlock.assetType] || unlock.assetType}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                        <SourceBadge source={unlock.source} />
                                        {unlock.charged ? (
                                          <span className="text-xs font-semibold text-amber-600">
                                            {formatCurrency(unlock.amountMinor, unlock.currency)}
                                          </span>
                                        ) : (
                                          <span className="text-xs text-green-600 font-medium">Free</span>
                                        )}
                                        <span className="text-[10px] text-gray-400">{relativeTime(unlock.unlockedAt)}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 italic">No asset unlocks</p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Recent Activity Timeline ---- */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Activity</h3>
        {data.unlockEvents.length > 0 ? (
          <div className="space-y-0">
            {data.unlockEvents.slice(0, 20).map((event, i) => {
              const Icon = ASSET_ICONS[event.assetType] || FileText;
              return (
                <div key={i} className="flex items-start gap-3 relative">
                  {/* Timeline line */}
                  {i < Math.min(data.unlockEvents.length, 20) - 1 && (
                    <div className="absolute left-[15px] top-[32px] bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
                  )}
                  {/* Dot */}
                  <div className={`flex-shrink-0 mt-1 h-[30px] w-[30px] rounded-full flex items-center justify-center ${
                    event.charged
                      ? 'bg-amber-100 dark:bg-amber-950/40'
                      : 'bg-green-100 dark:bg-green-950/40'
                  }`}>
                    <Icon className={`h-3.5 w-3.5 ${event.charged ? 'text-amber-600' : 'text-green-600'}`} />
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        <span className="font-medium">{emailForUser(event.userId)}</span>
                        {' unlocked '}
                        <span className="font-medium">{ASSET_LABELS[event.assetType] || event.assetType}</span>
                      </p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <SourceBadge source={event.source} />
                        {event.charged ? (
                          <span className="text-sm font-semibold text-amber-600">
                            {formatCurrency(event.amountMinor, event.currency)}
                          </span>
                        ) : (
                          <span className="text-sm text-green-600 font-medium">Free</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {event.projectName || event.projectId.slice(0, 10)} &middot; {formatDateTime(event.unlockedAt)}
                      {event.panelCount > 0 && ` \u00B7 ${event.panelCount} panels`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">No activity yet</p>
        )}
      </div>
    </div>
  );
}

