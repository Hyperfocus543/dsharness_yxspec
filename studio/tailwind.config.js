/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 全局字号放大（需求 2：字太小看不清）
      // text-xs 从默认 12px 提到 14px，让所有用到 text-xs 的地方自动放大，
      // 避免逐个组件改类名。text-sm 保持 14px，text-base 保持 16px。
      fontSize: {
        xs: ["0.875rem", { lineHeight: "1.25rem" }], // 12px -> 14px
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
      },
      colors: {
        // 阶段状态色：completed/in_progress/pending/pending_review/rejected/blocked/stale
        cockpit: {
          completed: "#10b981",
          in_progress: "#f59e0b",
          pending: "#9ca3af",
          pending_review: "#fb923c",
          rejected: "#ef4444",
          blocked: "#dc2626",
          stale: "#a855f7",
        },
      },
    },
  },
  plugins: [],
};
