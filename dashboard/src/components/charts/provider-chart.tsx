"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { ProviderStats } from "@/lib/types";

const PROVIDER_HEX: Record<string, string> = {
  openai: "#22c55e",
  anthropic: "#f97316",
  google: "#3b82f6",
  mistral: "#a855f7",
  azure: "#06b6d4",
};

const PROVIDER_FILL = (provider: string) =>
  PROVIDER_HEX[provider] ?? "#8b5cf6";

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

interface ProviderChartProps {
  data: ProviderStats[];
}

export default function ProviderChart({ data }: ProviderChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No provider data yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 4, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="provider"
          tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          width={80}
        />
        <Tooltip
          content={<ChartTooltip suffix="requests" />}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
        />
        <Bar
          dataKey="request_count"
          radius={[0, 4, 4, 0]}
          animationDuration={600}
        >
          {data.map((entry) => (
            <Cell
              key={entry.provider}
              fill={PROVIDER_FILL(entry.provider)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
