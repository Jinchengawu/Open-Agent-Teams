import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

const buttonVariants = {
  variant: {
    default: "border border-[#111820] bg-[#111820] text-white shadow-[7px_7px_0_rgba(255,92,31,0.14)] hover:bg-black",
    destructive: "border border-red-700 bg-red-600 text-white hover:bg-red-700",
    outline: "border border-slate-300 bg-white/70 text-[#111820] hover:border-slate-400 hover:bg-white",
    secondary: "border border-slate-200 bg-slate-100 text-[#111820] hover:bg-slate-200",
    ghost: "text-slate-700 hover:bg-slate-100 hover:text-[#111820]",
    link: "text-[#007f96] underline-offset-4 hover:underline",
  },
  size: {
    default: "h-10 px-4 py-2",
    sm: "h-9 rounded-md px-3",
    lg: "h-11 rounded-md px-8",
    icon: "h-10 w-10",
  },
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center rounded-md text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007f96] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f9fa] disabled:pointer-events-none disabled:opacity-50",
          buttonVariants.variant[variant],
          buttonVariants.size[size],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
