/**
 * Generic CSV export utility.
 *
 * Usage:
 *   exportCSV(rows, { filename: "analytics.csv" });
 *   exportCSV(rows, { columns: ["date", "requests", "cost"], filename: "report.csv" });
 */

interface ExportCSVOptions {
  /** Filename for the downloaded CSV. Default: "export.csv" */
  filename?: string;
  /** Explicit ordered column keys. If omitted, all keys from the first row are used. */
  columns?: string[];
  /** Human-readable column headers. Defaults to the keys themselves. */
  headers?: Record<string, string>;
}

export function exportCSV<T extends Record<string, unknown>>(
  rows: T[],
  options: ExportCSVOptions = {},
): void {
  if (rows.length === 0) return;

  const {
    filename = "export.csv",
    columns = Object.keys(rows[0]),
    headers = {},
  } = options;

  // Header row
  const headerLine = columns
    .map((col) => escapeCell(headers[col] ?? col))
    .join(",");

  // Data rows
  const dataLines = rows.map((row) =>
    columns.map((col) => escapeCell(String(row[col] ?? ""))).join(","),
  );

  const csv = [headerLine, ...dataLines].join("\n");

  // Trigger download
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCell(value: string): string {
  // If the value contains commas, quotes, or newlines, wrap in quotes
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
