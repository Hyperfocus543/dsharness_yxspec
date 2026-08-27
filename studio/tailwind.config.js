/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ===================================================================
      // Claude 暖白视觉（colorspace skill · claude 品牌设计系统）
      // 直接覆盖 Tailwind 内置色板为 Claude 暖系值：组件类名不用动，
      // zinc-* → 暖中性、emerald-* → 赤陶、red-* → 暖绯、blue-* → coral，
      // 一套配置即全局换肤。铁律：零冷灰、零饱和杂色。
      // ===================================================================
      colors: {
        // ---- zinc：中性灰 → Claude 暖中性（带黄棕调）----
        zinc: {
          50: "#faf9f5", // Ivory（比 parchment 略浅的面板）
          100: "#f5f4ed", // Parchment 暖羊皮纸
          200: "#e8e6dc", // Border Warm 暖边框
          300: "#ded9cc", // Ring Warm hover
          400: "#b0aea5", // Warm Silver（深底上的浅字）
          500: "#87867f", // Stone Gray 三级文字
          600: "#5e5d59", // Olive Gray 次级正文
          700: "#4d4c48", // Charcoal Warm 主文/按钮字
          800: "#3d3d3a", // Dark Warm 强调文
          900: "#141413", // Near Black 暖近黑（最深）
          950: "#141413",
        },
        // ---- emerald：主强调 → Terracotta 赤陶橙 ----
        emerald: {
          50: "#fdf0ea", // 赤陶浅底
          100: "#f8e0d3",
          200: "#f0c3ac",
          300: "#e5a07f",
          400: "#db8b64",
          500: "#d97757", // Coral 浅赤陶
          600: "#c96442", // Terracotta Brand 主强调（主按钮/当前态）
          700: "#ab5235",
          800: "#8a4129",
          900: "#6b3220",
          950: "#4c2417",
        },
        // ---- sage：成功/通过/完成 → 柔和暖绿（区别于阻塞的暖绯红，避免"通过/阻塞同色"）----
        sage: {
          50: "#f3f6ed", // 极浅暖绿底（完成态卡面）
          100: "#e6ecd9",
          200: "#cdd8b6",
          300: "#aebe8f",
          400: "#8fa46b",
          500: "#728a52", // Sage 主色（完成态圆点/描边）
          600: "#5c7042", // 深 sage（通过态图标/文字）
          700: "#4a5a36",
          800: "#3a4730",
          900: "#2e3828",
        },
        // ---- red：错误 → Crimson 暖绯 ----
        red: {
          50: "#fbeae9",
          100: "#f6d3d1",
          200: "#eba8a4",
          300: "#df7b76",
          400: "#d25d57",
          500: "#c24a44",
          600: "#b53333", // Crimson 暖绯错误
          700: "#962a2a",
          800: "#772222",
          900: "#5a1a1a",
          950: "#3d1212",
        },
        // ---- blue：链接/焦点 → Coral 暖珊瑚（非冷蓝）----
        blue: {
          50: "#fdf1ed",
          100: "#fbe2da",
          200: "#f6c5b7",
          300: "#f0a18d",
          400: "#e98468",
          500: "#e26d4e",
          600: "#d97757", // Coral
          700: "#bf5b3e",
          800: "#9a472f",
          900: "#7a3724",
          950: "#54251a",
        },
        // ---- orange：待审（保留暖橙）----
        orange: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
        },
        // ---- 阶段状态色（驾驶舱节点/徽章，暖调语义色）----
        // completed/done 用 sage（暖绿，与阻塞绯红区分）；in_progress 琥珀；
        // rejected/blocked 暖绯；pending_review 暖橙；stale 紫
        cockpit: {
          completed: "#728a52", // sage 500（通过态，柔和不乍眼）
          in_progress: "#f59e0b", // 琥珀
          pending: "#87867f", // 暖灰
          pending_review: "#fb923c", // 暖橙
          rejected: "#b53333", // 暖绯
          blocked: "#962a2a", // 深绯
          stale: "#a855f7", // 紫
        },
      },
      // ===================================================================
      // 字号：整体放大一档（解决"字太小"）
      // xs 12px→15px、sm 14px→15px、base 16px→17px（Claude Body Standard）
      // 任意值类 text-[10px]/[11px] 需单独清理（见 tailwind.css）
      // ===================================================================
      fontSize: {
        xs: ["0.9375rem", { lineHeight: "1.25rem" }], // 15px
        sm: ["0.9375rem", { lineHeight: "1.25rem" }], // 15px
        base: ["1.0625rem", { lineHeight: "1.625rem" }], // 17px
        lg: ["1.125rem", { lineHeight: "1.75rem" }], // 18px
        xl: ["1.375rem", { lineHeight: "1.875rem" }], // 22px
        "2xl": ["1.625rem", { lineHeight: "2.125rem" }], // 26px
      },
      // ===================================================================
      // 阴影：Claude 暖系 —— ring-shadow + whisper，不用冷灰 drop-shadow
      // ===================================================================
      boxShadow: {
        ring: "0 0 0 1px rgba(0,0,0,0.08)", // ring-shadow 暖透明黑
        whisper: "0 4px 24px rgba(0,0,0,0.05)", // 极柔悬浮
      },
      fontFamily: {
        // 标题可选衬线（Claude 品牌 Serif 精神，Georgia fallback）
        serif: ['Georgia', '"Noto Serif SC"', "Songti SC", "SimSun", "serif"],
      },
    },
  },
  plugins: [],
};
