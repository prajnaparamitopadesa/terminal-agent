import { forwardRef } from 'react'
import { Send } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

interface PromptInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  placeholder?: string
  className?: string
  children?: React.ReactNode
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

/**
 * Styled prompt input component inspired by ai-elements prompt-input.
 * Auto-resizes as content grows, submits on Enter (without Shift).
 */
export const PromptInput = forwardRef<HTMLTextAreaElement, PromptInputProps>(
  ({ value, onChange, onSubmit, disabled, placeholder, className, children, onKeyDown }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
        return
      }
      onKeyDown?.(e)
    }

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      const target = e.target as HTMLTextAreaElement
      target.style.height = 'auto'
      target.style.height = Math.min(target.scrollHeight, 128) + 'px'
    }

    return (
      <div
        className={cn(
          'flex items-end gap-2 rounded-xl border border-gray-600 bg-gray-800 px-3 py-2',
          'focus-within:border-gray-500 focus-within:ring-1 focus-within:ring-gray-500',
          'transition-colors',
          className
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder || '输入消息...'}
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-gray-100 placeholder:text-gray-500',
            'outline-none border-none focus:ring-0 focus:outline-none',
            'max-h-32 overflow-y-auto leading-relaxed py-0.5',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          style={{ minHeight: '24px' }}
        />
        {children || (
          <Button
            type="submit"
            disabled={disabled || !value.trim()}
            size="iconSm"
            className="flex-shrink-0 mb-0.5"
            onClick={onSubmit}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    )
  }
)

PromptInput.displayName = 'PromptInput'
