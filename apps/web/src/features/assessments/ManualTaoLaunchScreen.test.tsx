import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MANUAL_TAO_LAUNCH_API,
  ManualTaoLaunchScreen,
} from "./ManualTaoLaunchScreen";

describe("ManualTaoLaunchScreen", () => {
  it("renders a Harly loading experience that submits to the protected API", () => {
    const markup = renderToStaticMarkup(createElement(ManualTaoLaunchScreen));

    expect(markup).toContain("Your assessment is almost ready");
    expect(markup).toContain("Secure LTI 1.3 launch");
    expect(markup).toContain("Continue now");
    expect(markup).toContain(`action="${MANUAL_TAO_LAUNCH_API}"`);
    expect(markup).toContain('method="get"');
    expect(markup).toContain('aria-busy="true"');
  });
});
