import { useCallback, useEffect, useRef, useState } from 'react'

const VIEW = 260 // сторона квадратного окна редактирования
const OUT = 512 // сторона итогового файла
const MIN_ZOOM = 1
const MAX_ZOOM = 4

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

/**
 * Модальное окно аватара: выбор файла, круглая область с перетаскиванием и
 * зумом и превью — как аватар будет выглядеть после сохранения.
 *
 * Наружу отдаёт готовый обрезанный Blob, загрузку делает родитель
 * (у админа и у самого пользователя разные эндпоинты).
 */
export default function AvatarEditorModal({
  open,
  userName = '',
  currentUrl = null,
  onClose,
  onSave,
}) {
  const [picked, setPicked] = useState(null) // { url, img }
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const viewRef = useRef(null)

  // Сбрасываем состояние при каждом открытии
  useEffect(() => {
    if (!open) return
    setPicked(null)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setError('')
    setBusy(false)
    setDragging(false)
  }, [open])

  // Освобождаем blob-ссылку
  useEffect(
    () => () => {
      if (picked?.url) URL.revokeObjectURL(picked.url)
    },
    [picked],
  )

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const img = picked?.img || null
  const natural = img ? { w: img.naturalWidth, h: img.naturalHeight } : null

  // Масштаб, при котором картинка ровно закрывает круг
  const baseScale = natural ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1
  const scale = baseScale * zoom
  const dw = natural ? natural.w * scale : 0
  const dh = natural ? natural.h * scale : 0
  const maxX = Math.max(0, (dw - VIEW) / 2)
  const maxY = Math.max(0, (dh - VIEW) / 2)

  const applyZoom = useCallback(
    (next) => {
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM)
      setZoom(z)
      setOffset((prev) => {
        if (!natural) return prev
        const s = baseScale * z
        const w = natural.w * s
        const h = natural.h * s
        return {
          x: clamp(prev.x, -Math.max(0, (w - VIEW) / 2), Math.max(0, (w - VIEW) / 2)),
          y: clamp(prev.y, -Math.max(0, (h - VIEW) / 2), Math.max(0, (h - VIEW) / 2)),
        }
      })
    },
    [baseScale, natural],
  )

  function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!String(file.type || '').startsWith('image/')) {
      setError('Можно загружать только изображения')
      return
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('Файл больше 12 МБ — выберите изображение поменьше')
      return
    }

    const url = URL.createObjectURL(file)
    const next = new Image()
    next.onload = () => {
      setPicked({ url, img: next })
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      setError('')
    }
    next.onerror = () => {
      URL.revokeObjectURL(url)
      setError('Не удалось прочитать изображение')
    }
    next.src = url
  }

  function onPointerDown(e) {
    if (!img || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    viewRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y }
  }

  function onPointerMove(e) {
    const start = viewRef.current
    if (!dragging || !start) return
    setOffset({
      x: clamp(start.ox + (e.clientX - start.startX), -maxX, maxX),
      y: clamp(start.oy + (e.clientY - start.startY), -maxY, maxY),
    })
  }

  function onPointerUp(e) {
    if (viewRef.current) e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(false)
    viewRef.current = null
  }

  function reset() {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  async function save() {
    if (!img) {
      setError('Сначала выберите изображение')
      return
    }
    setBusy(true)
    setError('')
    try {
      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0b1f3a'
      ctx.fillRect(0, 0, OUT, OUT)

      const k = OUT / VIEW
      ctx.drawImage(
        img,
        (VIEW / 2 - dw / 2 + offset.x) * k,
        (VIEW / 2 - dh / 2 + offset.y) * k,
        dw * k,
        dh * k,
      )

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Не удалось подготовить изображение')

      await onSave(blob)
      onClose()
    } catch (err) {
      setError(err.message || 'Не удалось сохранить аватар')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const previewSizes = [72, 40, 28]

  return (
    <div className="cab-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cab-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Аватар пользователя"
        style={{ width: 'min(680px, 100%)', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cab-modal-head">
          <div>
            <h3>Аватар{userName ? ` — ${userName}` : ''}</h3>
            <span className="cab-muted" style={{ fontSize: '0.78rem' }}>
              Перетащите фото мышью и подберите масштаб — в круге видно, как будет выглядеть аватар.
            </span>
          </div>
          <button type="button" className="cab-btn ghost" onClick={onClose} style={{ minHeight: 32 }}>
            Закрыть
          </button>
        </div>

        {error && (
          <div className="cab-alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-5">
          <div>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                position: 'relative',
                width: VIEW,
                height: VIEW,
                flexShrink: 0,
                overflow: 'hidden',
                borderRadius: 14,
                border: '1px solid rgba(154, 211, 255, 0.22)',
                background: '#071529',
                cursor: img ? (dragging ? 'grabbing' : 'grab') : 'default',
                touchAction: 'none',
                userSelect: 'none',
              }}
            >
              {img ? (
                <img
                  src={picked.url}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    width: dw,
                    height: dh,
                    maxWidth: 'none',
                    left: VIEW / 2 - dw / 2 + offset.x,
                    top: VIEW / 2 - dh / 2 + offset.y,
                  }}
                />
              ) : (
                <div
                  className="cab-muted"
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    height: '100%',
                    fontSize: '0.82rem',
                    padding: 20,
                    textAlign: 'center',
                  }}
                >
                  Выберите изображение — здесь появится область кадрирования
                </div>
              )}

              {/* Затемняем всё за пределами круга */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  boxShadow: '0 0 0 9999px rgba(2, 8, 20, 0.7)',
                  border: '1px solid rgba(143, 210, 255, 0.5)',
                  pointerEvents: 'none',
                }}
              />
            </div>

            <div style={{ marginTop: 12, width: VIEW }}>
              <label
                className="cab-muted"
                style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em' }}
              >
                МАСШТАБ
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.02}
                  value={zoom}
                  disabled={!img}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 6 }}
                />
              </label>
              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <label className="cab-btn ghost" style={{ minHeight: 34, fontSize: '0.78rem', cursor: 'pointer' }}>
                  {img ? 'Другое фото' : 'Выбрать фото'}
                  <input type="file" accept="image/*" hidden onChange={pickFile} />
                </label>
                <button
                  type="button"
                  className="cab-btn ghost"
                  style={{ minHeight: 34, fontSize: '0.78rem' }}
                  onClick={reset}
                  disabled={!img}
                >
                  Сбросить
                </button>
              </div>
            </div>
          </div>

          <div style={{ minWidth: 150, flex: 1 }}>
            <div
              className="cab-muted"
              style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', marginBottom: 10 }}
            >
              КАК БУДЕТ ВИДНО
            </div>

            <div className="flex items-center gap-4">
              {previewSizes.map((size) => {
                // Превью — та же картинка с тем же сдвигом, просто меньше.
                const k = size / VIEW
                const pw = dw * k
                const ph = dh * k
                return (
                  <div
                    key={size}
                    title={`${size}px`}
                    style={{
                      position: 'relative',
                      width: size,
                      height: size,
                      flexShrink: 0,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      background: '#1a3a63',
                      border: '1px solid rgba(154, 211, 255, 0.22)',
                    }}
                  >
                    {img ? (
                      <img
                        src={picked.url}
                        alt=""
                        draggable={false}
                        style={{
                          position: 'absolute',
                          width: pw,
                          height: ph,
                          maxWidth: 'none',
                          left: size / 2 - pw / 2 + offset.x * k,
                          top: size / 2 - ph / 2 + offset.y * k,
                        }}
                      />
                    ) : currentUrl ? (
                      <img
                        src={currentUrl}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          placeItems: 'center',
                          height: '100%',
                          color: '#cfe6ff',
                          fontWeight: 800,
                          fontSize: size > 50 ? '1.1rem' : '0.8rem',
                        }}
                      >
                        {(userName || '?').slice(0, 1)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {currentUrl && (
              <div style={{ marginTop: 18 }}>
                <div
                  className="cab-muted"
                  style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', marginBottom: 8 }}
                >
                  СЕЙЧАС
                </div>
                <img
                  src={currentUrl}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '1px solid rgba(154, 211, 255, 0.22)',
                  }}
                />
              </div>
            )}

            <div className="cab-muted" style={{ marginTop: 18, fontSize: '0.76rem', lineHeight: 1.5 }}>
              Сохранится квадрат {OUT}×{OUT} — из него аватар обрезается в круг.
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid rgba(154, 211, 255, 0.14)',
          }}
        >
          <button type="button" className="cab-btn ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="cab-btn primary"
            onClick={save}
            disabled={busy || !img}
          >
            {busy ? 'Сохранение…' : currentUrl ? 'Заменить аватар' : 'Сохранить аватар'}
          </button>
        </div>
      </div>
    </div>
  )
}
