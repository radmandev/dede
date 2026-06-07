import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { MessageSquare, Plus, Phone, ChevronLeft } from "lucide-react";
import MessageThread from "../components/MessageThread";
import NewChatDialog from "../components/NewChatDialog";
import { Button } from "@/components/ui/button";

const CRM_METHOD = {
  CRM_LEAD_DETAIL_TAB: "crm.lead.get",
  CRM_DEAL_DETAIL_TAB: "crm.deal.get",
  CRM_CONTACT_DETAIL_TAB: "crm.contact.get",
  CRM_COMPANY_DETAIL_TAB: "crm.company.get",
};

const CHANNEL_DOT = {
  whatsapp: "bg-green-500",
  telegram: "bg-sky-400",
  instagram: "bg-pink-500",
  facebook: "bg-blue-600",
  live_chat: "bg-violet-500",
};

function loadBx24() {
  return new Promise((resolve) => {
    if (window.BX24) return resolve();
    const s = document.createElement("script");
    s.src = "https://api.bitrix24.com/api/v1/";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}

function callBx(method, params) {
  return new Promise((resolve, reject) => {
    window.BX24.callMethod(method, params, (res) => {
      if (res.error()) reject(new Error(String(res.error())));
      else resolve(res.data());
    });
  });
}

function extractPhone(d) {
  if (!d) return "";
  const ph = d.PHONE || d.phone;
  if (Array.isArray(ph) && ph.length) return ph[0].VALUE || ph[0].value || "";
  if (typeof ph === "string") return ph;
  return "";
}

function extractName(d, placement) {
  if (!d) return "";
  if (placement === "CRM_CONTACT_DETAIL_TAB")
    return [d.NAME, d.LAST_NAME].filter(Boolean).join(" ") || d.name || "";
  return d.TITLE || d.NAME || d.name || d.title || "";
}

const digits = (s) => (s || "").toString().replace(/\D/g, "");

async function findConversations(phone) {
  const tail = digits(phone).slice(-9);
  if (tail.length < 7) return [];
  const all = await base44.entities.Conversation.list("-last_message_at", 500);
  return all.filter((c) => digits(c.contact_phone || "").slice(-9) === tail);
}

function timeLabel(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 8) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function ConvItem({ conv, selected, onClick }) {
  const name = conv.contact_name || conv.contact_phone || "Unknown";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase() || "?";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-r-2
        ${selected
          ? "bg-primary/10 border-primary"
          : "border-transparent hover:bg-muted/40"
        }`}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
          {initials}
        </div>
        {conv.channel && (
          <span
            className={`absolute -bottom-px -right-px w-3 h-3 rounded-full border-2 border-background ${CHANNEL_DOT[conv.channel] || "bg-muted-foreground"}`}
          />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold truncate leading-none">{name}</span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {timeLabel(conv.last_message_at)}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {conv.last_message_text || "—"}
        </p>
      </div>
    </button>
  );
}

export default function CrmChat() {
  const [ready, setReady] = useState(false);
  const [authErr, setAuthErr] = useState(null);
  const [entityName, setEntityName] = useState("");
  const [entityPhone, setEntityPhone] = useState("");
  const [convs, setConvs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  // On narrow viewports show either list or thread, not both
  const [panel, setPanel] = useState("list");

  useEffect(() => {
    let dead = false;

    (async () => {
      // Any authenticated user can use the widget
      let me;
      try {
        me = await base44.auth.me();
      } catch {
        if (!dead) setAuthErr("Please sign in to use this widget.");
        return;
      }
      if (!me) {
        if (!dead) setAuthErr("Please sign in to use this widget.");
        return;
      }

      await loadBx24();

      if (!window.BX24) {
        if (!dead) setReady(true);
        return;
      }

      window.BX24.init(async () => {
        if (dead) return;
        try {
          const info = window.BX24.placement.info();
          const placement = info?.placement;
          const opts = info?.options || {};
          const entityId = opts.ID || opts.ENTITY_VALUE_ID || opts.ENTITY_ID;
          const method = CRM_METHOD[placement];

          let phone = "";
          let name = "";

          if (method && entityId) {
            try {
              const data = await callBx(method, { id: entityId });
              phone = extractPhone(data);
              name = extractName(data, placement);
              // Deals: fall back to linked contact for phone
              if (!phone && method === "crm.deal.get" && data?.CONTACT_ID) {
                const contact = await callBx("crm.contact.get", { id: data.CONTACT_ID });
                phone = extractPhone(contact);
                if (!name) name = [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ");
              }
            } catch (e) {
              console.warn("[CrmChat] entity fetch:", e.message);
            }
          }

          if (!dead) {
            setEntityName(name);
            setEntityPhone(phone);
          }

          if (phone) {
            const found = await findConversations(phone);
            if (!dead) {
              setConvs(found);
              if (found.length > 0) {
                setSelected(found[0]);
                setPanel("thread");
              }
            }
          }
        } catch (e) {
          console.warn("[CrmChat] BX24 init:", e.message);
        }

        if (!dead) setReady(true);
      });
    })();

    return () => { dead = true; };
  }, []);

  const handleNewConv = useCallback((conv) => {
    setConvs((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
    setSelected(conv);
    setNewChatOpen(false);
    setPanel("thread");
  }, []);

  // ── Auth error ──────────────────────────────────────────────────────────────
  if (authErr) {
    return (
      <div className="h-screen flex flex-col items-center justify-center text-center p-8 font-inter bg-background text-muted-foreground">
        <MessageSquare className="h-10 w-10 opacity-30 mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">Sign in required</p>
        <p className="text-xs">{authErr}</p>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="w-7 h-7 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // ── Widget ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex font-inter bg-background overflow-hidden">

      {/* ── Left sidebar (always visible on wide; hidden when thread shown on narrow) ── */}
      <div
        className={`flex-shrink-0 border-r border-border flex flex-col bg-card transition-all
          ${panel === "thread" ? "hidden sm:flex w-[220px]" : "flex w-full sm:w-[220px]"}`}
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-border/50 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {entityName && (
              <p className="text-xs font-semibold truncate leading-tight">{entityName}</p>
            )}
            {entityPhone && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="h-2.5 w-2.5 flex-shrink-0" />
                <span dir="ltr" className="truncate">{entityPhone}</span>
              </p>
            )}
            {!entityName && !entityPhone && (
              <p className="text-xs font-medium text-muted-foreground">Conversations</p>
            )}
          </div>
          <button
            onClick={() => setNewChatOpen(true)}
            className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent transition-colors flex-shrink-0 mt-0.5"
            title="New conversation"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {convs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-3 text-center">
              <MessageSquare className="h-7 w-7 text-muted-foreground opacity-25 mb-2" />
              <p className="text-xs text-muted-foreground leading-snug">
                No conversations{entityPhone ? " for this contact" : ""} yet
              </p>
              <button
                onClick={() => setNewChatOpen(true)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Start one
              </button>
            </div>
          ) : (
            convs.map((conv) => (
              <ConvItem
                key={conv.id}
                conv={conv}
                selected={selected?.id === conv.id}
                onClick={() => { setSelected(conv); setPanel("thread"); }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: message thread ─────────────────────────────────────────────── */}
      <div
        className={`flex-1 min-w-0 flex flex-col overflow-hidden
          ${panel === "list" ? "hidden sm:flex" : "flex"}`}
      >
        {selected ? (
          <>
            {/* Back button on narrow viewports */}
            <button
              onClick={() => setPanel("list")}
              className="sm:hidden flex items-center gap-1 px-3 py-2 text-xs text-primary border-b border-border bg-card flex-shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> All conversations
            </button>
            <MessageThread conversation={selected} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <MessageSquare className="h-10 w-10 opacity-20 mb-3" />
            <p className="text-sm font-medium text-foreground">No conversation selected</p>
            <p className="text-xs mt-1 mb-4">
              {entityPhone
                ? "No previous chats with this contact."
                : "Select or start a conversation."}
            </p>
            <Button size="sm" variant="outline" onClick={() => setNewChatOpen(true)} className="gap-2">
              <Plus className="h-3.5 w-3.5" /> New Conversation
            </Button>
          </div>
        )}
      </div>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onConversationCreated={handleNewConv}
        defaultPhone={entityPhone}
      />
    </div>
  );
}
