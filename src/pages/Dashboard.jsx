import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import ConversationList from "../components/ConversationList";
import MessageThread from "../components/MessageThread";
import { useIsMobile } from "@/hooks/use-mobile";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedConv, setSelectedConv] = useState(null);
  const isMobile = useIsMobile();

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => base44.entities.Conversation.list("-last_message_at", 200),
  });

  useEffect(() => {
    const channel = supabase.channel("realtime-dashboard");

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "conversations" },
      ({ new: row }) => {
        queryClient.setQueryData(["conversations"], (old = []) =>
          [row, ...old.filter((c) => c.id !== row.id)]
        );
      }
    );

    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversations" },
      ({ new: row }) => {
        queryClient.setQueryData(["conversations"], (old = []) =>
          old.map((c) => (c.id === row.id ? row : c))
            .sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at))
        );
      }
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const currentConv = selectedConv
    ? conversations.find((c) => c.id === selectedConv.id) || selectedConv
    : null;

  const handleNewConversation = (conv) => {
    queryClient.setQueryData(["conversations"], (old = []) =>
      old.find((c) => c.id === conv.id) ? old : [conv, ...old]
    );
    setSelectedConv(conv);
  };

  if (isMobile) {
    return (
      <div className="flex w-full h-full min-w-0">
        {currentConv ? (
          <MessageThread
            conversation={currentConv}
            onBack={() => setSelectedConv(null)}
          />
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={currentConv?.id}
            onSelect={setSelectedConv}
            onNewConversation={handleNewConversation}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full h-full">
      {/* Left panel - conversation list */}
      <div className="w-[360px] flex-shrink-0 border-r border-border overflow-hidden">
        <ConversationList
          conversations={conversations}
          selectedId={currentConv?.id}
          onSelect={setSelectedConv}
          onNewConversation={handleNewConversation}
        />
      </div>

      {/* Right panel - message thread */}
      <MessageThread conversation={currentConv} />
    </div>
  );
}
