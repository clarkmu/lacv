import type {
  AssayDefinitionDetail, AssayDefinitionDraft, AssayDefinitionListItem, AssayExecution, BatchDetail, ExecutionImportPreview, ExecutionSampleDraft,
  BatchListItem, BatchSampleImportPreview, BatchSampleImportRow, ProcessEventDetail, SampleDetail, SampleLineage, SampleListItem, SampleMap, SampleRef, SampleType,
  StorageLocation, StorageLocationDetail, TemplateDoc,
} from './types'

const API = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isMultipart = options?.body instanceof FormData
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      headers: isMultipart ? options?.headers : { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    })
  } catch {
    throw new ApiError('Could not reach the LACV server. Check the network connection and try again; nothing was saved.')
  }
  if (!response.ok) throw await readError(response)
  if (response.status === 204) return undefined as T
  return response.json()
}

/** One located problem from a validation error: path is the request path without "body" (e.g. ["samples", 2, "collection_date"]). */
export type ApiProblem = { path: (string | number)[]; message: string }

/**
 * An API failure. message is a sentence for the user. fieldErrors maps a request field (e.g. "volume_used"), and its
 * full path (e.g. "samples.2.collection_date"), to its message, so forms can show it in place.
 */
export class ApiError extends Error {
  fieldErrors: Record<string, string>
  problems: ApiProblem[]
  status: number

  constructor(message: string, fieldErrors: Record<string, string> = {}, problems: ApiProblem[] = [], status = 0) {
    super(message)
    this.fieldErrors = fieldErrors
    this.problems = problems
    this.status = status
  }
}

/** "collection_date" → "Collection date"; a list index is a row, counted from 1. */
function describePath(path: (string | number)[]) {
  const parts = path.map(part => (typeof part === 'number' ? `row ${part + 1}` : part.replace(/_/g, ' ')))
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// The backend writes these messages for people; only fall back to the raw text when the response is not ours.
export async function readError(response: Response) {
  const text = await response.text()
  try {
    const body = JSON.parse(text)
    if (typeof body.detail === 'string') return new ApiError(body.detail, {}, [], response.status)
    if (body.detail && typeof body.detail.message === 'string') {
      return new ApiError([body.detail.message, ...(body.detail.problems ?? [])].join('. '), {}, [], response.status)
    }
    if (Array.isArray(body.detail)) {
      const items = body.detail as { loc?: (string | number)[]; msg: string }[]
      const problems = items.map(item => ({ path: (item.loc ?? []).filter((part, index) => !(index === 0 && part === 'body')), message: item.msg.replace(/^Value error, /, '') }))
      const fieldErrors: Record<string, string> = {}
      for (const problem of problems.filter(problem => problem.path.length > 0)) {
        fieldErrors[String(problem.path.at(-1))] ??= problem.message
        fieldErrors[problem.path.join('.')] = problem.message
      }
      const message = problems.map(problem => (problem.path.length ? `${describePath(problem.path)}: ${problem.message}` : problem.message)).join('; ')
      return new ApiError(message, fieldErrors, problems, response.status)
    }
  } catch {
    // Not JSON (e.g. a proxy error page); fall through to a plain message.
  }
  if (response.status >= 500 || !text || text.trimStart().startsWith('<')) {
    return new ApiError(`The server could not complete the request (${response.status} ${response.statusText || 'error'}). Nothing was saved; try again, and if it keeps happening tell the LACV administrator.`, {}, [], response.status)
  }
  return new ApiError(text, {}, [], response.status)
}

function formWith(file: File) {
  const body = new FormData()
  body.append('file', file)
  return body
}

const post = <T>(path: string, payload: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(payload) })
const patch = <T>(path: string, payload: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) })

