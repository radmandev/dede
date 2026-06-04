import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import ConversationList from "@/components/ConversationList";
import MessageThread from "@/components/MessageThread";

export default function Dashboard() {
  const [selected, setSelected] = useState(null);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => base44.entities.Conversation.list("-updated_date", 200),
    refetchInterval: 30000,
  });

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={selected?.id}
            onSelect={setSelected}
          />
        )}
      </div>
      <div className="flex-1 flex overflow-hidden">
        <MessageThread conversation={selected} />
      </div>
    </div>
  );
}
