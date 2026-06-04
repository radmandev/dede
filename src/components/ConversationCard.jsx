import { format, isToday, isYesterday } from "date-fns";
import ChannelIcon from "./ChannelIcon";

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

export default function ConversationCard({ conversation, isSelected, onClick }) {
  const hasUnread = (conversation.unread_count || 0) > 0;

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-3.5 flex items-start gap-3 transition-all duration-150 border-b border-border/50
        ${isSelected 
          ? "bg-accent border-l-2 border-l-primary" 
          : "hover:bg-muted/50 border-l-2 border-l-transparent"
        }
      `}
    >
      <ChannelIcon channel={conversation.channel} size="md" />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className={`text-sm truncate ${hasUnread ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
            {conversation.contact_name}
          </h4>
          <span className="text-[11px] text-muted-foreground whitespace-nowrap flex-shrink-0">
            {formatTime(conversation.last_message_at || conversation.updated_date)}
          </span>
        </div>
        
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-xs truncate ${hasUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {conversation.last_message_text || "No messages yet"}
          </p>
          {hasUnread && (
            <span className="flex-shrink-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1.5">
              {conversation.unread_count}
            </span>
          )}
        </div>

        {conversation.status !== "open" && (
          <span className={`
            inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider
            ${conversation.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}
          `}>
            {conversation.status}
          </span>
        )}
      </div>
    </button>
  );
}