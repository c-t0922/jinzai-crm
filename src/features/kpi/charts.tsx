"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// dataviz 参照パレットのシリーズ1（青）。単一系列のチャートのみで使う。
const SERIES = "#257de0";
const GRID = "#e5e7eb";
const AXIS = { fontSize: 11, fill: "#64748b" };

function Tip({ active, payload, label, unit, labelFmt }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string | number; unit: string; labelFmt?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <p className="text-slate-500">{labelFmt && label !== undefined ? labelFmt(label) : label}</p>
      <p className="tabular font-medium text-slate-900">{payload[0].value.toLocaleString("ja-JP")}{unit}</p>
    </div>
  );
}

const md = (b: string | number) => { const s = String(b); return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`; };

/** 推移（1チャート1指標。二軸は使わない） */
export function TrendChart({ data, dataKey, unit = "件", height = 160, label }: { data: Record<string, string | number>[]; dataKey: string; unit?: string; height?: number; label: string }) {
  const single = data.length <= 1;
  return (
    <figure aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        {single ? (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="bucket" tickFormatter={md} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip cursor={{ fill: "#f1f5f9" }} content={<Tip unit={unit} labelFmt={md} />} />
            <Bar dataKey={dataKey} fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="bucket" tickFormatter={md} tick={AXIS} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }} content={<Tip unit={unit} labelFmt={md} />} />
            <Line type="linear" dataKey={dataKey} stroke={SERIES} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}

/** 時間帯別の架電数（棒） */
export function HourChart({ data, height = 180 }: { data: { hour: number; calls: number }[]; height?: number }) {
  const full = Array.from({ length: 13 }, (_, i) => i + 9).map((h) => ({ hour: h, calls: data.find((d) => d.hour === h)?.calls ?? 0 }));
  return (
    <figure aria-label="時間帯別 架電数">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={full} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="hour" tickFormatter={(h) => `${h}時`} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} content={<Tip unit="件" labelFmt={(h) => `${h}時台`} />} />
          <Bar dataKey="calls" fill={SERIES} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** 架電結果の内訳（横棒・件数順は保持せずマスタの表示順） */
export function ResultBars({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <ul className="space-y-1.5" aria-label="架電結果の内訳">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 text-xs" title={`${d.label}：${d.count.toLocaleString("ja-JP")}件`}>
          <span className="truncate text-slate-600">{d.label}</span>
          <span className="h-3 rounded-r bg-slate-100">
            <span className="block h-full rounded-r" style={{ width: `${(d.count / max) * 100}%`, background: SERIES, minWidth: d.count ? 2 : 0 }} />
          </span>
          <span className="tabular text-right text-slate-700">{d.count.toLocaleString("ja-JP")}<span className="ml-1 text-slate-400">{total ? `${((d.count / total) * 100).toFixed(0)}%` : ""}</span></span>
        </li>
      ))}
    </ul>
  );
}
