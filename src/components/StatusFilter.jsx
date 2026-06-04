const filters = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" },
];

export default function StatusFilter({ activeFilter, onFilterChange, counts }) {
  return (
    <div className="flex gap-1 px-4 py-2 border-b border-border">
      {filters.map((f) => {
        const count = f.value === "all" ? counts.all : counts[f.value] || 0;
        const isActive = activeFilter === f.value;
        return (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
              ${isActive 
                ? "bg-primary text-primary-foreground shadow-sm" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }
            `}
          >
            {f.label}
            {count > 0 && (
              <span className={`
                text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center
                ${isActive ? "bg-white/20" : "bg-muted"}
              `}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}