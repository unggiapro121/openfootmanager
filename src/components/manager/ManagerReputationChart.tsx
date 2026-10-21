import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ReputationChange } from "../../store/types";
import { useChartTheme } from "../ui/charts/chartTheme";
import { ChartContainer } from "../ui/charts/ChartContainer";

interface ManagerReputationChartProps {
  /** The season-end reviews, oldest first. */
  log: ReputationChange[];
  reputationLabel: string;
}

/** The user's reputation after each season's review, starting from where the first began. */
export function ManagerReputationChart({ log, reputationLabel }: ManagerReputationChartProps) {
  const theme = useChartTheme();

  if (log.length === 0) {
    return <ChartContainer isEmpty height={140} />;
  }

  const start = { season: `${log[0].season - 1}`, reputation: log[0].before };
  const data = [
    start,
    ...log.map((change) => ({ season: `${change.season}`, reputation: change.after })),
  ];

  return (
    <ChartContainer height={140}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} vertical={false} />
          <XAxis
            dataKey="season"
            tick={{ fill: theme.axisColor, fontSize: 9, fontFamily: "var(--font-heading)" }}
            axisLine={{ stroke: theme.gridColor }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 1000]}
            tick={{ fill: theme.axisColor, fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: 8,
              fontSize: 11,
              color: theme.tooltipText,
            }}
          />
          <Line
            type="monotone"
            dataKey="reputation"
            name={reputationLabel}
            stroke={theme.primary}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
