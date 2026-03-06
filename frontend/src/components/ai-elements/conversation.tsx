import { cn } from '../../lib/utils'

interface ConversationProps {
  children: React.ReactNode
  className?: string
}

export function Conversation({ children, className }: ConversationProps) {
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {children}
    </div>
  )
}

interface ConversationContentProps {
  children: React.ReactNode
  className?: string
}

export function ConversationContent({ children, className }: ConversationContentProps) {
  return (
    <div className={cn('flex-1 overflow-y-auto p-4 space-y-4', className)}>
      {children}
    </div>
  )
}
