import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { MessageSquare, ShieldAlert } from "lucide-react";
import MessageThread from "../components/MessageThread";

const CRM_METHOD = {
  CRM_LEAD_DETAIL_TAB: "crm.lead.get",
  CRM_DEAL_DETAIL_TAB: "crm.deal.get",
  CRM_CONTACT_DETAIL_TAB: "crm.contact.get",
  CRM_COMPANY_DETAIL_TAB: "crm.company.get",
};

const digits = (s) => (s || "").toString().replace(/\D/g, "");

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
      if (res.error()) reject(new Error(res.error())); else resolve(res.data());
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

async function getPhone(method, id) {
  const data = await callBx(method, { id });
  let phone = extractPhone(data);
  if (!phone && method === "crm.deal.get" && data?.CONTACT_ID) {
    const c = await callBx("crm.contact.get", { id: data.CONTACT_ID });
    phone = extractPhone(c);
  }
  return phone;
}

async function findConversation(phone) {
  const target = digits(phone).slice(-9);
  if (target.length < 7) return null;
  const convs = await base44.entities.Conversation.list("-last_message_at", 500);
  return convs.find((c) => digits(c.contact_phone).slice(-9) === target) || null;
}

function Centered({ icon: Icon, title, text }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center text-center p-8 font-inter bg-background text-muted-foreground">
      <div className="p-5 rounded-2xl bg-muted/30 mb-4">
        <Icon className="h-10 w-10 opacity-40" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{title}</h3>
      {text && <p className="text-sm max-w-sm">{text}</p>}
    </div>
  );
}

export default function CrmChat() {
  const [state, setState] = useState({ loading: true, error: null, conv: null });

  useEffect(() => {
    let cancelled = false;
    const finish = (s) => { if (!cancelled) setState({ loading: false, error: s.error || null, conv: s.conv || null }); };

    (async () => {
      let me;
      try { me = await base44.auth.me(); } catch { finish({ error: "Please sign in as an admin to view this chat." }); return; }
      if (me?.role !== "admin") { finish({ error: "This view is available to admins only." }); return; }

      await loadBx24();
      if (!window.BX24) { finish({ error: "Could not load the Bitrix24 bridge." }); return; }

      window.BX24.init(async () => {
        try {
          const info = window.BX24.placement.info();
          const placement = info?.placement;
          const options = info?.options || {};
          const entityId = options.ID || options.ENTITY_VALUE_ID || options.ENTITY_ID;
          const method = CRM_METHOD[placement];
          if (!method || !entityId) { finish({ error: "No CRM element detected." }); return; }

          const phone = await getPhone(method, entityId);
          if (!phone) { finish({ error: "This CRM element has no phone number." }); return; }

          const conv = await findConversation(phone);
          if (!conv) { finish({ error: `No conversation found for ${phone}.` }); return; }
          finish({ conv });
        } catch (e) { finish({ error: e.message }); }
      });
    })();

    return () => { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (state.error) {
    const isAuth = /admin|sign in/i.test(state.error);
    return <Centered icon={isAuth ? ShieldAlert : MessageSquare} title={isAuth ? "Access restricted" : "No chat to show"} text={state.error} />;
  }

  return (
    <div className="h-screen flex font-inter bg-background">
      <MessageThread conversation={state.conv} />
    </div>
  );
}