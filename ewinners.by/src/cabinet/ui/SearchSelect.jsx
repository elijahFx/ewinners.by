import { useState } from 'react'
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react'
import { Check, ChevronDown, Search } from 'lucide-react'
import clsx from 'clsx'

/**
 * Выпадающий список с поиском.
 *
 * Совмещает два способа выбора: можно ввести часть названия и отфильтровать
 * список, а можно просто раскрыть его и выбрать глазами.
 */
export default function SearchSelect({
  value,
  onChange,
  options,
  getKey = (o) => o.id,
  getLabel = (o) => o.name,
  getHint,
  placeholder = 'Начните вводить название…',
  emptyText = 'Ничего не найдено',
}) {
  const [query, setQuery] = useState('')
  const selected = options.find((o) => String(getKey(o)) === String(value)) || null

  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? options.filter((o) =>
        `${getLabel(o)} ${getHint ? getHint(o) : ''}`.toLowerCase().includes(needle),
      )
    : options

  return (
    <Combobox
      value={selected}
      onChange={(option) => {
        onChange(option ? String(getKey(option)) : '')
        setQuery('')
      }}
    >
      <div className="relative">
        <div className="flex h-10 items-center rounded-lg border border-[#2a5f8f] bg-[#0c2344] pl-3 focus-within:ring-2 focus-within:ring-[#4ea8ff]/35">
          <Search aria-hidden className="size-4 shrink-0 text-[#9db8d4]" />
          <ComboboxInput
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm font-medium text-[#f3f8ff] outline-none placeholder:text-[#6f8bab]"
            displayValue={(o) => (o ? getLabel(o) : '')}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
          />
          <ComboboxButton className="flex h-full items-center px-2 text-[#9db8d4]">
            <ChevronDown aria-hidden className="size-4" />
          </ComboboxButton>
        </div>

        <ComboboxOptions
          anchor="bottom start"
          className="z-30 mt-1 max-h-72 w-[var(--input-width)] overflow-auto rounded-lg border border-[#2a5f8f] bg-[#0b1f3a] p-1 shadow-xl empty:invisible"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-[#9db8d4]">{emptyText}</div>
          ) : (
            filtered.map((option) => (
              <ComboboxOption
                key={getKey(option)}
                value={option}
                className={({ focus }) =>
                  clsx(
                    'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm',
                    focus ? 'bg-[#258dff] text-white' : 'text-[#cfe6ff]',
                  )
                }
              >
                {({ selected: isSelected }) => (
                  <>
                    <Check
                      aria-hidden
                      className={clsx('size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="min-w-0 flex-1 truncate">{getLabel(option)}</span>
                    {getHint ? (
                      <span className="shrink-0 text-xs text-[#9db8d4]">{getHint(option)}</span>
                    ) : null}
                  </>
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  )
}
