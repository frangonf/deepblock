import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayString() {
  return formatLocalDate(new Date());
}

export function shiftDate(date: string, deltaDays: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + deltaDays);
  return formatLocalDate(next);
}

export function parseTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours * 60) + minutes;
}

export function formatTime(totalMinutes: number) {
  const minutesInDay = 24 * 60;
  const normalized = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainder}m`;
}

export function getScoreTone(score: number) {
  if (score >= 80) {
    return 'status-success';
  }
  if (score >= 60) {
    return 'status-info';
  }
  if (score >= 40) {
    return 'status-warning';
  }
  return 'status-danger';
}

export function formatPlanDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
