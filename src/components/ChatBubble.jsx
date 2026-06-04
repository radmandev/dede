import { useState } from "react";
import { format } from "date-fns";
import { FileText, Music, Download, X, FileImage, FileAudio, FileVideo, File, Archive, ImageIcon } from "lucide-react";

const LARGE_TEXT_THRESHOLD = 400;

function getFileIconAndColor(name) {
  if (!name) return { Icon: File, colorClass: "bg-muted-foreground/20 text-muted-foreground" };
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext))
    return { Icon: FileImage, colorClass: "bg-blue-500/20 text-blue-600" };
  if (["mp3", "wav", "ogg", "m4a", "aac"].includes(ext))
    return { Icon: FileAudio, colorClass: "bg-purple-500/20 text-purple-600" };
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
    return { Icon: FileVideo, colorClass: "bg-red-500/20 text-red-600" };
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext))
    return { Icon: Archive, colorClass: "bg-amber-500/20 text-amber-600" };
  if (["pdf"].includes(ext))
    return { Icon: FileText, colorClass: "bg-red-500/20 text-red-600" };
  if (["doc", "docx"].includes(ext))
    return { Icon: FileText, colorClass: "bg-blue-500/20 text-blue-600" };
  if (["xls", "xlsx", "csv"].includes(ext))
    return { Icon: FileText, colorClass: "bg-emerald-500/20 text-emerald-600" };
  return { Icon: File, colorClass: "bg-muted-foreground/20 text-muted-foreground" };
}

function ImageLightbox({ src, alt, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/50 rounded-full p-2 transition-colors"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function MediaContent({ message }) {
  const { message_type, media_url, media_name, message_text } = message;
  const isInbound = message.direction === "inbound";
  const captionClass = `text-xs mt-1.5 ${isInbound ? "text-muted-foreground" : "text-primary-foreground/70"}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  if (message_type === "image") {
    // Encode the URL to handle Arabic characters, spaces, and other non-ASCII in filenames
    const safeUrl = media_url
      ? (() => { try { return encodeURI(decodeURI(media_url)); } catch { return media_url; } })()
      : null;

    if (!safeUrl || imgFailed) {
      // Fallback: image URL missing or failed to load (e.g. private S3 bucket)
      return (
        <div className={`flex items-center gap-3 min-w-[180px] p-1 rounded-lg ${isInbound ? "bg-muted/40" : "bg-white/10"}`}>
          <div className={`p-2.5 rounded-xl flex-shrink-0 ${isInbound ? "bg-blue-500/15 text-blue-500" : "bg-white/20 text-white"}`}>
            <ImageIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{media_name || "Image"}</p>
            {safeUrl && (
              <a href={safeUrl} target="_blank" rel="noopener noreferrer"
                className={`text-xs hover:underline ${isInbound ? "text-primary" : "text-primary-foreground/70"}`}>
                Open ↗
              </a>
            )}
          </div>
        </div>
      );
    }

    return (
      <>
        {lightboxOpen && (
          <ImageLightbox
            src={safeUrl}
            alt={media_name || "image"}
            onClose={() => setLightboxOpen(false)}
          />
        )}
        <div>
          <img
            src={safeUrl}
            alt={media_name || "image"}
            className="max-w-full rounded-lg max-h-72 object-contain cursor-zoom-in hover:opacity-95 transition-opacity"
            onClick={() => setLightboxOpen(true)}
            onError={() => setImgFailed(true)}
          />
          {message_text && message_text !== "[Image]" && (
            <p className={`${captionClass} whitespace-pre-wrap`}>{message_text}</p>
          )}
        </div>
      </>
    );
  }

  if (message_type === "audio" && media_url) {
    const safeUrl = (() => { try { return encodeURI(decodeURI(media_url)); } catch { return media_url; } })();
    return (
      <div className="space-y-1.5 min-w-[240px]">
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 flex-shrink-0 opacity-70" />
          {media_name && (
            <span className="text-xs font-medium truncate max-w-[200px] opacity-80">{media_name}</span>
          )}
        </div>
        <audio controls src={safeUrl} className="w-full h-9" />
      </div>
    );
  }

  if (message_type === "file" && media_url) {
    const safeUrl = (() => { try { return encodeURI(decodeURI(media_url)); } catch { return media_url; } })();
    const { Icon: FileIcon, colorClass } = getFileIconAndColor(media_name);
    const ext = media_name?.split(".").pop()?.toUpperCase() || "FILE";
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 hover:opacity-80 transition-opacity min-w-[220px] max-w-[320px]"
      >
        <div className={`p-3 rounded-xl flex-shrink-0 ${isInbound ? colorClass : "bg-white/20 text-white"}`}>
          <FileIcon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug break-all line-clamp-2">
            {media_name || message_text || "File"}
          </p>
          <p className={`text-xs mt-0.5 flex items-center gap-1 ${isInbound ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
            <Download className="h-3 w-3 flex-shrink-0" />
            <span>{ext} · Download</span>
          </p>
        </div>
      </a>
    );
  }

  if (message_type === "template") {
    const templateName = message_text?.replace("[Template: ", "").replace("]", "") || message_text;
    return (
      <div className={`space-y-1 border rounded-lg p-2.5 ${isInbound ? "border-border bg-muted/30" : "border-white/30 bg-white/10"}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Template</p>
        <p className="text-sm font-medium">{templateName}</p>
      </div>
    );
  }

  // Large text with expand/collapse
  const isLarge = message_text && message_text.length > LARGE_TEXT_THRESHOLD;
  const displayText = isLarge && !expanded
    ? message_text.slice(0, LARGE_TEXT_THRESHOLD) + "…"
    : message_text;

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">{displayText}</p>
      {isLarge && (
        <button
          onClick={() => setExpanded(!expanded)}
          className={`text-xs mt-2 font-semibold hover:underline ${isInbound ? "text-primary" : "text-primary-foreground/80"}`}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
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
          {(() => { const d = new Date(message.sent_at || message.created_at); return isNaN(d) ? "" : format(d, "h:mm a"); })()}
        </p>
      </div>
    </div>
  );
}
