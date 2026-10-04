/** Round to cents. All money in this app is two-decimal. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseLocaleNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, "").replace(/[€$]/g, "");
  if (!trimmed || trimmed === "-" || trimmed === "+" ) {
    return null;
  }

  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  let normalized = trimmed;

  if (lastComma > lastDot) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = trimmed.replace(/,/g, "");
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return null;
  }
  return money(value);
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = money(Math.abs(value));
  const [whole, fraction = "00"] = abs.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${fraction}`;
}

export function canonicalKeys(value: number): string[] {
  const rounded = money(value);
  const two = rounded.toFixed(2);
  const keys = new Set<string>([two, formatMoney(rounded)]);
  if (Number.isInteger(rounded)) {
    keys.add(String(rounded));
  }
  return [...keys];
}
