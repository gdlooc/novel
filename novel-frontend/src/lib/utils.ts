/**
 * shadcn/ui 标准工具函数 — 合并 className 并智能去重。
 *
 * clsx 处理条件类名、数组、对象的合并，
 * twMerge 解决 Tailwind 类名冲突（如同一个属性后设置的类覆盖前者）。
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并任意数量的 className 输入，自动处理 Tailwind 冲突 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
