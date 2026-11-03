// How a Sample's result in an execution is shown, and how a link points at one execution on its assay's page.

export function resultText(row: { result_numeric?: string | null; result_text?: string | null }) {
  if (row.result_numeric !== null && row.result_numeric !== undefined) return String(Number(row.result_numeric))
  return row.result_text ?? ''
}

/** The assay's page, scrolled to one execution. */
export function executionHref(execution: { assay_definition_id: number; assay_execution_id: number }) {
  return `/assays/${execution.assay_definition_id}#execution-${execution.assay_execution_id}`
}
