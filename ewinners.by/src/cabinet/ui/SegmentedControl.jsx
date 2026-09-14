import clsx from 'clsx'
import Button from './Button'

/**
 * Filter / section switcher built from the shared Button component
 * (no separate tab chrome — same look as action buttons).
 */
export default function SegmentedControl({
  items,
  value,
  onChange,
  className,
  size = 'sm',
}) {
  return (
    <div
      role="tablist"
      className={clsx('flex flex-wrap items-center gap-2', className)}
    >
      {items.map((item) => {
        const selected = item.id === value
        const Icon = item.icon
        return (
          <Button
            key={item.id || 'all'}
            type="button"
            role="tab"
            aria-selected={selected}
            size={size}
            variant={selected ? 'primary' : 'secondary'}
            onClick={() => onChange(item.id)}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}
