/**
 * ErrorView — 通用错误提示组件。
 *
 * @param message - 错误信息
 * @param onRetry - 重试回调（可选）
 * @param onBack - 返回回调（可选）
 */
import React from 'react';
import { Button } from '@/components/ui/button';

export interface ErrorViewProps {
  message?: string;
  onRetry?: () => void;
  onBack?: () => void;
}

export const ErrorView: React.FC<ErrorViewProps> = ({
  message = '出错了',
  onRetry,
  onBack,
}) => {
  return (
    <div className="flex items-center justify-center h-full bg-background text-foreground">
      <div className="text-center p-8">
        <div className="text-5xl mb-3">😞</div>
        <div className="text-[15px] text-muted-foreground mb-5">
          {message}
        </div>
        <div className="flex gap-2.5 justify-center">
          {onRetry && (
            <Button onClick={onRetry}>
              重试
            </Button>
          )}
          {onBack && (
            <Button variant="outline" onClick={onBack}>
              返回
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
