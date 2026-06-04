import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import MessageThread from "@/components/MessageThread";
import ConversationList from "@/components/ConversationList";

export default function CrmChat() {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState(null);
  const contactId = searchParams.get("contact_id");

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => base44.entities.Conversation.list("-updated_date", 200),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (contactId && conversations.length > 0) {
      const match = conversations.find((c) => c.sendpulse_contact_id === contactId || c.bitrix24_contact_id === contactId);
      if (match) setSelected(match);
    }
  }, [contactId, conversations]);

  return (
    <div className="h-screen flex overflow-hidden bg-background">
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
