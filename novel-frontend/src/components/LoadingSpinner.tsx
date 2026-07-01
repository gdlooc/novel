/**
 * LoadingSpinner — 通用加载指示器。
 *
 * 使用 Tailwind 内置 animate-spin 动画，无需自定义 keyframes。
 *
 * @param message - 加载提示文字，默认"加载中..."
 * @param size - 旋转环大小（px），默认 32，通过行内 style 控制
 */
import React from 'react';

export interface LoadingSpinnerProps {
  message?: string;
  size?: number;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = '加载中...',
  size = 32,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
      {/* 旋转环 — 使用 Tailwind 内置 animate-spin */}
      <div
        style={{ width: size, height: size }}
        className="border-[3px] border-border border-t-primary rounded-full animate-spin mb-3"
      />
      <div className="text-sm">{message}</div>
    </div>
  );
};
