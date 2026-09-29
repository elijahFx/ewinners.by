import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EmojiPicker from 'emoji-picker-react'
import { io } from 'socket.io-client'
import { MessageCircle, Smile, Paperclip, Send, X, FileText, Users, Upload } from 'lucide-react'
import { useAuth } from '../AuthContext'
import { api, mediaUrl } from '../api'

const API_BASE = (import.meta.env.VITE_API_URL || 'https://178.172.137.114.sslip.io').replace(/\/$/, '')
const MAX_CHAT_FILES = 5

const ALLOWED_FILE_EXT = /\.(pdf|doc|docx|xls|xlsx|zip|txt)$/i
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'text/plain',
])

function isAllowedChatFile(file) {
  if (!file) return false
  if (String(file.type || '').startsWith('image/')) return true
  if (String(file.type || '').startsWith('video/')) return true
  if (ALLOWED_MIME.has(file.type)) return true
  return ALLOWED_FILE_EXT.test(file.name || '')
}

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

function AttachmentBlock({ attachments }) {
  if (!attachments?.length) return null
  return (
    <div className="ew-chat-attachments">
      {attachments.map((a) => {
        const url = mediaUrl(a.url)
        if (a.kind === 'image') {
          return (
            <a key={a.id} href={url} target="_blank" rel="noreferrer" className="ew-chat-attach-image">
              <img src={url} alt={a.name} />
            </a>
          )
        }
        if (a.kind === 'video') {
          return (
            <video key={a.id} className="ew-chat-attach-video" controls src={url} preload="metadata" />
          )
        }
        return (
          <a key={a.id} href={url} target="_blank" rel="noreferrer" className="ew-chat-attach-file">
            <FileText size={14} />
            <span>{a.name}</span>
          </a>
        )
      })}
    </div>
  )
}

function ConversationButton({ conversation: c, active, onSelect }) {
  return (
    <button
      type="button"
      className={`ew-chat-conv${active ? ' is-active' : ''}`}
      onClick={() => onSelect(c.id)}
    >
      <span className="ew-chat-avatar" aria-hidden>
        {c.avatarUrl ? <img src={mediaUrl(c.avatarUrl)} alt="" /> : initials(c.title)}
      </span>
      <span className="ew-chat-conv-body">
        <span className="ew-chat-conv-top">
          <strong>{c.title}</strong>
          {c.unread ? <em className="ew-chat-badge">{c.unread}</em> : null}
        </span>
        <span className="ew-chat-conv-preview">
          {c.lastMessagePreview || c.subtitle || 'Нет сообщений'}
        </span>
      </span>
    </button>
  )
}

