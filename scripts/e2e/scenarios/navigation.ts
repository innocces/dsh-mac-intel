import { assertNavigationState } from "../assertions.ts";
import type { E2ePage } from "../page.ts";
import { pause } from "../runtime.ts";

/** Verify every numbered navigation step, its scroll destination, and its highlight. */
export async function verifyNavigationScenario(page: E2ePage): Promise<void> {
  const steps = [
    {
      id: "shortcuts",
      caption: "02 · 快捷方式：插件与官方功能直达",
    },
    {
      id: "updates",
      caption: "03 · 更新中心：插件、Harness 与桌面壳独立更新",
    },
    {
      id: "environment",
      caption: "04 · 环境检测：缺失项与可选依赖一目了然",
    },
    {
      id: "settings",
      caption: "05 · 连接设置：保存 SSH / HTTPS 配置",
    },
  ];

  for (const step of steps) {
    await page.click(`.side-nav a[href="#${step.id}"]`);
    await page.waitFor(
      `document.querySelector('.side-nav a[href="#${step.id}"]')?.classList.contains('active')`,
      `${step.id} 导航高亮`,
    );
    await page.waitFor(
      `Math.abs(document.getElementById('${step.id}').getBoundingClientRect().top) < 80`,
      `${step.id} 滚动位置`,
    );
    await page.setCaption(step.caption);
    await pause(1_100);
    await assertNavigationState(page, step.id);
  }
}
