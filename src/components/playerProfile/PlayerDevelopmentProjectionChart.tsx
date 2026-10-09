import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProjectionPoint } from "../../store/types";
import { useChartTheme } from "../ui/charts/chartTheme";
import { ChartContainer } from "../ui/charts/ChartContainer";

interface PlayerDevelopmentProjectionChartProps {
  points: ProjectionPoint[];
  expectedLabel: string;
  rangeLabel: string;
  ageLabel: string;
}

/** The projected overall by age: the expected line inside the low–high band. */
export default function PlayerDevelopmentProjectionChart({
  points,
  expectedLabel,
  rangeLabel,
  ageLabel,
}: PlayerDevelopmentProjectionChartProps) {
  const theme = useChartTheme();
  if (points.length < 2) {
    return <ChartContainer isEmpty height={160} />;
  }

  const data = points.map((point) => ({
    age: point.age,
    expected: point.expected,
    range: [point.low, point.high],
  }));
  const lowest = Math.min(...points.map((point) => point.low));
  const highest = Math.max(...points.map((point) => point.high));

  return (
    <ChartContainer height={160}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} vertical={false} />
          <XAxis
            dataKey="age"
            tick={{ fill: theme.axisColor, fontSize: 9, fontFamily: "var(--font-heading)" }}
            axisLine={{ stroke: theme.gridColor }}
            tickLine={false}
          />
          <YAxis
            domain={[Math.max(1, lowest - 5), Math.min(99, highest + 5)]}
            tick={{ fill: theme.axisColor, fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: 8,
              fontSize: 11,
              color: theme.tooltipText,
            }}
            labelFormatter={(label) => `${ageLabel} ${label}`}
            formatter={(value, name) =>
              Array.isArray(value)
                ? [`${value[0]}–${value[1]}`, rangeLabel]
                : [String(value ?? ""), name === "expected" ? expectedLabel : String(name)]
            }
          />
          <Area
            type="monotone"
            dataKey="range"
            stroke="none"
            fill={theme.primary}
            fillOpacity={0.15}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke={theme.primary}
            strokeWidth={2}
            dot={{ r: 3, fill: theme.primary }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
