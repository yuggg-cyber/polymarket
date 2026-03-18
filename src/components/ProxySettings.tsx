import { Shield, ShieldOff, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { ProxyConfig } from '@/types'

interface ProxySettingsProps {
  proxyConfig: ProxyConfig
  onProxyChange: (config: ProxyConfig) => void
}

export function ProxySettings({ proxyConfig, onProxyChange }: ProxySettingsProps) {
  const proxyReady = proxyConfig.enabled && proxyConfig.host

  // 解析代理字符串格式：host:port:user:pass
  const handleProxyQuickFill = (text: string) => {
    const line = text.trim().split('\n')[0]?.trim()
    if (!line) return

    const parts = line.split(':')
    if (parts.length >= 4) {
      const host = parts[0]
      const port = parts[1]
      const pass = parts[parts.length - 1]
      const user = parts.slice(2, parts.length - 1).join(':')

      const sessionMatch = user.match(/^(.+?)_session-[A-Za-z0-9]+$/)
      const userPrefix = sessionMatch ? sessionMatch[1] : user

      onProxyChange({
        ...proxyConfig,
        host,
        port,
        userPrefix,
        password: pass,
      })
    }
  }

  return (
    <div className="space-y-5">
      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">启用代理模式</p>
          <p className="text-xs text-gray-400 mt-0.5">
            每个地址使用不同代理 IP 查询，防止同 IP 批量查询风险
          </p>
        </div>
        <button
          onClick={() => onProxyChange({ ...proxyConfig, enabled: !proxyConfig.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            proxyConfig.enabled ? 'bg-green-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              proxyConfig.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {proxyConfig.enabled && (
        <>
          {/* 推荐代理平台提示 */}
          <div className="flex items-start gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="leading-relaxed">
              适用于以下动态代理平台：
              <a href="https://www.stormproxies.cn/?invite=UTYH9Q" target="_blank" rel="noopener noreferrer" className="ml-1 font-medium underline hover:text-blue-800 transition-colors">StormProxies</a>
              <span className="mx-1.5 text-blue-300">|</span>
              <a href="https://www.smartproxy.cn/?invite=RMZCLN" target="_blank" rel="noopener noreferrer" className="font-medium underline hover:text-blue-800 transition-colors">SmartProxy</a>
            </span>
          </div>

          {/* 快速填入 */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              快速填入（粘贴一行代理信息，格式：主机:端口:用户名:密码）
            </label>
            <Input
              placeholder="proxy.example.com:8080:username:password"
              onChange={(e) => handleProxyQuickFill(e.target.value)}
              className="h-10 text-sm bg-gray-50 border-gray-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">代理主机</label>
              <Input
                placeholder="proxy.example.com"
                value={proxyConfig.host}
                onChange={(e) => onProxyChange({ ...proxyConfig, host: e.target.value })}
                className="h-10 text-sm bg-gray-50 border-gray-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">端口</label>
              <Input
                placeholder="8080"
                value={proxyConfig.port}
                onChange={(e) => onProxyChange({ ...proxyConfig, port: e.target.value })}
                className="h-10 text-sm bg-gray-50 border-gray-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              用户名前缀（不含 _session-XXX 部分，系统会自动为每个地址生成唯一 session）
            </label>
            <Input
              placeholder="your-username-prefix"
              value={proxyConfig.userPrefix}
              onChange={(e) => onProxyChange({ ...proxyConfig, userPrefix: e.target.value })}
              className="h-10 text-sm bg-gray-50 border-gray-200"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">密码</label>
            <Input
              type="password"
              placeholder="代理密码"
              value={proxyConfig.password}
              onChange={(e) => onProxyChange({ ...proxyConfig, password: e.target.value })}
              className="h-10 text-sm bg-gray-50 border-gray-200"
            />
          </div>

          {/* 状态提示 */}
          {proxyReady ? (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
              <Shield className="h-4 w-4" />
              代理已配置，每个查询地址将使用独立的代理 IP
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              请填写完整的代理信息
            </div>
          )}
        </>
      )}

      {!proxyConfig.enabled && (
        <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 px-3 py-2 rounded-lg">
          <ShieldOff className="h-4 w-4" />
          代理已关闭，将直接请求 Polymarket API
        </div>
      )}
    </div>
  )
}
