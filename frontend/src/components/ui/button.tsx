import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-500',
        secondary: 'bg-gray-700 text-gray-100 hover:bg-gray-600',
        destructive: 'bg-red-700 text-white hover:bg-red-600',
        success: 'bg-green-600 text-white hover:bg-green-500',
        ghost: 'text-gray-400 hover:text-white hover:bg-gray-800',
        outline: 'border border-gray-600 bg-transparent text-gray-300 hover:bg-gray-800 hover:text-white',
        link: 'text-gray-400 underline-offset-4 hover:underline hover:text-white',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-1.5 text-xs',
        xs: 'px-2 py-1 text-xs',
        lg: 'px-6 py-2.5',
        icon: 'h-8 w-8 p-0',
        iconSm: 'h-6 w-6 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
