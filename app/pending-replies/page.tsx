import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Client, PendingReply } from "@/lib/types";
import { mockClients, mockPendingReplies } from "@/lib/mockClients";
import PendingRepliesList, { type PendingReplyWithClientName } from "@/components/PendingRepliesList";

export const dynamic = "force-dynamic";

export default async function PendingRepliesPage() {
  if (!isSupabaseConfigured()) {
    const replies: PendingReplyWithClientName[] = mockPendingReplies
      .map((r) => ({
        ...r,
        clientName: mockClients.find((c) => c.id === r.client_id)?.business_name ?? "—",
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return <PendingRepliesList replies={replies} sampleMode />;
  }

  const supabase = createSupabaseServerClient();
  const [{ data: pendingReplies, error }, { data: clients }] = await Promise.all([
    supabase.from("pending_replies").select("*").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, business_name"),
  ]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-serif text-xl mb-2">Couldn&apos;t load drafts</p>
          <p className="text-stone-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  const clientNameById = new Map(
    ((clients ?? []) as Pick<Client, "id" | "business_name">[]).map((c) => [c.id, c.business_name])
  );
  const replies: PendingReplyWithClientName[] = ((pendingReplies ?? []) as PendingReply[]).map((r) => ({
    ...r,
    clientName: (r.client_id && clientNameById.get(r.client_id)) || "—",
  }));

  return <PendingRepliesList replies={replies} />;
}
