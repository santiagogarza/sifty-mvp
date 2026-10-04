// @vitest-environment jsdom
import { PageHeader } from "@/components/app-shell/page-header";
import { TopBar } from "@/components/app-shell/top-bar";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("mobile page heading", () => {
  it("exposes exactly one h1 when the top bar and page header both show a title", () => {
    render(
      <>
        <TopBar title="Focus" onCapture={vi.fn()} onCommand={vi.fn()} />
        <PageHeader title="Focus" />
      </>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Focus");
  });
});
