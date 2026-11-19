// The Samples list's light grouping by shipping batch. Membership is the Sample's own batch (samples.batch_id, from the
// API); nothing is inferred from codes or lineage. A blank Batch cell must always mean "same batch as the row above".

type Batched = { sample_id: number; sample_code: string; batch: { batch_id: number } | null }

/**
 * The default order: batches newest first (the highest batch id was created last), each batch's Samples together by
 * code (natural order, so S-2 comes before S-10), then Samples with no batch in the order the API gave (newest first).
 * A sort the user picks in the table replaces this order.
 */
export function batchFriendlyOrder<T extends Batched>(samples: T[]): T[] {
  const batched = samples.filter(sample => sample.batch !== null)
  const unbatched = samples.filter(sample => sample.batch === null)
  batched.sort((left, right) => right.batch!.batch_id - left.batch!.batch_id
    || left.sample_code.localeCompare(right.sample_code, undefined, { numeric: true, sensitivity: 'base' }))
  return [...batched, ...unbatched]
}

/**
 * Whether this row continues the batch of the row displayed directly above it, so its Batch cell may be left blank.
 * Never true for a Sample without a batch: unbatched Samples are not a group.
 */
export function continuesBatch(row: Batched, previous: Batched | undefined) {
  return Boolean(row.batch && previous?.batch && previous.batch.batch_id === row.batch.batch_id)
}
