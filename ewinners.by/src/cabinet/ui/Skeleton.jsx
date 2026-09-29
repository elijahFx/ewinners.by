import clsx from 'clsx'

/**
 * Плейсхолдер на время загрузки данных.
 * Помечен aria-hidden: состояние загрузки озвучивает контейнер с aria-busy.
 */
export default function Skeleton({ className }) {
  return (
    <span
      aria-hidden="true"
      className={clsx('block animate-pulse rounded-md bg-white/[0.09]', className)}
    />
  )
}
