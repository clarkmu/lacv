export function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatQuantity(value: string | null | undefined, unit: string | null | undefined) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  const display = Number.isNaN(number) ? value : String(number)
  return unit ? `${display} ${unit}` : display
}

export function toDateTimeInput(value: string | null | undefined) {
  return value ? value.slice(0, 16) : ''
}
