import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Inbox } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/api/base44Client";
import ConversationCard from "./ConversationCard";
import StatusFilter from "./StatusFilter";

export default function ConversationList({ conversations, selectedId, onSelect }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const queryClient = useQueryClient();

  const counts = useMemo(() => {
    const c = { all: conversations.length, open: 0, pending: 0, closed: 0 };
    conversations.forEach((conv) => { c[conv.status] = (c[conv.status] || 0) + 1; });
    return c;
  }, [conversations]);

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const matchesSearch = !search || 
        c.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.last_message_text?.toLowerCase().includes(search.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [conversations, statusFilter, search]);

  useEffect(() => {
    const channel = supabase.channel("realtime-conversations");

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      () => queryClient.invalidateQueries({ queryKey: ["conversations"] })
    );

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      () => queryClient.invalidateQueries({ queryKey: ["conversations"] })
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-muted/50 border-0 text-sm"
          />
        </div>
      </div>

      <StatusFilter activeFilter={statusFilter} onFilterChange={setStatusFilter} counts={counts} />

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No conversations yet</p>
            <p className="text-xs mt-1">Messages will appear here when received</p>
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationCard
              key={conv.id}
              conversation={conv}
              isSelected={selectedId === conv.id}
              onClick={() => onSelect(conv)}
            />
          ))
        )}
      </div>
    </div>
  );
}