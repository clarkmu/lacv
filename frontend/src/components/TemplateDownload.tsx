import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { errorClass, sectionTitleClass } from './common'
import type { TemplateDoc } from '../types'

/**
 * A template download that first explains the template's columns. The explanation comes from the backend, from the same
 * column list the importer reads, so it describes exactly what an upload is checked against.
 */
export function TemplateDownload({ label, templateUrl, queryKey, loadDoc, className, compact = false }: {
  label: string
  templateUrl: string
  queryKey: unknown[]
  loadDoc: () => Promise<TemplateDoc>
  className?: string
  /** A small text link, for toolbars. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const doc = useQuery({ queryKey, queryFn: loadDoc, enabled: open })
  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} className={cn('inline-flex items-center gap-1 rounded-sm text-xs text-primary underline-offset-2 hover:underline', className)}>
          <Download aria-hidden="true" className="size-3" />{label}
        </button>
      ) : (
        <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)}><Download aria-hidden="true" />{label}</Button>
      )}
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><FileSpreadsheet aria-hidden="true" className="size-4 text-muted-foreground" />{doc.data?.title ?? 'Template'}</DialogTitle>
              <DialogDescription>
                What each column means and how to fill it in. Columns marked <span className="font-semibold text-foreground">*</span> are required; all others are optional and may be left blank.
              </DialogDescription>
            </DialogHeader>
            <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
              {doc.isLoading && <p className="text-sm text-muted-foreground">Loading the column guide…</p>}
              {doc.error && <p role="alert" className={errorClass}>Could not load the column guide ({doc.error.message}). The template can still be downloaded.</p>}
              {doc.data?.sheets.map(sheet => (
                <section key={sheet.name} aria-label={`${sheet.name} sheet columns`} className="space-y-1.5">
                  <h3 className={sectionTitleClass}>{sheet.name} sheet</h3>
                  <p className="text-xs text-muted-foreground">{sheet.description}</p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-[13px]">
                      <thead className="bg-muted/60 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        <tr>
                          <th scope="col" className="px-2.5 py-1.5">Column</th>
                          <th scope="col" className="px-2.5 py-1.5">Required</th>
                          <th scope="col" className="px-2.5 py-1.5">Meaning</th>
                          <th scope="col" className="px-2.5 py-1.5">Format</th>
                          <th scope="col" className="px-2.5 py-1.5">Example</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.columns.map(column => (
                          <tr key={column.name} className="border-t align-top">
                            <td className="px-2.5 py-1.5 font-mono text-xs font-medium whitespace-nowrap">
                              {column.header}
                              {!column.in_template && <span className="block font-sans text-[11px] font-normal text-muted-foreground">not in the template; add if needed</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-xs whitespace-nowrap">{column.required ? <span className="font-semibold text-foreground">Required</span> : <span className="text-muted-foreground">Optional</span>}</td>
                            <td className="min-w-56 px-2.5 py-1.5 text-xs">{column.description}</td>
                            <td className="min-w-40 px-2.5 py-1.5 text-xs text-muted-foreground">{column.format}</td>
                            <td className="px-2.5 py-1.5 font-mono text-xs whitespace-nowrap">{column.example}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
              {doc.data && doc.data.notes.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{doc.data.notes.map(note => <li key={note}>{note}</li>)}</ul>
              )}
            </div>
            <DialogFooter className="border-t pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
              <Button asChild size="sm">
                <a href={templateUrl} download={doc.data?.file_name ?? ''} onClick={() => setOpen(false)}><Download aria-hidden="true" />Download template</a>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
