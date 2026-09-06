import { useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";

type Props = {
  name: string;
  label: string;
  defaultValue?: string | null;
  locale: Locale;
};

function parseIsoDate(value?: string | null) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return {
    year: match?.[1] ?? "",
    month: match?.[2] ?? "",
    day: match?.[3] ?? "",
  };
}

export function BirthDateField({ name, label, defaultValue, locale }: Props) {
  const initial = useMemo(() => parseIsoDate(defaultValue), [defaultValue]);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  const currentYear = new Date().getFullYear();
  const maxDay = useMemo(() => {
    if (!year || !month) return 31;
    return new Date(Number(year), Number(month), 0).getDate();
  }, [year, month]);

  useEffect(() => {
    if (day && Number(day) > maxDay) {
      setDay(String(maxDay).padStart(2, "0"));
    }
  }, [day, maxDay]);

  const value = year && month && day ? `${year}-${month}-${day}` : "";

  return (
    <label className="birth-date-field">
      <span>{label}</span>
      <div className="birth-date-selects">
        <select aria-label={locale === "es" ? "Día" : "Day"} value={day} onChange={(event) => setDay(event.target.value)}>
          <option value="">{locale === "es" ? "Día" : "Day"}</option>
          {Array.from({ length: maxDay }, (_, index) => {
            const value = String(index + 1).padStart(2, "0");
            return <option value={value} key={value}>{index + 1}</option>;
          })}
        </select>
        <select aria-label={locale === "es" ? "Mes" : "Month"} value={month} onChange={(event) => setMonth(event.target.value)}>
          <option value="">{locale === "es" ? "Mes" : "Month"}</option>
          {Array.from({ length: 12 }, (_, index) => {
            const value = String(index + 1).padStart(2, "0");
            return <option value={value} key={value}>{index + 1}</option>;
          })}
        </select>
        <select aria-label={locale === "es" ? "Año" : "Year"} value={year} onChange={(event) => setYear(event.target.value)}>
          <option value="">{locale === "es" ? "Año" : "Year"}</option>
          {Array.from({ length: currentYear - 1899 }, (_, index) => {
            const value = String(currentYear - index);
            return <option value={value} key={value}>{value}</option>;
          })}
        </select>
      </div>
      <input type="hidden" name={name} value={value} readOnly />
    </label>
  );
}
