// How a Sample's result in an execution is shown, and how a link points at one execution on its assay's page.

/** A result value as shown and edited: a number without trailing zeros, or the text. */
export function valueText(result: { numeric_value: string | null; text_value: string | null } | undefined) {
  if (!result) return ''
  if (result.numeric_value !== null) return String(Number(result.numeric_value))
  return result.text_value ?? ''
}

/** The assay's page, scrolled to one execution. */
export function executionHref(execution: { assay_definition_id: number; assay_execution_id: number }) {
  return `/assays/${execution.assay_definition_id}#execution-${execution.assay_execution_id}`
}
