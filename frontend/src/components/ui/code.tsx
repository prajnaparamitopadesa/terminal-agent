import * as React from 'react'
import { cn } from '../../lib/utils'

/** Inline code span */
export interface CodeProps extends React.HTMLAttributes<HTMLElement> {}

const Code = React.forwardRef<HTMLElement, CodeProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <code
        className={cn(
          'font-mono text-sm text-green-300',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </code>
    )
  }
)
Code.displayName = 'Code'

/** Block code / pre */
export interface PreProps extends React.HTMLAttributes<HTMLPreElement> {}

const Pre = React.forwardRef<HTMLPreElement, PreProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <pre
        className={cn(
          'rounded-lg bg-gray-950 border border-gray-700 p-3 text-sm font-mono text-green-300 overflow-x-auto whitespace-pre-wrap break-all',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </pre>
    )
  }
)
Pre.displayName = 'Pre'

export { Code, Pre }
