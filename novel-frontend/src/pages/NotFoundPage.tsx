/**
 * NotFoundPage — 404 页面。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center h-full bg-background text-foreground">
      <div className="text-center p-8">
        <div className="text-6xl mb-3">📖</div>
        <h1 className="text-2xl font-bold mb-2">404</h1>
        <p className="text-sm text-muted-foreground mb-5">页面不存在</p>
        <Button onClick={() => navigate('/')} size="lg">返回首页</Button>
      </div>
    </div>
  );
};
