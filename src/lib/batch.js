// Helpers for bulk ("batch") input.

// Parse pasted text into rows of trimmed cells.
// One record per line; cells separated by a TAB or a comma — so pasting
// straight from a spreadsheet works, and so does plain comma-separated text.
// Blank lines are ignored.
export function parseBatchText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\t|,/).map((cell) => cell.trim()));
}

// Split an array into chunks of at most `size`. Firestore writeBatch commits
// are capped at 500 operations, so large imports are committed in chunks.
export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}
