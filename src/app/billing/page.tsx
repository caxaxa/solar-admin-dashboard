import { Sidebar } from '@/components/shared/Sidebar';
import { Header } from '@/components/shared/Header';
import { BillingDashboard } from '@/components/billing/BillingDashboard';

export default function BillingPage() {
  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 p-6">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">Billing & Revenue</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Monitor subscriptions, asset purchases, and revenue across all users
            </p>
          </div>
          <BillingDashboard />
        </main>
      </div>
    </div>
  );
}