export default function ChatPage() {
  const { user } = useAuth()
  const isStaff = user && ['admin', 'accountant'].includes(user.role)
  const [conversations, setConversations] = useState([])
  const [staffPeers, setStaffPeers] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [typingName, setTypingName] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showPeers, setShowPeers] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const [draft, setDraft] = useState('')
  const [draggingFiles, setDraggingFiles] = useState(false)
  const fileRef = useRef(null)
  const socketRef = useRef(null)
  const typingTimer = useRef(null)
  const activeIdRef = useRef(null)
  const listRef = useRef(null)
  const textareaRef = useRef(null)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  )

  const staffConversations = useMemo(
    () => conversations.filter((c) => c.kind === 'staff'),
    [conversations],
  )
  const clientConversations = useMemo(
    () => conversations.filter((c) => c.kind !== 'staff'),
    [conversations],
  )

  const loadConversations = useCallback(async () => {
    setLoadingList(true)
    try {
      const data = await api('/api/chat/conversations')
      const items = data.items || []
      setConversations(items)
      setActiveId((prev) => {
        if (prev && items.some((c) => c.id === prev)) return prev
        return items[0]?.id || null
      })
    } catch (err) {
      alert(err.message)
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadStaffPeers = useCallback(async () => {
    if (!isStaff) return
    try {
      const data = await api('/api/chat/staff-peers')
      setStaffPeers(data.items || [])
    } catch {
      setStaffPeers([])
    }
  }, [isStaff])

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) {
      setMessages([])
      return
    }
    setLoadingMessages(true)
    try {
      const data = await api(`/api/chat/conversations/${conversationId}/messages`)
      setMessages(data.items || [])
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)),
      )
      window.dispatchEvent(new Event('ew-chat-unread-refresh'))
    } catch (err) {
      alert(err.message)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    loadConversations()
    loadStaffPeers()
  }, [loadConversations, loadStaffPeers])

  useEffect(() => {
    if (activeId) loadMessages(activeId)
  }, [activeId, loadMessages])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, typingName, loadingMessages])

  useEffect(() => {
    const token = localStorage.getItem('ew_token')
    if (!token) return undefined

    const socket = io(API_BASE, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
    })
    socketRef.current = socket

    socket.on('connect', () => {
      if (activeIdRef.current) socket.emit('chat:join', activeIdRef.current)
    })

    socket.on('chat:message', ({ conversationId, message }) => {
      if (Number(conversationId) === Number(activeIdRef.current)) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev
          return [...prev, message]
        })
        api(`/api/chat/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => {})
        window.dispatchEvent(new Event('ew-chat-unread-refresh'))
      }
      setConversations((prev) => {
        const next = prev.map((c) => {
          if (c.id !== conversationId) return c
          const mine = Number(message.senderId) === Number(user?.id)
          return {
            ...c,
            lastMessageAt: message.createdAt,
            lastMessagePreview: message.body || '[Вложение]',
            unread:
              Number(conversationId) === Number(activeIdRef.current) || mine
                ? 0
                : (c.unread || 0) + 1,
          }
        })
        return [...next].sort((a, b) => {
          const ta = new Date(a.lastMessageAt || 0).getTime()
          const tb = new Date(b.lastMessageAt || 0).getTime()
          return tb - ta
        })
      })
    })

    socket.on('chat:typing', (payload) => {
      if (Number(payload.conversationId) !== Number(activeIdRef.current)) return
      if (Number(payload.userId) === Number(user?.id)) return
      if (payload.isTyping) {
        setTypingName(payload.userName || 'Собеседник')
        clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setTypingName(''), 2500)
      } else {
        setTypingName('')
      }
    })

    socket.on('chat:conversation-updated', () => {
      loadConversations()
    })

    socket.on('chat:unread-changed', () => {
      window.dispatchEvent(new Event('ew-chat-unread-refresh'))
    })

    return () => {
      clearTimeout(typingTimer.current)
      socket.disconnect()
      socketRef.current = null
    }
  }, [user?.id, loadConversations])

  useEffect(() => {
    const socket = socketRef.current
    if (socket && activeId) socket.emit('chat:join', activeId)
    setTypingName('')
    setShowEmoji(false)
    setPendingFiles([])
    setDraft('')
    setDraggingFiles(false)
    dragDepthRef.current = 0
  }, [activeId])

  function emitTyping(isTyping) {
    const socket = socketRef.current
    if (!socket || !activeId) return
    socket.emit('chat:typing', { conversationId: activeId, isTyping })
  }

  async function openStaffChat(peerId) {
    try {
      const data = await api('/api/chat/conversations/with-staff', {
        method: 'POST',
        body: { staffUserId: peerId },
      })
      setShowPeers(false)
      await loadConversations()
      if (data.conversation?.id) setActiveId(data.conversation.id)
    } catch (err) {
      alert(err.message)
    }
  }

  async function sendMessage() {
    if (!activeId || sending) return
    const text = draft.trim()
    if (!text && !pendingFiles.length) return

    setSending(true)
    emitTyping(false)
    try {
      const fd = new FormData()
      if (text) fd.append('body', text)
      pendingFiles.forEach((f) => fd.append('files', f))
      const data = await api(`/api/chat/conversations/${activeId}/messages`, {
        method: 'POST',
        body: fd,
      })
      const message = data.message
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev
        return [...prev, message]
      })
      setDraft('')
      setPendingFiles([])
      setShowEmoji(false)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                lastMessageAt: message.createdAt,
                lastMessagePreview: message.body || '[Вложение]',
                unread: 0,
              }
            : c,
        ),
      )
      window.dispatchEvent(new Event('ew-chat-unread-refresh'))
      textareaRef.current?.focus()
    } catch (err) {
      alert(err.message)
    } finally {
      setSending(false)
    }
  }

  function addFiles(fileList) {
    if (!activeId) {
      alert('Сначала выберите диалог')
      return
    }
    const incoming = Array.from(fileList || []).filter(Boolean)
    if (!incoming.length) return

    const accepted = incoming.filter(isAllowedChatFile)
    if (!accepted.length) {
      alert('Можно прикрепить фото, видео, PDF, Word, Excel, ZIP или TXT')
      return
    }

    setPendingFiles((prev) => {
      const next = [...prev, ...accepted].slice(0, MAX_CHAT_FILES)
      if (prev.length + accepted.length > MAX_CHAT_FILES) {
        alert(`Можно прикрепить не больше ${MAX_CHAT_FILES} файлов`)
      }
      return next
    })
  }

  function onFilesPicked(e) {
    addFiles(e.target.files)
    e.target.value = ''
  }

  function hasFilesInDataTransfer(dt) {
    if (!dt) return false
    if (dt.types && Array.from(dt.types).includes('Files')) return true
    return Array.from(dt.items || []).some((item) => item.kind === 'file')
  }

  function onPanelDragEnter(e) {
    if (!activeId || !hasFilesInDataTransfer(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setDraggingFiles(true)
  }

  function onPanelDragOver(e) {
    if (!activeId || !hasFilesInDataTransfer(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onPanelDragLeave(e) {
    if (!hasFilesInDataTransfer(e.dataTransfer) && !draggingFiles) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDraggingFiles(false)
  }

  function onPanelDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setDraggingFiles(false)
    if (!activeId) return
    addFiles(e.dataTransfer?.files)
  }

  function onDraftChange(value) {
    setDraft(value)
    emitTyping(!!value.trim())
  }

  const headerTitle = activeConversation?.title || (isStaff ? 'Диалог' : 'Поддержка E-Winners')
  const headerInfo = activeConversation?.subtitle || (isStaff ? '' : 'Сообщения администраторам')
  const canSend = !!activeId && !sending && (!!draft.trim() || pendingFiles.length > 0)

  return (
    <div className="cab-page ew-chat-page">
      <div className="cab-page-head">
        <div>
          <h1>Чат</h1>
          <p>
            {isStaff
              ? 'Клиенты и переписка между администраторами — текст, emoji, фото, видео и файлы.'
              : 'Чат с администраторами — текст, emoji, фото, видео и файлы.'}
          </p>
        </div>
      </div>

      <div className={`ew-chat-shell${isStaff ? ' has-sidebar' : ''}`}>
        {isStaff ? (
          <aside className="ew-chat-list">
            <div className="ew-chat-list-head-row">
              <div className="ew-chat-list-head">Диалоги</div>
              <button
                type="button"
                className="ew-chat-new-staff"
                title="Написать сотруднику"
                onClick={() => setShowPeers((v) => !v)}
              >
                <Users size={14} />
                <span>Команда</span>
              </button>
            </div>

            {showPeers ? (
              <div className="ew-chat-peers">
                {staffPeers.length === 0 ? (
                  <div className="ew-chat-empty sm">Нет других сотрудников</div>
                ) : (
                  staffPeers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ew-chat-peer"
                      onClick={() => openStaffChat(p.id)}
                    >
                      <span className="ew-chat-avatar sm" aria-hidden>
                        {p.avatarUrl ? (
                          <img src={mediaUrl(p.avatarUrl)} alt="" />
                        ) : (
                          initials(p.fullName)
                        )}
                      </span>
                      <span>
                        <strong>{p.fullName}</strong>
                        <em>
                          {p.role === 'admin' ? 'Админ' : 'Бухгалтер'}
                          {p.email ? ` · ${p.email}` : ''}
                        </em>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            <div className="ew-chat-list-scroll">
              {loadingList ? (
                <div className="ew-chat-empty">Загрузка…</div>
              ) : conversations.length === 0 ? (
                <div className="ew-chat-empty">Диалогов пока нет</div>
              ) : (
                <>
                  {staffConversations.length ? (
                    <div className="ew-chat-section">
                      <div className="ew-chat-section-title">Команда</div>
                      {staffConversations.map((c) => (
                        <ConversationButton
                          key={c.id}
                          conversation={c}
                          active={c.id === activeId}
                          onSelect={setActiveId}
                        />
                      ))}
                    </div>
                  ) : null}

                  <div className="ew-chat-section">
                    <div className="ew-chat-section-title">Клиенты</div>
                    {clientConversations.length === 0 ? (
                      <div className="ew-chat-empty sm">Клиентов пока нет</div>
                    ) : (
                      clientConversations.map((c) => (
                        <ConversationButton
                          key={c.id}
                          conversation={c}
                          active={c.id === activeId}
                          onSelect={setActiveId}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        ) : null}

        <section
          className={`ew-chat-panel${draggingFiles ? ' is-dragover' : ''}`}
          onDragEnter={onPanelDragEnter}
          onDragOver={onPanelDragOver}
          onDragLeave={onPanelDragLeave}
          onDrop={onPanelDrop}
        >
          {draggingFiles ? (
            <div className="ew-chat-drop-overlay" aria-hidden>
              <Upload size={28} />
              <strong>Отпустите файлы здесь</strong>
              <span>Фото, видео или документы · до {MAX_CHAT_FILES} шт.</span>
            </div>
          ) : null}

          <header className="ew-chat-header">
            <span className="ew-chat-avatar lg" aria-hidden>
              {activeConversation?.avatarUrl ? (
                <img src={mediaUrl(activeConversation.avatarUrl)} alt="" />
              ) : (
                <MessageCircle size={18} />
              )}
            </span>
            <div>
              <strong>{headerTitle}</strong>
              <p>{headerInfo}</p>
            </div>
          </header>

          <div className="ew-chat-messages" ref={listRef}>
            {!activeId ? (
              <div className="ew-chat-empty">Выберите диалог</div>
            ) : loadingMessages ? (
              <div className="ew-chat-empty">Загрузка сообщений…</div>
            ) : messages.length === 0 ? (
              <div className="ew-chat-empty">Напишите первое сообщение</div>
            ) : (
              messages.map((m) => {
                const mine = Number(m.senderId) === Number(user?.id)
                return (
                  <div key={m.id} className={`ew-chat-row${mine ? ' is-mine' : ''}`}>
                    <div className="ew-chat-bubble">
                      {!mine ? <div className="ew-chat-sender">{m.senderName}</div> : null}
                      {m.body ? <div className="ew-chat-text">{m.body}</div> : null}
                      <AttachmentBlock attachments={m.attachments} />
                      <time className="ew-chat-time">{formatTime(m.createdAt)}</time>
                    </div>
                  </div>
                )
              })
            )}

            {typingName ? (
              <div className="ew-chat-typing">
                <span className="ew-chat-typing-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                {typingName} печатает…
              </div>
            ) : null}
          </div>

          <footer className="ew-chat-composer">
            {pendingFiles.length ? (
              <div className="ew-chat-pending">
                {pendingFiles.map((f, idx) => (
                  <span key={`${f.name}-${idx}`} className="ew-chat-pending-item">
                    {f.name}
                    <button
                      type="button"
                      aria-label="Убрать файл"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {showEmoji ? (
              <div className="ew-chat-emoji">
                <EmojiPicker
                  theme="dark"
                  onEmojiClick={(emojiData) => {
                    onDraftChange(`${draft}${emojiData.emoji}`)
                    textareaRef.current?.focus()
                  }}
                  width="100%"
                  height={280}
                  previewConfig={{ showPreview: false }}
                />
              </div>
            ) : null}

            <div className="ew-chat-input-row">
              <button
                type="button"
                className="ew-chat-icon-btn"
                title="Emoji"
                disabled={!activeId}
                onClick={() => setShowEmoji((v) => !v)}
              >
                <Smile size={18} />
              </button>
              <button
                type="button"
                className="ew-chat-icon-btn"
                title="Прикрепить"
                disabled={!activeId}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip size={18} />
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
                onChange={onFilesPicked}
              />

              <textarea
                ref={textareaRef}
                className="ew-chat-textarea"
                rows={1}
                placeholder={activeId ? 'Напишите сообщение…' : 'Выберите чат'}
                disabled={!activeId || sending}
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
              />

              <button
                type="button"
                className="ew-chat-send"
                disabled={!canSend}
                onClick={sendMessage}
                title="Отправить"
              >
                <Send size={16} />
                <span>Отправить</span>
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  )
}
