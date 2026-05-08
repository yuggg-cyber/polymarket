import { useState, useEffect, useRef } from 'react'

/** 可选的标记颜色 */
export const MARK_COLORS = [
  { name: '灰色', value: 'gray', bg: 'bg-gray-200', bgHex: '#e5e7eb' },
  { name: '黄色', value: 'yellow', bg: 'bg-yellow-200', bgHex: '#fef08a' },
  { name: '蓝色', value: 'blue', bg: 'bg-blue-200', bgHex: '#bfdbfe' },
  { name: '绿色', value: 'green', bg: 'bg-green-200', bgHex: '#bbf7d0' },
  { name: '红色', value: 'red', bg: 'bg-red-200', bgHex: '#fecaca' },
] as const

export type MarkColor = typeof MARK_COLORS[number]['value']

/** localStorage 存储键 */
const STORAGE_KEY = 'polymarket_row_colors'

/** 从 localStorage 加载颜色标记映射 */
export function loadRowColors(): Record<string, MarkColor> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

/** 保存颜色标记映射到 localStorage */
export function saveRowColors(colors: Record<string, MarkColor>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors))
  } catch { /* ignore */ }
}

/** 根据颜色值获取对应的背景色 CSS 类名 */
export function getRowBgClass(color: MarkColor | undefined): string {
  if (!color) return ''
  const found = MARK_COLORS.find((c) => c.value === color)
  return found ? found.bgHex : ''
}

/** 右键颜色标记菜单 */
interface ColorMarkMenuProps {
  x: number
  y: number
  addresses: string[]
  currentColor?: MarkColor
  onSelect: (addresses: string[], color: MarkColor | null) => void
  onClose: () => void
}

export function ColorMarkMenu({ x, y, addresses, currentColor, onSelect, onClose }: ColorMarkMenuProps) {
  const isBatch = addresses.length > 1
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x, y })

  // 调整菜单位置，确保不超出视口
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      let newX = x
      let newY = y
      if (x + rect.width > window.innerWidth) {
        newX = window.innerWidth - rect.width - 8
      }
      if (y + rect.height > window.innerHeight) {
        newY = window.innerHeight - rect.height - 8
      }
      setAdjustedPos({ x: newX, y: newY })
    }
  }, [x, y])

  // 点击外部关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleScroll = () => onClose()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('scroll', handleScroll, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-xl py-1.5 min-w-[140px]"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 font-medium border-b border-gray-100 mb-1">
        {isBatch ? `为 ${addresses.length} 个地址标记颜色` : '颜色标记'}
      </div>
      {MARK_COLORS.map((color) => (
        <button
          key={color.value}
          onClick={() => {
            onSelect(addresses, color.value)
            onClose()
          }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <span
            className="w-4 h-4 rounded-sm border border-gray-300 flex-shrink-0"
            style={{ backgroundColor: color.bgHex }}
          />
          <span>{color.name}</span>
          {currentColor === color.value && (
            <span className="ml-auto text-blue-500 text-xs font-medium">&#10003;</span>
          )}
        </button>
      ))}
      {(currentColor || isBatch) && (
        <>
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={() => {
              onSelect(addresses, null)
              onClose()
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
          >
            <span className="w-4 h-4 rounded-sm border border-dashed border-gray-300 flex-shrink-0" />
            <span>{isBatch ? '取消所有标记' : '取消标记'}</span>
          </button>
        </>
      )}
    </div>
  )
}
