import { format } from "date-fns";
import { FileText, Music, Download } from "lucide-react";

function MediaContent({ message }) {
  const { message_type, media_url, media_name, message_text } = message;
  const isInbound = message.direction === "inbound";
  const captionClass = `text-xs mt-1 ${isInbound ? "text-muted-foreground" : "text-primary-foreground/70"}`;

  if (message_type === "image" && media_url) {
    return (
      <div>
        <img
          src={media_url}
          alt={media_name || "image"}
          className="max-w-full rounded-lg max-h-64 object-cover"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        {message_text && message_text !== "[Image]" && (
          <p className={`${captionClass} whitespace-pre-wrap`}>{message_text}</p>
        )}
      </div>
    );
  }

  if (message_type === "audio" && media_url) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 flex-shrink-0" />
          <audio controls src={media_url} className="h-8 max-w-[200px]" />
        </div>
      </div>
    );
  }

  if (message_type === "file" && media_url) {
    return (
      <a
        href={media_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <div className={`p-2 rounded-lg ${isInbound ? "bg-muted" : "bg-white/20"}`}>
          <FileText className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{media_name || message_text || "File"}</p>
          <p className={`text-xs ${isInbound ? "text-muted-foreground" : "text-primary-foreground/70"} flex items-center gap-1`}>
            <Download className="h-3 w-3" /> Download
          </p>
        </div>
      </a>
    );
  }

  if (message_type === "template") {
    const templateName = message_text?.replace("[Template: ", "").replace("]", "") || message_text;
    return (
      <div className={`space-y-1 border rounded-lg p-2 ${isInbound ? "border-border bg-muted/30" : "border-white/30 bg-white/10"}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Template</p>
        <p className="text-sm font-medium">{templateName}</p>
      </div>
    );
  }

  // default text
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{message_text}</p>;
}

export default function ChatBubble({ message }) {
  const isInbound = message.direction === "inbound";

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"} mb-3`}>
      <div className="max-w-[75%]">
        <div className={`
          px-4 py-2.5 rounded-2xl
          ${isInbound
            ? "bg-card border border-border text-foreground rounded-bl-md"
            : "bg-primary text-primary-foreground rounded-br-md"
          }
        `}>
          {isInbound && (
            <p className="text-xs font-semibold mb-1 text-muted-foreground">
              {message.sender_name}
            </p>
          )}
          <MediaContent message={message} />
        </div>
        <p className={`text-[11px] text-muted-foreground mt-1 px-1 ${isInbound ? "text-left" : "text-right"}`}>
          {format(new Date(message.sent_at || message.created_date), "h:mm a")}
        </p>
      </div>
    </div>
  );
}