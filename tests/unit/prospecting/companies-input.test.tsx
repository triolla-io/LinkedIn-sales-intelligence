import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CompaniesInput } from "@/components/prospecting/companies-input";

afterEach(() => {
  cleanup();
});

describe("CompaniesInput", () => {
  it("shows a live tabular count of parsed companies", () => {
    render(
      <CompaniesInput
        value={"Acme\nhttps://www.linkedin.com/company/globex"}
        onChange={() => {}}
        file={null}
        onFileChange={() => {}}
      />,
    );
    expect(screen.getByText("2 חברות")).toBeInTheDocument();
  });

  it("propagates textarea edits", () => {
    const onChange = vi.fn();
    render(
      <CompaniesInput
        value=""
        onChange={onChange}
        file={null}
        onFileChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Acme" },
    });
    expect(onChange).toHaveBeenCalledWith("Acme");
  });

  it("shows the selected file as a removable chip", () => {
    const onFileChange = vi.fn();
    render(
      <CompaniesInput
        value=""
        onChange={() => {}}
        file={new File(["x"], "companies.xlsx")}
        onFileChange={onFileChange}
      />,
    );
    expect(screen.getByText("companies.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("הסר קובץ"));
    expect(onFileChange).toHaveBeenCalledWith(null);
  });
});
