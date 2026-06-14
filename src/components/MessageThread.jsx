import { useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44, supabase } from "@/api/base44Client";
import { MessageSquare, User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ChatBubble from "./ChatBubble";
import ChannelIcon, { channelConfig } from "./ChannelIcon";
import MessageComposer from "./MessageComposer";

export default function MessageThread({ conversation }) {
  const scrollRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", conversation?.id],
    queryFn: () => base44.entities.Message.filter({ conversation_id: conversation.id }, "created_date", 200),
    enabled: !!conversation?.id,
  });

  // Real-time subscription — directly update cache, no refetch round-trip
  useEffect(() => {
    if (!conversation?.id) return;

    const channel = supabase.channel(`realtime-messages-${conversation.id}`);

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversation.id}`,
      },
      ({ new: msg }) => {
        queryClient.setQueryData(["messages", conversation.id], (old = []) =>
          old.some((m) => m.id === msg.id) ? old : [...old, msg]
        );
      }
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id, queryClient]);

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Conversation.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const sendMessage = useMutation({
    mutationFn: (payload) => base44.functions.invoke('sendMessage', { conversation_id: conversation.id, ...payload }),
    onSuccess: (result) => {
      // Log delivery diagnostics to browser console for debugging
      if (result?.data?.delivery) {
        console.log('[noqta] sendMessage delivery:', result.data.delivery);
      }
      queryClient.invalidateQueries({ queryKey: ["messages", conversation?.id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  // Queue so rapid sends go out sequentially, not concurrently (prevents SP rate-limit drops)
  const sendQueue = useRef([]);
  const draining = useRef(false);

  const drainQueue = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    while (sendQueue.current.length > 0) {
      const payload = sendQueue.current.shift();
      try { await sendMessage.mutateAsync(payload); } catch (_) {}
    }
    draining.current = false;
  }, [sendMessage]);

  const enqueueSend = useCallback((payload) => {
    sendQueue.current.push(payload);
    drainQueue();
  }, [drainQueue]);

  const markRead = useMutation({
    mutationFn: (id) => base44.entities.Conversation.update(id, { unread_count: 0 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });

  useEffect(() => {
    if (conversation?.id && conversation.unread_count > 0) {
      markRead.mutate(conversation.id);
    }
  }, [conversation?.id]);


  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background text-muted-foreground">
        <div className="p-6 rounded-2xl bg-muted/30 mb-4">
          <MessageSquare className="h-12 w-12 opacity-30" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">Select a conversation</h3>
        <p className="text-sm">Choose from the list to view messages</p>
      </div>
    );
  }

  const channelInfo = channelConfig[conversation.channel] || channelConfig.telegram;

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChannelIcon channel={conversation.channel} size="lg" />
          <div>
            <h3 className="font-semibold text-foreground">{conversation.contact_name}</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className={channelInfo.color}>{channelInfo.label}</span>
              <span>·</span>
              <span>ID: {conversation.sendpulse_contact_id || "—"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={conversation.status}
            onValueChange={(value) => updateStatus.mutate({ id: conversation.id, status: value })}
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Open
                </span>
              </SelectItem>
              <SelectItem value="pending">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Pending
                </span>
              </SelectItem>
              <SelectItem value="closed">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground" /> Closed
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <User className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No messages in this conversation</p>
          </div>
        ) : (
          messages.map((msg) => <ChatBubble key={msg.id} message={msg} />)
        )}
      </div>

      <MessageComposer
        conversation={conversation}
        onSend={enqueueSend}
        isSending={sendMessage.isPending}
        error={sendMessage.isError ? (sendMessage.error?.message || 'Failed to send') : null}
      />
    </div>
  );
}