import { Button as HuiButton } from '@headlessui/react'
import clsx from 'clsx'

const variants = {
  primary:
    'border border-transparent bg-[#258dff] text-white hover:bg-[#1f7ae6] data-hover:bg-[#1f7ae6]',
  secondary:
    'border border-transparent bg-white/[0.06] text-[#d7e9ff] hover:bg-white/[0.11] data-hover:bg-white/[0.11]',
  success:
    'border border-transparent bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25 data-hover:bg-emerald-400/25',
  ghost:
    'border border-transparent bg-transparent text-[#9db8d4] hover:bg-white/[0.06] hover:text-[#eaf4ff] data-hover:bg-white/[0.06] data-hover:text-[#eaf4ff]',
}

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...props
}) {
  return (
    <HuiButton
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition',
        'outline-none focus-visible:ring-2 focus-visible:ring-[#4ea8ff]/40 focus-visible:ring-offset-0',
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        variants[variant] || variants.secondary,
        sizes[size] || sizes.md,
        className,
      )}
    >
      {children}
    </HuiButton>
  )
}
