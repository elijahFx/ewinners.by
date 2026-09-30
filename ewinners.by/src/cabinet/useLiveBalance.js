import { useEffect, useRef } from 'react'

/**
 * Перечитывает данные, когда у клиента меняется баланс.
 *
 * Сервер присылает по сокету событие `balance:changed`, CabinetLayout
 * превращает его в window-событие, а страницы подписываются через этот хук —
 * так баланс обновляется без перезагрузки страницы.
 */
export default function useLiveBalance(reload) {
  const saved = useRef(reload)
  saved.current = reload

  useEffect(() => {
    const handler = () => {
      if (typeof saved.current === 'function') saved.current()
    }
    window.addEventListener('ew-balance-changed', handler)
    return () => window.removeEventListener('ew-balance-changed', handler)
  }, [])
}
