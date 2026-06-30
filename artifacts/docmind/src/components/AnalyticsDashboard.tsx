import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import type { JobApplication } from "../lib/supabase";
import { format, subDays, isSameDay, parseISO } from "date-fns";

export function AnalyticsDashboard({ apps }: { apps: JobApplication[] }) {
  const funnelData = useMemo(() => {
    let applied = 0;
    let interview = 0;
    let offer = 0;

    apps.forEach((a) => {
      const dates = a.status_dates || {};
      const hasApplied = dates.applied || dates.interviewing || dates.offer || dates.rejected || a.status === 'applied';
      const hasInterview = dates.interviewing || dates.offer || a.status === 'interviewing';
      const hasOffer = dates.offer || a.status === 'offer';

      if (hasApplied) applied++;
      if (hasInterview) interview++;
      if (hasOffer) offer++;
    });

    return [
      { stage: "Applied", count: applied, fill: "#4caf7d" },
      { stage: "Interview", count: interview, fill: "#f5a623" },
      { stage: "Offer", count: offer, fill: "#2563eb" },
    ];
  }, [apps]);

  const timelineData = useMemo(() => {
    // Generate last 14 days
    const days = Array.from({ length: 14 }).map((_, i) => subDays(new Date(), 13 - i));
    
    return days.map(day => {
      const count = apps.filter(a => {
        const d = a.status_dates?.applied;
        if (!d) return false;
        return isSameDay(parseISO(d), day);
      }).length;

      return {
        date: format(day, "MMM dd"),
        Applications: count,
      };
    });
  }, [apps]);

  if (apps.length === 0) return null;

  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      {/* Funnel Chart */}
      <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm dark:bg-ink/5 dark:border-ink/20">
        <h3 className="mb-4 text-sm font-semibold text-ink/70">Application Funnel</h3>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 30, left: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e5e7eb" />
              <XAxis type="number" hide />
              <YAxis dataKey="stage" type="category" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
              <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Timeline Chart */}
      <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm dark:bg-ink/5 dark:border-ink/20">
        <h3 className="mb-4 text-sm font-semibold text-ink/70">Activity (Last 14 Days)</h3>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timelineData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorApps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4caf7d" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#4caf7d" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Area type="monotone" dataKey="Applications" stroke="#4caf7d" strokeWidth={2} fillOpacity={1} fill="url(#colorApps)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
