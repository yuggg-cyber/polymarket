import { useState } from 'react'
import {
  Trash2,
  Edit3,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Plus,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

export interface SavedAddress {
  address: string
  note: string
  addedAt: number
}

interface AddressManagerProps {
  savedAddresses: SavedAddress[]
  onSave: (addresses: SavedAddress[]) => void
  onQuery: (addresses: string[]) => Promise<void>
  isLoading: boolean
}

export function AddressManager({
  savedAddresses,
  onSave,
  onQuery,
  isLoading,
}: AddressManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [addError, setAddError] = useState('')
  const [editingAddr, setEditingAddr] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')

  // 添加地址
  const handleAdd = () => {
    const lines = addInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    if (lines.length === 0) {
      setAddError('请输入至少一个地址')
      return
    }

    const invalid = lines.filter((a) => !ETH_ADDRESS_REGEX.test(a))
    if (invalid.length > 0) {
      setAddError(`发现 ${invalid.length} 个无效地址`)
      return
    }

    const existingSet = new Set(savedAddresses.map((a) => a.address.toLowerCase()))
    const newAddresses: SavedAddress[] = []
    let duplicateCount = 0

    for (const addr of lines) {
      const lower = addr.toLowerCase()
      if (existingSet.has(lower)) {
        duplicateCount++
        continue
      }
      existingSet.add(lower)
      newAddresses.push({
        address: addr,
        note: '',
        addedAt: Date.now(),
      })
    }

    if (newAddresses.length === 0 && duplicateCount > 0) {
      setAddError(`所有 ${duplicateCount} 个地址已存在`)
      return
    }

    onSave([...savedAddresses, ...newAddresses])
    setAddInput('')
    setAddError('')
  }

  // 删除单个地址
  const handleDelete = (address: string) => {
    onSave(savedAddresses.filter((a) => a.address !== address))
  }

  // 清空所有地址
  const handleClearAll = () => {
    if (window.confirm('确定要清空所有已保存的地址吗？')) {
      onSave([])
    }
  }

  // 开始编辑备注
  const startEdit = (address: string, currentNote: string) => {
    setEditingAddr(address)
    setEditNote(currentNote)
  }

  // 保存备注
  const saveNote = () => {
    if (editingAddr === null) return
    onSave(
      savedAddresses.map((a) =>
        a.address === editingAddr ? { ...a, note: editNote.trim() } : a
      )
    )
    setEditingAddr(null)
    setEditNote('')
  }

  // 取消编辑
  const cancelEdit = () => {
    setEditingAddr(null)
    setEditNote('')
  }

  // 刷新查询所有保存的地址
  const handleRefreshAll = () => {
    if (savedAddresses.length === 0) return
    onQuery(savedAddresses.map((a) => a.address))
  }

  return (
    <div className="mt-8">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2.5 text-base text-gray-600 hover:text-gray-800 transition-colors font-medium"
      >
        <Bookmark className="h-5 w-5 text-amber-500" />
        <span>地址管理</span>
        {savedAddresses.length > 0 && (
          <span className="text-sm px-2.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
            {savedAddresses.length} 个地址
          </span>
        )}
        {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
      </button>

      {isExpanded && (
        <div className="mt-4 p-6 bg-white rounded-xl border border-gray-200 shadow-sm space-y-5">
          {/* 添加地址区域 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">
              添加地址（每行一个或用逗号分隔）
            </label>
            <div className="flex gap-3">
              <Textarea
                placeholder="输入钱包地址，每行一个或用逗号分隔"
                value={addInput}
                onChange={(e) => {
                  setAddInput(e.target.value)
                  setAddError('')
                }}
                className="min-h-[72px] text-sm bg-gray-50 border-gray-200 resize-y"
                rows={2}
              />
              <Button
                onClick={handleAdd}
                className="h-auto px-5 bg-blue-600 hover:bg-blue-700 text-white self-end text-sm"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                添加
              </Button>
            </div>
            {addError && (
              <p className="text-sm text-red-500 mt-1.5">{addError}</p>
            )}
          </div>

          {/* 操作按钮 */}
          {savedAddresses.length > 0 && (
            <div className="flex items-center gap-3">
              <Button
                onClick={handleRefreshAll}
                disabled={isLoading}
                className="h-9 px-4 text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
                刷新查询全部
              </Button>
              <Button
                onClick={handleClearAll}
                variant="outline"
                className="h-9 px-4 text-sm text-red-500 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                清空全部
              </Button>
              <span className="text-sm text-gray-400 ml-auto">
                共 {savedAddresses.length} 个地址，数据自动保存在浏览器中
              </span>
            </div>
          )}

          {/* 地址列表 */}
          {savedAddresses.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 w-[60px]">#</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">地址</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">备注</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 w-[90px]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {savedAddresses.map((item, idx) => (
                    <tr key={item.address} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm text-gray-700" title={item.address}>
                          {item.address.slice(0, 10)}...{item.address.slice(-6)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {editingAddr === item.address ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveNote()
                                if (e.key === 'Escape') cancelEdit()
                              }}
                              className="h-8 text-sm"
                              placeholder="输入备注..."
                              autoFocus
                            />
                            <button
                              onClick={saveNote}
                              className="p-1.5 rounded hover:bg-emerald-100 text-emerald-600"
                              title="保存"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="p-1.5 rounded hover:bg-gray-200 text-gray-400"
                              title="取消"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">
                              {item.note || <span className="text-gray-300 italic">无备注</span>}
                            </span>
                            <button
                              onClick={() => startEdit(item.address, item.note)}
                              className="p-1 rounded hover:bg-gray-200 text-gray-300 hover:text-gray-500"
                              title="编辑备注"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDelete(item.address)}
                          className="p-1.5 rounded hover:bg-red-100 text-gray-300 hover:text-red-500 transition-colors"
                          title="删除此地址"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">
              暂无保存的地址，添加地址后将自动保存在浏览器中
            </div>
          )}
        </div>
      )}
    </div>
  )
}
