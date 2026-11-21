import { useSearchParams } from "react-router-dom";
import { todayString } from "@/lib/utils";

export function validPlanDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return todayString();
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(value.slice(0, 4)) &&
    date.getMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getDate() === Number(value.slice(8, 10))
    ? value
    : todayString();
}

export function useSelectedDate() {
  const [params, setParams] = useSearchParams();
  const date = validPlanDate(params.get("date"));
  const setDate = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("date", validPlanDate(value));
    setParams(next);
  };
  return [date, setDate] as const;
}
