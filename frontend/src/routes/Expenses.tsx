import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { useDeleteExpense, useFetchRate, usePutExpense, useTripBundle } from '../api/trips'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type PaymentMethod } from '../api/types'
import { AppBar } from '../components/AppBar'
import { Fab } from '../components/Fab'
import { t } from '../i18n'
import { expenseCategoryLabel, paymentLabel } from '../i18n/labels'
import { byDay, formatMoney, summarise } from '../lib/budget'
import { formatCalendarDate } from '../lib/datetime'

const PAUSE_MS = 250

function AddExpense({
  tripId,
  defaultCurrency,
  defaultDate,
  onDone,
}: {
  tripId: string
  defaultCurrency: string
  defaultDate: string
  onDone: () => void
}) {
  const save = usePutExpense(tripId)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [spentAt, setSpentAt] = useState(defaultDate)
  const [category, setCategory] = useState<ExpenseCategory>('food')
  const [payment, setPayment] = useState<PaymentMethod>('cash')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!description.trim() || !amount) return
    save.mutate(
      {
        // The id is minted here, not by the server: that is what makes a
        // replayed write after a tunnel land as one expense, not two.
        id: crypto.randomUUID(),
        description: description.trim(),
        amount,
        currency: currency.toUpperCase(),
        spent_at: spentAt,
        category,
        payment_method: payment,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">{t('money.field.description')}</span>
        <input
          className="field__input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          autoFocus
          required
        />
      </label>

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('money.field.amount')}</span>
          <input
            className="field__input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">{t('money.field.currency')}</span>
          <input
            className="field__input"
            value={currency}
            maxLength={3}
            style={{ width: '7ch' }}
            onChange={(event) => setCurrency(event.target.value)}
            required
          />
        </label>
      </div>

      <div className="row">
        <label className="field field--grow">
          <span className="field__label">{t('money.field.date')}</span>
          <input
            className="field__input"
            type="date"
            value={spentAt}
            onChange={(event) => setSpentAt(event.target.value)}
            required
          />
        </label>
        <label className="field field--grow">
          <span className="field__label">{t('money.field.category')}</span>
          <select
            className="field__input"
            value={category}
            onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
          >
            {EXPENSE_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {expenseCategoryLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--grow">
          <span className="field__label">{t('money.field.payment')}</span>
          <select
            className="field__input"
            value={payment}
            onChange={(event) => setPayment(event.target.value as PaymentMethod)}
          >
            <option value="cash">{paymentLabel('cash')}</option>
            <option value="card">{paymentLabel('card')}</option>
          </select>
        </label>
      </div>

      {save.error && (
        <p className="field__error" role="alert">
          {save.error.message || t('common.error')}
        </p>
      )}

      <div className="row row--end">
        <button type="button" className="button button--quiet" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

export function Expenses() {
  const { tripId } = useParams<{ tripId: string }>()
  const bundle = useTripBundle(tripId)
  const save = usePutExpense(tripId ?? '')
  const remove = useDeleteExpense(tripId ?? '')
  const fetchRate = useFetchRate()

  const [adding, setAdding] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [found, setFound] = useState<number | null>(null)

  if (bundle.isPending) return <main className="page">{t('common.loading')}</main>
  if (!bundle.data || !tripId) return <main className="page">{t('common.error')}</main>

  const { trip, expenses } = bundle.data
  const summary = summarise(expenses, trip)
  const missingRate = expenses.filter(
    (expense) => expense.currency !== trip.primary_currency && !expense.rate,
  )

  /** Fill in the conversion rates that were unavailable at the till. */
  async function findRates() {
    setProgress({ done: 0, total: missingRate.length })
    let hits = 0

    for (const [index, expense] of missingRate.entries()) {
      try {
        const rate = await fetchRate.mutateAsync({
          base: expense.currency,
          quote: trip.primary_currency,
          on: expense.spent_at,
        })
        await save.mutateAsync({
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency,
          spent_at: expense.spent_at,
          category: expense.category,
          payment_method: expense.payment_method,
          stop_id: expense.stop_id,
          booking_id: expense.booking_id,
          notes: expense.notes,
          rate: String(rate.rate),
          // The date the rate is really from: the ECB does not publish at
          // weekends, so a Saturday coffee converts at Friday's rate.
          rate_date: rate.date,
          rate_source: rate.source,
        })
        hits += 1
      } catch {
        // One missing day should not stop the other twenty.
      }
      setProgress({ done: index + 1, total: missingRate.length })
      await new Promise((done) => setTimeout(done, PAUSE_MS))
    }

    setProgress(null)
    setFound(hits)
  }

  const over = summary.remaining !== null && summary.remaining < 0

  return (
    <>
      <AppBar title={t('money.title')} subtitle={trip.title} back={`/trips/${tripId}`} />
      <main className="page stack">

      <section className="card stack stack--tight">
        <div className="totals">
          <div>
            <span className="detail__label">{t('money.spent')}</span>
            <span className="totals__big">
              {formatMoney(summary.converted, trip.primary_currency)}
            </span>
          </div>
          {summary.budget !== null && (
            <div>
              <span className="detail__label">{over ? t('money.over') : t('money.remaining')}</span>
              <span className={`totals__big ${over ? 'totals__big--over' : ''}`}>
                {formatMoney(Math.abs(summary.remaining ?? 0), trip.primary_currency)}
              </span>
            </div>
          )}
        </div>

        {summary.budget !== null && (
          <div
            className="meter"
            role="progressbar"
            aria-valuenow={Math.round((summary.converted / summary.budget) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className={`meter__fill ${over ? 'meter__fill--over' : ''}`}
              style={{ width: `${Math.min(100, (summary.converted / summary.budget) * 100)}%` }}
            />
          </div>
        )}

        {summary.byCurrency.length > 1 && (
          <p className="muted small">
            {summary.byCurrency
              .map((entry) => formatMoney(entry.total, entry.currency))
              .join(' · ')}
          </p>
        )}
      </section>

      {summary.unconverted > 0 && (
        <div className="stack stack--tight">
          <p className="hint">{t('money.unconverted', { count: summary.unconverted })}</p>
          {progress ? (
            <p className="muted small">
              {t('money.findingRates', { done: progress.done, total: progress.total })}
            </p>
          ) : (
            <button className="button button--quiet" onClick={() => void findRates()}>
              {t('money.findRates')}
            </button>
          )}
        </div>
      )}

      {found !== null && !progress && (
        <p className="muted small">
          {t('money.ratesFound', { found, total: found + summary.unconverted })}
        </p>
      )}

      {adding && (
        <AddExpense
          tripId={tripId}
          defaultCurrency={trip.primary_currency}
          defaultDate={new Date().toISOString().slice(0, 10)}
          onDone={() => setAdding(false)}
        />
      )}

      {expenses.length === 0 && !adding && <p className="empty">{t('money.none')}</p>}

      {byDay(expenses).map((group) => (
        <section key={group.day} className="day">
          <h2 className="day__header">
            <span className="day__date">{formatCalendarDate(group.day)}</span>
          </h2>
          <ul className="docs">
            {group.items.map((expense) => (
              <li key={expense.id} className="doc">
                <span className="doc__open" style={{ cursor: 'default' }}>
                  <span className="doc__name">{expense.description}</span>
                  <span className="doc__meta">
                    {expenseCategoryLabel(expense.category)} ·{' '}
                    {paymentLabel(expense.payment_method)}
                    {expense.rate_date && ` · ${t('money.rateNote', { date: expense.rate_date })}`}
                  </span>
                </span>
                <span className="doc__amount">
                  {formatMoney(Number(expense.amount), expense.currency)}
                </span>
                <button
                  className="chip chip--danger"
                  onClick={() =>
                    confirm(t('common.confirmDelete', { name: expense.description })) &&
                    remove.mutate(expense.id)
                  }
                  aria-label={t('common.delete')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </main>
      {!adding && <Fab onClick={() => setAdding(true)} label={t('money.add')} />}
    </>
  )
}
