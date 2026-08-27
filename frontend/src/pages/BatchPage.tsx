import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'

export function BatchPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['batch', id], queryFn: () => api.getBatch(id) })
  if (query.isLoading) return <p>Loading batch…</p>
  if (!query.data) return <p>Batch not found.</p>
  const batch = query.data
  return <section className="space-y-6"><div><div className="text-sm text-slate-500">Batch</div><h1 className="text-3xl font-semibold">{batch.batch_code}</h1><p className="mt-1 text-slate-600">{batch.batch_name}</p></div><section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Samples</h2></div><div className="divide-y divide-slate-100">{batch.samples.length ? batch.samples.map(sample => <Link className="block px-5 py-3 text-blue-700 hover:bg-slate-50" key={sample.sample_id} to={`/sample/${sample.sample_id}`}>{sample.sample_code} <span className="text-slate-400">· {sample.sample_type || 'No type'} · {sample.status}</span></Link>) : <p className="px-5 py-4 text-sm text-slate-500">No samples in this batch.</p>}</div></section></section>
}