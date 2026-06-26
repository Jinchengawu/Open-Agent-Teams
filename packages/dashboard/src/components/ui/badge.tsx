import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "border-[#007f96]/20 bg-[#007f96]/8 text-[#007f96] hover:bg-[#007f96]/12",
    secondary: "border-slate-200 bg-white/72 text-slate-700 hover:bg-white",
    destructive: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    outline: "border-slate-300 bg-transparent text-slate-700",
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus:outline-none focus:ring-2 focus:ring-[#007f96] focus:ring-offset-2 focus:ring-offset-[#f7f9fa]",
        variants[variant],
        className
      )}
      {...props}
    />
  )
}

export { Badge }
