import { createContext, useContext } from 'react'

// Направления работы: у каждого свой счёт, банковские обороты и рабочее место.
export const DIRECTIONS = [
  { code: 'hr', label: 'HR' },
  { code: 'digital', label: 'Digital' },
  { code: 'kc', label: 'КЦ' },
]

export const DIRECTION_STORAGE_KEY = 'ew_direction'

export const DirectionContext = createContext({
  direction: 'hr',
  setDirection: () => {},
})

/** Текущее направление из сайдбара. */
export function useDirection() {
  return useContext(DirectionContext)
}
