import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Client } from "@/lib/types";
import { mockClients } from "@/lib/mockClients";
import ClientsList from "@/components/ClientsList";
import { getStorefrontLink } from "@/lib/clientToken";
import { getBotLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  if (!isSupabaseConfigured()) {
    return <ClientsList clients={mockClients} sampleMode />;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("business_name", { ascending: true });

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-serif text-xl mb-2">Couldn&apos;t load clients</p>
          <p className="text-stone-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  const clients = (data ?? []) as Client[];
  // For the "copy the links" button: everyone who is not in the bot yet, with the links to send them.
  const invites = clients
    .filter((c) => !c.telegram_chat_id)
    .map((c) => ({ name: c.business_name, order: getStorefrontLink(c.id), bot: getBotLink(c.id, false) }));
  return <ClientsList clients={clients} invites={invites} />;
}
