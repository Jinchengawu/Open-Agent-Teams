import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

const buttonVariants = {
  variant: {
    default: "border border-[#176bff] bg-[#176bff] text-white shadow-[0_12px_26px_rgba(23,107,255,0.20)] hover:bg-[#0f5ee8]",
    destructive: "border border-red-700 bg-red-600 text-white hover:bg-red-700",
    outline: "border border-[#dbe6f5] bg-white/90 text-[#10182b] hover:border-[#b9c9df] hover:bg-white",
    secondary: "border border-[#dbe6f5] bg-[#f4f7fb] text-[#10182b] hover:bg-[#eaf2ff]",
    ghost: "text-[#30415f] hover:bg-[#f4f7fb] hover:text-[#176bff]",
    link: "text-[#176bff] underline-offset-4 hover:underline",
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
          "inline-flex items-center justify-center rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176bff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f9fd] disabled:pointer-events-none disabled:opacity-50",
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
