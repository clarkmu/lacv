// How results are labelled and how a typed value is sent. Shared by result entry on Record assay and on the execution page.

export function resultLabel(result: { analyte: string | null; result_name: string }) {
  return result.analyte ? `${result.analyte} ${result.result_name}` : result.result_name
}

export type ResultDraft = { analyte: string; result_name: string; value: string; unit: string; interpretation: string; qc_status: string }

/** A typed value is a number when it reads as one (e.g. 31.2); anything else, such as "not detected", is kept as text. */
export function resultPayload(draft: ResultDraft) {
  const value = draft.value.trim()
  const isNumber = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value)
  return {
    analyte: draft.analyte || null, result_name: draft.result_name,
    numeric_value: isNumber ? value : null, text_value: isNumber ? null : value || null,
    unit: draft.unit || null, interpretation: draft.interpretation || null, qc_status: draft.qc_status,
  }
}
