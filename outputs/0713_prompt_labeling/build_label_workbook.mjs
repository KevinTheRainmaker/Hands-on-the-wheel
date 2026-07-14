import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("./", import.meta.url);
const uniqueCsvPath = new URL("0713_19명_user_prompts_labeled.csv", outputDir);
const summaryJsonPath = new URL("0713_19명_labeling_summary.json", outputDir);
const xlsxPath = new URL("0713_19명_user_prompts_labeled.xlsx", outputDir);
const previewPath = new URL("0713_19명_user_prompts_labeled_preview.png", outputDir);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function truncateCell(value) {
  if (typeof value !== "string") return value;
  return value.length > 32000 ? `${value.slice(0, 31980)}... [truncated]` : value;
}

const csvText = await fs.readFile(uniqueCsvPath, "utf8");
const rows = parseCsv(csvText.replace(/^\uFEFF/, "")).map((row) => row.map(truncateCell));
const summary = JSON.parse(await fs.readFile(summaryJsonPath, "utf8"));

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("Summary");
const promptSheet = workbook.worksheets.add("User Prompts");

summarySheet.getRange("A1:B8").values = [
  ["Metric", "Value"],
  ["Original rows", summary.total_original_rows],
  ["Unique user prompt turns", summary.unique_user_prompt_turns],
  ["Yes", summary.label_counts_unique_prompts.Yes ?? 0],
  ["No", summary.label_counts_unique_prompts.No ?? 0],
  ["Uncertain", summary.label_counts_unique_prompts.Uncertain ?? 0],
  ["Window rule", "Current turn plus previous 5 turns in same sessionId"],
  ["Non-prompt events", "code_run/code_submit/code_run_error are excluded from the unique prompt sheet"],
];

summarySheet.getRange("A1:B1").format = {
  fill: "#1F4E79",
  font: { bold: true, color: "#FFFFFF" },
};
summarySheet.getRange("A1:B8").format.borders = {
  preset: "all",
  style: "thin",
  color: "#D9E2F3",
};
summarySheet.getRange("A:A").format.columnWidth = 28;
summarySheet.getRange("B:B").format.columnWidth = 72;
summarySheet.freezePanes.freezeRows(1);
summarySheet.showGridLines = false;

promptSheet.getRangeByIndexes(0, 0, rows.length, rows[0].length).values = rows;
const header = promptSheet.getRangeByIndexes(0, 0, 1, rows[0].length);
header.format = {
  fill: "#305496",
  font: { bold: true, color: "#FFFFFF" },
};
promptSheet.getRangeByIndexes(0, 0, rows.length, rows[0].length).format.borders = {
  preset: "inside",
  style: "thin",
  color: "#E7E6E6",
};
promptSheet.getRange("A:A").format.columnWidth = 18;
promptSheet.getRange("B:B").format.columnWidth = 10;
promptSheet.getRange("C:C").format.columnWidth = 36;
promptSheet.getRange("D:D").format.columnWidth = 10;
promptSheet.getRange("E:E").format.columnWidth = 36;
promptSheet.getRange("F:F").format.columnWidth = 16;
promptSheet.getRange("G:G").format.columnWidth = 22;
promptSheet.getRange("H:H").format.columnWidth = 80;
promptSheet.getRange("I:I").format.columnWidth = 14;
promptSheet.getRange("J:J").format.columnWidth = 56;
promptSheet.getRange("K:K").format.columnWidth = 56;
promptSheet.getRange("L:L").format.columnWidth = 16;
promptSheet.getRange("H:K").format.wrapText = true;
promptSheet.freezePanes.freezeRows(1);
promptSheet.freezePanes.freezeColumns(4);
promptSheet.showGridLines = false;
promptSheet.tables.add(`A1:L${rows.length}`, true, "PromptLabels");

const preview = await workbook.render({
  sheetName: "Summary",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(fileURLToPath(xlsxPath));

console.log(JSON.stringify({
  xlsx: fileURLToPath(xlsxPath),
  preview: previewPath.pathname,
  rows: rows.length,
}, null, 2));
