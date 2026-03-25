import { useState, useEffect } from 'react'
import { ArrowUp } from 'lucide-react'

/**
 * 回到顶部悬浮按钮
 * - 当页面需要滚动（即内容高度超出视口）且用户已向下滚动超过 300px 时显示
 * - 点击后平滑滚动到页面顶部
 */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const checkVisibility = () => {
      // 页面是否有足够内容需要滚动
      const hasScroll = document.documentElement.scrollHeight > window.innerHeight + 100
      // 用户是否已向下滚动超过 300px
      const scrolledDown = window.scrollY > 300
      setVisible(hasScroll && scrolledDown)
    }

    checkVisibility()
    window.addEventListener('scroll', checkVisibility, { passive: true })
    window.addEventListener('resize', checkVisibility, { passive: true })

    // 使用 MutationObserver 监听 DOM 变化（数据加载后内容高度变化）
    const observer = new MutationObserver(checkVisibility)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })

    return () => {
      window.removeEventListener('scroll', checkVisibility)
      window.removeEventListener('resize', checkVisibility)
      observer.disconnect()
    }
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!visible) return null

  return (
    <button
      onClick={scrollToTop}
      className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-11 h-11 bg-white border border-gray-300 rounded-full shadow-lg hover:bg-gray-50 hover:border-gray-400 hover:shadow-xl active:scale-95 transition-all duration-200 group md:w-12 md:h-12"
      title="回到顶部"
      aria-label="回到顶部"
    >
      <ArrowUp className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors md:w-5.5 md:h-5.5" />
    </button>
  )
}
