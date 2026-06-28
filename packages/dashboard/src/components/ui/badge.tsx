import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "border-[#176bff]/20 bg-[#eaf2ff] text-[#176bff] hover:bg-[#dfeaff]",
    secondary: "border-[#dbe6f5] bg-white/90 text-[#30415f] hover:bg-white",
    destructive: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    outline: "border-[#dbe6f5] bg-transparent text-[#30415f]",
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#176bff] focus:ring-offset-2 focus:ring-offset-[#f6f9fd]",
        variants[variant],
        className
      )}
      {...props}
    />
  )
}

export { Badge }
