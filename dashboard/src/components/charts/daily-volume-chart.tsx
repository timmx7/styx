"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyStats } from "@/lib/types";

function ChartTooltip({
  active,
  payload,
  label,
  suffix = "",
}: {
  active?: boolean;
  payload?: { value: number; name: string; color?: string }[];
  label?: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-md">
      {label && (
        <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-semibold">
          {entry.value.toLocaleString()}
          {suffix && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {suffix}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

interface DailyVolumeChartProps {
  data: DailyStats[];
}

export default function DailyVolumeChart({ data }: DailyVolumeChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data available yet. Start sending requests through Styx.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradientVolume" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          content={<ChartTooltip suffix="requests" />}
          cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "4 4" }}
        />
        <Area
          type="monotone"
          dataKey="request_count"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#gradientVolume)"
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
