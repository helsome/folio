import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-[10px] font-medium transition-smooth disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985]',
  {
    variants: {
      variant: {
        default: 'mac-primary-button',
        destructive: 'bg-destructive text-white hover:bg-destructive/90 shadow-sm',
        outline: 'mac-secondary-button text-foreground hover:border-[var(--mac-border-strong)]',
        secondary: 'mac-secondary-button text-foreground',
        ghost: 'bg-transparent text-foreground hover:bg-[var(--mac-sidebar-hover)]',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 text-[13px]',
        sm: 'h-8 px-3 text-[12px]',
        lg: 'h-10 px-5 text-[14px]',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
