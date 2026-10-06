import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";
import { mockClients } from "@/lib/mockClients";
import { mockOrders } from "@/lib/mockOrders";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="font-serif text-xl mb-2">Couldn&apos;t load orders</p>
        <p className="text-stone-500 text-sm">{message}</p>
      </div>
    </div>
  );
}

export default async function Page() {
  // Supabase isn't configured yet — fall back to sample data so the
  // dashboard is testable before real credentials exist (see README).
  if (!isSupabaseConfigured()) {
    return <Dashboard initialOrders={mockOrders} clients={mockClients} sampleMode />;
  }

  const supabase = createSupabaseServerClient();
  const [{ data, error }, { data: clients }] = await Promise.all([
    supabase.from("orders").select("*").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, business_name").order("business_name"),
  ]);

  if (error) {
    return <ErrorScreen message={error.message} />;
  }

  return (
    <Dashboard
      initialOrders={(data ?? []) as Order[]}
      clients={(clients ?? []) as { id: string; business_name: string }[]}
    />
  );
}
