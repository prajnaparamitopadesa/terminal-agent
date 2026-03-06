import { useNavigate } from 'react-router-dom'
import { Terminal, ArrowLeft, Building2, BrainCircuit, Server, KeyRound, Rocket } from 'lucide-react'
import { Button } from '../components/ui/button'

interface StepProps {
  number: number
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}

function Step({ number, icon, title, children }: StepProps) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 flex flex-col items-center">
        <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
          {number}
        </div>
        <div className="w-px flex-1 bg-gray-700 mt-2" />
      </div>
      <div className="pb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-blue-400">{icon}</span>
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
        <div className="text-sm text-gray-400 space-y-2 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <code className="bg-gray-800 text-green-300 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
  )
}

export default function Help() {
  const navigate = useNavigate()

  return (
    <div className="h-screen overflow-y-auto bg-gray-950">
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Terminal className="w-7 h-7 text-green-400" />
          <h1 className="text-xl font-bold text-white">使用帮助</h1>
        </div>

        <p className="text-gray-400 mb-8 text-sm leading-relaxed">
          按照以下步骤快速配置终端助手，即可使用 AI 助手管理您的服务器。
        </p>

        {/* Steps */}
        <div>
          <Step number={1} icon={<Building2 className="w-4 h-4" />} title="配置 AI 服务商">
            <p>前往首页 <strong className="text-gray-200">「服务商」</strong> 标签页，添加您的 AI 服务商信息：</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li><strong className="text-gray-200">服务商标识</strong>：唯一标识符，如 <Code>阿里云</Code></li>
              <li><strong className="text-gray-200">显示名称</strong>：界面显示用的友好名称</li>
              <li><strong className="text-gray-200">API Base URL</strong>：服务商的 OpenAI 兼容端点，例如
                <br /><Code>https://dashscope.aliyuncs.com/compatible-mode/v1</Code></li>
              <li><strong className="text-gray-200">API Key</strong>：您的 API 密钥，保存在本地配置文件中</li>
            </ul>
            <div className="mt-3 bg-gray-800/60 border border-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-500 font-medium mb-1">常用服务商端点</p>
              <div className="space-y-1 text-xs font-mono">
                <div><span className="text-purple-400">阿里云 DashScope：</span><span className="text-gray-300">https://dashscope.aliyuncs.com/compatible-mode/v1</span></div>
                <div><span className="text-purple-400">ModelScope：</span><span className="text-gray-300">https://api-inference.modelscope.cn/v1</span></div>
                <div><span className="text-purple-400">OpenAI：</span><span className="text-gray-300">https://api.openai.com/v1</span></div>
              </div>
            </div>
          </Step>

          <Step number={2} icon={<BrainCircuit className="w-4 h-4" />} title="添加 AI 模型">
            <p>前往 <strong className="text-gray-200">「模型管理」</strong> 标签页，为已配置的服务商添加模型：</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li><strong className="text-gray-200">模型 ID</strong>：服务商提供的模型标识符，如 <Code>qwen-plus</Code></li>
              <li><strong className="text-gray-200">显示名称</strong>：在聊天界面显示的名称</li>
              <li><strong className="text-gray-200">服务商</strong>：从已配置的服务商中选择</li>
              <li><strong className="text-gray-200">状态</strong>：启用后才能在聊天时选择</li>
            </ul>
            <div className="mt-3 bg-gray-800/60 border border-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-500 font-medium mb-1">推荐模型（工具调用能力强）</p>
              <div className="space-y-1 text-xs font-mono">
                <div><span className="text-blue-400">qwen-plus</span><span className="text-gray-500"> — 阿里云通义千问，速度与能力平衡</span></div>
                <div><span className="text-blue-400">qwen3-max</span><span className="text-gray-500"> — 阿里云旗舰模型，能力最强</span></div>
                <div><span className="text-blue-400">gpt-4o</span><span className="text-gray-500"> — OpenAI，支持工具调用</span></div>
              </div>
            </div>
          </Step>

          <Step number={3} icon={<Server className="w-4 h-4" />} title="添加服务器">
            <p>前往 <strong className="text-gray-200">「服务器」</strong> 标签页，添加要管理的 SSH 服务器：</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li><strong className="text-gray-200">主机地址</strong>：服务器的 IP 或域名</li>
              <li><strong className="text-gray-200">用户名</strong>：SSH 登录用户名</li>
              <li><strong className="text-gray-200">端口</strong>：SSH 端口，默认 22</li>
            </ul>
          </Step>

          <Step number={4} icon={<KeyRound className="w-4 h-4" />} title="连接并配置密码（可选）">
            <p>点击服务器列表中的 <strong className="text-gray-200">「连接」</strong> 按钮，在连接对话框中可以：</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>输入 SSH 密码（可勾选「记住密码」保存到本地数据库）</li>
              <li>如已配置 SSH 密钥认证，则无需密码</li>
            </ul>
          </Step>

          <Step number={5} icon={<Rocket className="w-4 h-4" />} title="开始使用 AI 助手">
            <p>连接成功后，在页面右侧的聊天面板中：</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>从顶部下拉菜单选择要使用的 <strong className="text-gray-200">AI 模型</strong></li>
              <li>输入自然语言指令，如 <Code>查看系统状态</Code>、<Code>安装 nginx</Code></li>
              <li>AI 会自动在终端执行命令，高危操作需要您手动确认</li>
              <li>可在「自动审批」面板中配置无需确认的命令模式</li>
            </ul>
          </Step>
        </div>

        {/* FAQ */}
        <div className="mt-4 bg-gray-900 border border-gray-700 rounded-xl p-6">
          <h2 className="text-base font-semibold text-white mb-4">常见问题</h2>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-gray-200 font-medium">API Key 存储在哪里？</p>
              <p className="text-gray-400 mt-1">服务商配置（包括 API Key）和模型配置均保存在本地 SQLite 数据库（<Code>terminal-agent.db</Code>）中，不会上传到任何服务器。</p>
            </div>
            <div>
              <p className="text-gray-200 font-medium">AI 执行命令有什么限制？</p>
              <p className="text-gray-400 mt-1">默认情况下所有命令都需要您确认。您可以在「自动审批」面板中为常用的安全命令添加规则，跳过确认步骤。</p>
            </div>
            <div>
              <p className="text-gray-200 font-medium">模型配置保存在哪里？</p>
              <p className="text-gray-400 mt-1">模型配置和服务商配置均保存在本地 SQLite 数据库（<Code>terminal-agent.db</Code>）中。</p>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Button variant="success" onClick={() => navigate('/')}>
            <Terminal className="w-4 h-4" />
            开始使用
          </Button>
        </div>
      </div>
    </div>
    </div>
  )
}
