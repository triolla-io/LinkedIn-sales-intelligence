import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SendWindowPicker, type SendWindow } from "@/components/prospecting/send-window-picker";

afterEach(() => {
  cleanup();
});

const base: SendWindow = { sendDays: [0, 1, 2, 3, 4], sendHoursStart: 9, sendHoursEnd: 18 };

describe("SendWindowPicker", () => {
  it("renders 7 day chips with the active ones pressed", () => {
    render(<SendWindowPicker value={base} onChange={() => {}} />);
    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(7);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true"); // Sunday
    expect(chips[5]).toHaveAttribute("aria-pressed", "false"); // Friday
  });

  it("toggles a day off", () => {
    const onChange = vi.fn();
    render(<SendWindowPicker value={base} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button")[4]); // Thursday
    expect(onChange).toHaveBeenCalledWith({ ...base, sendDays: [0, 1, 2, 3] });
  });

  it("toggles a day on, keeping the list sorted", () => {
    const onChange = vi.fn();
    render(<SendWindowPicker value={base} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button")[6]); // Saturday
    expect(onChange).toHaveBeenCalledWith({ ...base, sendDays: [0, 1, 2, 3, 4, 6] });
  });

  it("refuses to untoggle the last remaining day", () => {
    const onChange = vi.fn();
    render(<SendWindowPicker value={{ ...base, sendDays: [2] }} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button")[2]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers only end hours after the start hour", () => {
    render(<SendWindowPicker value={{ ...base, sendHoursStart: 16 }} onChange={() => {}} />);
    const endSelect = screen.getByLabelText("שעת סיום") as HTMLSelectElement;
    const values = Array.from(endSelect.options).map((o) => Number(o.value));
    expect(Math.min(...values)).toBe(17);
    expect(Math.max(...values)).toBe(24);
  });

  it("bumps the end hour when the start moves past it", () => {
    const onChange = vi.fn();
    render(<SendWindowPicker value={{ ...base, sendHoursStart: 9, sendHoursEnd: 10 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("שעת התחלה"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith({ ...base, sendHoursStart: 12, sendHoursEnd: 13 });
  });

  it("shows the live summary sentence", () => {
    render(<SendWindowPicker value={base} onChange={() => {}} />);
    expect(screen.getByText("יישלח בימים א׳–ה׳, בין 09:00 ל־18:00 (שעון ישראל)")).toBeInTheDocument();
  });
});
