import { Input } from '@headlessui/react'
import { Search } from 'lucide-react'
import clsx from 'clsx'

export default function SearchField({ className, inputClassName, ...props }) {
  return (
    <div
      className={clsx(
        'flex h-10 items-center gap-2 rounded-lg border border-transparent bg-white/[0.06] px-3',
        'focus-within:bg-white/[0.09] focus-within:ring-2 focus-within:ring-[#4ea8ff]/35',
        className,
      )}
    >
      <Search aria-hidden className="size-4 shrink-0 text-[#9db8d4]" strokeWidth={2} />
      <Input
        {...props}
        className={clsx(
          'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-[#f3f8ff]',
          'placeholder:text-[#6f8bab] outline-none',
          inputClassName,
        )}
      />
    </div>
  )
}
