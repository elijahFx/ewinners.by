import { Navigate } from 'react-router-dom'
import { useDirection } from './DirectionContext'

/**
 * Глобальные разделы (почта, пользователи, счета, документы…) относятся к КЦ.
 * В HR/Digital их не показываем и не открываем по прямой ссылке — возвращаем
 * на рабочее место выбранного направления.
 */
export default function DirectionGuard({ children }) {
  const { direction } = useDirection()
  if (direction !== 'kc') {
    return <Navigate to={`/cabinet/admin/direction/${direction}`} replace />
  }
  return children
}
