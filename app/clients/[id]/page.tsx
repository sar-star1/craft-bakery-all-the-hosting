import { notFound } from "next/navigation";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Client, Conversation, Order, PendingReply } from "@/lib/types";
import { mockClients, mockConversations, mockPendingReplies } from "@/lib/mockClients";
import { mockOrders } from "@/lib/mockOrders";
import ClientDetail from "@/components/ClientDetail";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isSupabaseConfigured()) {
    const client = mockClients.find((c) => c.id === id);
    if (!client) notFound();
    const conversation = mockConversations.find((c) => c.client_id === id) ?? null;
    const pendingReplies = mockPendingReplies.filter((r) => r.client_id === id);
    const orders = mockOrders
      .filter((o) => o.client_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    return (
      <ClientDetail
        client={client}
        conversation={conversation}
        pendingReplies={pendingReplies}
        orders={orders}
        sampleMode
      />
    );
  }

  const supabase = createSupabaseServerClient();

  const [{ data: client, error: clientError }, { data: conversations }, { data: orders }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).single(),
      supabase
        .from("conversations")
        .select("*")
        .eq("client_id", id)
        .order("last_message_at", { ascending: false })
        .limit(1),
      supabase
        .from("orders")
        .select("*")
        .eq("client_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (clientError || !client) notFound();

  const conversation = (conversations?.[0] as Conversation | undefined) ?? null;
  let pendingReplies: PendingReply[] = [];
  if (conversation) {
    const { data } = await supabase
      .from("pending_replies")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false });
    pendingReplies = (data ?? []) as PendingReply[];
  }

  return (
    <ClientDetail
      client={client as Client}
      conversation={conversation}
      pendingReplies={pendingReplies}
      orders={(orders ?? []) as Order[]}
    />
  );
}
