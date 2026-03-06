import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { cn } from '../../lib/utils'

interface MessageProps {
  from: 'user' | 'assistant'
  children: React.ReactNode
  className?: string
}

export function Message({ from, children, className }: MessageProps) {
  return (
    <div
      className={cn(
        'flex',
        from === 'user' ? 'justify-end' : 'justify-start',
        className
      )}
    >
      {children}
    </div>
  )
}

interface MessageContentProps {
  children: React.ReactNode
  className?: string
}

export function MessageContent({ children, className }: MessageContentProps) {
  return (
    <div className={cn('max-w-[95%]', className)}>
      {children}
    </div>
  )
}

interface MessageResponseProps {
  children: string
  className?: string
  /** Override the default code block renderer (e.g. to add copy/approval buttons) */
  codeBlockRenderer?: (code: string, lang: string) => React.ReactNode
}

/**
 * Renders AI-generated markdown text with proper formatting.
 * Equivalent to the ai-elements MessageResponse component.
 */
export function MessageResponse({ children, className, codeBlockRenderer }: MessageResponseProps) {
  const components: Components = {
    code({ className: codeClass, children: codeChildren, ...props }) {
      const isInline = !codeClass
      if (isInline) {
        return (
          <code
            className="bg-gray-800 text-green-300 px-1 py-0.5 rounded text-xs font-mono"
            {...props}
          >
            {codeChildren}
          </code>
        )
      }
      const lang = (codeClass || '').replace('language-', '')
      const code = String(codeChildren).replace(/\n$/, '')
      if (codeBlockRenderer) {
        return <>{codeBlockRenderer(code, lang)}</>
      }
      return (
        <code className={cn('text-xs', codeClass)} {...props}>
          {codeChildren}
        </code>
      )
    },
    pre({ children: preChildren }) {
      // If codeBlockRenderer is provided, the code component handles the block directly
      if (codeBlockRenderer) {
        return <>{preChildren}</>
      }
      return (
        <pre className="bg-gray-950 border border-gray-700 rounded-lg p-3 overflow-x-auto text-xs font-mono text-gray-200 my-2">
          {preChildren}
        </pre>
      )
    },
  }

  return (
    <div
      className={cn(
        'prose prose-invert prose-sm max-w-none',
        'prose-p:my-1 prose-p:leading-relaxed',
        'prose-headings:text-gray-100 prose-headings:font-semibold',
        'prose-h1:text-base prose-h2:text-sm prose-h3:text-sm',
        'prose-strong:text-gray-100',
        'prose-em:text-gray-300',
        'prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline',
        'prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5',
        'prose-blockquote:border-gray-600 prose-blockquote:text-gray-400',
        'prose-hr:border-gray-700',
        'prose-table:text-xs',
        'prose-th:text-gray-300 prose-td:text-gray-400',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
