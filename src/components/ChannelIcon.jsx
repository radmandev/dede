import { MessageCircle, Send, Instagram, Facebook } from "lucide-react";

const channelConfig = {
  telegram: { icon: Send, color: "text-sky-500", bg: "bg-sky-500/10", label: "Telegram" },
  whatsapp: { icon: MessageCircle, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "WhatsApp" },
  instagram: { icon: Instagram, color: "text-pink-500", bg: "bg-pink-500/10", label: "Instagram" },
  facebook: { icon: Facebook, color: "text-blue-600", bg: "bg-blue-600/10", label: "Facebook" },
};

export default function ChannelIcon({ channel, size = "sm" }) {
  const config = channelConfig[channel] || channelConfig.telegram;
  const Icon = config.icon;
  const sizeClasses = size === "sm" ? "h-4 w-4" : size === "md" ? "h-5 w-5" : "h-6 w-6";
  const containerClasses = size === "sm" ? "p-1.5" : size === "md" ? "p-2" : "p-2.5";

  return (
    <div className={`${containerClasses} rounded-lg ${config.bg} flex items-center justify-center`}>
      <Icon className={`${sizeClasses} ${config.color}`} />
    </div>
  );
}

export { channelConfig };