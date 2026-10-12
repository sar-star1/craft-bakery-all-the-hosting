import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import type { Order } from "@/lib/types";
import { formatMoney } from "@/lib/utils";

export default function StatsBar({ orders, lang }: { orders: Order[]; lang: Lang }) {
  const t = STR[lang];
  const active = orders.filter((o) => o.status !== "completed");
  const pipelineValue = active.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);

  return (
    <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
      <div className="bg-white rounded-md border border-stone-200 px-4 py-3">
        <p className="text-[11px] text-stone-400 uppercase tracking-wide">{t.statActive}</p>
        <p className="font-serif text-2xl mt-0.5">{active.length}</p>
      </div>
      <div className="bg-white rounded-md border border-stone-200 px-4 py-3">
        <p className="text-[11px] text-stone-400 uppercase tracking-wide">{t.statValue}</p>
        <p className="font-serif text-2xl mt-0.5">{formatMoney(pipelineValue)}</p>
      </div>
    </div>
  );
}
