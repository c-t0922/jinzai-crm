import type { NextConfig } from "next";

// 社内業務システムのため全画面がユーザー依存の動的データ。
// Cache Components は使わず、従来の動的レンダリングで運用する（docs/02 参照）。
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 一度開いた画面は 30 秒間ブラウザ側の結果を再利用し、戻る・行き来を即時表示にする
  // （サーバーが米国・DB が東京のため 1 画面の取得に約 1 秒かかる。更新操作後は revalidatePath で破棄される）
  experimental: { staleTimes: { dynamic: 30 } },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
