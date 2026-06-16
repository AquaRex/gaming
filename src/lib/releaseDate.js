// Helpers for fuzzy release dates.
// We store an anchor `release_date` (ISO date or null) plus a `release_precision`
// of 'day' | 'month' | 'year' | 'unknown'. From that we derive a display string
// and a sortable key (unknowns always sort last).

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const PRECISIONS = ['day', 'month', 'year', 'unknown']

export function formatReleaseDate(date, precision) {
  if (!date || precision === 'unknown') return 'TBA'
  // date is 'YYYY-MM-DD'
  const [y, m, d] = date.split('-').map(Number)
  if (precision === 'year') return String(y)
  if (precision === 'month') return `${MONTHS[m - 1]} ${y}`
  return `${d} ${MONTHS[m - 1]} ${y}` // day precision
}

// Sort key: unknown -> Infinity (sorts last on ascending). Otherwise a number
// derived from the date so partial dates still order sensibly.
export function releaseSortKey(date, precision) {
  if (!date || precision === 'unknown') return Number.POSITIVE_INFINITY
  const [y, m, d] = date.split('-').map(Number)
  return y * 10000 + (precision === 'year' ? 0 : m) * 100 + (precision === 'day' ? d : 0)
}

// Build the {release_date, release_precision} pair from the admin form inputs.
// year required for anything but 'unknown'; month required for month/day; day for day.
export function buildReleaseDate({ precision, year, month, day }) {
  if (precision === 'unknown' || !year) {
    return { release_date: null, release_precision: 'unknown' }
  }
  const y = String(year).padStart(4, '0')
  const m = String(precision === 'year' ? 1 : month || 1).padStart(2, '0')
  const d = String(precision === 'day' ? day || 1 : 1).padStart(2, '0')
  return { release_date: `${y}-${m}-${d}`, release_precision: precision }
}

// Reverse: turn a stored row back into form fields.
export function releaseToForm(date, precision) {
  if (!date || precision === 'unknown') {
    return { precision: 'unknown', year: '', month: '', day: '' }
  }
  const [y, m, d] = date.split('-').map(Number)
  return {
    precision,
    year: String(y),
    month: precision === 'year' ? '' : String(m),
    day: precision === 'day' ? String(d) : '',
  }
}

export { MONTHS }
