"use client";
import { useEffect } from "react";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 個人情報を含めないため digest のみ出力
    console.error("[app] render error", error.digest ?? "");
  }, [error]);
  return (
    <div className="p-6">
      <ErrorState
        title="画面の表示に失敗しました"
        description={`時間をおいて再度お試しください。解決しない場合は管理者にお問い合わせください。${error.digest ? `（エラーID：${error.digest}）` : ""}`}
        action={<Button onClick={reset}>再読み込み</Button>}
      />
    </div>
  );
}
