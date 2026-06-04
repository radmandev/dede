import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import ConversationList from "../components/ConversationList";
import MessageThread from "../components/MessageThread";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedConv, setSelectedConv] = useState(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => base44.entities.Conversation.list("-last_message_at", 200),
  });

  useEffect(() => {
    const convChannel = supabase.channel("realtime-dashboard-conversations");

    convChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      () => queryClient.invalidateQueries({ queryKey: ["conversations"] })
    );

    convChannel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      () => queryClient.invalidateQueries({ queryKey: ["conversations"] })
    );

    convChannel.subscribe();

    return () => {
      supabase.removeChannel(convChannel);
    };
  }, [queryClient]);

  // Keep selected conversation in sync with latest data
  const currentConv = selectedConv 
    ? conversations.find((c) => c.id === selectedConv.id) || selectedConv
    : null;

  return (
    <div className="flex w-full h-full">
      {/* Left panel - conversation list */}
      <div className="w-[360px] flex-shrink-0 border-r border-border overflow-hidden">
        <ConversationList
          conversations={conversations}
          selectedId={currentConv?.id}
          onSelect={setSelectedConv}
        />
      </div>

      {/* Right panel - message thread */}
      <MessageThread conversation={currentConv} />
    </div>
  );
}