/** Badge 徽标组件 — shadcn/ui 风格 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow",
        outline: "text-foreground",
        success: "border-transparent bg-emerald-100 text-emerald-700",
        warning: "border-transparent bg-amber-100 text-amber-700",
        info: "border-transparent bg-blue-100 text-blue-700",
        s: "border-transparent bg-red-100 text-red-700",
        a: "border-transparent bg-orange-100 text-orange-700",
        b: "border-transparent bg-yellow-100 text-yellow-700",
        c: "border-transparent bg-green-100 text-green-700",
        d: "border-transparent bg-sky-100 text-sky-700",
        e: "border-transparent bg-slate-100 text-slate-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

// 评分徽标辅助函数
export function getRatingVariant(rating: string): VariantProps<typeof badgeVariants>["variant"] {
  const key = rating.replace("级", "").toLowerCase()
  return (badgeVariants as any).variants?.variant?.[key] ? key as any : "outline"
}

export { Badge, badgeVariants }