export const api = {
  listBatches: () => request<BatchListItem[]>('/batches'),
  getBatch: (id: string | number) => request<BatchDetail>(`/batches/${id}`),
  updateBatchSamples: (batchId: number, payload: { changes: Record<string, unknown>[]; operator_name?: string | null; change_notes?: string | null }) => patch<BatchDetail>(`/batches/${batchId}/samples`, payload),
  previewSampleBatchImport: (file: File) => request<BatchSampleImportPreview>('/batches/sample-import/preview', { method: 'POST', headers: {}, body: formWith(file) }),
  createSampleBatch: (payload: { batch_name: string; samples: BatchSampleImportRow[] }) => post<BatchDetail>('/batches/sample-import', payload),
  batchTemplateUrl: () => `${API}/batches/sample-template`,
  describeBatchTemplate: () => request<TemplateDoc>('/batches/sample-template/columns'),

  listSamples: (options: { rootOnly?: boolean } = {}) => request<SampleListItem[]>(options.rootOnly ? '/samples?root_only=true' : '/samples'),
  lookupSample: (code: string) => request<SampleRef>(`/samples/lookup?code=${encodeURIComponent(code)}`),
  getSample: (id: string | number) => request<SampleDetail>(`/samples/${id}`),
  getSampleLineage: (id: string | number) => request<SampleLineage>(`/samples/${id}/lineage`),
  getSampleMap: () => request<SampleMap>('/samples/map'),
  createSample: (payload: Record<string, unknown>) => post<SampleDetail>('/samples', payload),
  createChildSample: (parentId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${parentId}/children`, payload),
  updateSample: (id: number, changes: Record<string, unknown>) => patch<SampleDetail>(`/samples/${id}`, changes),
  deleteSample: (id: number) => request<void>(`/samples/${id}`, { method: 'DELETE' }),
  createAliquots: (sampleId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${sampleId}/aliquots`, payload),
  attachDataFile: (sampleId: number, payload: Record<string, unknown>) => post<SampleDetail>(`/samples/${sampleId}/data-files`, payload),

  listSampleTypes: () => request<SampleType[]>('/sample-types'),
  createSampleType: (payload: { type_name: string }) => post<SampleType>('/sample-types', payload),

  createProcessEvent: (payload: Record<string, unknown>) => post<ProcessEventDetail>('/process-events', payload),

  listAssayDefinitions: (options: { activeOnly?: boolean } = {}) => request<AssayDefinitionListItem[]>(options.activeOnly ? '/assay-definitions?active_only=true' : '/assay-definitions'),
  getAssayDefinition: (id: string | number) => request<AssayDefinitionDetail>(`/assay-definitions/${id}`),
  createAssayDefinition: (payload: AssayDefinitionDraft) => post<AssayDefinitionDetail>('/assay-definitions', payload),
  /** One execution with all its Samples, saved together or not at all. */
  createAssayExecution: (definitionId: number, payload: { execution_name?: string | null; assay_date?: string | null; operator_name?: string | null; notes?: string | null; samples: ExecutionSampleDraft[] }) =>
    post<AssayExecution>(`/assay-definitions/${definitionId}/executions`, payload),
  previewExecutionImport: (definitionId: number, file: File) =>
    request<ExecutionImportPreview>(`/assay-definitions/${definitionId}/executions/import/preview`, { method: 'POST', headers: {}, body: formWith(file) }),
  executionTemplateUrl: (definitionId: number) => `${API}/assay-definitions/${definitionId}/executions/import-template`,
  describeExecutionTemplate: (definitionId: number) => request<TemplateDoc>(`/assay-definitions/${definitionId}/executions/import-template/columns`),

  listPerformedBy: () => request<string[]>('/assay-executions/performed-by'),
  updateAssayExecution: (executionId: number, changes: Record<string, unknown>) => patch<AssayExecution>(`/assay-executions/${executionId}`, changes),
  addExecutionSample: (executionId: number, payload: ExecutionSampleDraft) => post<AssayExecution>(`/assay-executions/${executionId}/samples`, payload),
  /** Enter, change or clear one result field of one Sample; only the parts sent change. The backend decides number or text. */
  updateExecutionResult: (executionId: number, sampleId: number, fieldId: number, changes: { value?: string | null; interpretation?: string | null; qc_status?: string }) =>
    patch<AssayExecution>(`/assay-executions/${executionId}/samples/${sampleId}/results/${fieldId}`, changes),
  removeExecutionSample: (executionId: number, sampleId: number) => request<AssayExecution>(`/assay-executions/${executionId}/samples/${sampleId}`, { method: 'DELETE' }),

  listStorageLocations: () => request<StorageLocation[]>('/storage-locations'),
  getStorageLocation: (id: string | number) => request<StorageLocationDetail>(`/storage-locations/${id}`),
  createStorageLocation: (payload: Record<string, unknown>) => post<StorageLocation>('/storage-locations', payload),
  updateStorageLocation: (id: number, changes: Record<string, unknown>) => patch<StorageLocation>(`/storage-locations/${id}`, changes),
}
