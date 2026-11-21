import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPlanDate, shiftDate, todayString } from "@/lib/utils";

export function DayNavigation({
  date,
  onChange,
  disabled = false,
}: {
  date: string;
  onChange: (date: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="day-navigation">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Previous day"
        onClick={() => onChange(shiftDate(date, -1))}
        disabled={disabled}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <label className="flex items-center gap-2 text-sm text-ink">
        <CalendarDays className="h-4 w-4 text-muted" aria-hidden="true" />
        <span className="sr-only">Plan date</span>
        <input
          className="day-navigation__date"
          type="date"
          title={formatPlanDate(date)}
          value={date}
          data-testid="selected-date"
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
          disabled={disabled}
        />
      </label>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Next day"
        onClick={() => onChange(shiftDate(date, 1))}
        disabled={disabled}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(todayString())}
        disabled={disabled || date === todayString()}
      >
        Today
      </Button>
    </div>
  );
}
