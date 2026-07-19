const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

export function utcDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function validateAdrDate(value, today = utcDate()) {
  if (!datePattern.test(value)) {
    return "date must use YYYY-MM-DD";
  }

  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || utcDate(parsed) !== value) {
    return "date is not a real calendar day";
  }
  if (value > today) return `date is in the future (today is ${today})`;
  return null;
}
